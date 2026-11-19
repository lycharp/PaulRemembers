/**
 * People in shared journals: each person's name and icon, and which journals
 * are shared with more than one person. Kept on this device (setting 'people')
 * and refreshed on every sync, so icons show offline too.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { useLiveQuery } from 'dexie-react-hooks';
import { getSetting, JOURNAL_COLORS, setSetting, type Journal } from '../db';
import { cloudUser, supabase } from './cloud';

export interface Person {
  id: string;
  email?: string;
  name?: string;
  /** An emoji, or 'color:#rrggbb' for a coloured circle with their initial. */
  icon?: string;
}

interface PeopleCache {
  people: Person[];
  /** Your journals that you share with someone. */
  shared: string[];
  /** Who each of those journals is shared with (emails, in the order they were added). */
  members?: Record<string, string[]>;
}

const KEY = 'people';

/** Fetch everyone you share journals with. Quietly does nothing if the online database isn't updated yet. */
export async function refreshPeople(sb: SupabaseClient = supabase()) {
  const [{ data, error }, members] = await Promise.all([
    sb.rpc('list_people'),
    sb.from('journal_members').select('journal_id, email').order('added_at'),
  ]);
  if (error) return;
  const people: Person[] = ((data ?? []) as { user_id: string; email: string | null; name: string | null; icon: string | null }[]).map((r) => ({
    id: r.user_id,
    email: r.email ?? undefined,
    name: r.name?.trim() || undefined,
    icon: r.icon || undefined,
  }));
  const rows = (members.data ?? []) as { journal_id: string; email: string }[];
  const byJournal: Record<string, string[]> = {};
  for (const r of rows) (byJournal[r.journal_id] ??= []).push(r.email.toLowerCase());
  await setSetting(KEY, { people, shared: Object.keys(byJournal), members: byJournal } satisfies PeopleCache);
}

export async function saveProfile(name: string, icon: string) {
  const user = cloudUser();
  if (!user) throw new Error('Sign in first.');
  const { error } = await supabase().from('profiles').upsert({ user_id: user.id, name: name.trim() || null, icon, updated_at: new Date().toISOString() });
  if (error) {
    if (/schema cache|does not exist|could not find/i.test(error.message)) throw new Error('The online database needs the Version 3 update first (run the latest supabase/setup.sql in the Supabase SQL Editor).');
    throw error;
  }
  await refreshPeople();
}

export interface People {
  byId: Map<string, Person>;
  byEmail: Map<string, Person>;
  /** Shared with more than one person, so who wrote what is shown. */
  isShared: (j?: Journal) => boolean;
  /** One of your own journals that you have shared with someone. */
  sharedByMe: (j?: Journal) => boolean;
  /** Who you have shared one of your journals with (people without an account yet show by email). */
  sharedWith: (j?: Journal) => Person[];
}

export function usePeople(): People {
  const cache = useLiveQuery(() => getSetting<PeopleCache>(KEY), []);
  const people = cache?.people ?? [];
  const shared = new Set(cache?.shared ?? []);
  const byEmail = new Map(people.filter((p) => p.email).map((p) => [p.email!.toLowerCase(), p]));
  const mine = (j?: Journal): j is Journal => !!j && (!j.role || j.role === 'owner');
  return {
    byId: new Map(people.map((p) => [p.id, p])),
    byEmail,
    isShared: (j) => !!j && (j.role === 'editor' || j.role === 'viewer' || shared.has(j.id)),
    sharedByMe: (j) => mine(j) && shared.has(j.id),
    sharedWith: (j) => (mine(j) ? cache?.members?.[j.id] ?? [] : []).map((email) => byEmail.get(email) ?? { id: email, email }),
  };
}

/** What to call someone: their chosen name, else the start of their email. */
export const nameOf = (p?: Person) => p?.name || p?.email?.split('@')[0] || 'Someone';

/** Someone who hasn't picked an icon gets a coloured circle that stays the same for them. */
export function defaultIcon(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `color:${JOURNAL_COLORS[h % JOURNAL_COLORS.length]}`;
}
