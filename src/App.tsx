import { useEffect, useState } from 'react';
import { createJournal, getSetting } from './db';
import { JournalDot, useCurrentJournal, useJournals } from './journals';
import { CalendarView } from './components/CalendarView';
import { EntryPage } from './components/EntryPage';
import { ImportPage } from './components/ImportPage';
import { Insights } from './components/Insights';
import { Settings } from './components/Settings';
import { Timeline } from './components/Timeline';
import { go, sha256, useRoute } from './util';

const NAV = [
  { path: '/', label: 'Journal', icon: '📓' },
  { path: '/calendar', label: 'Calendar', icon: '🗓️' },
  { path: '/insights', label: 'Insights', icon: '✨' },
  { path: '/import', label: 'Import', icon: '📥' },
  { path: '/settings', label: 'Settings', icon: '⚙️' },
];

export function App() {
  const route = useRoute();
  const [locked, setLocked] = useState<boolean | null>(null);

  useEffect(() => {
    getSetting<string>('passcode').then((p) => setLocked(!!p));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n' && !locked) {
        e.preventDefault();
        go('/new');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [locked]);

  if (locked === null) return null;
  if (locked) return <LockScreen onUnlock={() => setLocked(false)} />;

  const entryId = /^\/entry\/(.+)$/.exec(route)?.[1];
  let page;
  if (route === '/new') page = <EntryPage key="new" />;
  else if (entryId) page = <EntryPage key={entryId} id={entryId} />;
  else if (route === '/calendar') page = <CalendarView />;
  else if (route === '/insights') page = <Insights />;
  else if (route === '/import') page = <ImportPage />;
  else if (route === '/settings') page = <Settings onLock={() => setLocked(true)} />;
  else page = <Timeline />;

  const active = entryId || route === '/new' ? '/' : route;
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand"><img src="./icon.svg" alt="" /> Journal</div>
        <button className="btn primary new-btn" onClick={() => go('/new')} title="New entry (Ctrl+N)">＋ New entry</button>
        <nav>
          {NAV.map((n) => (
            <a key={n.path} href={`#${n.path}`} className={active === n.path ? 'on' : ''}>
              <span aria-hidden>{n.icon}</span> {n.label}
            </a>
          ))}
        </nav>
        <JournalList />
      </aside>
      <main className="main">{page}</main>
      <button className="fab" onClick={() => go('/new')} aria-label="New entry">＋</button>
    </div>
  );
}

function JournalList() {
  const journals = useJournals();
  const [current, setCurrent] = useCurrentJournal();
  const pick = (c: string) => {
    setCurrent(c);
    if (!['/', '/calendar', '/insights'].includes(window.location.hash.replace(/^#/, '') || '/')) go('/');
  };
  const add = async () => {
    const name = prompt('Name for the new journal (for example Travel or Family)');
    if (!name?.trim()) return;
    pick((await createJournal(name)).id);
  };
  if (!journals) return null;
  return (
    <div className="journal-list">
      <div className="journal-list-head">Journals</div>
      {journals.length > 1 && (
        <button className={current === 'all' ? 'on' : ''} onClick={() => pick('all')}>
          <span className="journal-dot all" aria-hidden /> All journals
        </button>
      )}
      {journals.map((j) => (
        <button key={j.id} className={current === j.id || (journals.length === 1 && current === 'all') ? 'on' : ''} onClick={() => pick(j.id)}>
          <JournalDot color={j.color} /> {j.name}
        </button>
      ))}
      <button className="journal-add" onClick={add}>＋ New journal</button>
    </div>
  );
}

function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const [code, setCode] = useState('');
  const [wrong, setWrong] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((await sha256(code)) === (await getSetting<string>('passcode'))) onUnlock();
    else {
      setWrong(true);
      setCode('');
    }
  };
  return (
    <form className="lock" onSubmit={submit}>
      <img src="./icon.svg" alt="" width={72} />
      <h2>Journal is locked</h2>
      <input type="password" autoFocus placeholder="Passcode" value={code} onChange={(e) => (setCode(e.target.value), setWrong(false))} />
      {wrong && <p className="error-text">That passcode is not right.</p>}
      <button className="btn primary">Unlock</button>
    </form>
  );
}
