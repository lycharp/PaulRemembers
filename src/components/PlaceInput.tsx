import { useId, useMemo, useState } from 'react';
import type { Place } from '../db';
import { usePlaces } from '../places';

/**
 * The editor's Place field with a dropdown of places you have used before.
 * Type to filter; ↑/↓ to move, Enter or a click to pick, Esc to close.
 * Whatever you type is kept as a new place if you don't pick one.
 */
export function PlaceInput({ value, onChange }: { value?: Place; onChange: (p: Place | undefined) => void }) {
  const places = usePlaces();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();
  const text = value?.name ?? '';

  const matches = useMemo(() => {
    const q = text.trim().toLowerCase();
    const all = places ?? [];
    const list = q ? all.filter((p) => p.name.toLowerCase().includes(q)) : all;
    // Starts-with matches first, and don't offer the exact text already typed.
    return list
      .filter((p) => p.name.toLowerCase() !== q)
      .sort((a, b) => Number(b.name.toLowerCase().startsWith(q)) - Number(a.name.toLowerCase().startsWith(q)))
      .slice(0, 8);
  }, [places, text]);

  const pick = (p: Place) => {
    onChange({ name: p.name, lat: p.lat, lng: p.lng });
    setOpen(false);
    setActive(-1);
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && active >= 0 && matches[active]) pick(matches[active]);
      else setOpen(false);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const showList = open && matches.length > 0;
  return (
    <div className="place-field">
      <input className="place-input" placeholder="Place" value={text} role="combobox" aria-expanded={showList} aria-controls={listId}
        aria-autocomplete="list" autoComplete="off"
        onChange={(e) => {
          const name = e.target.value;
          onChange(name ? { ...value, name } : undefined);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKey} />
      {showList && (
        <ul className="place-options" id={listId} role="listbox">
          {matches.map((p, i) => (
            <li key={p.name} role="option" aria-selected={i === active} className={i === active ? 'on' : ''}
              // mousedown, not click, so it happens before the field loses focus
              onMouseDown={(e) => (e.preventDefault(), pick(p))} onMouseEnter={() => setActive(i)}>
              <span>📍 {p.name}</span>
              <span className="muted small">{p.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
