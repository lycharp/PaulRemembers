import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useCloud } from '../cloud/cloud';
import { copyInvite, journalInvite, type InviteEmail } from '../inviteEmail';
import { cloudConfigured } from '../cloud/config';
import { nameOf, refreshPeople, usePeople, type Person } from '../cloud/people';
import { PersonIcon } from './People';
import { addMember, createEntryShare, getEntryShare, listMembers, loadSharedEntry, NOT_INVITED, removeMember, shareUrl, stopEntryShare, type Member, type SharedMedia } from '../cloud/sharing';
import { myRequests, removeRequest, requestInvite, useAdmin, type InviteRequest } from '../cloud/admin';
import type { LocalJournal } from '../cloud/sync';
import { db, type Entry } from '../db';
import { fmtDay, moodFor } from '../util';
import { Icon } from './Icon';
import { Linkified } from './Linkified';

export const errText = (e: unknown) => (e instanceof Error ? e.message : (e as { message?: string })?.message ?? String(e));

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
                  : m.kind === 'audio' ? <div className="tile-audio-inner"><Icon name="mic" className="audio-mark" /><audio src={m.url} controls /></div>
                  : <a href={m.url} target="_blank" rel="noreferrer"><img src={m.url} alt={m.caption ?? ''} /></a>}
                {m.caption && <span className="tile-caption">{m.caption}</span>}
              </div>
            ))}
          </div>
        )}
        {e.title && <h1 className="entry-title"><Linkified text={e.title} /></h1>}
        <div className="entry-body">{e.body.split(/\n{2,}/).map((p, i) => <p key={i}><Linkified text={p} /></p>)}</div>
        <div className="entry-footer">
          {e.place && <span><Icon name="pin" className="inline-icon" /> {e.place.name}</span>}
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
      <button className="btn ghost icon-tile" onClick={() => setOpen(true)} title="Share" aria-label="Share"><Icon name="share" /></button>
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
      <p className="muted">You can share with people who already use Paul Remembers. To add someone new, ask Paul to invite them. Viewers can read a journal; editors can also add and change entries.</p>
      <p className="muted small">The app doesn't send anyone an email by itself, so press <strong>Send invite</strong> next to a name to send them a note from Gmail, Outlook, Yahoo or your email app, or copy it to paste anywhere. They sign in with that same email address, and the journal shows up for them.</p>
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
    case 'gmail': return `https://mail.google.com/mail/?view=cm&fs=1&to=${t}&su=${s}${body ? `&body=${b}` : ''}`;
    case 'outlook': return `https://outlook.live.com/mail/0/deeplink/compose?to=${t}&subject=${s}${body ? `&body=${b}` : ''}`;
    case 'yahoo': return `https://compose.mail.yahoo.com/?to=${t}&subject=${s}${body ? `&body=${b}` : ''}`;
    case 'app': return `mailto:${t}?subject=${s}${body ? `&body=${b}` : ''}`;
    default: return null;
  }
}

/** The name invites are signed with: your name in Paul Remembers, else your Google name. */
export function useMyName() {
  const { user } = useCloud();
  const { byId } = usePeople();
  return (user && byId.get(user.id)?.name) || user?.name;
}

const isTouch = () => matchMedia('(pointer: coarse)').matches;

export function SendInvite({ to, mail }: { to: string; mail: () => InviteEmail }) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<Sender>();
  const [link, setLink] = useState('');
  let last: string | null = null;
  try { last = localStorage.getItem(LAST_SENDER); } catch { /* private window */ }
  const ordered = [...SENDERS].sort((x, y) => (y.id === last ? 1 : 0) - (x.id === last ? 1 : 0));
  const paste = isTouch() ? 'press and hold in the message, then select Paste' : 'click in the message and press Ctrl+V';

  const pick = async (id: Sender) => {
    try { localStorage.setItem(LAST_SENDER, id); } catch { /* ignore */ }
    const m = mail();
    if (id === 'copy') {
      if (await copyInvite(m, true)) setDone('copy');
      else { window.prompt('Copy this invite:', m.text); setOpen(false); }
      return;
    }
    // Compose links only take plain text, so the formatted invite (logo, button) goes on
    // the clipboard to paste. If the clipboard is refused, the plain text fills the email instead.
    // Copy first: browsers refuse the clipboard once the new tab has taken focus.
    const copied = await copyInvite(m, false);
    const link = senderLink(id, to, m.subject, copied ? '' : m.text)!;
    setLink(link);
    if (id === 'app') location.href = link;
    else window.open(link, '_blank', 'noopener');
    if (copied) setDone(id);
    else setOpen(false);
  };

  const close = () => { setOpen(false); setDone(undefined); };
  return (
    <>
      <button className="btn small ghost" onClick={() => setOpen(true)}>Send invite</button>
      {open && (
        <Dialog title={`Send an invite to ${to}`} onClose={close}>
          {done ? (
            <>
              {done === 'copy'
                ? <p><strong>Copied ✓</strong> Now paste it into an email or text message.</p>
                : <>
                  <p><strong>One more step:</strong> the invite is copied, so in the new email, {paste}. The logo, the button and the link come with it.</p>
                  <p className="muted small">No new email? <a href={link} target={done === 'app' ? undefined : '_blank'} rel="noopener">Open it here</a>.</p>
                </>}
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <button className="btn primary" onClick={close}>Done</button>
              </div>
            </>
          ) : (
            <>
              <p className="muted small">Pick where to send it from. A new email opens with their address and the subject filled in, and the invite is copied for you to paste in.</p>
              <div className="invite-senders">
                {ordered.map((o) => (
                  <button key={o.id} className={o.id === last ? 'btn' : 'btn ghost'} onClick={() => pick(o.id)}>{o.label}</button>
                ))}
              </div>
            </>
          )}
        </Dialog>
      )}
    </>
  );
}

/** A member's icon and name, once they have signed in at least once. */
function MemberPerson({ person }: { person?: Person }) {
  if (!person) return null;
  return <><span className="member-person"><PersonIcon id={person.id} person={person} /> {nameOf(person)} ·</span>{' '}</>;
}

function JournalMembers({ journal }: { journal: LocalJournal }) {
  const [members, setMembers] = useState<Member[]>();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Member['role']>('viewer');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [requests, setRequests] = useState<InviteRequest[]>([]);
  const [outsider, setOutsider] = useState<{ email: string; role: Member['role'] }>();
  const { byEmail } = usePeople();
  const { admin } = useAdmin();
  const myName = useMyName();
  const { user } = useCloud();
  const ownerName = user?.email?.split('@')[0] ?? 'Me';
  // Also refresh names and icons, and whether this journal now counts as shared.
  const reload = () => {
    void refreshPeople().catch(() => {});
    void myRequests(journal.id).then(setRequests);
    return listMembers(journal.id).then(setMembers, () => setMembers([]));
  };
  useEffect(() => {
    reload();
  }, [journal.id]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg('');
    setOutsider(undefined);
    try {
      await addMember(journal.id, email, role);
      setMsg(`Shared with ${email}. The app doesn't send an email by itself, so click "Send invite" next to their name and pick Gmail, Outlook, Yahoo, your email app, or Copy.`);
      setEmail('');
      await reload();
    } catch (err) {
      // Not in the app yet: offer to ask Paul (admins never get here, sharing invites them).
      if (!admin && errText(err) === NOT_INVITED) setOutsider({ email: email.trim().toLowerCase(), role });
      else setMsg(errText(err));
    } finally {
      setBusy(false);
    }
  };

  const ask = async () => {
    if (!outsider) return;
    setBusy(true);
    try {
      await requestInvite(journal.id, outsider.email, outsider.role);
      setOutsider(undefined);
      setEmail('');
      setMsg(`Asked Paul to invite ${outsider.email}. Once he approves, this journal is shared with them, and you can press "Send invite" next to their name.`);
      await reload();
    } catch (err) {
      setMsg(errText(err));
    } finally {
      setBusy(false);
    }
  };
  const clear = async (r: InviteRequest) => {
    try {
      await removeRequest(journal.id, r.email);
      await reload();
    } catch (err) {
      setMsg(errText(err));
    }
  };
  const asked = requests.filter((r) => !members?.some((m) => m.email === r.email));

  return (
    <div className="journal-members">
      <h4>{journal.name}</h4>
      {members?.length ? (
        <ul className="plain">
          {members.map((m) => (
            <li key={m.email} className="row">
              <span className="grow">
                <MemberPerson person={byEmail.get(m.email.toLowerCase())} />
                {m.email} <span className="muted small">· {m.role === 'editor' ? 'can edit' : 'can read'}</span></span>
              <SendInvite to={m.email} mail={() => journalInvite(`${myName || ownerName} · ${journal.name}`, m.email, m.role, myName, byEmail.has(m.email.toLowerCase()))} />
              <button className="btn small ghost danger" onClick={() => removeMember(journal.id, m.email).then(reload)}>Remove</button>
            </li>
          ))}
        </ul>
      ) : members && !asked.length && <p className="muted small">Only you.</p>}
      {asked.length > 0 && (
        <ul className="plain">
          {asked.map((r) => (
            <li key={r.email} className="row">
              <span className="grow">
                {r.email} <span className="muted small">· {r.role === 'editor' ? 'can edit' : 'can read'}</span>{' '}
                {r.status === 'waiting' ? <span className="pill wait">Waiting for Paul</span> : <span className="pill no">Declined</span>}
              </span>
              {r.status === 'waiting'
                ? <button className="btn small ghost danger" onClick={() => clear(r)}>Cancel request</button>
                : <button className="btn small ghost" onClick={() => clear(r)}>OK</button>}
            </li>
          ))}
        </ul>
      )}
      <form className="row" onSubmit={add}>
        <input className="text-input grow" type="email" required placeholder="Their email address" value={email} onChange={(e) => setEmail(e.target.value)} />
        <select className="text-input" value={role} onChange={(e) => setRole(e.target.value as Member['role'])}>
          <option value="viewer">Can read</option>
          <option value="editor">Can edit</option>
        </select>
        <button className="btn" disabled={busy}>Share</button>
      </form>
      {outsider && (
        <div className="notice warn">
          <strong>{outsider.email} isn't in Paul Remembers yet.</strong>
          <p className="small">Paul has to invite them first. Ask him, and once he approves, they're invited and this journal is shared with them automatically.</p>
          <div className="row">
            <button className="btn primary small" disabled={busy} onClick={ask}>Ask Paul to invite them</button>
            <button className="btn small ghost" onClick={() => setOutsider(undefined)}>Never mind</button>
          </div>
        </div>
      )}
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
  // Drawn at the top of the page, so it covers everything even when opened from
  // inside the sidebar (which otherwise kept it underneath the journal list).
  return createPortal(
    <div className="dialog-backdrop" onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div className="dialog card pad" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="row"><h3 className="grow">{title}</h3><button className="btn ghost small" onClick={onClose} aria-label="Close">×</button></div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
