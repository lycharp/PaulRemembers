import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db } from '../db';
import { useMediaUrl } from '../util';

export function MediaTile({ id, onOpen, onRemove }: { id: string; onOpen?: () => void; onRemove?: () => void }) {
  const media = useLiveQuery(() => db.media.get(id), [id]);
  const url = useMediaUrl(id);
  const [failed, setFailed] = useState(false);
  if (!media || !url) return <div className="tile tile-loading" />;
  return (
    <div className={`tile tile-${media.kind}`}>
      {failed ? (
        <VideoFallback url={url} />
      ) : media.kind === 'video' ? (
        <video src={url} preload="metadata" muted onClick={onOpen} onError={() => setFailed(true)} />
      ) : media.kind === 'audio' ? (
        <div className="tile-audio-inner">
          <span aria-hidden>🎙️</span>
          <audio src={url} controls />
        </div>
      ) : (
        <img src={url} alt={media.caption ?? ''} loading="lazy" onClick={onOpen} />
      )}
      {media.kind === 'video' && !failed && <span className="tile-badge" onClick={onOpen}>▶</span>}
      {media.caption && <span className="tile-caption">{media.caption}</span>}
      {onRemove && (
        <button className="tile-remove" title="Remove" onClick={onRemove}>
          ×
        </button>
      )}
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
    <div className="video-fallback">
      <span>🎬 This video can't play in this browser yet.</span>
      <a href="ms-windows-store://pdp/?ProductId=9N4WGH0Z6VHQ">Get HEVC Video Extensions</a>
      <a href={url} download="video.mov">Download video</a>
    </div>
  );
}
