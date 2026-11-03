import JSZip from 'jszip';
import { db, defaultJournalId, type Entry, type Journal, type Media } from './db';

/**
 * Everything lives in this browser's storage, so a backup file is the way to
 * keep a safe copy or move the journal to another computer.
 */
const extFor = (type: string) =>
  ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic', 'video/mp4': 'mp4', 'audio/webm': 'webm', 'audio/mp4': 'm4a' } as Record<string, string>)[type] ?? 'bin';

/** A backup of every journal, or of just the given ones. */
export async function exportBackup(journalIds?: string[]): Promise<Blob> {
  const zip = new JSZip();
  const only = journalIds && new Set(journalIds);
  const journals = (await db.journals.toArray()).filter((j) => !only || only.has(j.id));
  const entries = (await db.entries.toArray()).filter((e) => !only || only.has(e.journalId));
  const entryIds = new Set(entries.map((e) => e.id));
  const media = (await db.media.toArray()).filter((m) => !only || entryIds.has(m.entryId));
  const mediaMeta = media.map(({ blob, ...m }) => ({ ...m, type: blob.type, file: `media/${m.id}.${extFor(blob.type)}` }));
  zip.file('journal.json', JSON.stringify({ version: 2, exportedAt: Date.now(), journals, entries, media: mediaMeta }, null, 2));
  media.forEach((m, i) => zip.file(mediaMeta[i].file, m.blob));
  return zip.generateAsync({ type: 'blob' });
}

export async function restoreBackup(file: Blob): Promise<{ entries: number; skipped: number }> {
  const zip = await JSZip.loadAsync(file);
  const json = zip.file('journal.json');
  if (!json) throw new Error('This is not a journal backup file (journal.json is missing).');
  const data = JSON.parse(await json.async('string')) as {
    journals?: Journal[];
    entries: Entry[];
    media: (Omit<Media, 'blob'> & { type: string; file: string })[];
  };
  // Older backups have no journals: their entries go into the default journal.
  const knownJournals = new Set(await db.journals.toCollection().primaryKeys());
  const newJournals = (data.journals ?? []).filter((j) => !knownJournals.has(j.id));
  newJournals.forEach((j) => knownJournals.add(j.id));
  const fallback = await defaultJournalId();
  const existing = new Set(await db.entries.toCollection().primaryKeys());
  const fresh = data.entries
    .filter((e) => !existing.has(e.id))
    .map((e) => (e.journalId && knownJournals.has(e.journalId) ? e : { ...e, journalId: fallback }));
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
  return { entries: fresh.length, skipped: data.entries.length - fresh.length };
}

export function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
