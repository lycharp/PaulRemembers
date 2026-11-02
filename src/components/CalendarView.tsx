import { useMemo, useState } from 'react';
import { type Entry } from '../db';
import { JournalSelect, useEntries } from '../journals';
import { dayKey, fmtDay } from '../util';
import { Thumb } from './Media';
import { EntryCard } from './Timeline';

export function CalendarView() {
  const entries = useEntries();
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [selected, setSelected] = useState<string | null>(null);

  const byDay = useMemo(() => {
    const m = new Map<string, Entry[]>();
    for (const e of entries ?? []) {
      const k = dayKey(e.date);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(e);
    }
    return m;
  }, [entries]);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const lead = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const todayKey = dayKey(Date.now());
  const shift = (n: number) => {
    setCursor(new Date(year, month + n, 1));
    setSelected(null);
  };
  const monthCount = cells.filter((d) => d && byDay.has(dayKey(new Date(year, month, d).getTime()))).length;
  const selectedEntries = selected ? byDay.get(selected) ?? [] : [];

  return (
    <div className="calendar-page">
      <JournalSelect className="mobile-only page-select" />
      <div className="cal-head">
        <button className="btn ghost" onClick={() => shift(-1)} aria-label="Previous month">‹</button>
        <div>
          <h2>{cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h2>
          <div className="muted small center">{monthCount} {monthCount === 1 ? 'day' : 'days'} journaled</div>
        </div>
        <button className="btn ghost" onClick={() => shift(1)} aria-label="Next month">›</button>
      </div>
      <div className="cal-grid">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className="cal-dow">{d}</div>)}
        {cells.map((d, i) => {
          if (!d) return <div key={i} />;
          const k = dayKey(new Date(year, month, d).getTime());
          const list = byDay.get(k);
          const thumb = list?.find((e) => e.mediaIds.length)?.mediaIds[0];
          return (
            <button key={i} className={`cal-day ${list ? 'has' : ''} ${k === todayKey ? 'today' : ''} ${selected === k ? 'sel' : ''}`}
              onClick={() => list && setSelected(k)} disabled={!list}>
              {thumb && <Thumb id={thumb} />}
              <span className="cal-num">{d}</span>
              {list && list.length > 1 && <span className="cal-count">{list.length}</span>}
            </button>
          );
        })}
      </div>
      <div className="row center">
        <button className="btn small ghost" onClick={() => { const d = new Date(); setCursor(new Date(d.getFullYear(), d.getMonth(), 1)); }}>Today</button>
        {entries && entries.length > 0 && (
          <button className="btn small ghost" onClick={() => { const d = new Date(entries[0].date); setCursor(new Date(d.getFullYear(), d.getMonth(), 1)); }}>Latest entry</button>
        )}
      </div>
      {selected && (
        <section>
          <h3 className="month">{fmtDay(selectedEntries[0]?.date ?? Date.now())}</h3>
          <div className="cards">{selectedEntries.map((e) => <EntryCard key={e.id} e={e} />)}</div>
        </section>
      )}
    </div>
  );
}
