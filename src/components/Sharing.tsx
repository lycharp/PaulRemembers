import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { appUrl, useCloud } from '../cloud/cloud';
import { cloudConfigured } from '../cloud/config';
import { addMember, createEntryShare, getEntryShare, listMembers, loadSharedEntry, removeMember, shareUrl, stopEntryShare, type Member, type SharedMedia } from '../cloud/sharing';
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
      <p className="muted">Add people by email. The app doesn't send them anything, so use <strong>Send with Gmail</strong> or <strong>Copy invite</strong> to send them a note. They sign in (or create an account) with that same email address, and the journal shows up for them. Viewers can read it; editors can also add and change entries.</p>
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

/** The app sends no email itself, so Paul sends this invite from his own Gmail (or pastes it anywhere). */
function inviteText(journalName: string, email: string, role: Member['role']) {
  const subject = `I shared my journal "${journalName}" with you`;
  const body = [
    'Hi,',
    '',
    `I shared my journal "${journalName}" with you in Paul Remembers. You can ${role === 'editor' ? 'read it and add entries' : 'read it'}.`,
    '',
    `1. Open ${appUrl()}`,
    `2. Sign in, or create an account, using this email address: ${email}`,
    '3. The journal shows up for you once you are signed in.',
    '',
    'If you create a new account, check your inbox (and spam folder) for a confirmation email first.',
  ].join('\n');
  return { subject, body };
}

function gmailLink(journalName: string, email: string, role: Member['role']) {
  const { subject, body } = inviteText(journalName, email, role);
  return `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(email)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function CopyInvite({ journalName, member }: { journalName: string; member: Member }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const { subject, body } = inviteText(journalName, member.email, member.role);
    try {
      await navigator.clipboard.writeText(`${subject}\n\n${body}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy this invite:', body);
    }
  };
  return <button className="btn small ghost" onClick={copy}>{copied ? 'Copied ✓' : 'Copy invite'}</button>;
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
      setMsg(`Shared with ${email}. The app doesn't send an email by itself, so click "Send with Gmail" next to their name (or "Copy invite" to paste it into a text or any email).`);
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
              <a className="btn small ghost" href={gmailLink(journal.name, m.email, m.role)} target="_blank" rel="noopener">Send with Gmail</a>
              <CopyInvite journalName={journal.name} member={m} />
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
