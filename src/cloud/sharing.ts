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
    if (/row-level security/i.test(error.message)) throw new Error(NOT_INVITED);
    throw error;
  }
}

/** Supabase refuses to share with someone who has no account and no invite (only the admin can invite). */
export const NOT_INVITED = "This person doesn't have an account yet, and Paul Remembers is invite-only. Ask Paul to invite them first, then share again.";

export async function removeMember(journalId: string, email: string) {
  const { error } = await supabase().from('journal_members').delete().eq('journal_id', journalId).eq('email', email);
  if (error) throw error;
}

const chunks = <T,>(a: T[], n = 100) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

/** Who each of these journals is shared with (for a backup). */
export async function membersOf(journalIds: string[]): Promise<Record<string, Member[]>> {
  const out: Record<string, Member[]> = {};
  for (const ids of chunks(journalIds)) {
    const { data, error } = await supabase().from('journal_members').select('journal_id, email, role').in('journal_id', ids).order('added_at');
    if (error) throw error;
    for (const r of data ?? []) (out[r.journal_id as string] ??= []).push({ email: r.email as string, role: r.role as Member['role'] });
  }
  return out;
}

/**
 * Stop sharing these journals: nobody keeps access, and private links to
 * their entries stop working. Used by "Delete for good", so a journal that is
 * later restored from a backup starts out private.
 */
export async function clearShares(journalIds: string[], entryIds: string[]) {
  const sb = supabase();
  for (const ids of chunks(journalIds)) {
    const { error } = await sb.from('journal_members').delete().in('journal_id', ids);
    if (error) throw error;
  }
  for (const ids of chunks(entryIds)) {
    const { error } = await sb.from('entry_shares').delete().in('entry_id', ids);
    if (error) throw error;
  }
}

/**
 * Share a journal with exactly these people (anyone else loses access).
 * Returns how many it could share with: people without an account or an
 * invite are skipped, since the app is invite-only.
 */
export async function setMembers(journalId: string, members: Member[]): Promise<number> {
  const sb = supabase();
  const { error } = await sb.from('journal_members').delete().eq('journal_id', journalId);
  if (error) throw error;
  if (!members.length) return 0;
  const rows = members.map((m) => ({ journal_id: journalId, email: m.email.trim().toLowerCase(), role: m.role }));
  const { error: e2 } = await sb.from('journal_members').upsert(rows);
  if (!e2) return rows.length;
  if (!/row-level security/i.test(e2.message)) throw e2;
  // Someone on the list can't be shared with: add the others one by one.
  let added = 0;
  for (const row of rows) {
    const { error: e3 } = await sb.from('journal_members').upsert(row);
    if (!e3) added++;
    else if (!/row-level security/i.test(e3.message)) throw e3;
  }
  return added;
}

// ─── Invite-only sign-up (only the admin, Paul, can invite) ───────────────

/** Is the signed-in person the admin? False if the invite rules aren't set up yet. */
export async function isAdmin(): Promise<boolean> {
  const { data, error } = await supabase().rpc('is_admin');
  return !error && data === true;
}

export interface Invite {
  email: string;
  added_at: string;
  joined: boolean; // has created an account
}

export async function listInvites(): Promise<Invite[]> {
  const { data, error } = await supabase().rpc('list_invites');
  if (error) throw error;
  return (data ?? []) as Invite[];
}

export async function addInvite(email: string) {
  const { error } = await supabase().from('invites').upsert({ email: email.trim().toLowerCase() }, { ignoreDuplicates: true });
  if (error) throw error;
}

export async function removeInvite(email: string) {
  const { error } = await supabase().from('invites').delete().eq('email', email);
  if (error) throw error;
}
