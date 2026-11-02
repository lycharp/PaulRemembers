/**
 * Two-way sync between the local Dexie database and Supabase.
 *
 * - Local writes are noticed by Dexie hooks and queued in a separate small
 *   database ("journal-sync"), so the rest of the app does not need to know
 *   about sync at all and keeps working offline.
 * - push() sends queued journals, entries and media (files go to Storage).
 * - pull() fetches rows changed since the last pull. Conflicts are settled by
 *   the record's updatedAt: the newest write wins.
 */
import Dexie, { type Table, type Transaction } from 'dexie';
import type { SupabaseClient } from '@supabase/supabase-js';
import { db, type Entry, type Journal, type Media } from '../db';

export type Kind = 'journal' | 'entry' | 'media';
export type Role = 'owner' | 'editor' | 'viewer';

/** Extra fields a synced journal carries locally. */
export interface CloudJournalInfo {
  ownerId?: string;
  ownerEmail?: string;
  role?: Role;
}
export type LocalJournal = Journal & CloudJournalInfo;

interface OutboxItem {
  key: string; // `${kind}:${id}`
  kind: Kind;
  id: string;
  deleted: boolean;
  /** For media deletes: where the file lives in Storage. */
  entryId?: string;
  at: number;
}

class SyncDB extends Dexie {
  outbox!: Table<OutboxItem, string>;
  /** updated_at of the version this device last saw on the server, per record. */
  known!: Table<{ key: string; updatedAt: number }, string>;
  state!: Table<{ key: string; value: unknown }, string>;
  constructor() {
    super('journal-sync');
    this.version(1).stores({ outbox: 'key, kind', known: 'key', state: 'key' });
  }
}
export const sdb = new SyncDB();

export async function getState<T>(key: string) {
  return (await sdb.state.get(key))?.value as T | undefined;
}
const setState = (key: string, value: unknown) => sdb.state.put({ key, value });

// ─── Change tracking ────────────────────────────────────────────────────────

const FROM_CLOUD = Symbol('fromCloud');
let onQueued: () => void = () => {};
export const setOnQueued = (fn: () => void) => (onQueued = fn);

function queue(tx: Transaction, kind: Kind, id: string, deleted: boolean, entryId?: string) {
  if ((tx as unknown as Record<symbol, boolean>)[FROM_CLOUD] || (Dexie.currentTransaction as unknown as Record<symbol, boolean> | null)?.[FROM_CLOUD]) return;
  const item: OutboxItem = { key: `${kind}:${id}`, kind, id, deleted, entryId, at: Date.now() };
  tx.on('complete', () => {
    sdb.outbox.put(item).then(() => onQueued());
  });
}

let tracking = false;
export function trackChanges() {
  if (tracking) return;
  tracking = true;
  const watch = <T extends { id: string }>(table: Table<T, string>, kind: Kind) => {
    table.hook('creating', function (pk, obj, tx) {
      queue(tx, kind, (pk as string) ?? obj.id, false);
    });
    table.hook('updating', function (_mods, pk, _obj, tx) {
      queue(tx, kind, pk as string, false);
    });
    table.hook('deleting', function (pk, obj, tx) {
      if (obj) queue(tx, kind, pk as string, true, (obj as unknown as Media).entryId);
    });
  };
  watch(db.journals, 'journal');
  watch(db.entries, 'entry');
  watch(db.media, 'media');
}

/** Run local writes that came from the server, without queueing them for upload. */
export async function withoutSync(fn: () => Promise<void>) {
  await db.transaction('rw', db.journals, db.entries, db.media, async (tx) => {
    (tx as unknown as Record<symbol, boolean>)[FROM_CLOUD] = true;
    await fn();
  });
}

export const pendingCount = () => sdb.outbox.count();

// ─── Push ───────────────────────────────────────────────────────────────────

const ORDER: Record<Kind, number> = { journal: 0, entry: 1, media: 2 };
const isDenied = (e: { code?: string; message?: string; statusCode?: string } | null) =>
  !!e && (e.code === '42501' || e.statusCode === '403' || /row-level security|not authorized|unauthorized/i.test(e.message ?? ''));

function strip<T extends object>(o: T, keys: string[]) {
  const c = { ...o } as Record<string, unknown>;
  keys.forEach((k) => delete c[k]);
  return c;
}

async function done(item: OutboxItem, updatedAt?: number) {
  await sdb.transaction('rw', sdb.outbox, sdb.known, async () => {
    const cur = await sdb.outbox.get(item.key);
    if (cur && cur.at === item.at) await sdb.outbox.delete(item.key);
    if (updatedAt != null) await sdb.known.put({ key: item.key, updatedAt });
  });
}

export async function push(sb: SupabaseClient, userId: string, onProgress?: (left: number) => void) {
  const items = (await sdb.outbox.toArray()).sort((a, b) =>
    a.deleted !== b.deleted ? (a.deleted ? 1 : -1) : a.deleted ? ORDER[b.kind] - ORDER[a.kind] : ORDER[a.kind] - ORDER[b.kind]
  );
  const journals = new Map((await db.journals.toArray()).map((j) => [j.id, j as LocalJournal]));
  const roleOf = (journalId?: string) => {
    const j = journalId ? journals.get(journalId) : undefined;
    return j?.role ?? (j?.ownerId && j.ownerId !== userId ? 'viewer' : 'owner');
  };
  let left = items.length;
  const tick = () => onProgress?.(--left);

  for (const item of items) {
    const now = Date.now();
    if (item.deleted) {
      const table = item.kind === 'journal' ? 'journals' : item.kind === 'entry' ? 'entries' : 'media';
      if (item.kind === 'media' && item.entryId) await sb.storage.from('media').remove([`${item.entryId}/${item.id}`]);
      const { error } = await sb.from(table).update({ deleted: true, data: {}, updated_at: now }).eq('id', item.id);
      if (error && !isDenied(error)) throw error;
      await done(item, now);
      tick();
      continue;
    }

    if (item.kind === 'journal') {
      const j = journals.get(item.id);
      if (!j || roleOf(j.id) !== 'owner') {
        await done(item);
      } else {
        const { error } = await sb.from('journals').upsert({ id: j.id, data: strip(j, ['ownerId', 'ownerEmail', 'role']), updated_at: j.updatedAt });
        if (error && !isDenied(error)) throw error;
        await done(item, j.updatedAt);
      }
    } else if (item.kind === 'entry') {
      const e = await db.entries.get(item.id);
      if (!e || roleOf(e.journalId) === 'viewer') {
        await done(item);
      } else {
        const { error } = await sb.from('entries').upsert({ id: e.id, journal_id: e.journalId, data: e, updated_at: e.updatedAt, deleted: false });
        if (error && !isDenied(error)) throw error;
        await done(item, e.updatedAt);
      }
    } else {
      const m = await db.media.get(item.id);
      const entry = m && (await db.entries.get(m.entryId));
      if (!m || !entry || roleOf(entry.journalId) === 'viewer') {
        await done(item);
      } else {
        const path = `${m.entryId}/${m.id}`;
        const up = await sb.storage.from('media').upload(path, m.blob, { upsert: true, contentType: m.blob.type || 'application/octet-stream' });
        if (up.error && !isDenied(up.error as never)) throw up.error;
        const { blob, ...meta } = m;
        const { error } = await sb.from('media').upsert({ id: m.id, entry_id: m.entryId, data: { ...meta, type: blob.type }, path, updated_at: now, deleted: false });
        if (error && !isDenied(error)) throw error;
        await done(item, now);
      }
    }
    tick();
  }
}

// ─── Pull ───────────────────────────────────────────────────────────────────

interface Row {
  id: string;
  data: Record<string, unknown>;
  updated_at: number;
  deleted: boolean;
  synced_at: string;
}
interface JournalRow extends Row { owner_id: string; owner_email: string | null }
interface EntryRow extends Row { journal_id: string }
interface MediaRow extends Row { entry_id: string; path: string | null }

const PAGE = 500;
/** Re-read a little before the last cursor; rows committed late are not missed. */
const OVERLAP_MS = 2 * 60 * 1000;

async function fetchAll<T>(build: (from: number) => PromiseLike<{ data: T[] | null; error: unknown }>) {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

const chunks = <T,>(a: T[], n = 100) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

export async function pull(sb: SupabaseClient, user: { id: string; email?: string }) {
  const cursor = await getState<string>('cursor');
  const since = cursor ? new Date(new Date(cursor).getTime() - OVERLAP_MS).toISOString() : null;
  let maxSynced = cursor ?? '1970-01-01T00:00:00Z';
  const seen = (r: Row) => {
    if (r.synced_at > maxSynced) maxSynced = r.synced_at;
  };

  // Journals: always the full list (it is short), so new and removed shares show up.
  const jrows = await fetchAll<JournalRow>((f) => sb.from('journals').select('*').order('id').range(f, f + PAGE - 1));
  const { data: memberships, error: merr } = await sb.from('journal_members').select('journal_id, role').eq('email', (user.email ?? '').toLowerCase());
  if (merr) throw merr;
  const roles = new Map((memberships ?? []).map((m) => [m.journal_id as string, m.role as Role]));
  const localJournals = new Map((await db.journals.toArray()).map((j) => [j.id, j as LocalJournal]));
  const remoteIds = new Set(jrows.filter((j) => !j.deleted).map((j) => j.id));
  const newShared = jrows.filter((j) => !j.deleted && j.owner_id !== user.id && !localJournals.has(j.id)).map((j) => j.id);
  const gone = [...localJournals.values()].filter((j) => j.ownerId && j.ownerId !== user.id && !remoteIds.has(j.id)).map((j) => j.id);

  // Entries and media changed since the last pull, plus everything in journals shared with me since then.
  const erows = await fetchAll<EntryRow>((f) => {
    let q = sb.from('entries').select('*').order('synced_at').order('id').range(f, f + PAGE - 1);
    if (since) q = q.gt('synced_at', since);
    return q;
  });
  if (since && newShared.length) erows.push(...(await fetchAll<EntryRow>((f) => sb.from('entries').select('*').in('journal_id', newShared).order('id').range(f, f + PAGE - 1))));
  const mrows = await fetchAll<MediaRow>((f) => {
    let q = sb.from('media').select('*').order('synced_at').order('id').range(f, f + PAGE - 1);
    if (since) q = q.gt('synced_at', since);
    return q;
  });
  const sharedEntryIds = erows.filter((e) => newShared.includes(e.journal_id)).map((e) => e.id);
  if (since) for (const ids of chunks(sharedEntryIds)) mrows.push(...(await fetchAll<MediaRow>((f) => sb.from('media').select('*').in('entry_id', ids).order('id').range(f, f + PAGE - 1))));

  // Decide what to apply before opening the write transaction (it cannot wait on other work).
  const keys = [...jrows.map((r) => `journal:${r.id}`), ...erows.map((r) => `entry:${r.id}`), ...mrows.map((r) => `media:${r.id}`)];
  const known = new Map((await sdb.known.bulkGet(keys)).map((k, i) => [keys[i], k?.updatedAt]));
  const queued = new Set((await sdb.outbox.bulkGet(keys)).filter(Boolean).map((q) => q!.key));
  const localEntries = new Map((await db.entries.bulkGet(erows.map((e) => e.id))).filter(Boolean).map((e) => [e!.id, e!]));
  const localMedia = new Set((await db.media.bulkGet(mrows.map((m) => m.id))).filter(Boolean).map((m) => m!.id));
  /** Should a server version replace what this device has? */
  const isNewer = (key: string, updatedAt: number, localUpdatedAt?: number) => {
    const k = known.get(key);
    if (k != null && updatedAt <= k) return false;
    if (queued.has(key) && localUpdatedAt != null && localUpdatedAt > updatedAt) return false;
    return true;
  };

  // Download files (only new or changed ones).
  const blobs = new Map<string, Blob>();
  for (const m of mrows) {
    if (m.deleted || !m.path) continue;
    const key = `media:${m.id}`;
    if (localMedia.has(m.id) && (known.get(key) == null || !isNewer(key, m.updated_at))) continue;
    const { data, error } = await sb.storage.from('media').download(m.path);
    if (error || !data) continue; // try again next time
    blobs.set(m.id, new Blob([data], { type: (m.data.type as string) || data.type }));
  }

  const applied: { key: string; updatedAt: number }[] = [];
  const localUpdated = new Map<string, number>();
  await withoutSync(async () => {
    for (const j of jrows) {
      seen(j);
      const key = `journal:${j.id}`;
      const role: Role = j.owner_id === user.id ? 'owner' : roles.get(j.id) ?? 'viewer';
      const local = localJournals.get(j.id);
      const newer = !local || isNewer(key, j.updated_at, local.updatedAt);
      if (j.deleted) {
        if (local && newer) await removeJournal(j.id);
      } else if (newer || local.role !== role || local.ownerId !== j.owner_id) {
        const base = newer ? { ...(j.data as unknown as Journal), id: j.id, updatedAt: j.updated_at } : local;
        await db.journals.put({ ...base, ownerId: j.owner_id, ownerEmail: j.owner_email ?? undefined, role } as LocalJournal);
      }
      if (newer) applied.push({ key, updatedAt: j.updated_at });
      else if (local) localUpdated.set(key, local.updatedAt);
    }
    for (const id of gone) await removeJournal(id);

    for (const e of erows) {
      seen(e);
      const key = `entry:${e.id}`;
      const local = localEntries.get(e.id);
      if (!isNewer(key, e.updated_at, local?.updatedAt)) continue;
      if (e.deleted) {
        if (local) {
          await db.media.where('entryId').equals(e.id).delete();
          await db.entries.delete(e.id);
        }
      } else {
        const data = e.data as unknown as Entry;
        await db.entries.put({ ...data, id: e.id, journalId: e.journal_id, mediaIds: data.mediaIds ?? [], updatedAt: e.updated_at });
      }
      applied.push({ key, updatedAt: e.updated_at });
    }

    for (const m of mrows) {
      seen(m);
      const key = `media:${m.id}`;
      if (m.deleted) {
        if (isNewer(key, m.updated_at)) {
          await db.media.delete(m.id);
          applied.push({ key, updatedAt: m.updated_at });
        }
        continue;
      }
      const blob = blobs.get(m.id);
      if (!blob) continue;
      const { type: _type, ...meta } = m.data as Record<string, unknown>;
      await db.media.put({ ...(meta as unknown as Media), id: m.id, entryId: m.entry_id, blob });
      applied.push({ key, updatedAt: m.updated_at });
    }
  });

  await sdb.transaction('rw', sdb.known, sdb.outbox, async () => {
    await sdb.known.bulkPut(applied);
    // A server version that won replaces anything still queued for the same record.
    await sdb.outbox.bulkDelete(applied.map((a) => a.key));
  });
  await setState('cursor', maxSynced);
  return { journals: jrows.length, entries: erows.length, media: mrows.length };
}

async function removeJournal(id: string) {
  const ids = await db.entries.where('journalId').equals(id).primaryKeys();
  await db.media.where('entryId').anyOf(ids).delete();
  await db.entries.bulkDelete(ids);
  await db.journals.delete(id);
}

// ─── First sync on a device ─────────────────────────────────────────────────

/**
 * Link this device's journal to the signed-in account. Pulls the account's
 * entries first, then uploads what is only on this device, skipping local
 * entries that are already in the account (same date and title, e.g. the same
 * Apple Journal export imported on two computers) and merging journals that
 * have the same name.
 */
export async function linkDevice(sb: SupabaseClient, user: { id: string; email?: string }) {
  await pull(sb, user);
  const knownKeys = new Set(await sdb.known.toCollection().primaryKeys());
  const isRemote = (kind: Kind, id: string) => knownKeys.has(`${kind}:${id}`);

  const journals = (await db.journals.toArray()) as LocalJournal[];
  const remoteByName = new Map(journals.filter((j) => isRemote('journal', j.id) && j.role === 'owner').map((j) => [j.name.trim().toLowerCase(), j]));
  const entries = await db.entries.toArray();
  const remoteKeys = new Set(entries.filter((e) => isRemote('entry', e.id)).map((e) => `${e.date}|${e.title.trim()}`));

  const dupes = entries.filter((e) => !isRemote('entry', e.id) && remoteKeys.has(`${e.date}|${e.title.trim()}`)).map((e) => e.id);
  const merges = journals.filter((j) => !isRemote('journal', j.id) && remoteByName.has(j.name.trim().toLowerCase()));

  await withoutSync(async () => {
    await db.media.where('entryId').anyOf(dupes).delete();
    await db.entries.bulkDelete(dupes);
    for (const j of merges) {
      const target = remoteByName.get(j.name.trim().toLowerCase())!;
      await db.entries.where('journalId').equals(j.id).modify({ journalId: target.id });
      await db.journals.delete(j.id);
    }
    for (const j of journals) {
      if (!isRemote('journal', j.id) && !merges.includes(j)) await db.journals.update(j.id, { ownerId: user.id, ownerEmail: user.email, role: 'owner' } as Partial<LocalJournal>);
    }
  });
  await sdb.outbox.clear();
  // Upload the local-only records (the ones the server has not seen).
  const at = Date.now();
  const items: OutboxItem[] = [];
  for (const id of await db.journals.toCollection().primaryKeys()) if (!isRemote('journal', id)) items.push({ key: `journal:${id}`, kind: 'journal', id, deleted: false, at });
  for (const id of await db.entries.toCollection().primaryKeys()) if (!isRemote('entry', id)) items.push({ key: `entry:${id}`, kind: 'entry', id, deleted: false, at });
  for (const id of await db.media.toCollection().primaryKeys()) if (!isRemote('media', id)) items.push({ key: `media:${id}`, kind: 'media', id, deleted: false, at });
  await sdb.outbox.bulkPut(items);
  await setState('userId', user.id);
}

/** Forget sync state (after signing out and clearing, or erasing local data). */
export async function resetSync() {
  await Promise.all([sdb.outbox.clear(), sdb.known.clear(), sdb.state.clear()]);
}

