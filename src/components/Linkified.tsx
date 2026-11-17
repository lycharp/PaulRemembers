import type { ReactNode } from 'react';
import { Icon } from './Icon';

// Web addresses in text: https://…, http://…, or www.…
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"]+/gi;

/** The short site name for a link, e.g. "youtube.com" for https://www.youtube.com/watch?v=… */
function siteName(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

/**
 * Shows text with any web addresses turned into short "🔗 site name" pills.
 * Normally each pill is a link that opens in a new tab. With `plain` (the journal
 * list, where the whole card opens the entry) it is just a label. With `limit`,
 * the text is cut to about that many visible characters (a pill counts as its
 * short name, and is never cut in half) and ends with "…".
 */
export function Linkified({ text, plain, limit }: { text: string; plain?: boolean; limit?: number }) {
  const parts: ReactNode[] = [];
  let shown = 0; // visible characters so far
  let cut = false;
  const addText = (s: string) => {
    if (limit !== undefined && shown + s.length > limit) {
      parts.push(s.slice(0, Math.max(0, limit - shown)));
      shown = limit;
      cut = true;
      return;
    }
    parts.push(s);
    shown += s.length;
  };
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    // Leave trailing punctuation (a full stop, comma, closing bracket…) out of the link.
    let url = m[0];
    while (/[.,;:!?'")\]}]$/.test(url)) {
      const ch = url.slice(-1);
      const open = { ')': '(', ']': '[', '}': '{' }[ch];
      if (open && url.split(open).length > url.split(ch).length - 1) break; // keep balanced brackets, e.g. Wikipedia links
      url = url.slice(0, -1);
    }
    const start = m.index ?? 0;
    if (start > last) addText(text.slice(last, start));
    if (cut) break;
    const href = /^https?:/i.test(url) ? url : `https://${url}`;
    const label = siteName(href) || url;
    if (limit !== undefined && shown + label.length > limit) { cut = true; break; }
    const inner = <><Icon name="link" className="inline-icon" /> {label}</>;
    parts.push(plain
      ? <span key={start} className="entry-link" title={href}>{inner}</span>
      : <a key={start} className="entry-link" href={href} target="_blank" rel="noopener noreferrer" title={href}>{inner}</a>);
    shown += label.length + 2;
    last = start + url.length;
  }
  if (!cut && last < text.length) addText(text.slice(last));
  if (cut) parts.push('…');
  return <>{parts}</>;
}
