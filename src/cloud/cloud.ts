/**
 * Sign-in state and the sync loop. Components read it with useCloud().
 */
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { useSyncExternalStore } from 'react';
import { db } from '../db';
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
      const { refused } = await push(sb, user.id, (left) => set({ pending: left }));
      await pull(sb, user);
      set({ lastSync: Date.now(), pending: await pendingCount() });
      if (refused.length) throw new Error(`the server refused ${refused.length} changes (${refused[0]})`);
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
  }
  set({ user, otherAccount, ready: true, pending: await pendingCount() });
  if (user && !otherAccount) void syncNow();
}

export function startCloud() {
  if (!cloudConfigured) return;
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
  if (err) set({ error: err });
  if (params.has('code') || err) setTimeout(() => history.replaceState(null, '', appUrl() + location.hash), 1500);

  window.addEventListener('online', () => syncSoon(500));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncSoon(500);
  });
  setInterval(() => document.visibilityState === 'visible' && syncSoon(0), 5 * 60 * 1000);
}

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

/** Replace another account's journal on this device with the signed-in one. */
export async function replaceOtherAccount() {
  await eraseLocal();
  set({ otherAccount: false });
  await syncNow();
}

export const setRecovering = (recovering: boolean) => set({ recovering });
export { sdb };
