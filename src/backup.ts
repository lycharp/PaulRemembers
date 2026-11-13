import JSZip from 'jszip';
import { db, defaultJournalId, isOwnJournal, type Entry, type Journal, type Media } from './db';
import { cloudUser, syncNow } from './cloud/cloud';
import { clearShares, membersOf, setMembers, type Member } from './cloud/sharing';
import { sdb } from './cloud/sync';

/**
 * Everything lives in this browser's storage, so a backup file is the way to
 * keep a safe copy or move the journal to another computer.
 *
 * journal.json versions: 1 = entries only, 2 = + journals, 3 = + who each of
 * your journals is shared with (only when the backup was made signed in).
 */
const extFor = (type: string) =>
  ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic', 'video/mp4': 'mp4', 'audio/webm': 'webm', 'audio/mp4': 'm4a' } as Record<string, string>)[type] ?? 'bin';

interface BackupData {
  version?: number;
  exportedAt?: number;
  journals?: Journal[];
  entries: Entry[];
  media: (Omit<Media, 'blob'> & { type: string; file: string })[];
  /** Journal id → the people it was shared with. Missing when the backup was made signed out or offline. */
  shares?: Record<string, Member[]>;
}

export interface BuiltBackup {
  blob: Blob;
  entries: number;
  /** False when signed in but the sharing list could not be fetched (offline). */
  sharesIncluded: boolean;
}

/** A backup of every journal, or of just the given ones. */
export async function buildBackup(journalIds?: string[]): Promise<BuiltBackup> {
  const zip = new JSZip();
  const only = journalIds && new Set(journalIds);
  // Journals other people shared with you are left out: they are safe in their
  // owner's account, restore can't bring them back, and it keeps their entries out of your file.
  const journals = (await db.journals.toArray()).filter((j) => isOwnJournal(j) && (!only || only.has(j.id)));
  const kept = new Set(journals.map((j) => j.id));
  const entries = (await db.entries.toArray()).filter((e) => kept.has(e.journalId));
  const entryIds = new Set(entries.map((e) => e.id));
  const media = (await db.media.toArray()).filter((m) => entryIds.has(m.entryId));
  const mediaMeta = media.map(({ blob, ...m }) => ({ ...m, type: blob.type, file: `media/${m.id}.${extFor(blob.type)}` }));
  let shares: Record<string, Member[]> | undefined;
  let sharesIncluded = true;
  if (cloudUser()) {
    try {
      shares = await membersOf(journals.map((j) => j.id));
    } catch {
      sharesIncluded = false;
    }
  }
  const data: BackupData = { version: 3, exportedAt: Date.now(), journals, entries, media: mediaMeta, shares };
  zip.file('journal.json', JSON.stringify(data, null, 2));
  media.forEach((m, i) => zip.file(mediaMeta[i].file, m.blob));
  return { blob: await zip.generateAsync({ type: 'blob' }), entries: entries.length, sharesIncluded };
}

export async function exportBackup(journalIds?: string[]): Promise<Blob> {
  return (await buildBackup(journalIds)).blob;
}

// ─── Restore ────────────────────────────────────────────────────────────────

/** Entries of an older backup that has no journal list. */
export const OLD_BACKUP_GROUP = '';

export interface BackupJournal {
  /** OLD_BACKUP_GROUP for entries of an older backup without journals. */
  id: string;
  name: string;
  color?: string;
  entries: number;
  /** Already on this device: restoring only adds the entries it is missing. */
  here: boolean;
  /** Someone else's journal that was shared with you: it can't be restored. */
  ownerEmail?: string;
  theirs: boolean;
  /** Who it was shared with, if the backup knows. */
  shares?: Member[];
}

export interface OpenedBackup {
  zip: JSZip;
  data: BackupData;
  journals: BackupJournal[];
  exportedAt?: number;
  /** The backup includes the sharing list (made while signed in). */
  hasShares: boolean;
}

/** Read a backup file and list what is in it, without changing anything. */
export async function openBackup(file: Blob): Promise<OpenedBackup> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    throw new Error('This file is not a journal backup (it could not be opened as a .zip).');
  }
  const json = zip.file('journal.json');
  if (!json) throw new Error('This is not a journal backup file (journal.json is missing).');
  const data = JSON.parse(await json.async('string')) as BackupData;
  data.entries ??= [];
  data.media ??= [];
  const local = new Set(await db.journals.toCollection().primaryKeys());
  const inFile = new Map((data.journals ?? []).map((j) => [j.id, j]));
  const counts = new Map<string, number>();
  for (const e of data.entries) {
    const g = e.journalId && inFile.has(e.journalId) ? e.journalId : OLD_BACKUP_GROUP;
    counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  const journals: BackupJournal[] = (data.journals ?? []).map((j) => ({
    id: j.id,
    name: j.name,
    color: j.color,
    entries: counts.get(j.id) ?? 0,
    here: local.has(j.id),
    theirs: !isOwnJournal(j),
    ownerEmail: j.ownerEmail,
    shares: data.shares?.[j.id],
  }));
  if (counts.get(OLD_BACKUP_GROUP))
    journals.push({ id: OLD_BACKUP_GROUP, name: 'Entries from an older backup', entries: counts.get(OLD_BACKUP_GROUP)!, here: false, theirs: false });
  return { zip, data, journals, exportedAt: data.exportedAt, hasShares: !!data.shares };
}

export interface RestoreResult {
  entries: number;
  skipped: number;
  journals: number;
  /** People given access again. */
  shared: number;
  /** Something that did not work, in plain words. */
  warning?: string;
}

/**
 * Put the chosen journals back.
 * - Entries already on this device are left alone (never overwritten).
 * - Restored journals, entries and photos count as new changes, so when signed
 *   in they upload and reach every device, even after "Delete for good".
 * - shares: journal id → the people to share it with again. Only used for
 *   journals that were not on this device, and only when signed in.
 */
export async function restoreBackup(b: OpenedBackup, journalIds: string[], shares: Record<string, Member[]> = {}): Promise<RestoreResult> {
  const signedIn = !!cloudUser();
  // Bring this device up to date first, so "already here" also covers what is online.
  if (signedIn) await syncNow();

  const { data, zip } = b;
  const chosen = new Set(journalIds);
  const restorable = new Map(b.journals.filter((j) => !j.theirs && chosen.has(j.id)).map((j) => [j.id, j]));
  const localJournals = new Set(await db.journals.toCollection().primaryKeys());
  const now = Date.now();
  const newJournals: Journal[] = (data.journals ?? [])
    .filter((j) => restorable.has(j.id) && !localJournals.has(j.id))
    // It becomes yours on this device; the account fills in the owner when it syncs.
    .map(({ ownerId: _o, ownerEmail: _e, role: _r, ...j }) => ({ ...j, updatedAt: now }));
  const inFile = new Set((data.journals ?? []).map((j) => j.id));
  const groupOf = (e: Entry) => (e.journalId && inFile.has(e.journalId) ? e.journalId : OLD_BACKUP_GROUP);
  const wanted = data.entries.filter((e) => restorable.has(groupOf(e)));
  const fallback = restorable.has(OLD_BACKUP_GROUP) ? await defaultJournalId() : '';
  const existing = new Set(await db.entries.toCollection().primaryKeys());
  const fresh = wanted
    .filter((e) => !existing.has(e.id))
    .map((e) => ({ ...e, journalId: groupOf(e) === OLD_BACKUP_GROUP ? fallback : e.journalId, mediaIds: e.mediaIds ?? [], updatedAt: now }));
  const freshIds = new Set(fresh.map((e) => e.id));
  const media: Media[] = [];
  for (const { type, file: path, ...m } of data.media) {
    if (!freshIds.has(m.entryId)) continue;
    const f = zip.file(path);
    if (f) media.push({ ...m, blob: new Blob([await f.async('blob')], { type }) });
  }
  await db.transaction('rw', db.journals, db.entries, db.media, async () => {
    await db.journals.bulkPut(newJournals);
    await db.media.bulkPut(media);
    await db.entries.bulkPut(fresh);
  });
  const result: RestoreResult = { entries: fresh.length, skipped: wanted.length - fresh.length, journals: newJournals.length, shared: 0 };

  // Sharing: only for journals that came back, and only online.
  if (signedIn && newJournals.length) {
    try {
      await syncNow();
      const waiting = await sdb.outbox.bulkGet(newJournals.map((j) => `journal:${j.id}`));
      if (waiting.some(Boolean)) throw new Error('the journal has not finished uploading');
      // Old private links to restored entries stay off; the people you selected get access again.
      await clearShares([], [...freshIds]);
      for (const j of newJournals) {
        const people = shares[j.id] ?? [];
        result.shared += await setMembers(j.id, people);
      }
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      result.warning = `Your entries are back, but sharing could not be set up (${why}). You can share the journal again from Settings → Share a journal.`;
    }
  }
  return result;
}

// ─── File names and saving ─────────────────────────────────────────────────

/** Which account a backup is from, for file names and the log: the part of the email before the @. */
export function accountLabel(): string {
  const email = cloudUser()?.email;
  return email ? email.split('@')[0].replace(/[\\/:*?"<>|]+/g, '-') : 'not signed in';
}

const two = (n: number) => String(n).padStart(2, '0');
export const fileDate = (d = new Date()) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;

/** "Paul Remembers backup - paulprachyl - 2026-11-10.zip" (with the journal name for a one-journal backup). */
export function backupFileName(journalName?: string, d = new Date()) {
  const journal = journalName ? ` - ${journalName.replace(/[\\/:*?"<>|]+/g, '-')}` : '';
  return `Paul Remembers backup - ${accountLabel()}${journal} - ${fileDate(d)}.zip`;
}

export type Saved = { where: 'file' | 'download'; file: string } | null;

/** This browser has a "Save as" window (Edge and Chrome on a computer). */
export const canSaveAs = () => typeof window !== 'undefined' && 'showSaveFilePicker' in window && window.isSecureContext;

/**
 * Make a backup and save it. In Edge and Chrome a "Save as" window lets the
 * person pick the folder (it opens in the one used last time); elsewhere it
 * downloads. The window opens first, while the click still counts, and the
 * backup is made after. Returns null if they cancelled.
 */
export async function saveBackup(make: () => Promise<BuiltBackup>, name: string): Promise<{ saved: Saved; backup?: BuiltBackup }> {
  if (canSaveAs()) {
    type Picker = (o: object) => Promise<FileSystemFileHandle>;
    let handle: FileSystemFileHandle | null = null;
    try {
      handle = await (window as unknown as { showSaveFilePicker: Picker }).showSaveFilePicker({
        id: 'paul-remembers-backup',
        suggestedName: name,
        startIn: 'documents',
        types: [{ description: 'Journal backup', accept: { 'application/zip': ['.zip'] } }],
      });
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return { saved: null };
      // The window couldn't open (for example the click timed out): download instead.
    }
    if (handle) {
      const backup = await make();
      const w = await handle.createWritable();
      await w.write(backup.blob);
      await w.close();
      return { saved: { where: 'file', file: handle.name }, backup };
    }
  }
  const backup = await make();
  download(backup.blob, name);
  return { saved: { where: 'download', file: name }, backup };
}

export function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
