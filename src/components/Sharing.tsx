import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { appUrl, useCloud } from '../cloud/cloud';
import { cloudConfigured } from '../cloud/config';
import { addInvite, addMember, createEntryShare, getEntryShare, isAdmin, listInvites, listMembers, loadSharedEntry, removeInvite, removeMember, shareUrl, stopEntryShare, type Invite, type Member, type SharedMedia } from '../cloud/sharing';
import type { LocalJournal } from '../cloud/sync';
import { db, type Entry } from '../db';
import { fmtDay, moodFor } from '../util';

const errText = (e: unknown) => (e instanceof Error ? e.message : (e as { message?: string })?.message ?? String(e));

// ─── #/s/<token>: someone opened a shared link ─────────────────────────────

export function SharedEntryPage({ token }: { token: string }) {
  const [data, setData] = useState<{ entry: Entry; media: SharedMedia[] } | null | undefined>();
  const [error, setError] = useState('');
  useEffect(() => {
    if (!cloudConfigured) return setData(null);
    loadSharedEntry(token).then(setData, (e) => setError(errText(e)));
  }, [token]);

  if (error) return <div className="shared-page"><p className="muted center">Could not open this entry: {error}</p></div>;
  if (data === undefined) return <div className="shared-page"><p className="muted center">Opening…</p></div>;
  if (data === null) return <div className="shared-page"><p className="muted center">This link no longer works. The person who shared it may have stopped sharing.</p></div>;
  const e = data.entry;
  const mood = moodFor(e.mood);
  return (
    <div className="shared-page">
      <div className="entry-view">
        <div className="entry-date">{fmtDay(e.date)}</div>
        {e.prompt && <div className="prompt-card">{e.prompt}</div>}
        {data.media.length > 0 && (
          <div className={`media-grid n${Math.min(data.media.length, 4)}`}>
            {data.media.map((m) => (
              <div key={m.id} className={`tile tile-${m.kind}`}>
                {m.kind === 'video' ? <video src={m.url} controls preload="metadata" />
                  : m.kind === 'audio' ? <div className="tile-audio-inner"><span aria-hidden>🎙️</span><audio src={m.url} controls /></div>
                  : <a href={m.url} target="_blank" rel="noreferrer"><img src={m.url} alt={m.caption ?? ''} /></a>}
                {m.caption && <span className="tile-caption">{m.caption}</span>}
              </div>
            ))}
          </div>
        )}
        {e.title && <h1 className="entry-title">{e.title}</h1>}
        <div className="entry-body">{e.body.split(/\n{2,}/).map((p, i) => <p key={i}>{p}</p>)}</div>
        <div className="entry-footer">
          {e.place && <span>📍 {e.place.name}</span>}
          {mood && <span>{mood.emoji} {mood.label}</span>}
        </div>
      </div>
      <p className="muted small center">Shared from a private journal. Only people with this link can see it.</p>
    </div>
  );
}

// ─── Share button on an entry ──────────────────────────────────────────────

export function ShareEntryButton({ entry }: { entry: Entry }) {
  const cloud = useCloud();
  const journal = useLiveQuery(() => db.journals.get(entry.journalId) as Promise<LocalJournal | undefined>, [entry.journalId]);
  const [open, setOpen] = useState(false);
  if (!cloud.user || (journal?.role && journal.role !== 'owner')) return null;
  return (
    <>
      <button className="btn ghost" onClick={() => setOpen(true)} aria-label="Share">🔗 <span className="btn-label">Share</span></button>
      {open && <ShareEntryDialog entryId={entry.id} onClose={() => setOpen(false)} />}
    </>
  );
}

function ShareEntryDialog({ entryId, onClose }: { entryId: string; onClose: () => void }) {
  const [token, setToken] = useState<string | null | undefined>();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  useEffect(() => {
    getEntryShare(entryId).then(setToken, (e) => (setToken(null), setMsg(errText(e))));
  }, [entryId]);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMsg('');
    try {
      await fn();
    } catch (e) {
      setMsg(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const url = token ? shareUrl(token) : '';
  return (
    <Dialog title="Share this entry" onClose={onClose}>
      {token === undefined ? <p className="muted">Checking…</p> : token ? (
        <>
          <p className="muted">Anyone with this link can read this entry and see its photos. They do not need an account, and they cannot see anything else in your journal.</p>
          <div className="row">
            <input className="text-input grow" readOnly value={url} onFocus={(e) => e.target.select()} />
            <button className="btn primary" onClick={() => navigator.clipboard.writeText(url).then(() => setMsg('Link copied.'))}>Copy link</button>
          </div>
          {'share' in navigator && <button className="btn" onClick={() => navigator.share({ url }).catch(() => {})}>Share…</button>}
          <button className="btn ghost danger" disabled={busy} onClick={() => run(async () => { await stopEntryShare(entryId); setToken(null); setMsg('The link no longer works.'); })}>Stop sharing</button>
        </>
      ) : (
        <>
          <p className="muted">Create a private link to this one entry. Anyone you send it to can read it without an account. You can turn the link off at any time.</p>
          <button className="btn primary" disabled={busy} onClick={() => run(async () => setToken(await createEntryShare(entryId)))}>{busy ? 'Creating…' : 'Create link'}</button>
        </>
      )}
      {msg && <p className="small">{msg}</p>}
    </Dialog>
  );
}

// ─── Sharing whole journals (Settings) ─────────────────────────────────────

export function JournalSharingCard() {
  const cloud = useCloud();
  const journals = useLiveQuery(() => db.journals.toArray() as Promise<LocalJournal[]>, []);
  if (!cloud.user || cloud.otherAccount || !journals) return null;
  const mine = journals.filter((j) => !j.role || j.role === 'owner');
  const shared = journals.filter((j) => j.role && j.role !== 'owner');
  return (
    <section className="card pad">
      <h3>Share a journal</h3>
      <p className="muted">Add people by email. The app doesn't send them anything, so click <strong>Send invite</strong> next to their name to send them a note from Gmail, Outlook, Yahoo, your email app, or copy it to paste anywhere. They sign in (or create an account) with that same email address, and the journal shows up for them. Paul Remembers is invite-only: you can share with people who already have an account, or whom Paul has invited. Viewers can read it; editors can also add and change entries.</p>
      {mine.map((j) => <JournalMembers key={j.id} journal={j} />)}
      {shared.length > 0 && (
        <>
          <h4>Shared with you</h4>
          <ul className="plain">
            {shared.map((j) => <li key={j.id}>{j.name} <span className="muted small">from {j.ownerEmail ?? 'someone'} · you can {j.role === 'editor' ? 'edit' : 'read'}</span></li>)}
          </ul>
        </>
      )}
    </section>
  );
}

/** The invite email's link: opens "Create an account" with their email filled in. */
const joinUrl = (email: string) => `${appUrl()}#/join/${encodeURIComponent(email)}`;

/** The app sends no email itself, so the owner sends this invite from their own email (or pastes it anywhere). */
function inviteText(journalName: string, email: string, role: Member['role']) {
  const subject = `I shared my journal "${journalName}" with you`;
  const body = [
    'Hi,',
    '',
    `I shared my journal "${journalName}" with you in Paul Remembers. You can ${role === 'editor' ? 'read it and add entries' : 'read it'}.`,
    '',
    `1. Open this link: ${joinUrl(email)}`,
    `2. Create your account with this email address: ${email}`,
    '   (If it is a Gmail address, you can select "Continue with Google" instead.)',
    '   Already have an account? Select "Already have an account? Sign in".',
    '3. Check your inbox (and spam folder) for a confirmation email, then sign in.',
    '   The journal shows up for you once you are signed in.',
  ].join('\n');
  return { subject, body };
}

type Sender = 'gmail' | 'outlook' | 'yahoo' | 'app' | 'copy';
const SENDERS: { id: Sender; label: string }[] = [
  { id: 'gmail', label: 'Gmail' },
  { id: 'outlook', label: 'Outlook.com' },
  { id: 'yahoo', label: 'Yahoo Mail' },
  { id: 'app', label: 'My email app' },
  { id: 'copy', label: 'Copy invite (to paste anywhere)' },
];
const LAST_SENDER = 'pr.inviteSender';

function senderLink(id: Sender, to: string, subject: string, body: string): string | null {
  const t = encodeURIComponent(to), s = encodeURIComponent(subject), b = encodeURIComponent(body);
  switch (id) {
    case 'gmail': return `https://mail.google.com/mail/?view=cm&fs=1&to=${t}&su=${s}&body=${b}`;
    case 'outlook': return `https://outlook.live.com/mail/0/deeplink/compose?to=${t}&subject=${s}&body=${b}`;
    case 'yahoo': return `https://compose.mail.yahoo.com/?to=${t}&subject=${s}&body=${b}`;
    case 'app': return `mailto:${t}?subject=${s}&body=${b}`;
    default: return null;
  }
}

/** Invite to the app itself (Settings → Invite someone), no journal shared. */
function appInviteText(email: string) {
  const subject = "You're invited to Paul Remembers";
  const body = [
    'Hi,',
    '',
    "I've invited you to Paul Remembers, my journal app. It's invite-only, so you can create an account with this email address: " + email,
    '',
    `1. Open this link: ${joinUrl(email)}`,
    '2. Create your account with that same email address.',
    '   (If it is a Gmail address, you can select "Continue with Google" instead.)',
    '3. Check your inbox (and spam folder) for a confirmation email, then sign in.',
  ].join('\n');
  return { subject, body };
}

function SendInvite({ to, text }: { to: string; text: () => { subject: string; body: string } }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  let last: string | null = null;
  try { last = localStorage.getItem(LAST_SENDER); } catch { /* private window */ }
  const ordered = [...SENDERS].sort((x, y) => (y.id === last ? 1 : 0) - (x.id === last ? 1 : 0));

  const pick = async (id: Sender) => {
    try { localStorage.setItem(LAST_SENDER, id); } catch { /* ignore */ }
    const { subject, body } = text();
    const link = senderLink(id, to, subject, body);
    if (link) {
      if (id === 'app') location.href = link;
      else window.open(link, '_blank', 'noopener');
      setOpen(false);
      return;
    }
    try {
      await navigator.clipboard.writeText(`${subject}\n\n${body}`);
      setCopied(true);
      setTimeout(() => { setCopied(false); setOpen(false); }, 1500);
    } catch {
      window.prompt('Copy this invite:', body);
      setOpen(false);
    }
  };

  return (
    <>
      <button className="btn small ghost" onClick={() => setOpen(true)}>Send invite</button>
      {open && (
        <Dialog title={`Send an invite to ${to}`} onClose={() => setOpen(false)}>
          <p className="muted small">Pick where to send it from. A new email opens with everything filled in.</p>
          <div className="invite-senders">
            {ordered.map((o) => (
              <button key={o.id} className={o.id === last ? 'btn' : 'btn ghost'} onClick={() => pick(o.id)}>
                {o.id === 'copy' && copied ? 'Copied ✓ Paste it into a text or email' : o.label}
              </button>
            ))}
          </div>
        </Dialog>
      )}
    </>
  );
}

function JournalMembers({ journal }: { journal: LocalJournal }) {
  const [members, setMembers] = useState<Member[]>();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Member['role']>('viewer');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const reload = () => listMembers(journal.id).then(setMembers, () => setMembers([]));
  useEffect(() => {
    reload();
  }, [journal.id]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg('');
    try {
      await addMember(journal.id, email, role);
      setMsg(`Shared with ${email}. The app doesn't send an email by itself, so click "Send invite" next to their name and pick Gmail, Outlook, Yahoo, your email app, or Copy.`);
      setEmail('');
      await reload();
    } catch (err) {
      setMsg(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="journal-members">
      <h4>{journal.name}</h4>
      {members?.length ? (
        <ul className="plain">
          {members.map((m) => (
            <li key={m.email} className="row">
              <span className="grow">{m.email} <span className="muted small">· {m.role === 'editor' ? 'can edit' : 'can read'}</span></span>
              <SendInvite to={m.email} text={() => inviteText(journal.name, m.email, m.role)} />
              <button className="btn small ghost danger" onClick={() => removeMember(journal.id, m.email).then(reload)}>Remove</button>
            </li>
          ))}
        </ul>
      ) : members && <p className="muted small">Only you.</p>}
      <form className="row" onSubmit={add}>
        <input className="text-input grow" type="email" required placeholder="Their email address" value={email} onChange={(e) => setEmail(e.target.value)} />
        <select className="text-input" value={role} onChange={(e) => setRole(e.target.value as Member['role'])}>
          <option value="viewer">Can read</option>
          <option value="editor">Can edit</option>
        </select>
        <button className="btn" disabled={busy}>Share</button>
      </form>
      {msg && <p className="small">{msg}</p>}
    </div>
  );
}

export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog card pad" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="row"><h3 className="grow">{title}</h3><button className="btn ghost small" onClick={onClose} aria-label="Close">×</button></div>
        {children}
      </div>
    </div>
  );
}

// ─── Invite someone (Settings, only for the admin) ─────────────────────────

/** Only Paul (the admin) sees this. Supabase refuses invites from anyone else. */
export function InviteCard() {
  const cloud = useCloud();
  const [admin, setAdmin] = useState(false);
  const [invites, setInvites] = useState<Invite[]>();
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const reload = () => listInvites().then(setInvites, () => setInvites([]));
  useEffect(() => {
    setAdmin(false);
    if (!cloud.user) return;
    isAdmin().then((yes) => {
      setAdmin(yes);
      if (yes) reload();
    });
  }, [cloud.user?.id]);
  if (!cloud.user || !admin) return null;

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg('');
    try {
      await addInvite(email);
      setMsg(`${email} can now create an account. The app doesn't send an email by itself, so click "Send invite" next to their name.`);
      setEmail('');
      await reload();
    } catch (err) {
      setMsg(errText(err));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (who: string) => {
    try {
      await removeInvite(who);
      await reload();
    } catch (err) {
      setMsg(errText(err));
    }
  };

  return (
    <section className="card pad">
      <h3>Invite someone</h3>
      <p className="muted">Paul Remembers is invite-only. Only people on this list can create an account. Anyone you share a journal with is added here for you. Only you can see this.</p>
      {invites?.length ? (
        <ul className="plain">
          {invites.map((i) => (
            <li key={i.email} className="row">
              <span className="grow">{i.email} <span className="muted small">· {i.joined ? 'has an account' : 'not signed up yet'}</span></span>
              {!i.joined && <SendInvite to={i.email} text={() => appInviteText(i.email)} />}
              {!i.joined && <button className="btn small ghost danger" onClick={() => remove(i.email)}>Remove</button>}
            </li>
          ))}
        </ul>
      ) : invites && <p className="muted small">Nobody invited yet.</p>}
      <form className="row" onSubmit={add}>
        <input className="text-input grow" type="email" required placeholder="Their email address" value={email} onChange={(e) => setEmail(e.target.value)} />
        <button className="btn" disabled={busy}>Add</button>
      </form>
      {msg && <p className="small">{msg}</p>}
    </section>
  );
}
