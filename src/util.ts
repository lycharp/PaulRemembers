import { useEffect, useState, useSyncExternalStore } from 'react';
import { db } from './db';

/** Tiny hash router: #/, #/entry/<id>, #/new, #/calendar, #/insights, #/import, #/settings */
const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};
export const useRoute = () =>
  useSyncExternalStore(subscribe, () => window.location.hash.replace(/^#/, '') || '/');
export const go = (path: string) => {
  window.location.hash = path;
};

/** Object URL for a stored media blob, revoked when the component unmounts. */
export function useMediaUrl(id: string | undefined) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!id) return;
    let u: string | undefined;
    let live = true;
    db.media.get(id).then((m) => {
      if (m && live) setUrl((u = URL.createObjectURL(m.blob)));
    });
    return () => {
      live = false;
      if (u) URL.revokeObjectURL(u);
    };
  }, [id]);
  return url;
}

export const fmtDay = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
export const fmtShort = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
export const fmtTime = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
export const monthKey = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
export const dayKey = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const fmtMonth = (key: string) => {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
};
export const wordCount = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

/** <input type="datetime-local"> wants local time without a zone. */
export const toLocalInput = (ms: number) => {
  const d = new Date(ms);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

export async function sha256(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const MOODS = [
  { id: 'very-pleasant', emoji: '😄', label: 'Very pleasant' },
  { id: 'pleasant', emoji: '🙂', label: 'Pleasant' },
  { id: 'neutral', emoji: '😐', label: 'Neutral' },
  { id: 'unpleasant', emoji: '🙁', label: 'Unpleasant' },
  { id: 'very-unpleasant', emoji: '😢', label: 'Very unpleasant' },
];
export const moodFor = (id?: string) => MOODS.find((m) => m.id === id);

export const PROMPTS = [
  'What made you smile today?',
  'Describe a moment from today you want to remember.',
  'Who are you grateful for right now, and why?',
  'What is something you are looking forward to?',
  'Write about a place that feels like home.',
  'What did you learn about yourself this week?',
  'Describe a favorite memory with someone you love.',
  'What is a small thing that brought you comfort lately?',
  'What would you tell yourself a year ago?',
  'What does a perfect ordinary day look like for you?',
  'Write about a photo you took recently and why you took it.',
  'What has been on your mind the most today?',
  'What is something you want to let go of?',
  'Describe the sounds and smells around you right now.',
  'What tradition means the most to you?',
];
