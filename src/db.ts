import Dexie, { type Table } from 'dexie';

export type MediaKind = 'photo' | 'video' | 'audio' | 'map';

export interface Place {
  name: string;
  lat?: number;
  lng?: number;
}

export interface Journal {
  id: string;
  name: string;
  color?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Entry {
  id: string;
  /** The journal this entry belongs to. */
  journalId: string;
  /** When the entry is dated, in ms since epoch. */
  date: number;
  title: string;
  /** Plain text; blank lines separate paragraphs. */
  body: string;
  bookmarked: boolean;
  mood?: string;
  /** A reflection prompt the entry was written in response to. */
  prompt?: string;
  place?: Place;
  /** Ordered ids into the media table. */
  mediaIds: string[];
  /** Set for imported entries so a re-import does not create duplicates. */
  sourceKey?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Media {
  id: string;
  entryId: string;
  kind: MediaKind;
  blob: Blob;
  caption?: string;
  /** When the photo/video was captured, if known. */
  takenAt?: number;
  place?: Place;
}

class JournalDB extends Dexie {
  journals!: Table<Journal, string>;
  entries!: Table<Entry, string>;
  media!: Table<Media, string>;
  settings!: Table<{ key: string; value: unknown }, string>;

  constructor() {
    super('journal');
    this.version(1).stores({
      entries: 'id, date, bookmarked, sourceKey, updatedAt',
      media: 'id, entryId',
      settings: 'key',
    });
    // v2: multiple journals. Existing entries move into a default journal.
    this.version(2)
      .stores({
        journals: 'id, name, updatedAt',
        entries: 'id, journalId, date, bookmarked, sourceKey, updatedAt',
      })
      .upgrade(async (tx) => {
        const now = Date.now();
        const journal: Journal = { id: newId(), name: DEFAULT_JOURNAL_NAME, color: JOURNAL_COLORS[0], createdAt: now, updatedAt: now };
        await tx.table('journals').add(journal);
        await tx.table('entries').toCollection().modify((e: Entry) => {
          e.journalId = journal.id;
          e.updatedAt = now;
        });
      });
    // Fresh installs get a default journal too.
    this.on('populate', (tx) => {
      const now = Date.now();
      tx.table('journals').add({ id: newId(), name: DEFAULT_JOURNAL_NAME, color: JOURNAL_COLORS[0], createdAt: now, updatedAt: now });
    });
  }
}

export const newId = () => crypto.randomUUID();

export const DEFAULT_JOURNAL_NAME = 'My Journal';
export const JOURNAL_COLORS = ['#6d4bd8', '#d8584b', '#2e9e6a', '#d89a2b', '#2f7fd8', '#c64ba8', '#5f6b7a'];

export const db = new JournalDB();

export async function getSetting<T>(key: string): Promise<T | undefined> {
  return (await db.settings.get(key))?.value as T | undefined;
}

export async function setSetting(key: string, value: unknown) {
  await db.settings.put({ key, value });
}

export async function deleteEntry(id: string) {
  await db.transaction('rw', db.entries, db.media, async () => {
    await db.media.where('entryId').equals(id).delete();
    await db.entries.delete(id);
  });
}

/** Every journal, oldest first. There is always at least one. */
export async function listJournals(): Promise<Journal[]> {
  return (await db.journals.toArray()).sort((a, b) => a.createdAt - b.createdAt);
}

/** The journal new entries go to when none is chosen: the oldest one. */
export async function defaultJournalId(): Promise<string> {
  const all = await listJournals();
  if (all.length) return all[0].id;
  return (await createJournal(DEFAULT_JOURNAL_NAME)).id;
}

export async function createJournal(name: string, color?: string): Promise<Journal> {
  const now = Date.now();
  const count = await db.journals.count();
  const journal: Journal = { id: newId(), name: name.trim() || 'Untitled journal', color: color ?? JOURNAL_COLORS[count % JOURNAL_COLORS.length], createdAt: now, updatedAt: now };
  await db.journals.add(journal);
  return journal;
}

export async function updateJournal(id: string, patch: Partial<Pick<Journal, 'name' | 'color'>>) {
  await db.journals.update(id, { ...patch, updatedAt: Date.now() });
}

/** Deletes a journal and moves its entries into another one, so nothing is lost. */
export async function deleteJournal(id: string, moveTo: string) {
  if (id === moveTo) throw new Error('Choose a different journal to move the entries to.');
  const now = Date.now();
  await db.transaction('rw', db.journals, db.entries, async () => {
    await db.entries.where('journalId').equals(id).modify({ journalId: moveTo, updatedAt: now });
    await db.journals.delete(id);
  });
}

export async function moveEntry(id: string, journalId: string) {
  await db.entries.update(id, { journalId, updatedAt: Date.now() });
}

export function emptyEntry(journalId: string): Entry {
  const now = Date.now();
  return {
    id: newId(),
    journalId,
    date: now,
    title: '',
    body: '',
    bookmarked: false,
    mediaIds: [],
    createdAt: now,
    updatedAt: now,
  };
}
