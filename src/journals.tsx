import { useLiveQuery } from 'dexie-react-hooks';
import { db, getSetting, isWritableJournal, listJournals, setSetting, type Entry, type Journal } from './db';

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
  return [stored ?? 'all', (c) => void setSetting('currentJournal', c), stored !== undefined];
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

/** Compact dropdown used at the top of pages on small screens. */
export function JournalSelect({ className = '' }: { className?: string }) {
  const journals = useJournals();
  const [current, setCurrent] = useCurrentJournal();
  if (!journals || journals.length < 2) return null;
  return (
    <select className={`journal-select ${className}`} value={current} onChange={(e) => setCurrent(e.target.value)} aria-label="Journal">
      <option value="all">All journals</option>
      {journals.map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}
    </select>
  );
}
