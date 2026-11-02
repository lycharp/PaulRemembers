import { useMemo, useState } from 'react';
import { JournalSelect, useEntries } from '../journals';
import { dayKey, wordCount } from '../util';
import { EntryCard } from './Timeline';
import { removePlace, renamePlace, usePlaces } from '../places';

export function Insights() {
  const entries = useEntries();

  const stats = useMemo(() => {
    if (!entries) return null;
    const days = new Set(entries.map((e) => dayKey(e.date)));
    // Current streak: consecutive days ending today (or yesterday).
    let streak = 0;
    const d = new Date();
    if (!days.has(dayKey(d.getTime()))) d.setDate(d.getDate() - 1);
    while (days.has(dayKey(d.getTime()))) {
      streak++;
      d.setDate(d.getDate() - 1);
    }
    // Longest streak over all time.
    const sorted = [...days].sort();
    let longest = 0;
    let run = 0;
    let prev: number | null = null;
    for (const k of sorted) {
      const [y, m, dd] = k.split('-').map(Number);
      const t = new Date(y, m - 1, dd).getTime();
      run = prev != null && Math.round((t - prev) / 86400000) === 1 ? run + 1 : 1;
      longest = Math.max(longest, run);
      prev = t;
    }
    const year = new Date().getFullYear();
    const thisYear = entries.filter((e) => new Date(e.date).getFullYear() === year).length;
    const words = entries.reduce((n, e) => n + wordCount(e.body), 0);
    const places = new Map<string, number>();
    entries.forEach((e) => e.place && places.set(e.place.name, (places.get(e.place.name) ?? 0) + 1));
    const now = new Date();
    const onThisDay = entries.filter((e) => {
      const x = new Date(e.date);
      return x.getMonth() === now.getMonth() && x.getDate() === now.getDate() && x.getFullYear() < now.getFullYear();
    });
    return {
      streak, longest, thisYear, words, days: days.size, total: entries.length,
      places: places.size,
      onThisDay,
    };
  }, [entries]);

  if (!stats) return null;
  return (
    <div className="insights">
      <JournalSelect className="mobile-only page-select" />
      <div className="stat-grid">
        <Stat label="Day streak" value={stats.streak} />
        <Stat label="Longest streak" value={stats.longest} />
        <Stat label={`Entries in ${new Date().getFullYear()}`} value={stats.thisYear} />
        <Stat label="Total entries" value={stats.total} />
        <Stat label="Days journaled" value={stats.days} />
        <Stat label="Words written" value={stats.words.toLocaleString()} />
        <Stat label="Photos, videos & audio" value={entries?.reduce((n, e) => n + e.mediaIds.length, 0) ?? 0} />
        <Stat label="Places" value={stats.places} />
      </div>
      {stats.onThisDay.length > 0 && (
        <section>
          <h2 className="month">On this day</h2>
          <div className="cards">{stats.onThisDay.map((e) => <EntryCard key={e.id} e={e} />)}</div>
        </section>
      )}
      <PlacesSection />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="stat card">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

/** Every place your entries use, with rename (fixes typos, merges duplicates) and remove. */
function PlacesSection() {
  const places = usePlaces();
  const [msg, setMsg] = useState('');
  const [all, setAll] = useState(false);
  if (!places?.length) return null;
  const shown = all ? places : places.slice(0, 10);

  const rename = async (name: string) => {
    const to = prompt(`Rename "${name}" to:`, name)?.trim();
    if (!to || to === name) return;
    const merging = places.some((p) => p.name.toLowerCase() === to.toLowerCase() && p.name !== name);
    if (merging && !confirm(`"${to}" is already a place. Merge "${name}" into it?`)) return;
    const n = await renamePlace(name, to);
    setMsg(`Updated ${n} ${n === 1 ? 'entry' : 'entries'}.`);
  };
  const remove = async (name: string, count: number) => {
    if (!confirm(`Remove "${name}" from ${count === 1 ? 'the entry that uses it' : `all ${count} entries that use it`}? The entries themselves are kept.`)) return;
    const n = await removePlace(name);
    setMsg(`Removed "${name}" from ${n} ${n === 1 ? 'entry' : 'entries'}.`);
  };

  return (
    <section>
      <h2 className="month">Places</h2>
      <p className="muted small">Places you have used in any journal. Rename one to fix a typo or merge two that are the same. A place disappears once no entry uses it.</p>
      <ul className="place-list">
        {shown.map((p) => (
          <li key={p.name}>
            <span>📍 {p.name} <span className="muted small">· {p.count} {p.count === 1 ? 'entry' : 'entries'}</span></span>
            <span className="place-actions">
              <button className="btn small ghost" onClick={() => rename(p.name)}>Rename</button>
              <button className="btn small ghost danger" onClick={() => remove(p.name, p.count)}>Remove</button>
            </span>
          </li>
        ))}
      </ul>
      {places.length > 10 && <button className="link" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${places.length} places`}</button>}
      {msg && <div className="notice ok">{msg}</div>}
    </section>
  );
}
