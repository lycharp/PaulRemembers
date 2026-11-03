import { useEffect, useState } from 'react';
import { SUPABASE_KEY, SUPABASE_URL } from '../cloud/config';
import { appUrl, keepSignedIn, replaceOtherAccount, setKeepSignedIn, setRecovering, signOut, supabase, syncNow, useCloud } from '../cloud/cloud';
import { go } from '../util';

/** #/account: sign in, create an account, reset a password, or see sync status. */
export function Account() {
  const cloud = useCloud();
  if (!cloud.configured) {
    return (
      <div className="settings">
        <h1>Account</h1>
        <p className="muted">Sign-in is not set up for this copy of the journal yet. Everything still works and is saved on this computer.</p>
      </div>
    );
  }
  if (!cloud.ready) return <p className="muted center">Loading…</p>;
  if (cloud.recovering && cloud.user) return <NewPassword />;
  if (!cloud.user) return <SignIn />;
  return (
    <div className="settings">
      <h1>Account</h1>
      <AccountCard />
    </div>
  );
}

export function AccountCard() {
  const cloud = useCloud();
  const [confirmOut, setConfirmOut] = useState(false);
  if (!cloud.configured) return null;
  if (!cloud.user) {
    return (
      <section className="card pad">
        <h3>Account & sync</h3>
        <p className="muted">Sign in to keep your journal safe online, see it on your phone and other computers, and share entries or whole journals.</p>
        <button className="btn primary" onClick={() => go('/account')}>Sign in or create an account</button>
      </section>
    );
  }
  return (
    <section className="card pad">
      <h3>Account & sync</h3>
      <p>Signed in as <strong>{cloud.user.email}</strong></p>
      {cloud.otherAccount ? (
        <div className="notice error">
          <span>This computer has a journal from a different account. Replace it with this account's journal? (The other account's entries stay safe online.)</span>
          <div className="row">
            <button className="btn primary" onClick={() => replaceOtherAccount()}>Replace with this account's journal</button>
            <button className="btn" onClick={() => signOut(true)}>Sign out instead</button>
          </div>
        </div>
      ) : (
        <p className="muted small">
          <SyncStatus />
        </p>
      )}
      <div className="row">
        <button className="btn" onClick={() => syncNow()} disabled={cloud.syncing || cloud.otherAccount}>Sync now</button>
        <button className="btn ghost" onClick={() => setConfirmOut(true)}>Sign out</button>
      </div>
      {confirmOut && (
        <div className="notice">
          <span>Keep a copy of the journal on this computer after signing out?</span>
          <div className="row">
            <button className="btn" onClick={() => signOut(true).then(() => setConfirmOut(false))}>Sign out, keep a copy here</button>
            <button className="btn danger" onClick={() => signOut(false).then(() => setConfirmOut(false))}>Sign out and remove it from this computer</button>
            <button className="btn ghost" onClick={() => setConfirmOut(false)}>Cancel</button>
          </div>
          {cloud.pending > 0 && <span className="small">{cloud.pending} changes have not been uploaded yet. Removing the copy here would lose them.</span>}
        </div>
      )}
    </section>
  );
}

export function SyncStatus() {
  const c = useCloud();
  if (!c.user) return null;
  if (c.syncing) return <>Syncing{c.pending ? ` · ${c.pending} left to upload` : '…'}</>;
  if (c.error) return <span className="error-text">Sync problem: {c.error}. It will try again.</span>;
  if (!navigator.onLine) return <>Offline · changes will upload when you are back online</>;
  if (c.pending) return <>{c.pending} changes waiting to upload</>;
  if (c.lastSync) return <>Up to date · synced {new Date(c.lastSync).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</>;
  return null;
}

/** Whether Google sign-in is switched on in the Supabase project (null while checking). */
function useGoogleEnabled() {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_KEY } })
      .then((r) => r.json())
      .then((s) => setOn(!!s?.external?.google), () => setOn(false));
  }, []);
  return on;
}

/** The sign-in form. On the start screen, onSkip offers "Continue without signing in". */
export function SignIn({ onSkip }: { onSkip?: () => void }) {
  const [mode, setMode] = useState<'in' | 'up' | 'forgot'>('in');
  const [keep, setKeep] = useState(keepSignedIn);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  const cloud = useCloud();
  const googleOn = useGoogleEnabled();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(undefined);
    const auth = supabase().auth;
    if (mode !== 'forgot') setKeepSignedIn(keep);
    try {
      if (mode === 'in') {
        const { error } = await auth.signInWithPassword({ email, password });
        if (error) throw error;
        go('/');
      } else if (mode === 'up') {
        const { data, error } = await auth.signUp({ email, password, options: { emailRedirectTo: appUrl() } });
        if (error) throw error;
        if (data.session) go('/');
        else setMsg({ ok: true, text: `Almost done: we sent an email to ${email}. Click the link in it to confirm your address, then sign in here.` });
      } else {
        const { error } = await auth.resetPasswordForEmail(email, { redirectTo: appUrl() });
        if (error) throw error;
        setMsg({ ok: true, text: `If ${email} has an account, an email with a reset link is on its way.` });
      }
    } catch (err) {
      setMsg({ ok: false, text: friendly(err) });
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    setKeepSignedIn(keep);
    const { error } = await supabase().auth.signInWithOAuth({ provider: 'google', options: { redirectTo: appUrl() } });
    if (error) setMsg({ ok: false, text: friendly(error) });
  };

  return (
    <form className="auth card pad" onSubmit={submit}>
      <img src="./icon.svg" alt="" width={56} />
      <h2>{mode === 'in' ? 'Sign in' : mode === 'up' ? 'Create an account' : 'Reset your password'}</h2>
      {cloud.error && !msg && <div className="notice error">{cloud.error}</div>}
      {mode !== 'forgot' && googleOn && (
        <>
          <button type="button" className="btn google" onClick={google}>
            <GoogleIcon /> Continue with Google
          </button>
          <div className="or"><span>or</span></div>
        </>
      )}
      <input type="email" required autoComplete="email" placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} />
      {mode !== 'forgot' && (
        <input type="password" required minLength={6} autoComplete={mode === 'up' ? 'new-password' : 'current-password'}
          placeholder={mode === 'up' ? 'Choose a password (6+ characters)' : 'Password'} value={password} onChange={(e) => setPassword(e.target.value)} />
      )}
      {mode !== 'forgot' && (
        <label className="keep-signed-in">
          <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
          Keep me signed in
        </label>
      )}
      <button className="btn primary" disabled={busy}>
        {mode === 'in' ? 'Sign in' : mode === 'up' ? 'Create account' : 'Send reset link'}
      </button>
      {msg && <div className={`notice ${msg.ok ? 'ok' : 'error'}`}>{msg.text}</div>}
      <div className="auth-links">
        {mode === 'in' ? (
          <>
            <button type="button" className="link" onClick={() => setMode('up')}>New here? Create an account</button>
            <button type="button" className="link" onClick={() => setMode('forgot')}>Forgot password?</button>
          </>
        ) : (
          <button type="button" className="link" onClick={() => setMode('in')}>Back to sign in</button>
        )}
      </div>
      {onSkip ? (
        <p className="muted small">
          No account? <button type="button" className="link" onClick={onSkip}>Continue without signing in</button>
          <br />Your journal still works on this computer, it just is not backed up online.
        </p>
      ) : (
        <p className="muted small">Your journal keeps working on this computer without an account.</p>
      )}
    </form>
  );
}

function NewPassword() {
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase().auth.updateUser({ password });
    if (error) return setMsg({ ok: false, text: friendly(error) });
    setRecovering(false);
    setMsg({ ok: true, text: 'Password changed.' });
    go('/');
  };
  return (
    <form className="auth card pad" onSubmit={submit}>
      <h2>Choose a new password</h2>
      <input type="password" required minLength={6} autoComplete="new-password" placeholder="New password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <button className="btn primary">Save password</button>
      {msg && <div className={`notice ${msg.ok ? 'ok' : 'error'}`}>{msg.text}</div>}
    </form>
  );
}

function friendly(err: unknown) {
  const m = err instanceof Error ? err.message : (err as { message?: string })?.message ?? String(err);
  if (/invalid login credentials/i.test(m)) return 'That email and password do not match. Check them, or use "Forgot password?".';
  if (/email not confirmed/i.test(m)) return 'Please confirm your email first: click the link in the email we sent you.';
  if (/already registered/i.test(m)) return 'There is already an account with that email. Sign in instead.';
  if (/provider is not enabled/i.test(m)) return 'Google sign-in is not switched on yet. Use email and password for now.';
  if (/failed to fetch|network/i.test(m)) return 'Could not reach the server. Check your internet connection.';
  return m;
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
