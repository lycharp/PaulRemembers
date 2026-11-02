import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { exportBackup, download, restoreBackup } from '../backup';
import { createJournal, db, deleteJournal, getSetting, isOwnJournal, JOURNAL_COLORS, setSetting, updateJournal } from '../db';
import { JournalDot, useJournals } from '../journals';
import { sha256 } from '../util';
import { AccountCard } from './Account';
import { JournalSharingCard } from './Sharing';
import { useCloud } from '../cloud/cloud';
import { resetSync } from '../cloud/sync';

export function Settings({ onLock }: { onLock: () => void }) {
  const [usage, setUsage] = useState<string>('');
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const hasPass = useLiveQuery(async () => !!(await getSetting<string>('passcode')), []);
  const count = useLiveQuery(() => db.entries.count(), []);
  const cloud = useCloud();

  useEffect(() => {
    navigator.storage?.estimate?.().then((e) => setUsage(`${((e.usage ?? 0) / 1e6).toFixed(1)} MB used`));
    navigator.storage?.persisted?.().then(setPersisted);
  }, [count]);

  const backup = async () => {
    setBusy(true);
    try {
      download(await exportBackup(), `journal-backup-${new Date().toISOString().slice(0, 10)}.zip`);
      await setSetting('lastBackup', Date.now());
      setMsg('Backup downloaded. Keep it somewhere safe, like OneDrive or iCloud Drive.');
    } finally {
      setBusy(false);
    }
  };

  const restore = async (f?: File) => {
    if (!f) return;
    setBusy(true);
    try {
      const r = await restoreBackup(f);
      setMsg(`Restored ${r.entries} entries${r.skipped ? `, ${r.skipped} were already here` : ''}.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

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

      <AccountCard />
      <JournalSharingCard />
      <Journals />

      <section className="card pad">
        <h3>Backup</h3>
        <p className="muted">{cloud.user ? 'Your journal is saved on this computer and in your account online. A backup file is an extra copy you control.' : 'Your journal is saved in this browser on this computer. Download a backup now and then, so you have a copy if the browser data is ever cleared.'}</p>
        <div className="row">
          <button className="btn primary" onClick={backup} disabled={busy}>Download backup</button>
          <label className="btn">
            Restore from backup
            <input type="file" accept=".zip" hidden onChange={(e) => restore(e.target.files?.[0])} />
          </label>
        </div>
        <p className="muted small">
          {count ?? 0} entries · {usage}
          {persisted === false && (
            <> · <button className="link" onClick={() => navigator.storage.persist().then(setPersisted)}>Protect storage from automatic cleanup</button></>
          )}
          {persisted && ' · Storage is protected'}
        </p>
      </section>

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

      <section className="card pad">
        <h3>Install on Windows</h3>
        <p className="muted">In Edge or Chrome, click the install icon at the right end of the address bar (or ⋯ → Apps → Install this site as an app). The journal then opens in its own window from the Start menu and works offline.</p>
      </section>

      <section className="card pad">
        <h3>Erase</h3>
        <button className="btn ghost danger" onClick={async () => {
          if (!confirm(cloud.user
            ? 'Erase every entry, photo and setting from this browser? Your account keeps its copy online, and it downloads again the next time you sign in here.'
            : 'Erase every entry, photo and setting from this browser? Download a backup first if you want to keep them.')) return;
          await resetSync();
          await db.delete();
          location.reload();
        }}>Erase all journal data</button>
      </section>

      {msg && <div className="notice ok">{msg}</div>}
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
      <button className="btn" onClick={add}>＋ New journal</button>
    </section>
  );
}
