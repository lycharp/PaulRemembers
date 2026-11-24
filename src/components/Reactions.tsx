import { useEffect, useRef, useState } from 'react';
import type { Entry, Journal } from '../db';
import { useCloud } from '../cloud/cloud';
import { nameOf, usePeople } from '../cloud/people';
import { REACTION_LABEL, REACTIONS, refreshEntryReactions, summarize, toggleReaction, useReactions, type Reaction } from '../cloud/reactions';
import { PersonIcon } from './People';

/** Counts on a journal card, next to the date. Just for looking: the card still opens the entry. */
export function CardReactions({ entry, journal }: { entry: Entry; journal?: Journal }) {
  const { user } = useCloud();
  const { isShared } = usePeople();
  const map = useReactions();
  const groups = summarize(map[entry.id], user?.id);
  if (!groups.length || !isShared(journal)) return null;
  return (
    <span className="card-reactions" aria-label="Reactions">
      {groups.map((g) => (
        <span key={g.emoji} className={`card-reaction ${g.mine ? 'mine' : ''}`}>{g.emoji} {g.people.length}</span>
      ))}
    </span>
  );
}

/**
 * The reactions row under an open entry in a shared journal. Select an emoji
 * to add yours, select it again to take it off. Resting the mouse on one (or
 * pressing and holding it on a phone) shows who chose it.
 */
export function EntryReactions({ entry, journal }: { entry: Entry; journal?: Journal }) {
  const { user } = useCloud();
  const { isShared, byId } = usePeople();
  const map = useReactions();
  const [picking, setPicking] = useState(false);
  const [who, setWho] = useState<{ emoji: Reaction; right: boolean; touch: boolean }>();
  const [error, setError] = useState('');
  const rowRef = useRef<HTMLDivElement>(null);
  const hold = useRef<number>(undefined);
  const held = useRef(false);

  // Fetch the latest reactions for this entry when it opens.
  useEffect(() => void refreshEntryReactions(entry.id), [entry.id]);

  // A tap anywhere else closes the picker and the "who" box.
  useEffect(() => {
    if (!picking && !who) return;
    const close = (ev: PointerEvent) => {
      if (rowRef.current?.contains(ev.target as Node)) return;
      setPicking(false);
      setWho(undefined);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [picking, who]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(''), 6000);
    return () => clearTimeout(t);
  }, [error]);

  if (!user || !isShared(journal)) return null;
  const groups = summarize(map[entry.id], user.id);

  const toggle = (emoji: Reaction) => {
    setError('');
    toggleReaction(entry.id, emoji).catch((e: Error) => setError(e.message));
  };
  const showWho = (emoji: Reaction, el: HTMLElement, touch: boolean) => {
    const row = rowRef.current?.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    // Near the right edge, the box opens leftwards so it stays on screen.
    setWho({ emoji, touch, right: !!row && r.left - row.left > row.width / 2 });
  };
  const nameFor = (id: string) => (id === user.id ? 'You' : nameOf(byId.get(id)));
  // You first, then everyone else in the order they reacted.
  const order = (ids: string[]) => [...ids.filter((id) => id === user.id), ...ids.filter((id) => id !== user.id)];

  return (
    <div className="reactions" ref={rowRef}>
      {groups.map((g) => (
        <span key={g.emoji} className="reaction-wrap">
          <button
            type="button"
            className={`reaction ${g.mine ? 'mine' : ''}`}
            aria-pressed={g.mine}
            aria-label={`${g.emoji} ${g.people.length}: ${order(g.people).map(nameFor).join(', ')}. ${g.mine ? 'Select to remove yours' : 'Select to add yours'}`}
            onPointerEnter={(ev) => ev.pointerType === 'mouse' && showWho(g.emoji, ev.currentTarget, false)}
            onPointerLeave={(ev) => ev.pointerType === 'mouse' && who && !who.touch && setWho(undefined)}
            onPointerDown={(ev) => {
              if (ev.pointerType === 'mouse') return;
              held.current = false;
              const el = ev.currentTarget;
              clearTimeout(hold.current);
              hold.current = window.setTimeout(() => {
                held.current = true;
                showWho(g.emoji, el, true);
              }, 450);
            }}
            onPointerUp={() => clearTimeout(hold.current)}
            onPointerCancel={() => clearTimeout(hold.current)}
            onContextMenu={(ev) => ev.preventDefault()}
            onClick={() => {
              // Letting go after press-and-hold only shows who; it doesn't change your reaction.
              if (held.current) {
                held.current = false;
                return;
              }
              setWho(undefined);
              toggle(g.emoji);
            }}
          >
            {g.emoji} <span className="reaction-count">{g.people.length}</span>
          </button>
          {who?.emoji === g.emoji && (
            <div className={`reaction-who ${who.right ? 'right' : ''}`} role="tooltip">
              <div className="reaction-who-title">{g.emoji} {REACTION_LABEL[g.emoji]}</div>
              {order(g.people).map((id) => (
                <div key={id} className="reaction-person">
                  <PersonIcon id={id} person={byId.get(id)} />
                  <span>{nameFor(id)}</span>
                </div>
              ))}
            </div>
          )}
        </span>
      ))}
      {picking ? (
        <span className="reaction-picker" role="group" aria-label="Choose a reaction">
          {REACTIONS.map((emoji) => {
            const mine = groups.some((g) => g.emoji === emoji && g.mine);
            return (
              <button key={emoji} type="button" className={mine ? 'mine' : ''} aria-pressed={mine} title={mine ? 'Remove your reaction' : 'React'}
                onClick={() => {
                  setPicking(false);
                  toggle(emoji);
                }}>
                {emoji}
              </button>
            );
          })}
        </span>
      ) : (
        <button type="button" className="reaction-add" title="Add a reaction" aria-label="Add a reaction" onClick={() => { setWho(undefined); setPicking(true); }}>
          ☺ +
        </button>
      )}
      {error && <div className="reaction-error" role="alert">{error}</div>}
    </div>
  );
}
