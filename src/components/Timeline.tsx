import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { db, type Entry } from '../db';
import { fmtMonth, fmtShort, go, monthKey, moodFor } from '../util';
import { Thumb } from './Media';

export function EntryCard({ e }: { e: Entry }) {
  const mood = moodFor(e.mood);
  const snippet = e.body.replace(/\s+/g, ' ').slice(0, 220);
  return (
    <article className="card entry-card" onClick={() => go(`/entry/${e.id}`)} tabIndex={0}
      onKeyDown={(k) => k.key === 'Enter' && go(`/entry/${e.id}`)}>
      {e.mediaIds.length > 0 && (
        <div className={`card-media n${Math.min(e.mediaIds.length, 3)}`}>
          {e.mediaIds.slice(0, 3).map((id) => <Thumb key={id} id={id} />)}
          {e.mediaIds.length > 3 && <span className="more">+{e.mediaIds.length - 3}</span>}
        </div>
      )}
      <div className="card-text">
        {e.prompt && <div className="card-prompt">{e.prompt}</div>}
        {e.title && <h3>{e.title}</h3>}
        {snippet && <p>{snippet}{e.body.length > 220 ? '…' : ''}</p>}
        <div className="card-meta">
          <span>{fmtShort(e.date)}</span>
          {e.place && <span>· 📍 {e.place.name}</span>}
          {mood && <span title={mood.label}>· {mood.emoji}</span>}
          {e.bookmarked && <span className="bookmark-on" title="Bookmarked">🔖</span>}
        </div>
      </div>
    </article>
  );
}

export function Timeline() {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'bookmarked' | 'media' | 'places'>('all');
  const entries = useLiveQuery(() => db.entries.orderBy('date').reverse().toArray(), []);

  const shown = useMemo(() => {
    if (!entries) return [];
    const needle = q.trim().toLowerCase();
    return entries.filter((e) => {
      if (filter === 'bookmarked' && !e.bookmarked) return false;
      if (filter === 'media' && e.mediaIds.length === 0) return false;
      if (filter === 'places' && !e.place) return false;
      if (!needle) return true;
      return [e.title, e.body, e.place?.name, e.prompt].some((s) => s?.toLowerCase().includes(needle));
    });
  }, [entries, q, filter]);

  const groups = useMemo(() => {
    const m = new Map<string, Entry[]>();
    for (const e of shown) {
      const k = monthKey(e.date);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(e);
    }
    return [...m];
  }, [shown]);

  if (!entries) return null;

  if (entries.length === 0) {
    return (
      <div className="empty">
        <div className="empty-icon">📓</div>
        <h2>Your journal is empty</h2>
        <p>Write your first entry, or bring in the entries you exported from Apple Journal.</p>
        <div className="row center">
          <button className="btn primary" onClick={() => go('/new')}>New entry</button>
          <button className="btn" onClick={() => go('/import')}>Import from Apple Journal</button>
        </div>
      </div>
    );
  }

  return (
    <div className="timeline">
      <div className="toolbar">
        <input className="search" type="search" placeholder="Search entries" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="chips">
          {(['all', 'bookmarked', 'media', 'places'] as const).map((f) => (
            <button key={f} className={`chip ${filter === f ? 'on' : ''}`} onClick={() => setFilter(f)}>
              {{ all: 'All', bookmarked: '🔖 Bookmarked', media: '🖼️ Photos & videos', places: '📍 Places' }[f]}
            </button>
          ))}
        </div>
      </div>
      {groups.length === 0 && <p className="muted center">No entries match.</p>}
      {groups.map(([k, list]) => (
        <section key={k}>
          <h2 className="month">{fmtMonth(k)}</h2>
          <div className="cards">{list.map((e) => <EntryCard key={e.id} e={e} />)}</div>
        </section>
      ))}
    </div>
  );
}
