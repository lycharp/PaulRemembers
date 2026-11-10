import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { allowFolder, getDaily, nextSlot, runDailyIfDue, saveDailyByDownload, saveDailyToFolder, type Waiting } from '../autoBackup';
import { useCloud } from '../cloud/cloud';
import { getSetting } from '../db';
import { isIPhoneOrIPad } from './IosSaveTip';

/**
 * Runs the daily backup when it is due: when the app opens, when it comes back
 * to the front, and at the chosen time while it is open. Shows a bar only when
 * the person has to tap something.
 */
export function DailyBackupBar() {
  const cloud = useCloud();
  const [waiting, setWaiting] = useState<Waiting>({ kind: 'none' });
  const [later, setLater] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const cfg = useLiveQuery(() => getDaily(), []);
  const last = useLiveQuery(() => getSetting<number>('lastDailyBackup'), []);
  const waitingRef = useRef(waiting);
  waitingRef.current = waiting;

  useEffect(() => {
    // Wait for sign-in to settle, so a signed-in backup includes everything.
    if (!cloud.ready || cloud.syncing || !cfg?.on) return;
    let stop = false;
    const check = async () => {
      if (stop || document.visibilityState !== 'visible' || waitingRef.current.kind !== 'none') return;
      const w = await runDailyIfDue();
      if (!stop) setWaiting(w);
    };
    void check();
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    // While the app is open, also run at the chosen time.
    const timer = setTimeout(check, Math.min(nextSlot(cfg.time) - Date.now() + 1000, 2 ** 31 - 1));
    return () => {
      stop = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
    };
  }, [cloud.ready, cloud.syncing, cfg?.on, cfg?.time, cfg?.since, last]);

  if (saved && isIPhoneOrIPad())
    return (
      <div className="update-bar" role="status">
        <span className="wrap">Tap <strong>More…</strong> → <strong>Save to Files</strong> → <strong>iCloud Drive</strong>.</span>
        <button className="link" onClick={() => setSaved(false)}>OK</button>
      </div>
    );
  if (waiting.kind === 'none' || later || !cfg?.on) return null;

  const save = async () => {
    setBusy(true);
    try {
      if (waiting.kind === 'save') {
        await saveDailyByDownload(waiting);
        setSaved(true);
      } else if (waiting.kind === 'allow') {
        if (await allowFolder()) await saveDailyToFolder();
      }
    } finally {
      setWaiting({ kind: 'none' });
      setBusy(false);
    }
  };

  return (
    <div className="update-bar" role="status">
      <span className="wrap">
        {waiting.kind === 'allow' ? <>Time for your daily backup. Allow saving to “{waiting.folder}”.</> : <>Your daily backup is ready.</>}
      </span>
      <button className="btn primary" onClick={save} disabled={busy}>{waiting.kind === 'allow' ? 'Allow and save' : 'Save'}</button>
      <button className="link" onClick={() => setLater(true)}>Later</button>
    </div>
  );
}
