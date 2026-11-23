import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Entry } from '../db';
import { JournalMark, JournalName, JournalSelect, useCanWriteHere, SharedSign, useJournalLabel, useSharedLine, SharedWithLine, useCurrentJournal, useEntries, useIsBookmarked, useJournals } from '../journals';
import { fmtMonth, fmtShort, go, monthKey, moodFor } from '../util';
import { Gallery, MediaTile, VoiceNote } from './Media';
import { PoquitoBadge } from './About';
import { Icon } from './Icon';
import { Linkified } from './Linkified';
import { Contributors } from './People';
import { useCloud } from '../cloud/cloud';
import { SyncProgress } from './Account';
import { Loading } from './Loading';
import { CardReactions } from './Reactions';

type Filter = 'all' | 'bookmarked' | 'media' | 'places';

/**
 * What the journal list looked like when an entry was opened from it, so going
 * back puts the list right where it was (at that entry, same search and filter)
 * instead of the top. Kept in memory only, for this visit.
 */
let returnTo: { entryId?: string; journal?: string; q: string; filter: Filter } = { q: '', filter: 'all' };

/** Start the journal list fresh at the top (the sidebar's Journal link, switching journals). */
export function forgetListPosition() {
  returnTo = { q: '', filter: 'all' };
}

export function EntryCard({ e, onOpen }: { e: Entry; onOpen?: () => void }) {
  const bookmarked = useIsBookmarked()(e);
  const mood = moodFor(e.mood);
  const snippet = e.body.replace(/\s+/g, ' ').trim();
  const journals = useJournals();
  const label = useJournalLabel();
  const [current] = useCurrentJournal();
  const entryJournal = journals?.find((j) => j.id === e.journalId);
  const journal = current === 'all' && journals && journals.length > 1 ? entryJournal : undefined;
  // Voice recordings get their own "▶ Voice note" bar instead of a tile.
  const audioIds = useLiveQuery(async () => (await db.media.bulkGet(e.mediaIds)).filter((m) => m?.kind === 'audio').map((m) => m!.id), [e.mediaIds.join()]);
  const visual = audioIds ? e.mediaIds.filter((id) => !audioIds.includes(id)) : [];
  const shownMedia = visual.slice(0, 3);
  return (
    <article className="card entry-card" data-entry-id={e.id} tabIndex={0}
      onClick={() => { onOpen?.(); go(`/entry/${e.id}`); }}
      onKeyDown={(k) => { if (k.key === 'Enter') { onOpen?.(); go(`/entry/${e.id}`); } }}>
      {shownMedia.length > 0 && (
        <div className="card-media">
          <Gallery ids={shownMedia} singleRow maxHeight={420}>
            {(id, _i, tile) => <MediaTile key={id} id={id} compact {...tile} />}
          </Gallery>
          {visual.length > 3 && <span className="more">+{visual.length - 3}</span>}
        </div>
      )}
      {audioIds?.map((id) => <VoiceNote key={id} id={id} />)}
      <div className="card-text">
        {e.prompt && <div className="card-prompt">{e.prompt}</div>}
        {e.title && <h3><Linkified text={e.title} plain /></h3>}
        {snippet && <p><Linkified text={snippet} plain limit={220} /></p>}
        <div className="card-meta">
          <span>{fmtShort(e.date)}</span>
          {e.place && <span>· <Icon name="pin" className="inline-icon" /> {e.place.name}</span>}
          {mood && <span title={mood.label}>· {mood.emoji}</span>}
          <CardReactions entry={e} journal={entryJournal} />
          {journal && <span className="card-journal"><JournalMark journal={journal} /> {label(journal)} <SharedSign journal={journal} /></span>}
          {bookmarked && <span className="bookmark-on" title="Bookmarked"><Icon name="bookmarked" className="inline-icon" /></span>}
          <Contributors entry={e} journal={entryJournal} />
        </div>
      </div>
    </article>
  );
}

export function Timeline() {
  const canWrite = useCanWriteHere();
  const [q, setQ] = useState(returnTo.q);
  const [filter, setFilter] = useState<Filter>(returnTo.filter);
  const entries = useEntries();
  const journals = useJournals();
  const [current, , currentLoaded] = useCurrentJournal();
  const listRef = useRef<HTMLDivElement>(null);
  const cloud = useCloud();
  const isBookmarked = useIsBookmarked();
  const sharedLine = useSharedLine();
  const currentJournal = current === 'all' ? (journals?.length === 1 ? journals[0] : undefined) : journals?.find((j) => j.id === current);
  const title = current === 'all' ? (journals && journals.length > 1 ? 'All journals' : journals?.[0]?.name) : journals?.find((j) => j.id === current)?.name;

  const shown = useMemo(() => {
    if (!entries) return [];
    const needle = q.trim().toLowerCase();
    return entries.filter((e) => {
      if (filter === 'bookmarked' && !isBookmarked(e)) return false;
      if (filter === 'media' && e.mediaIds.length === 0) return false;
      if (filter === 'places' && !e.place) return false;
      if (!needle) return true;
      return [e.title, e.body, e.place?.name, e.prompt].some((s) => s?.toLowerCase().includes(needle));
    });
  }, [entries, q, filter, isBookmarked]);

  const groups = useMemo(() => {
    const m = new Map<string, Entry[]>();
    for (const e of shown) {
      const k = monthKey(e.date);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(e);
    }
    return [...m];
  }, [shown]);

  // Coming back from an entry: show the list already at that entry. This runs
  // before the screen is drawn, so there's no visible scrolling. Photos above it
  // can still change size as they load, so for a moment keep the entry where it
  // is, until the person scrolls or touches the page themselves.
  const placed = useRef(false);
  useLayoutEffect(() => {
    if (placed.current || !entries || !currentLoaded) return;
    placed.current = true;
    const id = returnTo.entryId;
    if (!id) return;
    if (returnTo.journal !== current) return forgetListPosition();
    const card = listRef.current?.querySelector<HTMLElement>(`[data-entry-id="${CSS.escape(id)}"]`);
    if (!card) return;
    const top = 12;
    const put = () => window.scrollTo({ top: window.scrollY + card.getBoundingClientRect().top - top, behavior: 'instant' });
    put();
    const ro = new ResizeObserver(put);
    ro.observe(listRef.current!);
    const stop = () => {
      ro.disconnect();
      for (const ev of ['wheel', 'touchstart', 'keydown', 'mousedown'] as const) window.removeEventListener(ev, stop);
    };
    for (const ev of ['wheel', 'touchstart', 'keydown', 'mousedown'] as const) window.addEventListener(ev, stop, { passive: true });
    const timer = setTimeout(stop, 2500);
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, [entries, current, currentLoaded]);

  const remember = (entryId: string) => {
    returnTo = { entryId, journal: current, q, filter };
  };

  // Still reading this device's copy: say so, never a blank screen.
  if (!entries) return <Loading />;

  // Just signed in on a device with nothing on it yet (for example after erasing
  // it): the first sync is bringing the journal down, so say that instead of "empty".
  const firstSync = cloud.user && !cloud.otherAccount && !cloud.lastSync && !cloud.error && navigator.onLine;
  if (entries.length === 0 && firstSync) {
    return (
      <div className="empty syncing-screen" role="status">
        <div className="spinner" aria-hidden />
        <h2>Getting your journal…</h2>
        <p>Your entries are being copied down from your account. This can take a minute or two the first time, especially with lots of photos.</p>
        <SyncProgress />
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="empty">
        <JournalSelect />
        <div className="empty-icon"><Icon name="journal" /></div>
        <h2>{current === 'all' ? 'Your journal is empty' : `${title ?? 'This journal'} is empty`}</h2>
        {canWrite ? <>
        <p>Write your first entry, or bring in the entries you exported from Apple Journal.</p>
        <div className="row center">
          <button className="btn primary" onClick={() => go('/new')}>New entry</button>
          <button className="btn" onClick={() => go('/import')}>Import from Apple Journal</button>
        </div>
        </> : <p>Nothing has been written here yet. You can read this journal but not add to it.</p>}
        <PoquitoBadge className="home-badge" />
      </div>
    );
  }

  return (
    <div className="timeline" ref={listRef}>
      <div className="page-head sticky-head">
        <div className="grow">
          <h1>{currentJournal ? <JournalName journal={currentJournal} /> : title}</h1>
          {sharedLine(currentJournal) && <div className="muted small">{sharedLine(currentJournal)}</div>}
          <SharedWithLine journal={currentJournal} />
        </div>
        <JournalSelect className="mobile-only" />
      </div>
      <div className="toolbar">
        <input className="search" type="search" placeholder="Search entries" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="chips">
          {(['all', 'bookmarked', 'media', 'places'] as const).map((f) => (
            <button key={f} className={`chip ${filter === f ? 'on' : ''}`} onClick={() => setFilter(f)}>
              {{ all: <>All</>, bookmarked: <><Icon name="bookmark" className="inline-icon" /> Bookmarked</>, media: <><Icon name="photo" className="inline-icon" /> Photos &amp; videos</>, places: <><Icon name="pin" className="inline-icon" /> Places</> }[f]}
            </button>
          ))}
        </div>
      </div>
      {groups.length === 0 && <p className="muted center">No entries match.</p>}
      {groups.map(([k, list]) => (
        <section key={k}>
          <h2 className="month">{fmtMonth(k)}</h2>
          <div className="cards">{list.map((e) => <EntryCard key={e.id} e={e} onOpen={() => remember(e.id)} />)}</div>
        </section>
      ))}
      <PoquitoBadge className="home-badge" />
    </div>
  );
}
