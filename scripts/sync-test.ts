/**
 * Sync smoke test against an in-memory stand-in for Supabase.
 * Run: npx tsx scripts/sync-test.ts
 */
import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import Dexie from 'dexie';
(Dexie as any).debug = true;
process.on('uncaughtException', (e: any) => { console.log('UNCAUGHT', e.stack, e._stack); process.exit(1); });

type Row = Record<string, any>;
const tables: Record<string, Row[]> = { journals: [], entries: [], media: [], journal_members: [] };
const files = new Map<string, Blob>();
let clock = 0;
const stamp = () => new Date(Date.UTC(2026, 0, 1) + ++clock * 1000).toISOString();
const ME = { id: 'u1', email: 'paul@x.com' };

function query(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let range: [number, number] | null = null;
  let op: { kind: 'select' } | { kind: 'update'; patch: Row } = { kind: 'select' };
  const run = () => {
    if (op.kind === 'update') {
      const patch = op.patch;
      tables[table].filter((r) => filters.every((f) => f(r))).forEach((r) => Object.assign(r, structuredClone(patch), { synced_at: stamp() }));
      return { data: null, error: null };
    }
    let rows = tables[table].filter((r) => filters.every((f) => f(r))).map((r) => structuredClone(r));
    rows.sort((a, b) => (a.synced_at ?? '').localeCompare(b.synced_at ?? '') || String(a.id).localeCompare(String(b.id)));
    if (range) rows = rows.slice(range[0], range[1] + 1);
    return { data: rows, error: null };
  };
  const b: any = {
    select: () => b,
    order: () => b,
    range: (f: number, t: number) => ((range = [f, t]), b),
    gt: (c: string, v: any) => (filters.push((r) => r[c] > v), b),
    eq: (c: string, v: any) => (filters.push((r) => r[c] === v), b),
    in: (c: string, v: any[]) => (filters.push((r) => v.includes(r[c])), b),
    update: (patch: Row) => ((op = { kind: 'update', patch }), b),
    upsert: (row: Row) => {
      const ex = tables[table].find((r) => r.id === row.id);
      const owner = table === 'journals' ? { owner_id: ME.id, owner_email: ME.email } : {};
      if (ex) Object.assign(ex, structuredClone(row), { synced_at: stamp() });
      else tables[table].push({ ...owner, ...structuredClone(row), synced_at: stamp() });
      return Promise.resolve({ data: null, error: null });
    },
    then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
  };
  return b;
}
const sb: any = {
  from: query,
  storage: {
    from: () => ({
      upload: async (p: string, blob: Blob) => (files.set(p, blob), { error: null }),
      download: async (p: string) => (files.has(p) ? { data: files.get(p), error: null } : { data: null, error: { message: 'nf' } }),
      remove: async (ps: string[]) => (ps.forEach((p) => files.delete(p)), { error: null }),
    }),
  },
};

const { db } = await import('../src/db');
const sync = await import('../src/cloud/sync');
const settle = () => new Promise((r) => setTimeout(r, 50));
sync.trackChanges();

// Device A has a journal before signing in.
await db.journals.put({ id: 'jA', name: 'Journal', createdAt: 1, updatedAt: 1 });
await db.entries.put({ id: 'e1', journalId: 'jA', date: 100, title: 'Hello', body: 'b', bookmarked: false, mediaIds: ['m1'], createdAt: 1, updatedAt: 1 });
await db.media.put({ id: 'm1', entryId: 'e1', kind: 'photo', blob: new Blob(['img'], { type: 'image/jpeg' }) });
await settle();
assert.equal(await sync.pendingCount(), 3, 'local writes are queued');

await sync.linkDevice(sb, ME);
await sync.push(sb, ME.id);
assert.equal(await sync.pendingCount(), 0);
assert.equal(tables.journals.length, 1);
assert.equal(tables.entries[0].journal_id, 'jA');
assert.equal(tables.media[0].path, 'e1/m1');
assert.ok(files.has('e1/m1'));

// Pulling our own changes back must not queue anything or re-download.
await sync.pull(sb, ME);
await settle();
assert.equal(await sync.pendingCount(), 0, 'pull does not echo');

// Edit locally → queued → pushed.
await db.entries.update('e1', { title: 'Hello!', updatedAt: 5 });
await settle();
assert.equal(await sync.pendingCount(), 1);
await sync.push(sb, ME.id);
assert.equal(tables.entries[0].data.title, 'Hello!');

// Another device edits e1 and adds e2; we pull.
Object.assign(tables.entries[0], { data: { ...tables.entries[0].data, title: 'From phone' }, updated_at: 10, synced_at: stamp() });
tables.entries.push({ id: 'e2', journal_id: 'jA', data: { id: 'e2', journalId: 'jA', date: 200, title: 'Phone entry', body: '', bookmarked: false, mediaIds: [], createdAt: 9, updatedAt: 9 }, updated_at: 9, deleted: false, synced_at: stamp() });
await sync.pull(sb, ME);
await settle();
assert.equal((await db.entries.get('e1'))!.title, 'From phone');
assert.equal(await db.entries.count(), 2);
assert.equal(await sync.pendingCount(), 0);

// Delete locally → tombstone on server, file removed.
await db.transaction('rw', db.entries, db.media, async () => {
  await db.media.where('entryId').equals('e1').delete();
  await db.entries.delete('e1');
});
await settle();
await sync.push(sb, ME.id);
assert.equal(tables.entries.find((r) => r.id === 'e1')!.deleted, true);
assert.equal(files.has('e1/m1'), false);

// Remote delete of e2 reaches us.
Object.assign(tables.entries.find((r) => r.id === 'e2')!, { deleted: true, data: {}, updated_at: 20, synced_at: stamp() });
await sync.pull(sb, ME);
assert.equal(await db.entries.count(), 0);

// A fresh device: same Apple export imported locally (different ids), then sign in → no duplicates.
tables.entries.push({ id: 'e3', journal_id: 'jA', data: { id: 'e3', journalId: 'jA', date: 300, title: 'Trip', body: '', bookmarked: false, mediaIds: ['m3'], createdAt: 1, updatedAt: 1 }, updated_at: 1, deleted: false, synced_at: stamp() });
tables.media.push({ id: 'm3', entry_id: 'e3', data: { id: 'm3', entryId: 'e3', kind: 'photo', type: 'image/jpeg' }, path: 'e3/m3', updated_at: 1, deleted: false, synced_at: stamp() });
files.set('e3/m3', new Blob(['trip'], { type: 'image/jpeg' }));
await sync.withoutSync(async () => {
  await Promise.all([db.journals.clear(), db.entries.clear(), db.media.clear()]);
});
await sync.resetSync();
await db.journals.put({ id: 'jB', name: 'journal', createdAt: 1, updatedAt: 1 });
await db.entries.put({ id: 'x3', journalId: 'jB', date: 300, title: 'Trip', body: '', bookmarked: false, mediaIds: [], createdAt: 1, updatedAt: 1 });
await db.entries.put({ id: 'x4', journalId: 'jB', date: 400, title: 'Only here', body: '', bookmarked: false, mediaIds: [], createdAt: 1, updatedAt: 1 });
await settle();
await sync.linkDevice(sb, ME);
await sync.push(sb, ME.id);
const ids = (await db.entries.toArray()).map((e) => `${e.id}:${e.journalId}`).sort();
assert.deepEqual(ids, ['e3:jA', 'x4:jA'], 'duplicate dropped, journals merged');
assert.equal(await db.journals.count(), 1);
assert.equal(await (await db.media.get('m3'))!.blob.text(), 'trip');
assert.equal(tables.entries.find((r) => r.id === 'x4')!.journal_id, 'jA');
assert.equal(tables.journals.length, 1);

// Erasing the device does not delete anything in the account.
await sync.withoutSync(async () => {
  await db.entries.clear();
});
await settle();
assert.equal(await sync.pendingCount(), 0);
console.log('sync test passed');
