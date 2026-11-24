/**
 * Comments on entries in shared journals. Like reactions, they live online
 * only (table 'comments'); this device keeps a copy (setting 'comments'),
 * refreshed on every sync and when an entry is opened, so they show offline too.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { useLiveQuery } from 'dexie-react-hooks';
import { getSetting, setSetting } from '../db';
import { cloudUser, supabase, syncSoon } from './cloud';

/** The longest comment the online database takes. */
export const COMMENT_MAX = 2000;

/** One comment. `at` and `edited` are ISO times. */
export interface CommentRow { id: string; user: string; body: string; at: string; edited?: string }
/** Comments per entry id, oldest first. */
export type CommentMap = Record<string, CommentRow[]>;

const KEY = 'comments';
const COLS = 'id, entry_id, user_id, body, created_at, edited_at';
const NOT_READY = /schema cache|does not exist|could not find/i;

interface Row { id: string; entry_id: string; user_id: string; body: string; created_at: string; edited_at: string | null }

function group(rows: Row[], into: CommentMap = {}) {
  for (const r of rows) (into[r.entry_id] ??= []).push({ id: r.id, user: r.user_id, body: r.body, at: r.created_at, edited: r.edited_at ?? undefined });
  return into;
}

/** Fetch every comment you can see. Quietly does nothing if the online database isn't updated yet. */
export async function refreshComments(sb: SupabaseClient = supabase()) {
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('comments').select(COLS).order('created_at').order('id').range(from, from + 999);
    if (error) return;
    rows.push(...((data ?? []) as Row[]));
    if (!data || data.length < 1000) break;
  }
  await setSetting(KEY, group(rows));
}

/** Fetch one entry's comments again (when it's opened). */
export async function refreshEntryComments(entryId: string) {
  if (!cloudUser() || !navigator.onLine) return;
  const { data, error } = await supabase().from('comments').select(COLS).eq('entry_id', entryId).order('created_at').order('id');
  if (error) return;
  const map = { ...((await getSetting<CommentMap>(KEY)) ?? {}) };
  delete map[entryId];
  await setSetting(KEY, group((data ?? []) as Row[], map));
}

async function update(entryId: string, fn: (list: CommentRow[]) => CommentRow[]) {
  const map = { ...((await getSetting<CommentMap>(KEY)) ?? {}) };
  const list = fn(map[entryId] ?? []);
  if (list.length) map[entryId] = list;
  else delete map[entryId];
  await setSetting(KEY, map);
}

function ready(body: string) {
  const user = cloudUser();
  if (!user) throw new Error('Sign in to comment.');
  if (!navigator.onLine) throw new Error("You're offline. Try again when you're connected.");
  const text = body.trim();
  if (!text) throw new Error('Write something first.');
  if (text.length > COMMENT_MAX) throw new Error(`Comments can be up to ${COMMENT_MAX} characters.`);
  return { user, text };
}

/** Post a comment. Shows at once; taken back off if the server says no. */
export async function addComment(entryId: string, body: string) {
  const { user, text } = ready(body);
  const row: CommentRow = { id: crypto.randomUUID(), user: user.id, body: text, at: new Date().toISOString() };
  await update(entryId, (l) => [...l, row]);
  const { error } = await supabase().from('comments').insert({ id: row.id, entry_id: entryId, user_id: user.id, body: text });
  if (error) {
    await update(entryId, (l) => l.filter((c) => c.id !== row.id));
    throw friendly(error);
  }
  syncSoon();
}

/** Change the words of one of your comments. */
export async function editComment(entryId: string, id: string, body: string) {
  const { text } = ready(body);
  const old = ((await getSetting<CommentMap>(KEY)) ?? {})[entryId]?.find((c) => c.id === id);
  if (!old || old.body === text) return;
  await update(entryId, (l) => l.map((c) => (c.id === id ? { ...c, body: text, edited: new Date().toISOString() } : c)));
  const { data, error } = await supabase().from('comments').update({ body: text }).eq('id', id).select('edited_at');
  if (error || !data?.length) {
    await update(entryId, (l) => l.map((c) => (c.id === id ? old : c)));
    throw error ? friendly(error) : new Error("Couldn't change that comment. It may have been deleted.");
  }
}

/** Delete a comment (your own, or anyone's in a journal you own). */
export async function deleteComment(entryId: string, id: string) {
  if (!cloudUser()) throw new Error('Sign in to delete comments.');
  if (!navigator.onLine) throw new Error("You're offline. Try again when you're connected.");
  const old = ((await getSetting<CommentMap>(KEY)) ?? {})[entryId] ?? [];
  await update(entryId, (l) => l.filter((c) => c.id !== id));
  const { data, error } = await supabase().from('comments').delete().eq('id', id).select('id');
  if (error || !data?.length) {
    await update(entryId, () => old);
    throw error ? friendly(error) : new Error("Couldn't delete that comment.");
  }
}

function friendly(e: { message?: string }) {
  if (NOT_READY.test(e.message ?? '')) return new Error('Comments need the latest online database update (run the latest supabase/setup.sql in the Supabase SQL Editor).');
  if (/row-level security/i.test(e.message ?? '')) return new Error("Couldn't save your comment. If this entry is brand new, wait a moment for it to sync and try again.");
  return new Error(e.message ?? 'Could not save your comment.');
}

/** All comments on this device. */
export function useComments(): CommentMap {
  return useLiveQuery(() => getSetting<CommentMap>(KEY), []) ?? {};
}
