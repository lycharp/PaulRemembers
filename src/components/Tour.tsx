import { useCallback, useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { getSetting, setSetting } from '../db';
import { go } from '../util';

interface Step {
  /** CSS selector of what to point at; the first visible match is used. None = a card in the middle. */
  target?: string;
  title: string;
  text: string;
}

const STEPS: Step[] = [
  { title: 'Welcome to Paul Remembers 👋', text: 'Here is a quick look around. It takes about a minute. Use Next and Back, or press Esc to stop any time.' },
  { target: '[data-tour="new"]', title: 'Write something', text: 'Start a new entry here. You can add a title, your words, photos, videos, a voice recording, a place and a mood. On a keyboard, Ctrl+N does the same.' },
  { target: '[data-tour="nav-/"]', title: 'Your journal', text: 'All your entries, newest first. Use the search box and filters at the top to find old memories.' },
  { target: '[data-tour="nav-/calendar"]', title: 'Calendar', text: 'See which days you wrote on, and tap a day to read it.' },
  { target: '[data-tour="nav-/insights"]', title: 'Insights', text: 'Your writing streaks, "On this day" memories from past years, and the places you have been.' },
  { target: '[data-tour="journals"]', title: 'Journals', text: 'Keep separate journals, like Travel or Family. Click one to open it. The app remembers the last journal you were in and opens it next time.' },
  { target: '[data-tour="nav-/import"]', title: 'Import', text: 'Bring in entries exported from Apple\'s Journal app on your iPhone. Entries you already have are skipped.' },
  { target: '[data-tour="nav-/settings"]', title: 'Settings', text: 'Backups, a passcode lock, sharing a journal with family, and installing the app on Windows, Mac, iPhone or Android.' },
  { target: '[data-tour="account"]', title: 'Your account', text: 'Signed in, your journal is saved online and shows up on your other computers and your phone.' },
  { target: '[data-tour="nav-/help"]', title: 'Help', text: 'Answers to common questions live here, and you can take this tour again whenever you like.' },
  { title: 'That is it!', text: 'Enjoy remembering. Click the PoquitoWare logo any time to learn who made this.' },
];

// ─── Start the tour from anywhere ───────────────────────────────────────────

let open = false;
const listeners = new Set<() => void>();
const setOpen = (v: boolean) => {
  open = v;
  listeners.forEach((l) => l());
};
export const startTour = () => setOpen(true);
const useTourOpen = () => useSyncExternalStore((cb) => (listeners.add(cb), () => listeners.delete(cb)), () => open);

function visible(selector?: string): Element | null {
  if (!selector) return null;
  for (const el of document.querySelectorAll(selector)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

/** Shows the tour when started, and once by itself the first time the app is used. */
export function Tour({ autoStart }: { autoStart: boolean }) {
  const isOpen = useTourOpen();

  useEffect(() => {
    if (!autoStart) return;
    getSetting<boolean>('tourSeen').then((seen) => {
      if (!seen) setTimeout(startTour, 600);
    });
  }, [autoStart]);

  if (!isOpen) return null;
  return <TourSteps onEnd={() => (setOpen(false), void setSetting('tourSeen', true))} />;
}

function TourSteps({ onEnd }: { onEnd: () => void }) {
  // Skip steps whose button is hidden on this screen size (e.g. journals on a phone).
  const [steps] = useState(() => STEPS.filter((s) => !s.target || visible(s.target)));
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = steps[i];

  const measure = useCallback(() => {
    const el = visible(step.target);
    setRect(el ? el.getBoundingClientRect() : null);
  }, [step]);

  useLayoutEffect(() => {
    visible(step.target)?.scrollIntoView({ block: 'nearest' });
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [measure, step]);

  const next = () => (i < steps.length - 1 ? setI(i + 1) : onEnd());
  const back = () => setI(Math.max(0, i - 1));

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onEnd();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') back();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  const pad = 6;
  const W = Math.min(340, window.innerWidth - 32);
  let cardStyle: React.CSSProperties;
  if (!rect) {
    cardStyle = { left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: W };
  } else if (rect.right + 16 + W < window.innerWidth) {
    // Room to the right (the sidebar on a computer).
    cardStyle = { left: rect.right + 16, top: Math.max(16, Math.min(rect.top - 8, window.innerHeight - 260)), width: W };
  } else if (rect.top > window.innerHeight / 2) {
    // Near the bottom (the bar on a phone): show above it.
    cardStyle = { left: Math.max(16, Math.min(rect.left + rect.width / 2 - W / 2, window.innerWidth - W - 16)), bottom: window.innerHeight - rect.top + 16, width: W };
  } else {
    cardStyle = { left: Math.max(16, Math.min(rect.left, window.innerWidth - W - 16)), top: rect.bottom + 16, width: W };
  }

  return (
    <div className="tour" role="dialog" aria-label="Guided tour">
      {rect ? (
        <div className="tour-spot" style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }} />
      ) : (
        <div className="tour-dim" />
      )}
      <div className="tour-card card pad" style={cardStyle}>
        <h3>{step.title}</h3>
        <p>{step.text}</p>
        <div className="tour-foot">
          <span className="muted small">{i + 1} of {steps.length}</span>
          <div className="row">
            {i === 0 ? <button className="btn ghost" onClick={onEnd}>Skip</button> : <button className="btn ghost" onClick={back}>Back</button>}
            <button className="btn primary" autoFocus onClick={next}>{i === steps.length - 1 ? 'Done' : 'Next'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Go to the journal and start the tour (used by the Help page). */
export function goAndStartTour() {
  go('/');
  setTimeout(startTour, 150);
}
