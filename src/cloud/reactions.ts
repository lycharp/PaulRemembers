/**
 * Emoji reactions on entries in shared journals. They live online only (table
 * 'reactions'); this device keeps a copy (setting 'reactions'), refreshed on
 * every sync and when an entry is opened, so counts show offline too.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { useLiveQuery } from 'dexie-react-hooks';
import { getSetting, setSetting } from '../db';
import { cloudUser, supabase, syncSoon } from './cloud';

/** The fixed set, in the order they're offered. */
export const REACTIONS = ['❤️', '😂', '😮', '😢', '👍', '👎'] as const;
export type Reaction = (typeof REACTIONS)[number];

/** Heading of the "who reacted" box. */
export const REACTION_LABEL: Record<Reaction, string> = {
  '❤️': 'Loved by',
  '😂': 'Made laugh',
  '😮': 'Surprised',
  '😢': 'Felt sad',
  '👍': 'Liked by',
  '👎': 'Not a fan',
};

/** One person's reaction. */
export interface ReactionRow { user: string; emoji: Reaction; at: string }
/** Reactions per entry id, oldest first. */
export type ReactionMap = Record<string, ReactionRow[]>;

const KEY = 'reactions';
const NOT_READY = /schema cache|does not exist|could not find/i;

interface Row { entry_id: string; user_id: string; emoji: string; created_at: string }

const isReaction = (e: string): e is Reaction => (REACTIONS as readonly string[]).includes(e);

function group(rows: Row[], into: ReactionMap = {}) {
  for (const r of rows) if (isReaction(r.emoji)) (into[r.entry_id] ??= []).push({ user: r.user_id, emoji: r.emoji, at: r.created_at });
  return into;
}

/** Fetch every reaction you can see. Quietly does nothing if the online database isn't updated yet. */
export async function refreshReactions(sb: SupabaseClient = supabase()) {
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('reactions').select('entry_id, user_id, emoji, created_at').order('created_at').range(from, from + 999);
    if (error) return;
    rows.push(...((data ?? []) as Row[]));
    if (!data || data.length < 1000) break;
  }
  await setSetting(KEY, group(rows));
}

/** Fetch one entry's reactions again (when it's opened). */
export async function refreshEntryReactions(entryId: string) {
  if (!cloudUser() || !navigator.onLine) return;
  const { data, error } = await supabase().from('reactions').select('entry_id, user_id, emoji, created_at').eq('entry_id', entryId).order('created_at');
  if (error) return;
  const map = { ...((await getSetting<ReactionMap>(KEY)) ?? {}) };
  delete map[entryId];
  await setSetting(KEY, group((data ?? []) as Row[], map));
}

async function update(entryId: string, fn: (list: ReactionRow[]) => ReactionRow[]) {
  const map = { ...((await getSetting<ReactionMap>(KEY)) ?? {}) };
  const list = fn(map[entryId] ?? []);
  if (list.length) map[entryId] = list;
  else delete map[entryId];
  await setSetting(KEY, map);
}

/** Add your reaction, or take it off if it's already there. Shows at once; undone if the server says no. */
export async function toggleReaction(entryId: string, emoji: Reaction) {
  const user = cloudUser();
  if (!user) throw new Error('Sign in to react.');
  if (!navigator.onLine) throw new Error("You're offline. Try again when you're connected.");
  const mine = ((await getSetting<ReactionMap>(KEY)) ?? {})[entryId]?.find((r) => r.user === user.id && r.emoji === emoji);
  const sb = supabase();
  if (mine) {
    await update(entryId, (l) => l.filter((r) => r !== mine && !(r.user === user.id && r.emoji === emoji)));
    const { error } = await sb.from('reactions').delete().match({ entry_id: entryId, user_id: user.id, emoji });
    if (error) {
      await update(entryId, (l) => [...l, mine]);
      throw friendly(error);
    }
  } else {
    const row: ReactionRow = { user: user.id, emoji, at: new Date().toISOString() };
    await update(entryId, (l) => [...l, row]);
    const { error } = await sb.from('reactions').upsert({ entry_id: entryId, user_id: user.id, emoji }, { ignoreDuplicates: true });
    if (error) {
      await update(entryId, (l) => l.filter((r) => r !== row && !(r.user === user.id && r.emoji === emoji && r.at === row.at)));
      throw friendly(error);
    }
  }
  // The entry might be new to the server; the next sync brings everyone's latest.
  syncSoon();
}

function friendly(e: { message?: string }) {
  if (NOT_READY.test(e.message ?? '')) return new Error('Reactions need the latest online database update (run the latest supabase/setup.sql in the Supabase SQL Editor).');
  if (/row-level security/i.test(e.message ?? '')) return new Error("Couldn't save your reaction. If this entry is brand new, wait a moment for it to sync and try again.");
  return new Error(e.message ?? 'Could not save your reaction.');
}

/** All reactions on this device. */
export function useReactions(): ReactionMap {
  return useLiveQuery(() => getSetting<ReactionMap>(KEY), []) ?? {};
}

/** One entry's reactions, grouped by emoji in the fixed order, with who chose each (oldest first). */
export function summarize(list: ReactionRow[] | undefined, me?: string) {
  return REACTIONS.map((emoji) => {
    const people = (list ?? []).filter((r) => r.emoji === emoji).map((r) => r.user);
    return { emoji, people, mine: !!me && people.includes(me) };
  }).filter((g) => g.people.length > 0);
}
