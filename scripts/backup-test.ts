/**
 * Backup and restore test (signed out, plus what the server sees after a
 * "Delete for good" and a restore). Run: npx tsx scripts/backup-test.ts
 */
import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';

type Row = Record<string, any>;
const tables: Record<string, Row[]> = { journals: [], entries: [], media: [], journal_members: [], entry_shares: [] };
const files = new Map<string, Blob>();
let clock = 0;
const stamp = () => new Date(Date.UTC(2026, 0, 1) + ++clock * 1000).toISOString();
const ME = { id: 'u1', email: 'paul@x.com' };
function query(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let op: Row | null = null;
  const b: any = {
    select: () => b, order: () => b, range: () => b,
    gt: (c: string, v: any) => (filters.push((r) => r[c] > v), b),
    eq: (c: string, v: any) => (filters.push((r) => r[c] === v), b),
    in: (c: string, v: any[]) => (filters.push((r) => v.includes(r[c])), b),
    update: (patch: Row) => ((op = patch), b),
    upsert: async (row: Row) => {
      const ex = tables[table].find((r) => r.id === row.id);
      if (ex) Object.assign(ex, structuredClone(row), { synced_at: stamp() });
      else tables[table].push({ ...(table === 'journals' ? { owner_id: ME.id } : {}), deleted: false, ...structuredClone(row), synced_at: stamp() });
      return { error: null };
    },
    then: (res: any, rej: any) => {
      const rows = tables[table].filter((r) => filters.every((f) => f(r)));
      if (op) rows.forEach((r) => Object.assign(r, op, { synced_at: stamp() }));
      return Promise.resolve({ data: op ? null : structuredClone(rows), error: null }).then(res, rej);
    },
  };
  return b;
}
const sb: any = { from: query, storage: { from: () => ({ upload: async (p: string, x: Blob) => (files.set(p, x), { error: null }), remove: async (ps: string[]) => (ps.forEach((p) => files.delete(p)), { error: null }) }) } };

const { db } = await import('../src/db');
const sync = await import('../src/cloud/sync');
const backup = await import('../src/backup');
const auto = await import('../src/autoBackup');
const settle = () => new Promise((r) => setTimeout(r, 50));
sync.trackChanges();
await sync.withoutSync(async () => { await db.journals.clear(); });
await settle();
await sync.resetSync();

// Two journals, one with a photo; and a friend's journal shared with us.
await db.journals.bulkPut([
  { id: 'jA', name: 'Personal', createdAt: 1, updatedAt: 1, ownerId: ME.id, role: 'owner' },
  { id: 'jB', name: 'Travel', createdAt: 2, updatedAt: 2 },
]);
await db.entries.bulkPut([
  { id: 'a1', journalId: 'jA', date: 1, title: 'A1', body: '', bookmarked: false, mediaIds: ['m1'], createdAt: 1, updatedAt: 1 },
  { id: 'b1', journalId: 'jB', date: 2, title: 'B1', body: '', bookmarked: false, mediaIds: [], createdAt: 1, updatedAt: 1 },
]);
await db.media.put({ id: 'm1', entryId: 'a1', kind: 'photo', blob: new Blob(['img'], { type: 'image/jpeg' }) });
await settle();
await sync.linkDevice(sb, ME);
await sync.push(sb, ME.id);
assert.equal(tables.journals.find((j) => j.id === 'jA')!.deleted, false);
// A friend's journal shared with us (as it would arrive from the account).
await sync.withoutSync(async () => {
  await db.journals.put({ id: 'jF', name: 'Family', createdAt: 3, updatedAt: 3, ownerId: 'u2', ownerEmail: 'friend@x.com', role: 'viewer' });
  await db.entries.put({ id: 'f1', journalId: 'jF', date: 3, title: 'F1', body: '', bookmarked: false, mediaIds: [], createdAt: 1, updatedAt: 1 });
});

// Backup (signed out in this test: no sharing list), then delete jA for good.
const built = await backup.buildBackup();
assert.equal(built.entries, 2, "a friend's shared journal is left out");
const { deleteJournalsAndEntries } = await import('../src/db');
await deleteJournalsAndEntries(['jA']);
await settle();
await sync.push(sb, ME.id);
const deletedAt = tables.journals.find((j) => j.id === 'jA')!.updated_at;
assert.equal(tables.journals.find((j) => j.id === 'jA')!.deleted, true);
assert.equal(tables.entries.find((e) => e.id === 'a1')!.deleted, true);

// Open the backup: lists the journals.
const opened = await backup.openBackup(built.blob);
assert.deepEqual(opened.journals.map((j) => [j.id, j.entries, j.here, j.theirs]), [['jA', 1, false, false], ['jB', 1, true, false]]);

// Restore only jA.
await new Promise((r) => setTimeout(r, 5));
const r = await backup.restoreBackup(opened, ['jA', 'jF']);
assert.deepEqual([r.entries, r.skipped, r.journals], [1, 0, 1]);
assert.ok(await db.journals.get('jA'));
assert.equal(await (await db.media.get('m1'))!.blob.text(), 'img');
assert.equal((await db.journals.get('jA'))!.ownerId, undefined, 'restored journal becomes yours');
await settle();
await sync.push(sb, ME.id);
const jA = tables.journals.find((j) => j.id === 'jA')!;
assert.equal(jA.deleted, false, 'journal is un-deleted online');
assert.ok(jA.updated_at > deletedAt, 'newer than the delete, so other devices take it');
const a1 = tables.entries.find((e) => e.id === 'a1')!;
assert.equal(a1.deleted, false);
assert.ok(a1.updated_at > deletedAt);
assert.ok(files.has('a1/m1'), 'photo uploaded again');

// Restoring again adds nothing.
const again = await backup.restoreBackup(await backup.openBackup(built.blob), ['jA', 'jB']);
assert.deepEqual([again.entries, again.skipped], [0, 2]);

// Older backups without a journal list go into the default journal.
const JSZip = (await import('jszip')).default;
const z = new JSZip();
z.file('journal.json', JSON.stringify({ entries: [{ id: 'o1', date: 5, title: 'Old', body: '', bookmarked: false, mediaIds: [], createdAt: 1, updatedAt: 1 }], media: [] }));
const old = await backup.openBackup(await z.generateAsync({ type: 'blob' }));
assert.equal(old.journals[0].id, backup.OLD_BACKUP_GROUP);
await backup.restoreBackup(old, [backup.OLD_BACKUP_GROUP]);
assert.ok((await db.entries.get('o1'))!.journalId);

// Daily schedule.
const t = (s: string) => new Date(s).getTime();
assert.equal(auto.lastSlot('21:00', t('2026-11-10T22:00')), t('2026-11-10T21:00'));
assert.equal(auto.lastSlot('21:00', t('2026-11-10T10:00')), t('2026-11-09T21:00'));
assert.equal(auto.nextSlot('21:00', t('2026-11-10T10:00')), t('2026-11-10T21:00'));
const cfg = { on: true, time: '21:00', since: t('2026-11-10T10:00') };
assert.equal(auto.isDue(cfg, 0, t('2026-11-10T20:59')), false, 'not before the first time');
assert.equal(auto.isDue(cfg, 0, t('2026-11-10T21:00')), true);
assert.equal(auto.isDue(cfg, t('2026-11-10T21:01'), t('2026-11-11T08:00')), false, 'done today');
assert.equal(auto.isDue(cfg, t('2026-11-10T21:01'), t('2026-11-13T08:00')), true, 'missed days: one catch-up');
assert.equal(auto.isDue({ ...cfg, on: false }, 0, t('2026-11-13T08:00')), false);

// Log keeps the last 7.
for (let i = 0; i < 9; i++) await auto.addLog({ at: i, kind: 'daily', ok: true });
const log = (await (await import('../src/db')).getSetting<any[]>('backupLog'))!;
assert.equal(log.length, 7);
assert.equal(log[0].at, 8);
// File names and which old daily backups are removed (newest 7 of this account, plus older unnamed ones).
assert.match(backup.backupFileName(undefined, new Date(2026, 10, 10)), /^Paul Remembers backup - not signed in - 2026-11-10\.zip$/);
assert.match(auto.dailyFileName(new Date(2026, 10, 10, 21, 5)), /^Paul Remembers daily backup - not signed in - 2026-11-10 2105\.zip$/);
const names = [
  ...Array.from({ length: 8 }, (_, i) => `Paul Remembers daily backup - paul - 2026-11-${String(10 + i)} 2100.zip`),
  'Paul Remembers daily backup 2026-11-01 2100.zip',
  'Paul Remembers daily backup - friend - 2026-11-01 2100.zip',
  'notes.txt',
];
assert.deepEqual(auto.dailyFilesToRemove(names, 'paul').sort(), ['Paul Remembers daily backup - paul - 2026-11-10 2100.zip', 'Paul Remembers daily backup 2026-11-01 2100.zip'].sort());
console.log('backup test passed');
process.exit(0);
