/**
 * Daily backup.
 *
 * A web page can't wake itself up, so the backup runs while the app is open:
 * at the chosen time, or (if that time passed while the app was closed) the
 * next time it is opened or brought back to the front. Missed days make just
 * one catch-up backup.
 *
 * Where the file goes:
 * - Edge and Chrome on a computer can save into a folder the person picked once
 *   (ideally in OneDrive). Only the newest KEEP_FILES daily backups are kept there.
 * - Other browsers (iPhone/iPad Safari, Firefox) can't save a file by themselves,
 *   so a bar asks the person to tap Save.
 */
import { buildBackup, download, type BuiltBackup } from './backup';
import { getSetting, setSetting } from './db';

export interface DailyBackup {
  on: boolean;
  /** "21:00", local time. */
  time: string;
  /** When it was turned on or the time changed: earlier slots don't count as missed. */
  since: number;
}

export interface BackupLogItem {
  at: number;
  kind: 'daily' | 'manual';
  ok: boolean;
  entries?: number;
  bytes?: number;
  file?: string;
  /** Saved into the backup folder, or handed to the browser to save. */
  where?: 'folder' | 'download';
  folder?: string;
  note?: string;
}

export const LOG_SIZE = 7;
export const KEEP_FILES = 7;
export const DEFAULT_TIME = '21:00';
const FILE_PREFIX = 'Paul Remembers daily backup ';

// ─── Settings ───────────────────────────────────────────────────────────────

export const getDaily = async () => getSetting<DailyBackup>('dailyBackup');
export async function setDaily(on: boolean, time: string) {
  await setSetting('dailyBackup', { on, time, since: Date.now() } satisfies DailyBackup);
}
export const getLastDaily = async () => (await getSetting<number>('lastDailyBackup')) ?? 0;

export async function addLog(item: BackupLogItem) {
  const log = (await getSetting<BackupLogItem[]>('backupLog')) ?? [];
  await setSetting('backupLog', [item, ...log].slice(0, LOG_SIZE));
}

// ─── When ───────────────────────────────────────────────────────────────────

const at = (time: string, day: Date) => {
  const [h, m] = time.split(':').map(Number);
  const d = new Date(day);
  d.setHours(h || 0, m || 0, 0, 0);
  return d;
};

/** The most recent scheduled time at or before now. */
export function lastSlot(time: string, now = Date.now()): number {
  const d = at(time, new Date(now));
  if (d.getTime() > now) d.setDate(d.getDate() - 1);
  return d.getTime();
}

/** The next scheduled time after now. */
export function nextSlot(time: string, now = Date.now()): number {
  const d = at(time, new Date(now));
  if (d.getTime() <= now) d.setDate(d.getDate() + 1);
  return d.getTime();
}

export function isDue(cfg: DailyBackup | undefined, lastDone: number, now = Date.now()) {
  if (!cfg?.on) return false;
  return lastSlot(cfg.time, now) > Math.max(cfg.since, lastDone);
}

// ─── The backup folder (Edge and Chrome on a computer) ─────────────────────

type Perm = 'granted' | 'denied' | 'prompt';
type DirHandle = FileSystemDirectoryHandle & {
  queryPermission(o: { mode: 'readwrite' }): Promise<Perm>;
  requestPermission(o: { mode: 'readwrite' }): Promise<Perm>;
  values(): AsyncIterable<FileSystemHandle>;
};

/** This browser can save into a folder by itself. */
export const canUseFolder = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window && window.isSecureContext;

export const getFolder = async () => getSetting<DirHandle>('backupFolder');

/** Ask the person to pick the backup folder. Must run from a click. Returns its name, or null if they cancelled. */
export async function chooseFolder(): Promise<string | null> {
  try {
    const pick = (window as unknown as { showDirectoryPicker(o: object): Promise<DirHandle> }).showDirectoryPicker;
    const dir = await pick.call(window, { id: 'paul-remembers-backups', mode: 'readwrite', startIn: 'documents' });
    await setSetting('backupFolder', dir);
    return dir.name;
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') return null;
    throw e;
  }
}

export async function folderAccess(): Promise<Perm | 'none'> {
  const dir = await getFolder();
  if (!dir) return 'none';
  try {
    return await dir.queryPermission({ mode: 'readwrite' });
  } catch {
    return 'none';
  }
}

/** Ask again for permission to the folder. Must run from a click. */
export async function allowFolder(): Promise<boolean> {
  const dir = await getFolder();
  return !!dir && (await dir.requestPermission({ mode: 'readwrite' })) === 'granted';
}

const two = (n: number) => String(n).padStart(2, '0');
export function dailyFileName(now = new Date()) {
  return `${FILE_PREFIX}${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())} ${two(now.getHours())}${two(now.getMinutes())}.zip`;
}

async function saveToFolder(dir: DirHandle, name: string, blob: Blob) {
  const file = await dir.getFileHandle(name, { create: true });
  const w = await file.createWritable();
  await w.write(blob);
  await w.close();
  // Keep only the newest few daily backups (names sort by date).
  const old: string[] = [];
  for await (const h of dir.values()) if (h.kind === 'file' && h.name.startsWith(FILE_PREFIX) && h.name.endsWith('.zip')) old.push(h.name);
  old.sort().reverse();
  for (const n of old.slice(KEEP_FILES)) await dir.removeEntry(n).catch(() => {});
}

// ─── Running it ─────────────────────────────────────────────────────────────

/** What the daily backup needs from the person right now. */
export type Waiting =
  | { kind: 'none' }
  /** The browser needs a click to allow saving into the backup folder again. */
  | { kind: 'allow'; folder: string }
  /** The file is ready; tap Save (no folder possible or chosen). */
  | { kind: 'save'; backup: BuiltBackup; name: string };

let running = false;
/** Don't retry a failure over and over in one visit: wait until the app is opened again. */
let failedThisVisit = false;

async function withLock<T>(fn: () => Promise<T>): Promise<T | undefined> {
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (!locks) return fn();
  return locks.request('daily-backup', { ifAvailable: true }, async (lock) => (lock ? fn() : undefined));
}

async function finish(entry: BackupLogItem) {
  await addLog(entry);
  if (entry.ok) await setSetting('lastDailyBackup', entry.at);
}

/** Make the daily backup if it is due. Saves by itself where it can; otherwise says what it needs. */
export async function runDailyIfDue(): Promise<Waiting> {
  if (running || failedThisVisit) return { kind: 'none' };
  if (!isDue(await getDaily(), await getLastDaily())) return { kind: 'none' };
  running = true;
  try {
    return (
      (await withLock(async () => {
        if (!isDue(await getDaily(), await getLastDaily())) return { kind: 'none' } as Waiting;
        const dir = canUseFolder() ? await getFolder() : undefined;
        if (dir) {
          const perm = await dir.queryPermission({ mode: 'readwrite' }).catch(() => 'denied' as Perm);
          if (perm !== 'granted') return { kind: 'allow', folder: dir.name } as Waiting;
          return (await saveDailyToFolder()) ?? ({ kind: 'none' } as Waiting);
        }
        const name = dailyFileName();
        return { kind: 'save', backup: await buildBackup(), name } as Waiting;
      })) ?? { kind: 'none' }
    );
  } catch (e) {
    failedThisVisit = true;
    await finish({ at: Date.now(), kind: 'daily', ok: false, note: e instanceof Error ? e.message : String(e) });
    return { kind: 'none' };
  } finally {
    running = false;
  }
}

/** Save today's backup into the backup folder (permission already granted). */
export async function saveDailyToFolder(): Promise<Waiting | undefined> {
  const dir = await getFolder();
  if (!dir) return;
  const name = dailyFileName();
  try {
    const b = await buildBackup();
    await saveToFolder(dir, name, b.blob);
    await finish({ at: Date.now(), kind: 'daily', ok: true, entries: b.entries, bytes: b.blob.size, file: name, where: 'folder', folder: dir.name, note: b.sharesIncluded ? undefined : 'Sharing list not included (offline).' });
  } catch (e) {
    failedThisVisit = true;
    const msg = e instanceof Error ? e.message : String(e);
    await finish({ at: Date.now(), kind: 'daily', ok: false, folder: dir.name, note: `Could not save into the folder "${dir.name}" (${msg}). Choose the folder again in Settings → Backup.` });
  }
}

/** The person tapped Save on the bar. Runs inside the click, so the browser allows the download. */
export async function saveDailyByDownload(w: Extract<Waiting, { kind: 'save' }>) {
  download(w.backup.blob, w.name);
  await finish({ at: Date.now(), kind: 'daily', ok: true, entries: w.backup.entries, bytes: w.backup.blob.size, file: w.name, where: 'download', note: w.backup.sharesIncluded ? undefined : 'Sharing list not included (offline).' });
}
