import { useEffect, useState } from 'react';
import { createJournal, getSetting } from './db';
import { JournalDot, useCurrentJournal, useJournals } from './journals';
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

/** Same look as the splash built into index.html, so the hand-over is seamless. */
function Splash() {
  return (
    <div className="splash" role="status">
      <img src="./icon.svg" alt="" />
      <span>Opening {APP_NAME}…</span>
    </div>
  );
}

export function App() {
  const route = useRoute();
  const [locked, setLocked] = useState<boolean | null>(null);
  const cloud = useCloud();
  const needsProfile = useNeedsProfile();
  const { admin, waiting } = useAdmin();

  // Only coming straight back from an entry returns the list to that entry.
  useEffect(() => {
    if (route !== '/' && !route.startsWith('/entry/')) forgetListPosition();
  }, [route]);

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

  // A shared link is for someone else to read: no lock screen, no app chrome.
  const shareToken = /^\/s\/([\w-]+)$/.exec(route)?.[1];
  if (shareToken) return <SharedEntryPage token={shareToken} />;

  if (locked === null) return <Splash />;
  if (locked) return <LockScreen onUnlock={() => setLocked(false)} />;

  // Invite-only: signed out, the app shows nothing but the sign-in screen. The
  // invite email's link (#/join/<email>) opens "Create an account" instead.
  const joinEmail = /^\/join\/(.+)$/.exec(route)?.[1];
  if (cloud.configured && !cloud.user && !(hasSavedSignIn() && !cloud.ready)) {
    if (!cloud.ready) return <Splash />;
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
        <button className="btn primary new-btn" data-tour="new" onClick={() => go('/new')} title="New entry (Ctrl+N)">
          <Icon name="plus" className="inline-icon" /> New entry
        </button>
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
      <button className="fab" data-tour="new" onClick={() => go('/new')} aria-label="New entry" title="New entry (Ctrl+N)"><Icon name="plus" /></button>
      {/* Wait for "Getting your journal…" to finish so the tour points at the real screen. */}
      <Tour autoStart={route === '/' && !(cloud.user && !cloud.lastSync && !cloud.error)} />
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
    <div className="journal-list" data-tour="journals">
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
