/**
 * Sign-in state and the sync loop. Components read it with useCloud().
 */
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { useSyncExternalStore } from 'react';
import { db, getSetting, setSetting } from '../db';
import { cloudConfigured, SUPABASE_KEY, SUPABASE_URL } from './config';
import { getState, linkDevice, pendingCount, pull, push, resetSync, sdb, setOnQueued, setState, trackChanges, withoutSync } from './sync';

const LINK_VERSION = 2;

export interface CloudState {
  configured: boolean;
  ready: boolean;
  user: { id: string; email?: string } | null;
  syncing: boolean;
  pending: number;
  lastSync?: number;
  error?: string;
  /** Set after following a "reset password" email link. */
  recovering: boolean;
  /** Another account's journal is on this device; ask before replacing it. */
  otherAccount: boolean;
}

let state: CloudState = { configured: cloudConfigured, ready: !cloudConfigured, user: null, syncing: false, pending: 0, recovering: false, otherAccount: false };
const listeners = new Set<() => void>();
const set = (patch: Partial<CloudState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};
export const useCloud = () =>
  useSyncExternalStore((cb) => (listeners.add(cb), () => listeners.delete(cb)), () => state);

/** The signed-in person, if any (for code outside React). */
export const cloudUser = () => state.user;

let client: SupabaseClient | null = null;
export function supabase(): SupabaseClient {
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }
  return client;
}

/** Where sign-in emails and Google send people back to (this page, without the #route). */
export const appUrl = () => location.origin + location.pathname;

// ─── Sync loop ──────────────────────────────────────────────────────────────

let running: Promise<void> | null = null;
let again = false;
let timer: ReturnType<typeof setTimeout> | undefined;

export function syncSoon(delay = 3000) {
  clearTimeout(timer);
  timer = setTimeout(() => void syncNow(), delay);
}

export async function syncNow(): Promise<void> {
  const user = state.user;
  if (!user || state.otherAccount || !navigator.onLine) return;
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    set({ syncing: true, error: undefined });
    try {
      const sb = supabase();
      // LINK_VERSION 2: an earlier server rule refused first uploads, and those
      // changes were dropped; linking again re-queues everything not yet online.
      if ((await getState<string>('userId')) !== user.id || (await getState<number>('linkVersion')) !== LINK_VERSION) {
        await resetSync();
        await linkDevice(sb, user);
        await setState('linkVersion', LINK_VERSION);
      }
      set({ pending: await pendingCount() });
      const { refused, unreadable, tooBig } = await push(sb, user.id, (left) => set({ pending: left }));
      await pull(sb, user);
      set({ lastSync: Date.now(), pending: await pendingCount() });
      if (refused.length) throw new Error(`the server refused ${refused.length} changes (${refused[0]})`);
      if (tooBig.length)
        throw new Error(`a video in "${tooBig[0]}"${tooBig.length > 1 ? ` (and ${tooBig.length - 1} more)` : ''} is bigger than 50 MB (the most the free online storage takes) and this browser couldn't make it smaller, so it stays on this device only. Everything else synced. Opening the app on your iPhone may fix it`);
      if (unreadable.length)
        throw new Error(`a photo or video in "${unreadable[0]}"${unreadable.length > 1 ? ` (and ${unreadable.length - 1} more)` : ''} can't be read on this device, so it was not uploaded. Open the entry, remove it, and add it again`);
    } catch (e) {
      console.error('Sync failed', e);
      const msg = e instanceof Error ? e.message : (e as { message?: string })?.message ?? String(e);
      const error = /schema cache|does not exist|bucket not found/i.test(msg)
        ? 'the online database is not set up yet (run supabase/setup.sql in the Supabase SQL Editor)'
        : /row-level security/i.test(msg)
          ? 'the online database needs an update (run the latest supabase/setup.sql in the Supabase SQL Editor)'
          : msg;
      set({ error, pending: await pendingCount() });
    } finally {
      running = null;
      set({ syncing: false });
      if (again) {
        again = false;
        syncSoon(500);
      }
    }
  })();
  return running;
}

async function onSession(session: Session | null) {
  const user = session?.user ? { id: session.user.id, email: session.user.email } : null;
  if (user?.id === state.user?.id) return;
  let otherAccount = false;
  if (user) {
    const linked = await getState<string>('userId');
    otherAccount = !!linked && linked !== user.id && (await db.entries.count()) > 0;
    // On a new computer, open the journal this account was last in.
    const last = session?.user.user_metadata?.lastJournal;
    if (typeof last === 'string' && !otherAccount && !(await getSetting('currentJournal'))) await setSetting('currentJournal', last);
  }
  set({ user, otherAccount, ready: true, pending: await pendingCount() });
  if (user && !otherAccount) void syncNow();
}

// ─── Keep me signed in ──────────────────────────────────────────────────────

const KEEP_KEY = 'pr.keepSignedIn';
const ALIVE_KEY = 'pr.sessionAlive';
const tryStore = (fn: () => void) => {
  try {
    fn();
  } catch {
    /* storage blocked: fall back to staying signed in */
  }
};
const isAuthTokenKey = (k: string) => /^sb-.+-auth-token$/.test(k);

/** Whether "Keep me signed in" is on (the default). */
export function keepSignedIn(): boolean {
  try {
    return localStorage.getItem(KEEP_KEY) !== '0';
  } catch {
    return true;
  }
}

/** Called just before signing in: remember the choice for this app window. */
export function setKeepSignedIn(keep: boolean) {
  tryStore(() => localStorage.setItem(KEEP_KEY, keep ? '1' : '0'));
  tryStore(() => sessionStorage.setItem(ALIVE_KEY, '1'));
}

/** A sign-in is saved on this device (it may still be checking with the server). */
export function hasSavedSignIn(): boolean {
  try {
    return Object.keys(localStorage).some(isAuthTokenKey);
  } catch {
    return false;
  }
}

/**
 * Without "Keep me signed in", a sign-in lasts until the app window is closed:
 * sessionStorage survives reloads but not closing, so a fresh start forgets it.
 */
function forgetSignInIfSessionEnded() {
  tryStore(() => {
    if (keepSignedIn() || sessionStorage.getItem(ALIVE_KEY)) return;
    Object.keys(localStorage).filter(isAuthTokenKey).forEach((k) => localStorage.removeItem(k));
  });
}

/** Remember the open journal on the account, so other computers open it too. */
export function rememberJournalOnline(journal: string) {
  if (!state.user) return;
  supabase().auth.updateUser({ data: { lastJournal: journal } }).catch(() => {});
}

export function startCloud() {
  if (!cloudConfigured) return;
  forgetSignInIfSessionEnded();
  trackChanges();
  setOnQueued(() => {
    pendingCount().then((pending) => set({ pending }));
    syncSoon();
  });
  const sb = supabase();
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') {
      set({ recovering: true });
      location.hash = '/account';
    }
    // Do not await Supabase calls inside this callback (it holds an auth lock).
    setTimeout(() => void onSession(session), 0);
  });
  sb.auth.getSession().then(({ data }) => onSession(data.session));
  // Never leave the sign-in screen blank if the server is slow to answer.
  setTimeout(() => !state.ready && set({ ready: true }), 4000);
  // Supabase sends people back with ?code=… or ?error=…; show the error once, then tidy the address.
  const params = new URLSearchParams(location.search);
  const err = params.get('error_description');
  if (err) set({ error: /database error saving new user|invite-only/i.test(err) ? NOT_INVITED_SIGNUP : err });
  if (params.has('code') || err) setTimeout(() => history.replaceState(null, '', appUrl() + location.hash), 1500);

  window.addEventListener('online', () => syncSoon(500));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncSoon(500);
  });
  setInterval(() => document.visibilityState === 'visible' && syncSoon(0), 5 * 60 * 1000);
}

/** Supabase refused a new account: the email isn't on Paul's invite list. */
export const NOT_INVITED_SIGNUP = "Sorry, Paul Remembers is invite-only, and that email address hasn't been invited. Ask Paul to invite you, then try again. If you already have an account, sign in with the email you used before.";

// ─── Account actions ────────────────────────────────────────────────────────

export async function signOut(keepLocal: boolean) {
  await supabase().auth.signOut();
  if (!keepLocal) await eraseLocal();
  set({ user: null, otherAccount: false, lastSync: undefined, error: undefined });
}

/** Remove the journal from this device only (the account copy stays). */
export async function eraseLocal() {
  await withoutSync(async () => {
    await Promise.all([db.journals.clear(), db.entries.clear(), db.media.clear()]);
  });
  await resetSync();
}

/**
 * Remove some journals from this device only. Anything already saved to an
 * account stays there and downloads again the next time this device syncs.
 */
export async function eraseJournalsLocal(ids: string[]) {
  const entryIds = await db.entries.where('journalId').anyOf(ids).primaryKeys();
  const mediaIds = await db.media.where('entryId').anyOf(entryIds).primaryKeys();
  await withoutSync(async () => {
    await db.media.bulkDelete(mediaIds);
    await db.entries.bulkDelete(entryIds);
    await db.journals.bulkDelete(ids);
  });
  const keys = [...ids.map((id) => `journal:${id}`), ...entryIds.map((id) => `entry:${id}`), ...mediaIds.map((id) => `media:${id}`)];
  await sdb.transaction('rw', sdb.outbox, sdb.known, async () => {
    await sdb.outbox.bulkDelete(keys);
    await sdb.known.bulkDelete(keys);
  });
  // Fetch everything again on the next sync, so the account's copy comes back.
  await setState('cursor', undefined);
}

/** Replace another account's journal on this device with the signed-in one. */
export async function replaceOtherAccount() {
  await eraseLocal();
  set({ otherAccount: false });
  await syncNow();
}

export const setRecovering = (recovering: boolean) => set({ recovering });
export { sdb };
