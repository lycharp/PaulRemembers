import type { Entry, MediaKind } from '../db';
import { appUrl, supabase, syncNow } from './cloud';
import { sdb, type Role } from './sync';

// ─── A private link to one entry ───────────────────────────────────────────

export const shareUrl = (token: string) => `${appUrl()}#/s/${token}`;

export async function getEntryShare(entryId: string): Promise<string | null> {
  const { data, error } = await supabase().from('entry_shares').select('token').eq('entry_id', entryId).limit(1);
  if (error) throw error;
  return data?.[0]?.token ?? null;
}

export async function createEntryShare(entryId: string): Promise<string> {
  // The entry (and its photos) must be online before a link can show it.
  await syncNow();
  const waiting = await sdb.outbox.where('key').equals(`entry:${entryId}`).count();
  if (waiting) throw new Error('This entry has not finished uploading yet. Check your internet connection and try again.');
  const { data, error } = await supabase().from('entry_shares').insert({ entry_id: entryId }).select('token').single();
  if (error) throw error;
  return data.token as string;
}

export async function stopEntryShare(entryId: string) {
  const { error } = await supabase().from('entry_shares').delete().eq('entry_id', entryId);
  if (error) throw error;
}

export interface SharedMedia {
  id: string;
  kind: MediaKind;
  caption?: string;
  url: string;
}

/** For the public link page: works without signing in. */
export async function loadSharedEntry(token: string): Promise<{ entry: Entry; media: SharedMedia[] } | null> {
  const sb = supabase();
  const { data, error } = await sb.rpc('get_shared_entry', { t: token });
  if (error) throw error;
  if (!data) return null;
  const d = data as { id: string; entry: Entry; media: { id: string; data: { kind: MediaKind; caption?: string }; path: string }[] };
  const order = d.entry.mediaIds ?? [];
  const rows = [...d.media].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const media: SharedMedia[] = [];
  for (const m of rows) {
    const { data: signed } = await sb.storage.from('media').createSignedUrl(m.path, 60 * 60);
    if (signed?.signedUrl) media.push({ id: m.id, kind: m.data.kind, caption: m.data.caption, url: signed.signedUrl });
  }
  return { entry: d.entry, media };
}

// ─── Sharing a journal with people ─────────────────────────────────────────

export interface Member {
  email: string;
  role: Exclude<Role, 'owner'>;
}

export async function listMembers(journalId: string): Promise<Member[]> {
  const { data, error } = await supabase().from('journal_members').select('email, role').eq('journal_id', journalId).order('added_at');
  if (error) throw error;
  return (data ?? []) as Member[];
}

export async function addMember(journalId: string, email: string, role: Member['role']) {
  await syncNow(); // the journal itself must exist online first
  const { error } = await supabase().from('journal_members').upsert({ journal_id: journalId, email: email.trim().toLowerCase(), role });
  if (error) {
    if (/foreign key/i.test(error.message)) throw new Error('This journal has not finished uploading yet. Try again in a moment.');
    throw error;
  }
}

export async function removeMember(journalId: string, email: string) {
  const { error } = await supabase().from('journal_members').delete().eq('journal_id', journalId).eq('email', email);
  if (error) throw error;
}
