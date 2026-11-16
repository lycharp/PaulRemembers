import { useLiveQuery } from 'dexie-react-hooks';
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { db, type Media } from '../db';
import { useMediaUrl } from '../util';
import { backfillPoster } from '../poster';

/** A video's snapshot: the saved one, or one made now for a video added before snapshots existed. */
function usePoster(media: Media | undefined) {
  const [made, setMade] = useState<string>();
  const needs = media?.kind === 'video' && !media.poster;
  useEffect(() => {
    if (!needs || !media) return;
    let live = true;
    backfillPoster(media).then((p) => live && setMade(p));
    return () => {
      live = false;
    };
  }, [needs, media?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return media?.poster ?? made;
}

/** Width ÷ height. 0 marks an item (audio) that takes a full-width strip of its own. */
type OnRatio = (ratio: number) => void;

interface TileProps {
  style?: CSSProperties;
  onRatio?: OnRatio;
  onOpen?: () => void;
  onRemove?: () => void;
  /** Card thumbnails: audio shows as an icon instead of a player. */
  compact?: boolean;
}

export function MediaTile({ id, ...rest }: TileProps & { id: string }) {
  // null: this device has no such file (e.g. a recording that came out empty and never synced).
  const media = useLiveQuery(async () => (await db.media.get(id)) ?? null, [id]);
  const url = useMediaUrl(id);
  const poster = usePoster(media ?? undefined);
  if (media === null) return <MissingTile {...rest} />;
  if (!media || !url) return <div className="tile tile-loading" style={rest.style} />;
  return <TileBody kind={media.kind} url={url} poster={poster} caption={media.caption} {...rest} />;
}

/** A short strip saying the file isn't here, with the usual × while editing so it can be removed. */
function MissingTile({ style, onRatio, onRemove }: TileProps) {
  useEffect(() => onRatio?.(0), []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="tile tile-missing tile-strip" style={style}>
      <span className="muted small">This item isn’t on this device.</span>
      {onRemove && (
        <button className="tile-remove" title="Remove" onClick={(e) => (e.stopPropagation(), onRemove())}>×</button>
      )}
    </div>
  );
}

/** A tile for media that is not saved yet (picked in the editor). */
export function PendingTile({ media, ...rest }: TileProps & { media: Media }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    const u = URL.createObjectURL(media.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [media]);
  if (!url) return <div className="tile tile-loading" style={rest.style} />;
  return <TileBody kind={media.kind} url={url} poster={media.poster} caption={media.caption} {...rest} />;
}

function TileBody({ kind, url, poster, caption, style, onRatio, onOpen, onRemove, compact }: TileProps & { kind: Media['kind']; url: string; poster?: string; caption?: string }) {
  const [failed, setFailed] = useState(false);
  const audio = kind === 'audio';
  useEffect(() => {
    if (audio) onRatio?.(compact ? 1 : 0);
    else if (failed && !poster) onRatio?.(16 / 9);
  }, [audio, compact, failed, poster]); // eslint-disable-line react-hooks/exhaustive-deps
  const open = onOpen && ((e: React.MouseEvent) => (e.stopPropagation(), onOpen()));
  return (
    <div className={`tile tile-${kind} ${audio && !compact ? 'tile-strip' : ''} ${onOpen ? 'zoomable' : ''}`} style={style}>
      {kind === 'video' && poster ? (
        <img src={poster} alt={caption ?? ''} onClick={open}
          onLoad={(e) => e.currentTarget.naturalHeight && onRatio?.(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)} />
      ) : failed ? (
        // Only Windows needs the codec help; elsewhere keep a plain tile that still opens the video.
        isWindows ? <VideoFallback url={url} /> : <div className="tile-video-blank" onClick={open} />
      ) : kind === 'video' ? (
        <video src={url} preload="metadata" muted playsInline onClick={open}
          onLoadedMetadata={(e) => e.currentTarget.videoHeight && onRatio?.(e.currentTarget.videoWidth / e.currentTarget.videoHeight)}
          onError={() => setFailed(true)} />
      ) : audio ? (
        compact ? <div className="tile-audio-icon">🎙️</div> : (
          <div className="tile-audio-inner">
            <span aria-hidden>🎙️</span>
            <audio src={url} controls />
          </div>
        )
      ) : (
        <img src={url} alt={caption ?? ''} loading="lazy" onClick={open}
          onLoad={(e) => e.currentTarget.naturalHeight && onRatio?.(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)} />
      )}
      {kind === 'video' && (poster || !failed || !isWindows) && <span className="tile-badge" onClick={open}>▶</span>}
      {caption && <span className="tile-caption">{caption}</span>}
      {onRemove && (
        <button className="tile-remove" title="Remove" onClick={(e) => (e.stopPropagation(), onRemove())}>
          ×
        </button>
      )}
    </div>
  );
}

const GAP = 4;
const DEFAULT_RATIO = 4 / 3;

/**
 * Lays photos and videos out in rows that keep each item's real shape, so
 * nothing is cropped and rows grow as the window widens. Rows are filled
 * until they would get shorter than `rowHeight`; the last row is never
 * taller than `maxHeight`. With `singleRow`, everything goes in one row.
 */
export function Gallery({ ids, rowHeight = 260, maxHeight = 560, singleRow = false, className = '', children }: {
  ids: string[];
  rowHeight?: number;
  maxHeight?: number;
  singleRow?: boolean;
  className?: string;
  children: (id: string, index: number, tile: { style: CSSProperties; onRatio: OnRatio }) => ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [ratios, setRatios] = useState<Record<string, number>>({});

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rows = useMemo(() => {
    // On narrow screens aim for shorter rows so more than one photo fits.
    const target = Math.min(rowHeight, width * 0.4);
    const out: { items: { id: string; index: number; ratio: number }[]; height: number }[] = [];
    let row: { id: string; index: number; ratio: number }[] = [];
    const heightFor = (r: typeof row) => (width - GAP * (r.length - 1)) / r.reduce((n, x) => n + x.ratio, 0);
    const flush = (h: number) => {
      if (row.length) out.push({ items: row, height: h });
      row = [];
    };
    ids.forEach((id, index) => {
      const ratio = ratios[id] ?? DEFAULT_RATIO;
      if (ratio === 0) {
        flush(Math.min(heightFor(row), maxHeight));
        out.push({ items: [{ id, index, ratio: 0 }], height: 0 });
        return;
      }
      row.push({ id, index, ratio });
      if (!singleRow && heightFor(row) <= target) flush(heightFor(row));
    });
    flush(Math.min(heightFor(row), maxHeight));
    return out;
  }, [ids, ratios, width, rowHeight, maxHeight, singleRow]);

  return (
    <div ref={ref} className={`gallery ${className}`}>
      {width > 0 && rows.map((r, ri) => (
        <div key={ri} className="gallery-row" style={{ gap: GAP }}>
          {r.items.map(({ id, index, ratio }) =>
            <Fragment key={id}>
              {children(id, index, {
                style: ratio === 0 ? { width: '100%' } : { width: Math.floor(ratio * r.height), height: Math.floor(r.height) },
                onRatio: (x) => setRatios((m) => (Math.abs((m[id] ?? -1) - x) < 0.001 ? m : { ...m, [id]: x })),
              })}
            </Fragment>
          )}
        </div>
      ))}
    </div>
  );
}

/** Full-screen viewer for photos and videos, with arrow-key navigation. */
export function Lightbox({ ids, start, onClose }: { ids: string[]; start: number; onClose: () => void }) {
  const [i, setI] = useState(start);
  const media = useLiveQuery(() => db.media.get(ids[i]), [ids, i]);
  const url = useMediaUrl(ids[i]);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [i]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') setI((n) => Math.min(ids.length - 1, n + 1));
      if (e.key === 'ArrowLeft') setI((n) => Math.max(0, n - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ids.length, onClose]);
  return (
    <div className="lightbox" onClick={onClose}>
      <div className="lightbox-inner" onClick={(e) => e.stopPropagation()}>
        {media && url && (failed ? <VideoFallback url={url} /> : media.kind === 'video' ? <video src={url} poster={media.poster} controls autoPlay playsInline onError={() => setFailed(true)} /> : media.kind === 'audio' ? <audio src={url} controls autoPlay /> : <img src={url} alt="" />)}
        {media?.caption && <div className="lightbox-caption">{media.caption}</div>}
      </div>
      <button className="lightbox-close" onClick={onClose} aria-label="Close">×</button>
      {i > 0 && <button className="lightbox-nav prev" onClick={(e) => (e.stopPropagation(), setI(i - 1))} aria-label="Previous">‹</button>}
      {i < ids.length - 1 && <button className="lightbox-nav next" onClick={(e) => (e.stopPropagation(), setI(i + 1))} aria-label="Next">›</button>}
    </div>
  );
}

export function Thumb({ id }: { id?: string }) {
  const media = useLiveQuery(() => (id ? db.media.get(id) : undefined), [id]);
  const url = useMediaUrl(id);
  const poster = usePoster(media);
  if (!id || !url || !media) return null;
  if (media.kind === 'video') return poster ? <img className="thumb" src={poster} alt="" /> : <video className="thumb" src={url} preload="metadata" muted playsInline />;
  if (media.kind === 'audio') return <div className="thumb thumb-audio">🎙️</div>;
  return <img className="thumb" src={url} alt="" loading="lazy" />;
}

/**
 * iPhone videos are usually HEVC. Edge and Chrome on Windows play them once the
 * free "HEVC Video Extensions" codec is installed; until then offer the file.
 */
const isWindows = /Windows/i.test(navigator.userAgent);

function VideoFallback({ url }: { url: string }) {
  return (
    <div className="video-fallback" onClick={(e) => e.stopPropagation()}>
      <span>🎬 This video can't play in this browser{isWindows ? ' yet' : ''}.</span>
      {isWindows && <a href="ms-windows-store://pdp/?ProductId=9N4WGH0Z6VHQ">Get HEVC Video Extensions</a>}
      <a href={url} download="video.mov">Download video</a>
    </div>
  );
}

/** Under an entry being read: the recording's transcript, if any, with Copy text. */
export function AudioTranscript({ id }: { id: string }) {
  const media = useLiveQuery(() => db.media.get(id), [id]);
  const text = media?.kind === 'audio' ? media.transcript : undefined;
  if (!text) return null;
  return (
    <div className="transcript">
      <div className="row">
        <strong className="grow">🎙️ Transcript</strong>
        <CopyButton text={text} />
      </div>
      <p>{text}</p>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return <button type="button" className="btn small" onClick={copy}>{copied ? 'Copied ✓' : 'Copy text'}</button>;
}

/**
 * While editing an entry: transcribe a recording, redo or delete the transcript,
 * copy it, or add it to the entry's text. Changes are kept only when the entry is
 * saved (Done), like any other edit. `value` is the edited transcript, if changed.
 */
export function EditTranscript({ id, pending, value, onChange, onBusy, onAddToEntry }: {
  id: string;
  /** A recording made in this edit, not saved yet. */
  pending?: Media;
  value: string | undefined;
  onChange: (text: string) => void;
  onBusy: (busy: boolean) => void;
  onAddToEntry: (text: string) => void;
}) {
  const saved = useLiveQuery(() => (pending ? undefined : db.media.get(id)), [id, pending]);
  const media = pending ?? saved;
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [added, setAdded] = useState(false);
  if (!media || media.kind !== 'audio') return null;
  const text = value ?? media.transcript ?? '';

  const run = async () => {
    setError('');
    setAdded(false);
    onBusy(true);
    try {
      const { transcribe } = await import('../transcribe');
      onChange((await transcribe(media.blob, setBusy)) || '(No speech found in this recording.)');
    } catch (e) {
      setError(`Could not transcribe this recording: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy('');
      onBusy(false);
    }
  };
  const hasSpeech = text && text !== '(No speech found in this recording.)';

  return (
    <div className="transcript">
      {text ? (
        <>
          <strong>🎙️ Transcript</strong>
          <div className="row transcript-tools">
            {hasSpeech && <CopyButton text={text} />}
            {hasSpeech && (
              <button type="button" className="btn small" disabled={added}
                onClick={() => { onAddToEntry(text); setAdded(true); }}>{added ? 'Added ✓' : '➕ Add to entry'}</button>
            )}
            <button type="button" className="btn small ghost" onClick={run} disabled={!!busy}>Redo</button>
            <button type="button" className="btn small ghost danger" onClick={() => setConfirmDelete(true)} disabled={!!busy}>Delete</button>
          </div>
          {confirmDelete && (
            <div className="row transcript-confirm">
              <span className="grow">Delete this transcript? The recording stays.</span>
              <button type="button" className="btn small danger" onClick={() => { setConfirmDelete(false); setAdded(false); onChange(''); }}>Delete</button>
              <button type="button" className="btn small" onClick={() => setConfirmDelete(false)}>Keep</button>
            </div>
          )}
          <p>{text}</p>
        </>
      ) : (
        <button type="button" className="btn small" onClick={run} disabled={!!busy}>📝 Transcribe recording</button>
      )}
      {busy && <p className="muted small">{busy}</p>}
      {error && <p className="error-text small">{error}</p>}
    </div>
  );
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * On a journal card: "▶ Voice note · 0:42" that plays right there, plus the first
 * line of the transcript if there is one. Clicks don't open the entry.
 */
export function VoiceNote({ id }: { id: string }) {
  const media = useLiveQuery(() => db.media.get(id), [id]);
  const url = useMediaUrl(id);
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [length, setLength] = useState(0);
  const [at, setAt] = useState(0);
  const fixing = useRef(false);
  if (!media || !url) return <div className="voice-note loading" />;

  // Chrome doesn't know a fresh recording's length until it skips to the end once.
  const findLength = (a: HTMLAudioElement) => {
    if (a.duration === Infinity) { fixing.current = true; a.currentTime = 1e9; }
    else gotLength(a);
  };
  const gotLength = (a: HTMLAudioElement) => {
    if (!Number.isFinite(a.duration) || a.duration <= 0) return;
    setLength(a.duration);
    if (fixing.current) { fixing.current = false; a.currentTime = 0; }
  };
  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    const a = ref.current;
    if (!a) return;
    if (a.paused) void a.play().catch(() => setPlaying(false));
    else a.pause();
  };
  const transcript = media.transcript?.replace(/\s+/g, ' ').trim();

  return (
    <div className="voice-note" onClick={(e) => e.stopPropagation()}>
      <audio ref={ref} src={url} preload="metadata"
        onLoadedMetadata={(e) => findLength(e.currentTarget)}
        onDurationChange={(e) => gotLength(e.currentTarget)}
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
        onEnded={(e) => { setPlaying(false); setAt(0); e.currentTarget.currentTime = 0; }}
        onTimeUpdate={(e) => playing && setAt(e.currentTarget.currentTime)} />
      <button type="button" className="voice-play" onClick={toggle} aria-label={playing ? 'Pause voice note' : 'Play voice note'}>
        {playing ? '⏸' : '▶'}
      </button>
      <div className="voice-text">
        <div className="voice-label">
          Voice note{length > 0 && <span className="muted"> · {playing || at > 0 ? `${clock(at)} / ` : ''}{clock(length)}</span>}
        </div>
        {transcript && transcript !== '(No speech found in this recording.)' && <div className="voice-transcript">“{transcript}”</div>}
      </div>
    </div>
  );
}
