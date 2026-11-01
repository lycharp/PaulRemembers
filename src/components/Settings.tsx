import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { exportBackup, download, restoreBackup } from '../backup';
import { db, getSetting, setSetting } from '../db';
import { sha256 } from '../util';

export function Settings({ onLock }: { onLock: () => void }) {
  const [usage, setUsage] = useState<string>('');
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const hasPass = useLiveQuery(async () => !!(await getSetting<string>('passcode')), []);
  const count = useLiveQuery(() => db.entries.count(), []);

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

      <section className="card pad">
        <h3>Backup</h3>
        <p className="muted">Your journal is saved in this browser on this computer. Download a backup now and then, so you have a copy if the browser data is ever cleared.</p>
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
          if (!confirm('Erase every entry, photo and setting from this browser? Download a backup first if you want to keep them.')) return;
          await db.delete();
          location.reload();
        }}>Erase all journal data</button>
      </section>

      {msg && <div className="notice ok">{msg}</div>}
    </div>
  );
}
