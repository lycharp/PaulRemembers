import JSZip from 'jszip';
import { db, type Entry, type Media } from './db';

/**
 * Everything lives in this browser's storage, so a backup file is the way to
 * keep a safe copy or move the journal to another computer.
 */
const extFor = (type: string) =>
  ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic', 'video/mp4': 'mp4', 'audio/webm': 'webm', 'audio/mp4': 'm4a' } as Record<string, string>)[type] ?? 'bin';

export async function exportBackup(): Promise<Blob> {
  const zip = new JSZip();
  const entries = await db.entries.toArray();
  const media = await db.media.toArray();
  const mediaMeta = media.map(({ blob, ...m }) => ({ ...m, type: blob.type, file: `media/${m.id}.${extFor(blob.type)}` }));
  zip.file('journal.json', JSON.stringify({ version: 1, exportedAt: Date.now(), entries, media: mediaMeta }, null, 2));
  media.forEach((m, i) => zip.file(mediaMeta[i].file, m.blob));
  return zip.generateAsync({ type: 'blob' });
}

export async function restoreBackup(file: Blob): Promise<{ entries: number; skipped: number }> {
  const zip = await JSZip.loadAsync(file);
  const json = zip.file('journal.json');
  if (!json) throw new Error('This is not a journal backup file (journal.json is missing).');
  const data = JSON.parse(await json.async('string')) as {
    entries: Entry[];
    media: (Omit<Media, 'blob'> & { type: string; file: string })[];
  };
  const existing = new Set(await db.entries.toCollection().primaryKeys());
  const fresh = data.entries.filter((e) => !existing.has(e.id));
  const freshIds = new Set(fresh.map((e) => e.id));
  const media: Media[] = [];
  for (const { type, file: path, ...m } of data.media) {
    if (!freshIds.has(m.entryId)) continue;
    const f = zip.file(path);
    if (f) media.push({ ...m, blob: new Blob([await f.async('blob')], { type }) });
  }
  await db.transaction('rw', db.entries, db.media, async () => {
    await db.media.bulkPut(media);
    await db.entries.bulkPut(fresh);
  });
  return { entries: fresh.length, skipped: data.entries.length - fresh.length };
}

export function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
