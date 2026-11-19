import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './components/Icon';
import { rememberJournalOnline } from './cloud/cloud';
import { db, getSetting, isOwnJournal, isWritableJournal, listJournals, setSetting, type Entry, type Journal } from './db';
import { nameOf, usePeople, type Person } from './cloud/people';
import { FitLine, PersonIcon } from './components/People';

/** 'all' shows every journal; otherwise a journal id. Remembered on this device. */
export type JournalChoice = 'all' | string;

export const useJournals = (): Journal[] | undefined => useLiveQuery(listJournals, []);
/** Journals you can add entries to (not ones shared with you read-only). */
export const useWritableJournals = (): Journal[] | undefined =>
  useLiveQuery(async () => (await listJournals()).filter(isWritableJournal), []);

/**
 * Can you add an entry where you are looking? Not in a journal shared with you
 * read-only. With "All" showing, yes if any journal is yours to write in (or you
 * have none yet: one is made for you). Hides the + / New entry while read-only.
 */
export function useCanWriteHere(): boolean {
  const [current] = useCurrentJournal();
  const journals = useJournals();
  if (!journals) return false;
  if (current !== 'all') {
    const j = journals.find((x) => x.id === current);
    return !j || isWritableJournal(j);
  }
  return journals.length === 0 || journals.some(isWritableJournal);
}

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

/** Your own journals first, then the ones shared with you. */
export function splitJournals<J extends Journal>(journals: J[]): { mine: J[]; shared: J[] } {
  return { mine: journals.filter(isOwnJournal), shared: journals.filter((j) => !isOwnJournal(j)) };
}

/** The little "shared" sign after a journal's name: shared with you, or one of yours you've shared. */
export function SharedSign({ journal }: { journal?: Journal }) {
  const { sharedByMe } = usePeople();
  if (!journal) return null;
  const mine = isOwnJournal(journal);
  if (mine && !sharedByMe(journal)) return null;
  const title = mine ? "You've shared this" : 'Shared with you';
  return <span className="shared-sign" title={title} aria-label={title} role="img"><Icon name="shared" /></span>;
}

/**
 * One line under an entry's buttons: which journal it's in, and if it's one
 * of yours that you've shared, who with (see FitLine for how it fits).
 */
export function JournalLine({ journal }: { journal?: Journal }) {
  const label = useJournalLabel();
  const { sharedWith } = usePeople();
  if (!journal) return null;
  return (
    <FitLine className="journal-line" people={sharedWith(journal)}
      lead={<><JournalMark journal={journal} /><span className="fit-shrink">{label(journal)}</span><SharedSign journal={journal} /></>} />
  );
}

/** "Shared with 🦄 Laup · 🐻 Robert", under the name of a journal of yours that you've shared. */
export function SharedWithLine({ journal }: { journal?: Journal }) {
  const { sharedWith } = usePeople();
  const people = sharedWith(journal);
  if (!people.length) return null;
  return <FitLine className="muted small shared-with" people={people} lead={<span>Shared with</span>} />;
}

/** Mark, full name and shared sign together: "🐻 Sam · My Journal 👥". */
export function JournalName({ journal }: { journal?: Journal }) {
  const label = useJournalLabel();
  if (!journal) return null;
  return <span className="journal-name"><JournalMark journal={journal} /> <span>{label(journal)}</span> <SharedSign journal={journal} /></span>;
}

/** "Shared by Sam · you can read", for the top of a shared journal's page. */
export function useSharedLine(): (j?: Journal) => string {
  const { byId } = usePeople();
  return (j) => {
    const owner = ownerOf(j, byId);
    if (!j || !owner) return '';
    return `Shared by ${nameOf(owner)} · you can ${j.role === 'editor' ? 'edit' : 'read'}`;
  };
}

/**
 * The "Journals" button at the top of pages on small screens. It opens a list
 * from the bottom of the screen: All journals, then yours, then shared ones,
 * each with its full name and icons (the phone's own menu can't show those).
 */
export function JournalSelect({ className = '' }: { className?: string }) {
  const journals = useJournals();
  const [current, setCurrent] = useCurrentJournal();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open]);
  if (!journals || journals.length < 2) return null;
  const { mine, shared } = splitJournals(journals);
  const pick = (c: string) => {
    setCurrent(c);
    setOpen(false);
  };
  const row = (j: Journal) => (
    <button key={j.id} className={current === j.id ? 'on' : ''} onClick={() => pick(j.id)}><JournalName journal={j} /></button>
  );
  return (
    <>
      <button className={`btn journal-btn ${className}`} onClick={() => setOpen(true)} aria-haspopup="dialog">
        {/* Pages without a journal title (Calendar, Insights) show which journal is chosen. */}
        {className.includes('page-select')
          ? (current === 'all' ? <span className="journal-name"><span className="journal-dot all" aria-hidden /> All journals</span> : <JournalName journal={journals.find((j) => j.id === current)} />)
          : 'Journals'} <span aria-hidden>▾</span>
      </button>
      {open && createPortal(
        <div className="sheet-backdrop" onClick={() => setOpen(false)}>
          <div className="sheet" role="dialog" aria-label="Journals" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-grip" aria-hidden />
            <button className={current === 'all' ? 'on' : ''} onClick={() => pick('all')}><span className="journal-name"><span className="journal-dot all" aria-hidden /> All journals</span></button>
            {mine.length > 0 && <div className="journal-list-head">My journals</div>}
            {mine.map(row)}
            {shared.length > 0 && <div className="journal-list-head">Shared with me</div>}
            {shared.map(row)}
            <button className="btn sheet-close" onClick={() => setOpen(false)}>Close</button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
