import Dexie, { type Table } from 'dexie';

export type MediaKind = 'photo' | 'video' | 'audio' | 'map';

export interface Place {
  name: string;
  lat?: number;
  lng?: number;
}

export interface Entry {
  id: string;
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
  }
}

export const db = new JournalDB();

export const newId = () => crypto.randomUUID();

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

export function emptyEntry(): Entry {
  const now = Date.now();
  return {
    id: newId(),
    date: now,
    title: '',
    body: '',
    bookmarked: false,
    mediaIds: [],
    createdAt: now,
    updatedAt: now,
  };
}
