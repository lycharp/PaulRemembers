import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { createJournal, db, deleteJournal, getSetting, isOwnJournal, JOURNAL_COLORS, setSetting, updateJournal } from '../db';
import { JournalDot, useJournals } from '../journals';
import { sha256 } from '../util';
import { AccountCard } from './Account';
import { PoquitoBadge } from './About';
import { JournalSharingCard } from './Sharing';
import { useAdmin } from '../cloud/admin';
import { EraseCard } from './EraseCard';
import { InstallCard } from './Install';
import { Icon } from './Icon';
import { BackupCard } from './BackupCard';
import { ProfileCard } from './People';

export function Settings({ onLock }: { onLock: () => void }) {
  const [msg, setMsg] = useState('');
  const hasPass = useLiveQuery(async () => !!(await getSetting<string>('passcode')), []);

  const setPasscode = async () => {
    const a = prompt('Choose a passcode (at least 4 characters)');
    if (!a) return;
    if (a.length < 4) return alert('Passcode must be at least 4 characters.');
    if (prompt('Enter it again') !== a) return alert('Passcodes did not match.');
    await setSetting('passcode', await sha256(a));
    setMsg('Passcode set. The journal will ask for it each time it opens.');
  };

  return (
    <div className="settings">
      <h1>Settings</h1>

      <AdminLinkCard />
      <AccountCard />
      <ProfileCard />
      <Journals />
      <JournalSharingCard />

      <AppearanceCard />

      <BackupCard />

      <section className="card pad">
        <h3>Lock</h3>
        <p className="muted">Ask for a passcode when the journal opens. This keeps casual eyes out; it does not encrypt the data.</p>
        <div className="row">
          <button className="btn" onClick={setPasscode}>{hasPass ? 'Change passcode' : 'Set passcode'}</button>
          {hasPass && (
            <>
              <button className="btn" onClick={onLock}>Lock now</button>
              <button className="btn ghost danger" onClick={async () => { await db.settings.delete('passcode'); setMsg('Passcode removed.'); }}>Remove passcode</button>
            </>
          )}
        </div>
      </section>

      <InstallCard />

      <EraseCard />

      {msg && <div className="notice ok">{msg}</div>}

      <section className="card pad">
        <h3>About</h3>
        <PoquitoBadge />
      </section>
    </div>
  );
}

function Journals() {
  // Journals shared with you are listed under "Share a journal"; only the owner can rename or delete one.
  const journals = useJournals()?.filter(isOwnJournal);
  const counts = useLiveQuery(async () => {
    const m = new Map<string, number>();
    await db.entries.each((e) => m.set(e.journalId, (m.get(e.journalId) ?? 0) + 1));
    return m;
  }, []);
  if (!journals) return null;

  const rename = async (id: string, old: string) => {
    const name = prompt('New name for this journal', old);
    if (name?.trim()) await updateJournal(id, { name: name.trim() });
  };
  const recolor = async (id: string, color?: string) => {
    const i = JOURNAL_COLORS.indexOf(color ?? '');
    await updateJournal(id, { color: JOURNAL_COLORS[(i + 1) % JOURNAL_COLORS.length] });
  };
  const remove = async (id: string, name: string) => {
    const others = journals.filter((j) => j.id !== id);
    const n = counts?.get(id) ?? 0;
    const to = others[0];
    if (!confirm(n ? `Delete the journal "${name}"? Its ${n} ${n === 1 ? 'entry' : 'entries'} will move to "${to.name}", so nothing is lost.` : `Delete the empty journal "${name}"?`)) return;
    await deleteJournal(id, to.id);
  };
  const add = async () => {
    const name = prompt('Name for the new journal (for example Travel or Family)');
    if (name?.trim()) await createJournal(name);
  };

  return (
    <section className="card pad">
      <h3>Journals</h3>
      <p className="muted">Keep separate journals, like Personal, Travel or Family. Every entry belongs to one journal; you can move an entry by editing it.</p>
      <ul className="journal-manage">
        {journals.map((j) => (
          <li key={j.id}>
            <button className="color-btn" title="Change colour" onClick={() => recolor(j.id, j.color)}><JournalDot color={j.color} /></button>
            <span className="jm-name">{j.name}</span>
            <span className="muted small">{counts?.get(j.id) ?? 0} entries</span>
            <button className="btn small ghost" onClick={() => rename(j.id, j.name)}>Rename</button>
            {journals.length > 1 && <button className="btn small ghost danger" onClick={() => remove(j.id, j.name)}>Delete</button>}
          </li>
        ))}
      </ul>
      <button className="btn" onClick={add}><Icon name="plus" className="inline-icon" /> New journal</button>
    </section>
  );
}

/** Admins only: the way to the Admin page (on phones it isn't in the bottom bar). */
function AdminLinkCard() {
  const { admin, waiting } = useAdmin();
  if (!admin) return null;
  return (
    <a className="card pad admin-link" href="#/admin">
      <span className="grow">
        <h3 style={{ margin: 0 }}>Admin {waiting > 0 && <span className="count-dot">{waiting}</span>}</h3>
        <span className="muted small">People, invites, sharing and usage. Only admins see this.</span>
      </span>
      <span aria-hidden>›</span>
    </a>
  );
}

type Theme = 'auto' | 'light' | 'dark';

/** Light, Dark or Automatic (follows the phone or computer). Saved on this device only. */
function AppearanceCard() {
  const read = (): Theme => {
    try {
      const t = localStorage.getItem('pr.theme');
      return t === 'light' || t === 'dark' ? t : 'auto';
    } catch {
      return 'auto';
    }
  };
  const [theme, setTheme] = useState<Theme>(read);
  const pick = (t: Theme) => {
    setTheme(t);
    try {
      if (t === 'auto') localStorage.removeItem('pr.theme');
      else localStorage.setItem('pr.theme', t);
    } catch {
      /* storage blocked: still changes it until the app closes */
    }
    if (t === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
  };
  const options: [Theme, string][] = [['auto', 'Automatic'], ['light', 'Light'], ['dark', 'Dark']];
  return (
    <section className="card pad">
      <h3>Appearance</h3>
      <p className="muted">Automatic matches your phone or computer. This is saved on this device only.</p>
      <div className="chips" role="radiogroup" aria-label="Appearance">
        {options.map(([t, name]) => (
          <button key={t} role="radio" aria-checked={theme === t} className={`chip ${theme === t ? 'on' : ''}`} onClick={() => pick(t)}>{name}</button>
        ))}
      </div>
    </section>
  );
}
