import { useEffect, useState } from 'react';
import { createJournal, getSetting } from './db';
import { JournalMark, SharedSign, splitJournals, useCanWriteHere, useCurrentJournal, useJournalLabel, useJournals } from './journals';
import { Account, SignIn, SyncStatus } from './components/Account';
import { APP_NAME, PoquitoBadge } from './components/About';
import { Help } from './components/Help';
import { Tour } from './components/Tour';
import { SharedEntryPage } from './components/Sharing';
import { hasSavedSignIn, useCloud } from './cloud/cloud';
import { CalendarView } from './components/CalendarView';
import { EntryPage } from './components/EntryPage';
import { Icon, type IconName } from './components/Icon';
import { ImportPage } from './components/ImportPage';
import { Insights } from './components/Insights';
import { Settings } from './components/Settings';
import { AdminPage } from './components/Admin';
import { useAdmin } from './cloud/admin';
import { ProfileCard, useNeedsProfile } from './components/People';
import { forgetListPosition, Timeline } from './components/Timeline';
import { Loading } from './components/Loading';
import { go, sha256, useRoute } from './util';

const NAV = [
  { path: '/', label: 'Journal', icon: 'journal' },
  { path: '/calendar', label: 'Calendar', icon: 'calendar' },
  { path: '/insights', label: 'Insights', icon: 'insights' },
  { path: '/import', label: 'Import', icon: 'import' },
  { path: '/settings', label: 'Settings', icon: 'settings' },
  { path: '/help', label: 'Help', icon: 'help' },
  { path: '/admin', label: 'Admin', icon: 'shield' },
] satisfies { path: string; label: string; icon: IconName }[];

const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

export function App() {
  const route = useRoute();
  const [locked, setLocked] = useState<boolean | null>(null);
  const cloud = useCloud();
  const needsProfile = useNeedsProfile();
  const { admin, waiting } = useAdmin();
  // No + or New entry while looking at a journal you can only read.
  const canWrite = useCanWriteHere();

  // Only coming straight back from an entry returns the list to that entry.
  useEffect(() => {
    if (route !== '/' && !route.startsWith('/entry/')) forgetListPosition();
  }, [route]);

  useEffect(() => {
    getSetting<string>('passcode').then((p) => setLocked(!!p));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n' && !locked && canWrite) {
        e.preventDefault();
        go('/new');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [locked, canWrite]);

  // A shared link is for someone else to read: no lock screen, no app chrome.
  const shareToken = /^\/s\/([\w-]+)$/.exec(route)?.[1];
  if (shareToken) return <SharedEntryPage token={shareToken} />;

  if (locked === null) return <Loading full />;
  if (locked) return <LockScreen onUnlock={() => setLocked(false)} />;

  // Invite-only: signed out, the app shows nothing but the sign-in screen. The
  // invite email's link (#/join/<email>) opens "Create an account" instead.
  const joinEmail = /^\/join\/(.+)$/.exec(route)?.[1];
  if (cloud.configured && !cloud.user && !(hasSavedSignIn() && !cloud.ready)) {
    if (!cloud.ready) return <Loading full />;
    return (
      <div className="welcome">
        <SignIn key={joinEmail ?? ''} join={joinEmail ? safeDecode(joinEmail) : undefined} />
        <PoquitoBadge />
      </div>
    );
  }
  // Already signed in when opening an invite link: just open the journal.
  if (joinEmail) {
    go('/');
    return null;
  }
  // Everyone picks a name and an icon before using the app.
  if (cloud.user && needsProfile) {
    return (
      <div className="welcome">
        <ProfileCard required />
        <PoquitoBadge />
      </div>
    );
  }

  const entryId = /^\/entry\/(.+)$/.exec(route)?.[1];
  let page;
  if (route === '/new') page = <EntryPage key="new" />;
  else if (entryId) page = <EntryPage key={entryId} id={entryId} />;
  else if (route === '/calendar') page = <CalendarView />;
  else if (route === '/insights') page = <Insights />;
  else if (route === '/import') page = <ImportPage />;
  else if (route === '/account') page = <Account />;
  else if (route === '/help') page = <Help />;
  else if (route === '/admin') page = <AdminPage />;
  else if (route === '/settings') page = <Settings onLock={() => setLocked(true)} />;
  else page = <Timeline />;

  const active = entryId || route === '/new' ? '/' : route;
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand"><img src="./icon.svg" alt="" /> {APP_NAME}</div>
        {canWrite && (
          <button className="btn primary new-btn" data-tour="new" onClick={() => go('/new')} title="New entry (Ctrl+N)">
            <Icon name="plus" className="inline-icon" /> New entry
          </button>
        )}
        <nav>
          {NAV.filter((n) => n.path !== '/admin' || admin).map((n) => (
            <a key={n.path} href={`#${n.path}`} data-tour={`nav-${n.path}`} className={`${active === n.path ? 'on' : ''} ${n.path === '/admin' ? 'nav-admin' : ''}`}
              onClick={n.path === '/' ? forgetListPosition : undefined}>
              <span className="nav-icon"><Icon name={n.icon} />{waiting > 0 && (n.path === '/admin' || n.path === '/settings') && <span className={`count-dot ${n.path === '/settings' ? 'phone-only' : ''}`}>{waiting}</span>}</span> {n.label}
            </a>
          ))}
        </nav>
        <JournalList />
        <PoquitoBadge className="sidebar-badge" />
        <SidebarResize />
        {cloud.configured && (
          <a className={`account-link ${route === '/account' ? 'on' : ''}`} href="#/account" data-tour="account">
            <span className={`nav-icon ${cloud.error ? 'has-problem' : ''}`} title={cloud.error ? 'Sync problem' : undefined}>
              <Icon name={cloud.user && cloud.syncing ? 'sync' : 'account'} className={cloud.user && cloud.syncing ? 'spin' : ''} />
            </span>
            <span className="account-text">
              {cloud.user ? cloud.user.email : 'Sign in'}
              {cloud.user && <small className="muted"><SyncStatus /></small>}
            </span>
            <span className="account-short">{cloud.user ? (cloud.syncing ? 'Syncing' : 'Account') : 'Sign in'}</span>
          </a>
        )}
      </aside>
      <main className="main">{page}</main>
      {canWrite && <button className="fab" data-tour="new" onClick={() => go('/new')} aria-label="New entry" title="New entry (Ctrl+N)"><Icon name="plus" /></button>}
      {/* Wait for "Getting your journal…" to finish so the tour points at the real screen. */}
      <Tour autoStart={route === '/' && !(cloud.user && !cloud.lastSync && !cloud.error)} />
    </div>
  );
}

function JournalList() {
  const journals = useJournals();
  const label = useJournalLabel();
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
  const { mine, shared } = splitJournals(journals);
  const row = (j: (typeof journals)[number]) => (
    <button key={j.id} className={current === j.id || (journals.length === 1 && current === 'all') ? 'on' : ''} onClick={() => pick(j.id)}>
      <JournalMark journal={j} /> <span className="grow">{label(j)}</span> <SharedSign journal={j} />
    </button>
  );
  return (
    <div className="journal-list" data-tour="journals">
      <div className="journal-list-head">Journals</div>
      {journals.length > 1 && (
        <button className={current === 'all' ? 'on' : ''} onClick={() => pick('all')}>
          <span className="journal-dot all" aria-hidden /> All journals
        </button>
      )}
      {shared.length > 0 && <div className="journal-list-head sub">My journals</div>}
      {mine.map(row)}
      {shared.length > 0 && <div className="journal-list-head sub">Shared with me</div>}
      {shared.map(row)}
      <button className="journal-add" onClick={add}><Icon name="plus" className="inline-icon" /> New journal</button>
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
      <h2>{APP_NAME} is locked</h2>
      <input type="password" autoFocus placeholder="Passcode" value={code} onChange={(e) => (setCode(e.target.value), setWrong(false))} />
      {wrong && <p className="error-text">That passcode is not right.</p>}
      <button className="btn primary">Unlock</button>
    </form>
  );
}

const SIDEBAR_KEY = 'pr.sidebarWidth';
const SIDEBAR_MIN = 230;
const SIDEBAR_MAX = 460;
const setSidebarWidth = (w?: number) => {
  if (w) document.documentElement.style.setProperty('--sidebar-w', `${w}px`);
  else document.documentElement.style.removeProperty('--sidebar-w');
};
// The width chosen on this computer, put back before the first paint.
try {
  const w = Number(localStorage.getItem(SIDEBAR_KEY));
  if (w >= SIDEBAR_MIN && w <= SIDEBAR_MAX) setSidebarWidth(w);
} catch { /* storage blocked: normal width */ }

/** The left side's right edge on a computer: drag to make it wider, double-click for the normal width. */
function SidebarResize() {
  const [dragging, setDragging] = useState(false);
  const start = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const left = (el.parentElement as HTMLElement).getBoundingClientRect().left;
    let w = 0;
    const move = (ev: PointerEvent) => {
      w = Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, ev.clientX - left)));
      setSidebarWidth(w);
    };
    const end = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('pointercancel', end);
      setDragging(false);
      try { if (w) localStorage.setItem(SIDEBAR_KEY, String(w)); } catch { /* not remembered */ }
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    setDragging(true);
  };
  const reset = () => {
    setSidebarWidth();
    try { localStorage.removeItem(SIDEBAR_KEY); } catch { /* fine */ }
  };
  return (
    <div className={`sidebar-resize ${dragging ? 'dragging' : ''}`} onPointerDown={start} onDoubleClick={reset}
      role="separator" aria-orientation="vertical" title="Drag to make wider or narrower. Double-click for the normal width." />
  );
}
