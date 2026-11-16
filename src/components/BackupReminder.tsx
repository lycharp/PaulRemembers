import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import type { BackupLogItem } from '../autoBackup';
import { useCloud } from '../cloud/cloud';
import { db, getSetting, setSetting } from '../db';
import { go, useRoute } from '../util';

const DAY = 24 * 60 * 60 * 1000;
/** Suggest a backup when this device hasn't made one for this many days. */
export const REMIND_AFTER_DAYS = 7;

/** When this device last made a backup that worked (downloaded or daily), or 0. */
export async function lastGoodBackup(): Promise<number> {
  const log = (await getSetting<BackupLogItem[]>('backupLog')) ?? [];
  const fromLog = log.filter((l) => l.ok).map((l) => l.at);
  return Math.max(0, (await getSetting<number>('lastBackup')) ?? 0, (await getSetting<number>('lastDailyBackup')) ?? 0, ...fromLog);
}

/**
 * Once a week, suggest a backup: a bar shows when this device hasn't made a
 * backup (downloaded or daily) for 7 days. "Later" hides it for a day.
 * A device that has never made one waits 7 days from when it first opened
 * the app, so a new phone isn't asked straight away.
 */
export function BackupReminder() {
  const cloud = useCloud();
  const route = useRoute();
  const [now, setNow] = useState(Date.now());
  const info = useLiveQuery(async () => {
    // (Live queries can only read; the first visit is written down below.)
    const firstSeen = (await getSetting<number>('firstSeen')) ?? Date.now();
    return {
      last: await lastGoodBackup(),
      firstSeen,
      later: (await getSetting<number>('backupReminderLater')) ?? 0,
      entries: await db.entries.count(),
    };
  }, []);

  useEffect(() => {
    void getSetting<number>('firstSeen').then(async (t) => {
      if (!t) await setSetting('firstSeen', Date.now());
    });
  }, []);

  // Check again when the app comes back to the front (it may have been open for days).
  useEffect(() => {
    const tick = () => document.visibilityState === 'visible' && setNow(Date.now());
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('focus', tick);
    return () => {
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('focus', tick);
    };
  }, []);

  if (!info || !cloud.ready || cloud.syncing || !info.entries) return null;
  if (cloud.configured && !cloud.user) return null; // the sign-in screen
  // Already on the Backup page: no need to point there.
  if (route === '/settings') return null;
  const since = info.last || info.firstSeen;
  if (now - since < REMIND_AFTER_DAYS * DAY || now < info.later) return null;

  const openBackup = () => {
    go('/settings');
    setTimeout(() => document.getElementById('backup')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
  };
  const days = Math.floor((now - since) / DAY);
  return (
    <div className="update-bar" role="status">
      <span className="wrap">
        {info.last ? <>It’s been {days} days since your last backup.</> : <>You haven’t made a backup on this device yet.</>} We suggest one at least once a week.
      </span>
      <button className="btn primary" onClick={openBackup}>Back up now</button>
      <button className="link" onClick={() => setSetting('backupReminderLater', Date.now() + DAY)}>Later</button>
    </div>
  );
}
