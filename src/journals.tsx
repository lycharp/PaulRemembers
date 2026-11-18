import { useLiveQuery } from 'dexie-react-hooks';
import { rememberJournalOnline } from './cloud/cloud';
import { db, getSetting, isOwnJournal, isWritableJournal, listJournals, setSetting, type Entry, type Journal } from './db';
import { nameOf, usePeople, type Person } from './cloud/people';
import { PersonIcon } from './components/People';

/** 'all' shows every journal; otherwise a journal id. Remembered on this device. */
export type JournalChoice = 'all' | string;

export const useJournals = (): Journal[] | undefined => useLiveQuery(listJournals, []);
/** Journals you can add entries to (not ones shared with you read-only). */
export const useWritableJournals = (): Journal[] | undefined =>
  useLiveQuery(async () => (await listJournals()).filter(isWritableJournal), []);

/** The chosen journal; `loaded` is false until it has been read from storage. */
export function useCurrentJournal(): [JournalChoice, (c: JournalChoice) => void, boolean] {
  const stored = useLiveQuery(async () => {
    const c = (await getSetting<string>('currentJournal')) ?? 'all';
    // Fall back to all journals if the remembered one was deleted.
    return c === 'all' || (await db.journals.get(c)) ? c : 'all';
  }, []);
  const choose = (c: JournalChoice) => {
    void setSetting('currentJournal', c);
    rememberJournalOnline(c);
  };
  return [stored ?? 'all', choose, stored !== undefined];
}

/**
 * Bookmarks on entries in journals shared with you read-only. They are kept
 * on this device only, so the owner's journal is never changed.
 */
const SHARED_BOOKMARKS = 'sharedBookmarks';
export async function toggleSharedBookmark(entryId: string) {
  const ids = new Set((await getSetting<string[]>(SHARED_BOOKMARKS)) ?? []);
  if (ids.has(entryId)) ids.delete(entryId); else ids.add(entryId);
  await setSetting(SHARED_BOOKMARKS, [...ids]);
}

/** Tells whether an entry is bookmarked: your own bookmark for read-only journals, the entry's flag otherwise. */
export function useIsBookmarked(): (e: Entry) => boolean {
  const data = useLiveQuery(async () => ({
    shared: new Set((await getSetting<string[]>(SHARED_BOOKMARKS)) ?? []),
    viewer: new Set((await listJournals()).filter((j) => j.role === 'viewer').map((j) => j.id)),
  }), []);
  return (e: Entry) => (data?.viewer.has(e.journalId) ? data.shared.has(e.id) : !!e.bookmarked);
}

/** Entries in the chosen journal (or all), newest first. */
export function useEntries(): Entry[] | undefined {
  const [current] = useCurrentJournal();
  return useLiveQuery(async () => {
    const all = await db.entries.orderBy('date').reverse().toArray();
    return current === 'all' ? all : all.filter((e) => e.journalId === current);
  }, [current]);
}

export function JournalDot({ color }: { color?: string }) {
  return <span className="journal-dot" style={{ background: color ?? 'var(--accent)' }} aria-hidden />;
}

/** Whose journal it is, for journals shared with you (undefined for your own). */
function ownerOf(j: Journal | undefined, byId: Map<string, Person>): Person | undefined {
  if (!j || isOwnJournal(j)) return undefined;
  return (j.ownerId && byId.get(j.ownerId)) || { id: j.ownerId ?? j.id, email: j.ownerEmail };
}

/**
 * A journal's name as everyone sees it: your own journals by name, journals
 * shared with you with the owner's name in front ("Paul P · My Journal"),
 * so two journals called "My Journal" can be told apart.
 */
export function useJournalLabel(): (j?: Journal) => string {
  const { byId } = usePeople();
  return (j) => {
    if (!j) return '';
    const owner = ownerOf(j, byId);
    return owner ? `${nameOf(owner)} · ${j.name}` : j.name;
  };
}

/** The journal's coloured dot, or the owner's icon for a journal shared with you. */
export function JournalMark({ journal }: { journal?: Journal }) {
  const { byId } = usePeople();
  const owner = ownerOf(journal, byId);
  return owner ? <PersonIcon id={owner.id} person={owner} /> : <JournalDot color={journal?.color} />;
}

/** Compact dropdown used at the top of pages on small screens. */
export function JournalSelect({ className = '' }: { className?: string }) {
  const journals = useJournals();
  const [current, setCurrent] = useCurrentJournal();
  const label = useJournalLabel();
  if (!journals || journals.length < 2) return null;
  return (
    <select className={`journal-select ${className}`} value={current} onChange={(e) => setCurrent(e.target.value)} aria-label="Journal">
      <option value="all">All journals</option>
      {journals.map((j) => <option key={j.id} value={j.id}>{label(j)}</option>)}
    </select>
  );
}
