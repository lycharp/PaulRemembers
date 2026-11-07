import { db, isWritableJournal, type Media } from './db';

/**
 * A still picture from a video, used as its thumbnail. Browsers don't show a
 * video's first frame reliably (iPhone Safari shows a blank box), and Windows
 * can't open iPhone (HEVC) videos at all without an extra codec. So we take a
 * snapshot once, wherever the video can be opened, and save it with the video
 * (it syncs as a small JPEG), so every device can show it.
 */
export async function makePoster(blob: Blob, timeoutMs = 10000): Promise<string | undefined> {
  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('muted', '');
  video.preload = 'auto';
  // iPhone Safari only loads and draws videos that are on the page and on screen,
  // so keep it in view but invisible and behind everything.
  video.style.cssText = 'position:fixed;left:0;top:0;width:64px;height:64px;opacity:0.01;z-index:-1;pointer-events:none';
  document.body.appendChild(video);
  try {
    return await new Promise<string | undefined>((resolve) => {
      let finished = false;
      const finish = (v?: string) => {
        if (finished) return;
        finished = true;
        resolve(v);
      };
      const timer = setTimeout(() => finish(), timeoutMs);
      const grab = () => {
        try {
          const w = video.videoWidth;
          const h = video.videoHeight;
          if (!w || !h) return finish();
          const scale = Math.min(1, 640 / Math.max(w, h));
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(w * scale);
          canvas.height = Math.round(h * scale);
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          // All black: no frame decoded yet. Wait for the play fallback (or give up at the time limit).
          if (isBlank(ctx, canvas.width, canvas.height)) return;
          clearTimeout(timer);
          finish(canvas.toDataURL('image/jpeg', 0.75));
        } catch {
          clearTimeout(timer);
          finish();
        }
      };
      video.addEventListener('error', () => (clearTimeout(timer), finish()));
      video.addEventListener('seeked', () => video.readyState >= 2 && grab());
      // If seeking alone didn't give us a picture, grab one once it starts playing.
      video.addEventListener('timeupdate', () => {
        if (!finished && video.currentTime > 0 && video.readyState >= 2) {
          video.pause();
          grab();
        }
      });
      video.addEventListener('loadedmetadata', () => {
        // A moment in, so it isn't a black first frame.
        const d = Number.isFinite(video.duration) ? video.duration : 0;
        video.currentTime = Math.min(1, d * 0.25) || 0.01;
        // Some iPhones won't decode a frame until the video has started playing.
        setTimeout(() => {
          if (!finished) video.play().catch(() => {});
        }, 1500);
      });
      video.src = url;
      video.load();
    });
  } finally {
    video.removeAttribute('src');
    video.load();
    video.remove();
    URL.revokeObjectURL(url);
  }
}

function isBlank(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const px = ctx.getImageData(0, 0, w, h).data;
  const step = Math.max(4, Math.floor(px.length / 4 / 2000) * 4);
  for (let i = 0; i < px.length; i += step) if (px[i] > 12 || px[i + 1] > 12 || px[i + 2] > 12) return false;
  return true;
}

/** Snapshots made for videos this device may not save (a journal shared with you read-only). */
const unsaved = new Map<string, string>();
const tried = new Set<string>();
let chain: Promise<unknown> = Promise.resolve();

/**
 * For a video saved before snapshots existed: make one now (one video at a
 * time) and save it. Resolves to the snapshot, or undefined if this browser
 * can't open the video.
 */
export function backfillPoster(m: Media): Promise<string | undefined> {
  if (unsaved.has(m.id)) return Promise.resolve(unsaved.get(m.id));
  if (tried.has(m.id)) return Promise.resolve(undefined);
  tried.add(m.id);
  const job = chain.then(async () => {
    const poster = await makePoster(m.blob).catch(() => undefined);
    if (!poster) return undefined;
    const entry = await db.entries.get(m.entryId);
    const journal = entry && (await db.journals.get(entry.journalId));
    if (journal && isWritableJournal(journal)) await db.media.update(m.id, { poster });
    else unsaved.set(m.id, poster);
    return poster;
  });
  chain = job;
  return job;
}
