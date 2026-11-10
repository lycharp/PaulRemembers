import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { buildBackup, download, openBackup, restoreBackup, type OpenedBackup } from '../backup';
import { addLog, canUseFolder, chooseFolder, DEFAULT_TIME, folderAccess, getDaily, getFolder, LOG_SIZE, nextSlot, setDaily, type BackupLogItem } from '../autoBackup';
import { useCloud } from '../cloud/cloud';
import type { Member } from '../cloud/sharing';
import { db, getSetting, setSetting } from '../db';
import { JournalDot } from '../journals';
import { IosSaveTip, isIPhoneOrIPad } from './IosSaveTip';
import { Dialog } from './Sharing';

const size = (bytes?: number) => (bytes == null ? '' : bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`);
const when = (t: number) => new Date(t).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const clock = (time: string) => {
  const [h, m] = time.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
};

/** Settings → Backup: download, restore, daily backup and its log. */
export function BackupCard() {
  const cloud = useCloud();
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [backedUp, setBackedUp] = useState(false);
  const [opened, setOpened] = useState<OpenedBackup | null>(null);
  const [usage, setUsage] = useState('');
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const count = useLiveQuery(() => db.entries.count(), []);

  useEffect(() => {
    navigator.storage?.estimate?.().then((e) => setUsage(`${((e.usage ?? 0) / 1e6).toFixed(1)} MB used`));
    navigator.storage?.persisted?.().then(setPersisted);
  }, [count]);

  const backup = async () => {
    setBusy(true);
    setMsg('');
    const name = `journal-backup-${new Date().toISOString().slice(0, 10)}.zip`;
    try {
      const b = await buildBackup();
      download(b.blob, name);
      await setSetting('lastBackup', Date.now());
      await addLog({ at: Date.now(), kind: 'manual', ok: true, entries: b.entries, bytes: b.blob.size, file: name, where: 'download', note: b.sharesIncluded ? undefined : 'Sharing list not included (offline).' });
      setBackedUp(true);
      if (!isIPhoneOrIPad()) setMsg('Backup downloaded. Keep it somewhere safe, like OneDrive or iCloud Drive.');
    } catch (e) {
      const note = e instanceof Error ? e.message : String(e);
      await addLog({ at: Date.now(), kind: 'manual', ok: false, note });
      setMsg(note);
    } finally {
      setBusy(false);
    }
  };

  const pick = async (f?: File) => {
    if (!f) return;
    setBusy(true);
    setMsg('');
    try {
      setOpened(await openBackup(f));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card pad">
      <h3>Backup</h3>
      <p className="muted">{cloud.user ? 'Your journal is saved on this computer and in your account online. A backup file is an extra copy you control.' : 'Your journal is saved in this browser on this computer. Download a backup now and then, so you have a copy if the browser data is ever cleared.'}</p>
      <div className="row">
        <button className="btn primary" onClick={backup} disabled={busy}>Download backup</button>
        <label className="btn">
          Restore from backup
          <input type="file" accept=".zip" hidden onChange={(e) => (pick(e.target.files?.[0]), (e.target.value = ''))} />
        </label>
      </div>
      <IosSaveTip after={backedUp} />
      {msg && <div className="notice ok small">{msg}</div>}
      <p className="muted small">
        {count ?? 0} entries · {usage}
        {persisted === false && (
          <> · <button className="link" onClick={() => navigator.storage.persist().then(setPersisted)}>Protect storage from automatic cleanup</button></>
        )}
        {persisted && ' · Storage is protected'}
      </p>

      <DailyBackup />
      <BackupLog />

      {opened && <RestoreDialog backup={opened} onClose={() => setOpened(null)} onDone={(m) => (setOpened(null), setMsg(m))} />}
    </section>
  );
}

function DailyBackup() {
  const cfg = useLiveQuery(() => getDaily(), []);
  const folder = useLiveQuery(async () => (await getFolder())?.name ?? null, []);
  const last = useLiveQuery(() => getSetting<number>('lastDailyBackup'), []);
  const [access, setAccess] = useState<string>('');
  const [err, setErr] = useState('');
  const useFolder = canUseFolder();

  useEffect(() => {
    if (useFolder && folder) folderAccess().then(setAccess);
  }, [useFolder, folder, last]);

  if (cfg === undefined && folder === undefined) return null;
  const on = !!cfg?.on;
  const time = cfg?.time ?? DEFAULT_TIME;

  const pickFolder = async () => {
    setErr('');
    try {
      await chooseFolder();
      setAccess(await folderAccess());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  const toggle = async (v: boolean) => {
    await setDaily(v, time);
    // Ask for the folder right away on computers that can save into one.
    if (v && useFolder && !folder) await pickFolder();
  };

  const next = on ? nextSlot(time) : 0;
  const nextText = on ? new Date(next).toDateString() === new Date().toDateString() ? `today at ${clock(time)}` : `tomorrow at ${clock(time)}` : '';

  return (
    <div className="daily-backup">
      <h4>Daily backup</h4>
      <label className="row check">
        <input type="checkbox" checked={on} onChange={(e) => toggle(e.target.checked)} />
        <span>Back up every day</span>
      </label>
      {on && (
        <>
          <label className="row">
            <span>At</span>
            <input type="time" value={time} onChange={(e) => e.target.value && setDaily(true, e.target.value)} />
          </label>
          {useFolder ? (
            <p className="muted small">
              {folder ? <>Saved by itself into the folder <strong>{folder}</strong>. The newest 7 are kept. </> : <>Choose a folder for your backups. A folder in <strong>OneDrive</strong> keeps them safe off this computer too. </>}
              <button className="link" onClick={pickFolder}>{folder ? 'Change folder' : 'Choose folder'}</button>
              {folder && access && access !== 'granted' && <> · The browser will ask you to allow saving there at backup time.</>}
            </p>
          ) : (
            <p className="muted small">
              {isIPhoneOrIPad()
                ? 'iPhone and iPad can’t save a file by themselves, so at backup time a bar asks you to tap Save. Then tap More… → Save to Files → iCloud Drive.'
                : 'This browser can’t save into a folder by itself, so at backup time a bar asks you to tap Save. (Edge or Chrome can save into a folder for you.)'}
            </p>
          )}
          <p className="muted small">
            Next backup {nextText}. The app needs to be open: if it’s closed then, the backup happens the next time you open it.
          </p>
          {err && <div className="notice small">{err}</div>}
        </>
      )}
    </div>
  );
}

function BackupLog() {
  const log = useLiveQuery(() => getSetting<BackupLogItem[]>('backupLog'), []);
  if (!log?.length) return null;
  return (
    <div className="backup-log">
      <h4>Backup log <span className="muted small">(last {LOG_SIZE})</span></h4>
      <ul>
        {log.map((l, i) => (
          <li key={i} className={l.ok ? '' : 'failed'}>
            <span className="bl-icon" aria-hidden>{l.ok ? '✓' : '✗'}</span>
            <span>
              <strong>{when(l.at)}</strong> · {l.kind === 'daily' ? 'Daily' : 'Manual'}
              {l.ok
                ? <> · {l.entries} {l.entries === 1 ? 'entry' : 'entries'} · {size(l.bytes)} · {l.where === 'folder' ? <>saved in “{l.folder}”</> : 'downloaded'}</>
                : <> · failed</>}
              {l.note && <span className="muted small"> · {l.note}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RestoreDialog({ backup, onClose, onDone }: { backup: OpenedBackup; onClose: () => void; onDone: (msg: string) => void }) {
  const cloud = useCloud();
  const signedIn = !!cloud.user;
  const usable = backup.journals.filter((j) => !j.theirs && (j.entries > 0 || !j.here));
  const [picked, setPicked] = useState(() => new Set(usable.map((j) => j.id)));
  // Journal id → emails selected to share again (all selected to start).
  const [people, setPeople] = useState(() => new Map(usable.map((j) => [j.id, new Set((j.shares ?? []).map((m) => m.email))])));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const theirs = backup.journals.filter((j) => j.theirs);

  const flip = (id: string) => setPicked((p) => {
    const n = new Set(p);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });
  const flipPerson = (id: string, email: string) => setPeople((p) => {
    const n = new Map(p);
    const s = new Set(n.get(id));
    s.has(email) ? s.delete(email) : s.add(email);
    n.set(id, s);
    return n;
  });

  const go = async () => {
    setBusy(true);
    setErr('');
    try {
      const shares: Record<string, Member[]> = {};
      for (const j of usable) shares[j.id] = (j.shares ?? []).filter((m) => people.get(j.id)?.has(m.email));
      const r = await restoreBackup(backup, [...picked], shares);
      const parts = [`Restored ${r.entries} ${r.entries === 1 ? 'entry' : 'entries'}`];
      if (r.skipped) parts.push(`${r.skipped} ${r.skipped === 1 ? 'was' : 'were'} already here`);
      if (r.shared) parts.push(`shared again with ${r.shared} ${r.shared === 1 ? 'person' : 'people'}`);
      onDone(`${parts.join(', ')}.${r.warning ? ` ${r.warning}` : ''}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Dialog title="Restore from backup" onClose={onClose}>
      {backup.exportedAt && <p className="muted small">Backup made {when(backup.exportedAt)}.</p>}
      <p>Select the journals to bring back. Entries already here are left as they are.</p>
      <ul className="restore-list">
        {usable.map((j) => {
          const shares = j.shares ?? [];
          return (
            <li key={j.id}>
              <label className="row check">
                <input type="checkbox" checked={picked.has(j.id)} onChange={() => flip(j.id)} />
                <JournalDot color={j.color} />
                <span className="grow">{j.name}</span>
                <span className="muted small">{j.entries} {j.entries === 1 ? 'entry' : 'entries'}{j.here ? ' · already here' : ''}</span>
              </label>
              {picked.has(j.id) && shares.length > 0 && (
                j.here ? (
                  <p className="muted small indent">This journal is still here, so its sharing is left as it is.</p>
                ) : !signedIn ? (
                  <p className="muted small indent">It was shared with {shares.map((m) => m.email).join(', ')}. Sign in first to share it with them again.</p>
                ) : (
                  <div className="indent">
                    <p className="muted small">Share it again with:</p>
                    {shares.map((m) => (
                      <label key={m.email} className="row check small">
                        <input type="checkbox" checked={people.get(j.id)?.has(m.email) ?? false} onChange={() => flipPerson(j.id, m.email)} />
                        <span>{m.email} <span className="muted">({m.role === 'editor' ? 'can edit' : 'can view'})</span></span>
                      </label>
                    ))}
                  </div>
                )
              )}
            </li>
          );
        })}
      </ul>
      {!usable.length && <p className="muted">There is nothing in this backup that can be restored.</p>}
      {theirs.length > 0 && (
        <p className="muted small">
          Not restored: {theirs.map((j) => `“${j.name}”`).join(', ')}, shared with you by {[...new Set(theirs.map((j) => j.ownerEmail ?? 'someone else'))].join(', ')}. It comes back from their account when you sign in, as long as they still share it with you.
        </p>
      )}
      {!backup.hasShares && signedIn && <p className="muted small">This backup doesn’t include who your journals were shared with (it was made before backups saved that, or while signed out).</p>}
      {err && <div className="notice small">{err}</div>}
      <div className="row">
        <button className="btn primary" disabled={busy || !picked.size} onClick={go}>{busy ? 'Restoring…' : 'Restore'}</button>
        <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
      </div>
    </Dialog>
  );
}
