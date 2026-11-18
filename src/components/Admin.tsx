import { useEffect, useState } from 'react';
import { useCloud } from '../cloud/cloud';
import {
  adminPeople, adminRemoveMember, adminRequests, adminShares, adminTotals, adminUsage, approveRequest, declineRequest,
  refreshAdmin, setAdmin, setBlocked, useAdmin,
  type AdminPerson, type AdminRequest, type AdminShare, type AdminTotals, type AdminUsage,
} from '../cloud/admin';
import { addInvite, removeInvite } from '../cloud/sharing';
import type { Person } from '../cloud/people';
import { appInvite } from '../inviteEmail';
import { JournalDot } from '../journals';
import { PersonIcon } from './People';
import { errText, SendInvite, useMyName } from './Sharing';

// Free Supabase plan limits, for the Usage bars.
const FREE_FILES = 1024 ** 3; // 1 GB of photos, videos and voice notes
const FREE_DB = 500 * 1024 ** 2; // 500 MB database

const DAY = 864e5;
/** "today", "yesterday", "3 days ago", else a date like "Nov 14". */
function when(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(new Date()) - start(d)) / DAY);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

function size(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  if (bytes > 0) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return '0';
}

const asPerson = (p?: AdminPerson): Person | undefined =>
  p?.user_id ? { id: p.user_id, email: p.email, name: p.name ?? undefined, icon: p.icon ?? undefined } : undefined;
const nameFor = (p?: AdminPerson, email?: string) => p?.name || (p?.email ?? email ?? 'Someone').split('@')[0];

function Who({ p, email }: { p?: AdminPerson; email?: string }) {
  const person = asPerson(p);
  return (
    <span className="member-person">
      {person ? <PersonIcon id={person.id} person={person} /> : <span className="person-icon emoji small faded">✉</span>}
      {person ? nameFor(p) : email ?? p?.email}
    </span>
  );
}


/** #/admin: only admins. Counts and dates only, never what anyone wrote. */
export function AdminPage() {
  const cloud = useCloud();
  const { admin } = useAdmin();
  const [checked, setChecked] = useState(false);
  const [requests, setRequests] = useState<AdminRequest[]>();
  const [people, setPeople] = useState<AdminPerson[]>();
  const [shares, setShares] = useState<AdminShare[]>();
  const [usage, setUsage] = useState<AdminUsage[]>();
  const [totals, setTotals] = useState<AdminTotals>();
  const [error, setError] = useState('');

  const reload = async () => {
    try {
      const [r, p, s, u, t] = await Promise.all([adminRequests(), adminPeople(), adminShares(), adminUsage(), adminTotals()]);
      setRequests(r); setPeople(p); setShares(s); setUsage(u); setTotals(t ?? undefined);
      setError('');
    } catch (e) {
      setError(errText(e));
    }
  };
  useEffect(() => {
    if (!admin) return;
    void reload();
  }, [admin]);
  useEffect(() => {
    const t = setTimeout(() => setChecked(true), 4000);
    return () => clearTimeout(t);
  }, []);

  if (!cloud.user) return <div className="settings"><h1>Admin</h1><p className="muted">Sign in first.</p></div>;
  if (!admin) return <div className="settings"><h1>Admin</h1><p className="muted">{checked ? 'Only admins can see this page.' : 'Checking…'}</p></div>;

  const byId = new Map((people ?? []).filter((p) => p.user_id).map((p) => [p.user_id!, p]));
  const byEmail = new Map((people ?? []).map((p) => [p.email.toLowerCase(), p]));
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      alert(errText(e));
    }
    await reload();
    refreshAdmin();
  };

  return (
    <div className="settings admin">
      <h1>Admin</h1>
      <p className="muted">Only admins see this page. It shows counts and dates only, never what anyone wrote.</p>
      {error && <p className="notice error">{error}</p>}
      <Requests requests={requests} byId={byId} act={act} />
      <People people={people} me={cloud.user.id} act={act} />
      <Sharing shares={shares} byId={byId} byEmail={byEmail} act={act} />
      <Usage usage={usage} totals={totals} byId={byId} />
    </div>
  );
}

type Act = (fn: () => Promise<unknown>) => Promise<void>;

function Requests({ requests, byId, act }: { requests?: AdminRequest[]; byId: Map<string, AdminPerson>; act: Act }) {
  const waiting = (requests ?? []).filter((r) => r.status === 'waiting');
  return (
    <section className="card pad">
      <h3>Invite requests {waiting.length > 0 && <span className="count-dot">{waiting.length}</span>}</h3>
      <p className="muted small">People who want to share a journal with someone who isn't in Paul Remembers yet.</p>
      {!requests ? <p className="muted small">Loading…</p> : !waiting.length ? <p className="muted small">No requests waiting.</p> : waiting.map((r) => (
        <div key={r.journal_id + r.email} className="request row">
          <span className="grow">
            <strong><Who p={byId.get(r.requested_by)} /></strong> wants to share <strong>{r.journal_name ?? 'a journal'}</strong> with <strong>{r.email}</strong>{' '}
            <span className="muted">· {r.role === 'editor' ? 'can edit' : 'can read'}</span>
            <span className="muted small block-line">Asked {when(r.created_at)}, {new Date(r.created_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
          </span>
          <button className="btn primary small" onClick={() => act(() => approveRequest(r.journal_id, r.email))}>Approve</button>
          <button className="btn small danger" onClick={() => act(() => declineRequest(r.journal_id, r.email))}>Decline</button>
        </div>
      ))}
      {waiting.length > 0 && <p className="muted small">Approve invites them and shares the journal in one step. Then press <strong>Send invite</strong> next to their name under People to email them.</p>}
    </section>
  );
}

function People({ people, me, act }: { people?: AdminPerson[]; me: string; act: Act }) {
  const myName = useMyName();
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState('');
  const sorted = [...(people ?? [])].sort((a, b) =>
    (a.user_id === me ? -1 : b.user_id === me ? 1 : 0) || (+!a.user_id - +!b.user_id) || nameFor(a).localeCompare(nameFor(b)));

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    const who = email.trim().toLowerCase();
    await act(() => addInvite(who));
    setEmail('');
    setMsg(`${who} can now create an account. The app doesn't send an email by itself, so press "Send invite" next to their name.`);
  };

  return (
    <section className="card pad">
      <h3>People</h3>
      <p className="muted small">Everyone who can use Paul Remembers. Only people here can create an account. Anyone an admin shares a journal with is added for you.</p>
      {!people ? <p className="muted small">Loading…</p> : (
        <ul className="plain admin-list">
          {sorted.map((p) => (
            <li key={p.email} className="row">
              <span className="grow">
                <strong><Who p={p} /></strong>{' '}
                {p.admin && <span className="pill admin">Admin</span>}
                {p.blocked && <span className="pill blocked">Blocked</span>}
                {!p.user_id && <span className="pill wait">Invited</span>}
                <span className="muted small block-line">
                  {p.user_id
                    ? `${p.email} · joined ${when(p.joined_at)} · ${p.blocked ? "can't sign in" : p.last_active ? `last active ${when(p.last_active)}` : 'not active yet'}`
                    : `invited ${when(p.invited_at)} · hasn't joined yet`}
                </span>
              </span>
              {!p.user_id && <SendInvite to={p.email} mail={() => appInvite(p.email, myName)} />}
              {!p.user_id && <button className="btn small ghost danger" onClick={() => act(() => removeInvite(p.email))}>Cancel invite</button>}
              {p.user_id && p.user_id !== me && !p.blocked && (
                p.admin
                  ? <button className="btn small ghost" onClick={() => confirm(`Stop ${nameFor(p)} being an admin?`) && act(() => setAdmin(p.user_id!, false))}>Remove admin</button>
                  : <button className="btn small ghost" onClick={() => confirm(`Make ${nameFor(p)} an admin? They'll see this page and can invite people.`) && act(() => setAdmin(p.user_id!, true))}>Make admin</button>
              )}
              {p.user_id && p.user_id !== me && !p.admin && (
                p.blocked
                  ? <button className="btn small ghost" onClick={() => act(() => setBlocked(p.user_id!, false))}>Unblock</button>
                  : <button className="btn small ghost danger" onClick={() => confirm(`Block ${nameFor(p)}? They are signed out and can't sign in until you unblock them. Nothing is deleted.`) && act(() => setBlocked(p.user_id!, true))}>Block</button>
              )}
            </li>
          ))}
        </ul>
      )}
      <form className="row" onSubmit={invite}>
        <input className="text-input grow" type="email" required placeholder="Their email address" value={email} onChange={(e) => setEmail(e.target.value)} />
        <button className="btn">Invite</button>
      </form>
      {msg && <p className="small">{msg}</p>}
    </section>
  );
}

function Sharing({ shares, byId, byEmail, act }: { shares?: AdminShare[]; byId: Map<string, AdminPerson>; byEmail: Map<string, AdminPerson>; act: Act }) {
  const journals = new Map<string, AdminShare[]>();
  for (const s of shares ?? []) journals.set(s.journal_id, [...(journals.get(s.journal_id) ?? []), s]);
  return (
    <section className="card pad">
      <h3>Sharing</h3>
      <p className="muted small">Every journal that's shared, and with whom.</p>
      {!shares ? <p className="muted small">Loading…</p> : !journals.size ? <p className="muted small">No journals are shared yet.</p> : (
        <ul className="plain admin-list">
          {[...journals.values()].map((list) => {
            const j = list[0];
            return (
              <li key={j.journal_id}>
                <div className="row"><strong className="grow"><JournalDot color={j.journal_color ?? undefined} /> {j.journal_name ?? 'Untitled journal'}</strong><span className="muted small">owned by {nameFor(byId.get(j.owner_id))}</span></div>
                {list.map((m) => (
                  <div key={m.email} className="row small share-member">
                    <span className="grow"><Who p={byEmail.get(m.email.toLowerCase())} email={m.email} /> · {m.role === 'editor' ? 'can edit' : 'can read'}</span>
                    <button className="btn small ghost danger" onClick={() => confirm(`Take ${m.email} off ${j.journal_name ?? 'this journal'}?`) && act(() => adminRemoveMember(m.journal_id, m.email))}>Remove</button>
                  </div>
                ))}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Usage({ usage, totals, byId }: { usage?: AdminUsage[]; totals?: AdminTotals; byId: Map<string, AdminPerson> }) {
  const bar = (used: number, of: number) => <div className="usage-bar"><i style={{ width: `${Math.min(100, (used / of) * 100)}%` }} /></div>;
  return (
    <section className="card pad">
      <h3>Usage</h3>
      {totals && (
        <>
          <div className="stats">
            <div><b>{totals.people}</b><span className="muted small">people</span></div>
            <div><b>{totals.journals}</b><span className="muted small">journals</span></div>
            <div><b>{totals.entries}</b><span className="muted small">entries</span></div>
            <div><b>{totals.entries_this_week}</b><span className="muted small">new this week</span></div>
          </div>
          <div className="small"><strong>Photos, videos and voice notes:</strong> {size(totals.file_bytes)} of 1 GB free</div>
          {bar(totals.file_bytes, FREE_FILES)}
          <div className="small"><strong>Database:</strong> {size(totals.db_bytes)} of 500 MB free</div>
          {bar(totals.db_bytes, FREE_DB)}
        </>
      )}
      {!usage ? <p className="muted small">Loading…</p> : (
        <ul className="plain admin-list usage-list">
          {usage.map((u) => (
            <li key={u.journal_id}>
              <div className="row"><strong className="grow"><JournalDot color={u.journal_color ?? undefined} /> {u.journal_name ?? 'Untitled journal'}</strong><span className="muted small">{nameFor(byId.get(u.owner_id))}</span></div>
              <div className="muted small">
                {[`${u.entries} ${u.entries === 1 ? 'entry' : 'entries'}`, u.photos && `${u.photos} photos`, u.videos && `${u.videos} videos`, u.voice && `${u.voice} voice notes`, size(u.bytes) !== '0' && size(u.bytes), u.last_updated && `updated ${when(u.last_updated)}`].filter(Boolean).join(' · ')}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
