import { useEffect, useRef, useState } from 'react';
import { isOwnJournal, type Entry, type Journal } from '../db';
import { useCloud } from '../cloud/cloud';
import { nameOf, usePeople } from '../cloud/people';
import { addComment, COMMENT_MAX, deleteComment, editComment, refreshEntryComments, useComments, type CommentRow } from '../cloud/comments';
import { fmtShort, fmtTime } from '../util';
import { askSure } from './Confirm';
import { Linkified } from './Linkified';
import { PersonIcon } from './People';

/** "Today, 8:15 AM", "Yesterday, 7:42 PM" or "Mon, Nov 16, 9:10 PM". */
function when(iso: string) {
  const d = new Date(iso);
  const day = (n: number) => new Date(new Date().setHours(0, 0, 0, 0) - n * 864e5).toDateString();
  const label = d.toDateString() === day(0) ? 'Today' : d.toDateString() === day(1) ? 'Yesterday' : fmtShort(d.getTime());
  return `${label}, ${fmtTime(d.getTime())}`;
}

/** The comment count on a journal card, after the reactions. */
export function CardComments({ entry, journal }: { entry: Entry; journal?: Journal }) {
  const { isShared } = usePeople();
  const n = useComments()[entry.id]?.length ?? 0;
  if (!n || !isShared(journal)) return null;
  return <span className="card-reaction" aria-label={`${n} comment${n === 1 ? '' : 's'}`}>💬 {n}</span>;
}

/** A computer with a mouse or trackpad (so most likely a real keyboard), not a touch screen. */
const hasKeyboard = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches;

/** A text box that grows with what's typed. */
function Box({ value, onChange, onSubmit, placeholder, autoFocus }: { value: string; onChange: (s: string) => void; onSubmit: () => void; placeholder: string; autoFocus?: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight + 2, 200)}px`;
  }, [value]);
  return (
    <textarea ref={ref} rows={1} value={value} placeholder={placeholder} maxLength={COMMENT_MAX} autoFocus={autoFocus} aria-label={placeholder}
      onChange={(ev) => onChange(ev.target.value)}
      onKeyDown={(ev) => {
        if (ev.key !== 'Enter' || ev.shiftKey || ev.nativeEvent.isComposing) return;
        // On a computer, Enter posts (Shift+Enter starts a new line). On a phone
        // or tablet, Return starts a new line and you select Post; Ctrl/⌘+Enter
        // posts anywhere.
        if (ev.ctrlKey || ev.metaKey || hasKeyboard()) {
          ev.preventDefault();
          onSubmit();
        }
      }} />
  );
}

/**
 * Comments under an open entry in a shared journal, as chat bubbles: other
 * people's on the left with their icon, yours in purple on the right. Anyone
 * in the journal can comment; you can change or delete your own, and the
 * journal's owner can delete anyone's.
 */
export function EntryComments({ entry, journal }: { entry: Entry; journal?: Journal }) {
  const { user } = useCloud();
  const { isShared, byId } = usePeople();
  const list = useComments()[entry.id] ?? [];
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ id: string; text: string }>();
  const [error, setError] = useState('');

  useEffect(() => void refreshEntryComments(entry.id), [entry.id]);
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(''), 8000);
    return () => clearTimeout(t);
  }, [error]);

  if (!user || !isShared(journal)) return null;
  const owner = !!journal && isOwnJournal(journal);
  const me = byId.get(user.id) ?? { id: user.id };

  const run = async (fn: () => Promise<void>) => {
    setError('');
    setBusy(true);
    try {
      await fn();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const post = async () => {
    if (busy || !text.trim()) return;
    const was = text;
    setText('');
    if (!(await run(() => addComment(entry.id, was)))) setText(was);
  };
  const save = async () => {
    if (!editing || busy) return;
    if (await run(() => editComment(entry.id, editing.id, editing.text))) setEditing(undefined);
  };
  const remove = async (c: CommentRow) => {
    const mine = c.user === user.id;
    const ok = await askSure({ message: mine ? 'Delete your comment?' : `Delete ${nameOf(byId.get(c.user))}'s comment?`, yes: 'Yes, delete' });
    if (ok) await run(() => deleteComment(entry.id, c.id));
  };

  return (
    <section className="comments" aria-label="Comments">
      <h3 className="comments-title">💬 Comments{list.length > 0 && ` (${list.length})`}</h3>
      {list.map((c) => {
        const mine = c.user === user.id;
        const person = mine ? me : byId.get(c.user);
        const isEditing = editing?.id === c.id;
        return (
          <div key={c.id} className={`comment ${mine ? 'mine' : ''}`}>
            {!mine && <PersonIcon id={c.user} person={person} />}
            <div className="comment-main">
              <div className="comment-who">
                {mine ? 'You' : nameOf(person)} · {when(c.at)}{c.edited && ' · edited'}
              </div>
              {isEditing ? (
                <div className="comment-edit">
                  <Box value={editing.text} onChange={(s) => setEditing({ id: c.id, text: s })} onSubmit={save} placeholder="Change your comment" autoFocus />
                  <div className="row">
                    <button type="button" className="btn ghost" onClick={() => setEditing(undefined)}>Cancel</button>
                    <button type="button" className="btn primary" disabled={busy || !editing.text.trim()} onClick={save}>Save</button>
                  </div>
                </div>
              ) : (
                <div className="comment-bubble"><Linkified text={c.body} /></div>
              )}
              {!isEditing && (mine || owner) && (
                <div className="comment-actions">
                  {mine && <button type="button" className="link-btn" onClick={() => { setError(''); setEditing({ id: c.id, text: c.body }); }}>Edit</button>}
                  <button type="button" className="link-btn" onClick={() => remove(c)}>Delete</button>
                </div>
              )}
            </div>
          </div>
        );
      })}
      <div className="comment-write">
        <PersonIcon id={user.id} person={me} />
        <Box value={text} onChange={setText} onSubmit={post} placeholder="Write a comment…" />
        <button type="button" className="btn primary" disabled={busy || !text.trim()} onClick={post}>Post</button>
      </div>
      {error && <div className="comment-error" role="alert">{error}</div>}
    </section>
  );
}
