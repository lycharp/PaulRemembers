import { useMemo } from 'react';
import { JournalSelect, useEntries } from '../journals';
import { dayKey, wordCount } from '../util';
import { EntryCard } from './Timeline';

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
      places: [...places].sort((a, b) => b[1] - a[1]).slice(0, 8),
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
        <Stat label="Places" value={stats.places.length} />
      </div>
      {stats.onThisDay.length > 0 && (
        <section>
          <h2 className="month">On this day</h2>
          <div className="cards">{stats.onThisDay.map((e) => <EntryCard key={e.id} e={e} />)}</div>
        </section>
      )}
      {stats.places.length > 0 && (
        <section>
          <h2 className="month">Places</h2>
          <ul className="place-list">
            {stats.places.map(([name, n]) => <li key={name}><span>📍 {name}</span><span className="muted">{n}</span></li>)}
          </ul>
        </section>
      )}
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
