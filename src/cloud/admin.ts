/**
 * The Admin page (admins only) and invite requests. Supabase checks that the
 * signed-in person is an admin for every admin call; everything here is counts,
 * dates, names and email addresses, never what anyone wrote.
 */
import { useEffect, useState } from 'react';
import { supabase, useCloud } from './cloud';
import { isAdmin } from './sharing';
import type { Member } from './sharing';

async function call<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase().rpc(fn, args);
  if (error) {
    if (/schema cache|does not exist|could not find/i.test(error.message)) throw new Error(NEEDS_UPDATE);
    throw error;
  }
  return data as T;
}

export const NEEDS_UPDATE = 'The online database needs the Admin update first (run the latest supabase/setup.sql in the Supabase SQL Editor).';

// ─── Invite requests ───────────────────────────────────────────────────────

export interface InviteRequest {
  journal_id: string;
  email: string;
  role: Member['role'];
  status: 'waiting' | 'declined';
  created_at: string;
}
export interface AdminRequest extends InviteRequest {
  journal_name: string | null;
  journal_color: string | null;
  requested_by: string;
}

/** Ask an admin to invite this person and share the journal with them. */
export const requestInvite = (journalId: string, email: string, role: Member['role']) =>
  call<void>('request_invite', { j: journalId, e: email.trim().toLowerCase(), r: role }).then(() => notifyChange());

/** Your own requests for one journal (waiting or declined). */
export async function myRequests(journalId: string): Promise<InviteRequest[]> {
  const { data, error } = await supabase().from('invite_requests').select('journal_id, email, role, status, created_at').eq('journal_id', journalId).order('created_at');
  if (error) return []; // not set up yet
  return (data ?? []) as InviteRequest[];
}

/** Cancel a waiting request, or clear a declined one. */
export async function removeRequest(journalId: string, email: string) {
  const { error } = await supabase().from('invite_requests').delete().eq('journal_id', journalId).eq('email', email);
  if (error) throw error;
  notifyChange();
}

export const adminRequests = () => call<AdminRequest[]>('admin_requests').then((r) => r ?? []);
export const approveRequest = (j: string, e: string) => call<void>('approve_request', { j, e }).then(() => notifyChange());
export const declineRequest = (j: string, e: string) => call<void>('decline_request', { j, e }).then(() => notifyChange());

// ─── People, sharing and usage ─────────────────────────────────────────────

export interface AdminPerson {
  user_id: string | null; // null: invited, no account yet
  email: string;
  name: string | null;
  icon: string | null;
  joined_at: string | null;
  last_active: string | null;
  admin: boolean;
  blocked: boolean;
  invited_at: string | null;
}
export interface AdminShare {
  journal_id: string;
  journal_name: string | null;
  journal_color: string | null;
  owner_id: string;
  email: string;
  role: Member['role'];
}
export interface AdminUsage {
  journal_id: string;
  journal_name: string | null;
  journal_color: string | null;
  owner_id: string;
  entries: number;
  photos: number;
  videos: number;
  voice: number;
  bytes: number;
  last_updated: string | null;
}
export interface AdminTotals {
  people: number;
  journals: number;
  entries: number;
  entries_this_week: number;
  file_bytes: number;
  db_bytes: number;
}

export const adminPeople = () => call<AdminPerson[]>('admin_people').then((r) => r ?? []);
export const adminShares = () => call<AdminShare[]>('admin_shares').then((r) => r ?? []);
export const adminUsage = () => call<AdminUsage[]>('admin_usage').then((r) => (r ?? []).map((u) => ({ ...u, entries: +u.entries, photos: +u.photos, videos: +u.videos, voice: +u.voice, bytes: +u.bytes })));
export const adminTotals = () => call<AdminTotals[]>('admin_totals').then((r) => {
  const t = r?.[0];
  return t && { people: +t.people, journals: +t.journals, entries: +t.entries, entries_this_week: +t.entries_this_week, file_bytes: +t.file_bytes, db_bytes: +t.db_bytes };
});
export const setAdmin = (uid: string, make: boolean) => call<void>('admin_set_admin', { uid, make });
export const setBlocked = (uid: string, block: boolean) => call<void>('admin_set_blocked', { uid, block });
export const adminRemoveMember = (j: string, e: string) => call<void>('admin_remove_member', { j, e });

// ─── Is this an admin, and how many requests are waiting? ─────────────────

const listeners = new Set<() => void>();
function notifyChange() {
  for (const l of listeners) l();
}

export interface AdminState {
  admin: boolean;
  waiting: number;
}

/** Checked when signing in, when the app comes back to the front, and after any request changes. */
export function useAdmin(): AdminState {
  const { user } = useCloud();
  const [state, setState] = useState<AdminState>({ admin: false, waiting: 0 });
  useEffect(() => {
    if (!user) {
      setState({ admin: false, waiting: 0 });
      return;
    }
    let alive = true;
    const check = async () => {
      const admin = await isAdmin();
      let waiting = 0;
      if (admin) waiting = (await adminRequests().catch(() => [])).filter((r) => r.status === 'waiting').length;
      if (alive) setState({ admin, waiting });
    };
    void check();
    const onShow = () => document.visibilityState === 'visible' && void check();
    document.addEventListener('visibilitychange', onShow);
    listeners.add(check);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onShow);
      listeners.delete(check);
    };
  }, [user?.id]);
  return state;
}

/** Tell every useAdmin() to check again (after approving, blocking, etc.). */
export const refreshAdmin = notifyChange;
