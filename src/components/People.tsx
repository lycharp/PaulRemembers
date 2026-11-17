import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getSetting, JOURNAL_COLORS, setSetting, type Entry, type Journal } from '../db';
import { go, useRoute } from '../util';
import { useCloud } from '../cloud/cloud';
import { defaultIcon, nameOf, saveProfile, usePeople, type Person } from '../cloud/people';

/** One person's icon: their emoji, or a coloured circle with their initial. */
export function PersonIcon({ person, id, size = 'small' }: { person?: Person; id: string; size?: 'small' | 'big' }) {
  const icon = person?.icon || defaultIcon(id);
  const name = nameOf(person);
  if (icon.startsWith('color:')) {
    return (
      <span className={`person-icon letter ${size}`} style={{ background: icon.slice(6) }} title={name} aria-label={name} role="img">
        {name.charAt(0).toUpperCase()}
      </span>
    );
  }
  return <span className={`person-icon emoji ${size}`} title={name} aria-label={name} role="img">{icon}</span>;
}

/**
 * The row of icons on an entry in a shared journal: whoever wrote it first,
 * then each new person who changed it. Nothing shows in a private journal.
 * With `tappable`, pressing an icon shows that person's name (phones have no hover).
 */
export function Contributors({ entry, journal, tappable }: { entry: Entry; journal?: Journal; tappable?: boolean }) {
  const { byId, isShared } = usePeople();
  const [shown, setShown] = useState<string>();
  useEffect(() => {
    if (!shown) return;
    const t = setTimeout(() => setShown(undefined), 3000);
    return () => clearTimeout(t);
  }, [shown]);
  const ids = entry.contributors ?? [];
  if (!ids.length || !isShared(journal)) return null;
  return (
    <span className="contributors">
      {ids.map((id) =>
        tappable ? (
          <button key={id} type="button" className="person-btn" onClick={() => setShown(shown === id ? undefined : id)}>
            <PersonIcon id={id} person={byId.get(id)} />
          </button>
        ) : (
          <PersonIcon key={id} id={id} person={byId.get(id)} />
        )
      )}
      {shown && <span className="contributor-name">{nameOf(byId.get(shown))}</span>}
    </span>
  );
}

const EMOJI = ['😀', '😎', '🤓', '🥳', '🤠', '👻', '🤖', '👽', '🐻', '🐶', '🐱', '🦊', '🐼', '🐸', '🦉', '🐢', '🦄', '🐝', '🌵', '🌻', '🌈', '⭐', '🔥', '🍀', '🎸', '⚽', '☕', '🍕', '🚀', '❤️'];

/** Settings: the name and icon other people see on entries you write in shared journals. */
export function ProfileCard() {
  const { user } = useCloud();
  const { byId } = usePeople();
  const me = user ? byId.get(user.id) : undefined;
  const [name, setName] = useState<string>();
  const [icon, setIcon] = useState<string>();
  const [own, setOwn] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  if (!user) return null;
  const shownName = name ?? me?.name ?? '';
  const shownIcon = icon ?? me?.icon ?? defaultIcon(user.id);
  const preview: Person = { id: user.id, email: user.email, name: shownName || undefined, icon: shownIcon };
  const pick = (i: string) => {
    setIcon(i);
    setMsg('');
  };

  const save = async () => {
    setBusy(true);
    setMsg('');
    try {
      await saveProfile(shownName, shownIcon);
      setName(undefined);
      setIcon(undefined);
      setMsg('Saved. People you share journals with will see it after their next sync.');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card pad">
      <h3>Your name and icon</h3>
      <p className="muted">In shared journals, each entry shows the icons of everyone who wrote or changed it, in order. Pick how you appear.</p>
      <div className="profile-preview">
        <PersonIcon id={user.id} person={preview} size="big" />
        <input className="text-input grow" placeholder={user.email?.split('@')[0] ?? 'Your name'} maxLength={40} value={shownName}
          onChange={(e) => { setName(e.target.value); setMsg(''); }} aria-label="Your name" />
      </div>
      <div className="icon-choices" role="group" aria-label="Pick an icon">
        {JOURNAL_COLORS.map((c) => (
          <button key={c} type="button" className={`icon-choice ${shownIcon === `color:${c}` ? 'on' : ''}`} onClick={() => pick(`color:${c}`)} title="Coloured circle with your initial">
            <PersonIcon id={user.id} person={{ ...preview, icon: `color:${c}` }} />
          </button>
        ))}
        {EMOJI.map((e) => (
          <button key={e} type="button" className={`icon-choice ${shownIcon === e ? 'on' : ''}`} onClick={() => pick(e)}>
            <PersonIcon id={user.id} person={{ ...preview, icon: e }} />
          </button>
        ))}
      </div>
      <div className="row">
        <input className="text-input" style={{ width: '9em' }} placeholder="Or type any emoji" value={own}
          onChange={(e) => {
            setOwn(e.target.value);
            // Keep just the first emoji (or character) typed or pasted.
            const first = [...new Intl.Segmenter().segment(e.target.value.trim())][0]?.segment;
            if (first) pick(first);
          }} aria-label="Type any emoji" />
        <button className="btn primary" onClick={save} disabled={busy}>Save</button>
      </div>
      {msg && <p className="small">{msg}</p>}
    </section>
  );
}

const WEEK = 7 * 24 * 60 * 60 * 1000;

/**
 * A bar for someone in a shared journal who hasn't picked a name or icon yet.
 * "Pick now" opens the Account page; "Later" hides it for a week.
 */
export function IconReminder() {
  const cloud = useCloud();
  const route = useRoute();
  const { byId, isShared } = usePeople();
  const info = useLiveQuery(async () => ({
    later: (await getSetting<number>('iconReminderLater')) ?? 0,
    journals: await db.journals.toArray(),
  }), []);
  if (!cloud.user || !info || route === '/account' || Date.now() < info.later) return null;
  const me = byId.get(cloud.user.id);
  // Not until the people list has loaded (me is in it), and only once a journal is shared.
  if (!me || me.icon || me.name || !info.journals.some((j) => isShared(j))) return null;
  return (
    <div className="update-bar" role="status">
      <span className="wrap">Pick your name and icon so others know who wrote what.</span>
      <button className="btn primary" onClick={() => go('/account')}>Pick now</button>
      <button className="link" onClick={() => setSetting('iconReminderLater', Date.now() + WEEK)}>Later</button>
    </div>
  );
}
