import { useLiveQuery } from 'dexie-react-hooks';
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { db, type Media } from '../db';
import { useMediaUrl } from '../util';

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
  const media = useLiveQuery(() => db.media.get(id), [id]);
  const url = useMediaUrl(id);
  if (!media || !url) return <div className="tile tile-loading" style={rest.style} />;
  return <TileBody kind={media.kind} url={url} caption={media.caption} {...rest} />;
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
  return <TileBody kind={media.kind} url={url} caption={media.caption} {...rest} />;
}

function TileBody({ kind, url, caption, style, onRatio, onOpen, onRemove, compact }: TileProps & { kind: Media['kind']; url: string; caption?: string }) {
  const [failed, setFailed] = useState(false);
  const audio = kind === 'audio';
  useEffect(() => {
    if (audio) onRatio?.(compact ? 1 : 0);
    else if (failed) onRatio?.(16 / 9);
  }, [audio, compact, failed]); // eslint-disable-line react-hooks/exhaustive-deps
  const open = onOpen && ((e: React.MouseEvent) => (e.stopPropagation(), onOpen()));
  return (
    <div className={`tile tile-${kind} ${audio && !compact ? 'tile-strip' : ''} ${onOpen ? 'zoomable' : ''}`} style={style}>
      {failed ? (
        <VideoFallback url={url} />
      ) : kind === 'video' ? (
        <video src={url} preload="metadata" muted onClick={open}
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
      {kind === 'video' && !failed && <span className="tile-badge" onClick={open}>▶</span>}
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
        {media && url && (media.kind === 'video' ? <video src={url} controls autoPlay /> : media.kind === 'audio' ? <audio src={url} controls autoPlay /> : <img src={url} alt="" />)}
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
  if (!id || !url || !media) return null;
  if (media.kind === 'video') return <video className="thumb" src={url} preload="metadata" muted />;
  if (media.kind === 'audio') return <div className="thumb thumb-audio">🎙️</div>;
  return <img className="thumb" src={url} alt="" loading="lazy" />;
}

/**
 * iPhone videos are usually HEVC. Edge and Chrome on Windows play them once the
 * free "HEVC Video Extensions" codec is installed; until then offer the file.
 */
function VideoFallback({ url }: { url: string }) {
  return (
    <div className="video-fallback" onClick={(e) => e.stopPropagation()}>
      <span>🎬 This video can't play in this browser yet.</span>
      <a href="ms-windows-store://pdp/?ProductId=9N4WGH0Z6VHQ">Get HEVC Video Extensions</a>
      <a href={url} download="video.mov">Download video</a>
    </div>
  );
}

/** Under an entry: turn an audio recording into text you can copy. */
export function AudioTranscript({ id, readOnly }: { id: string; readOnly?: boolean }) {
  const media = useLiveQuery(() => db.media.get(id), [id]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  // For a journal shared with you read-only, the transcript is shown but not saved.
  const [unsaved, setUnsaved] = useState<string>();
  if (!media || media.kind !== 'audio') return null;
  const text = media.transcript ?? unsaved;

  const run = async () => {
    setError('');
    try {
      const { transcribe } = await import('../transcribe');
      const result = (await transcribe(media.blob, setBusy)) || '(No speech found in this recording.)';
      if (readOnly) setUnsaved(result);
      else await db.media.update(id, { transcript: result });
    } catch (e) {
      setError(`Could not transcribe this recording: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy('');
    }
  };
  const copy = async () => {
    await navigator.clipboard.writeText(text ?? '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="transcript">
      {text ? (
        <>
          <div className="row">
            <strong className="grow">🎙️ Transcript</strong>
            <button className="btn small" onClick={copy}>{copied ? 'Copied ✓' : 'Copy text'}</button>
            <button className="btn small ghost" onClick={run} disabled={!!busy}>Redo</button>
          </div>
          <p>{text}</p>
        </>
      ) : (
        <button className="btn small" onClick={run} disabled={!!busy}>📝 Transcribe recording</button>
      )}
      {busy && <p className="muted small">{busy}</p>}
      {error && <p className="error-text small">{error}</p>}
    </div>
  );
}
