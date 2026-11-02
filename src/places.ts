import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Place } from './db';

/**
 * Saved places are simply the places your entries use. A place nobody uses any
 * more (say, a typo you corrected) disappears from the list by itself.
 */
export interface SavedPlace extends Place {
  count: number;
}

const key = (name: string) => name.trim().toLowerCase();

export async function listPlaces(): Promise<SavedPlace[]> {
  const byName = new Map<string, SavedPlace>();
  await db.entries.each((e) => {
    const p = e.place;
    if (!p?.name?.trim()) return;
    const k = key(p.name);
    const cur = byName.get(k);
    if (cur) {
      cur.count++;
      if (cur.lat == null && p.lat != null) Object.assign(cur, { lat: p.lat, lng: p.lng });
    } else byName.set(k, { ...p, name: p.name.trim(), count: 1 });
  });
  return [...byName.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export const usePlaces = () => useLiveQuery(listPlaces, []);

/** Writable entries using a place (a journal shared with you read-only is left alone). */
async function entriesAt(name: string) {
  const readOnly = new Set((await db.journals.toArray()).filter((j) => j.role === 'viewer').map((j) => j.id));
  return db.entries.filter((e) => !!e.place && key(e.place.name) === key(name) && !readOnly.has(e.journalId)).toArray();
}

/** Rename a place in every entry. Renaming to an existing place merges the two. */
export async function renamePlace(from: string, to: string) {
  const name = to.trim();
  if (!name) return 0;
  const target = (await listPlaces()).find((p) => key(p.name) === key(name) && key(p.name) !== key(from));
  const now = Date.now();
  const list = await entriesAt(from);
  await db.transaction('rw', db.entries, async () => {
    for (const e of list) {
      const place: Place = target ? { name: target.name, lat: target.lat ?? e.place!.lat, lng: target.lng ?? e.place!.lng } : { ...e.place!, name };
      await db.entries.update(e.id, { place, updatedAt: now });
    }
  });
  return list.length;
}

/** Take a place off every entry that uses it. */
export async function removePlace(name: string) {
  const now = Date.now();
  const list = await entriesAt(name);
  await db.transaction('rw', db.entries, async () => {
    for (const e of list) await db.entries.update(e.id, { place: undefined, updatedAt: now });
  });
  return list.length;
}
