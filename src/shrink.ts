/**
 * The free online storage takes files up to 50 MB, and iPhone videos are often
 * bigger. Before such a video is saved, make a smaller copy (H.264 MP4, at most
 * 1280 pixels on the long side) that fits, so it can sync and be shared. The
 * copy also plays on Windows without the HEVC codec.
 *
 * Runs in the browser with WebCodecs (via mediabunny). If this browser can't
 * read or write the video, the original is kept.
 */
export const UPLOAD_LIMIT = 50 * 1024 * 1024;
/** Aim a bit below the limit: the bitrate is only a target. */
const TARGET = 42 * 1024 * 1024;
const AUDIO_BITRATE = 128_000;

export const needsShrink = (blob: Blob) => blob.size > UPLOAD_LIMIT;

export async function shrinkVideo(blob: Blob, onProgress?: (fraction: number) => void): Promise<Blob | undefined> {
  if (typeof VideoEncoder === 'undefined') return undefined;
  try {
    const mb = await import('mediabunny');
    const input = new mb.Input({ source: new mb.BlobSource(blob), formats: mb.ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    const duration = await input.computeDuration();
    if (!track || !duration) return undefined;

    const w = track.displayWidth;
    const h = track.displayHeight;
    const size = w >= h ? { width: Math.min(1280, even(w)) } : { height: Math.min(1280, even(h)) };
    // Spread the size budget over the whole video, and never more than a phone needs.
    const bitrate = Math.min(4_000_000, Math.floor((TARGET * 8) / duration - AUDIO_BITRATE));
    if (bitrate < 250_000) return undefined; // Too long to fit at any watchable quality.
    if (!(await mb.canEncodeVideo('avc', { ...guessSize(w, h, size), bitrate }))) return undefined;

    const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new mb.BufferTarget() });
    const conversion = await mb.Conversion.init({
      input,
      output,
      tracks: 'primary',
      video: { codec: 'avc', bitrate, ...size },
      // Sound is copied as it is when possible (iPhone audio already fits in MP4).
      showWarnings: false,
    });
    // Never lose the sound: if the audio couldn't be carried over, keep the original.
    const hadAudio = !!(await input.getPrimaryAudioTrack());
    const keepsAudio = conversion.utilizedTracks.some((t) => t.type === 'audio');
    if (!conversion.isValid || !conversion.utilizedTracks.some((t) => t.type === 'video') || (hadAudio && !keepsAudio)) return undefined;
    if (onProgress) conversion.onProgress = (p) => onProgress(p);
    await conversion.execute();
    const buffer = output.target.buffer;
    if (!buffer) return undefined;
    const out = new Blob([buffer], { type: 'video/mp4' });
    return out.size <= UPLOAD_LIMIT && out.size < blob.size ? out : undefined;
  } catch (e) {
    console.warn('Could not make the video smaller', e);
    return undefined;
  }
}

const even = (n: number) => n - (n % 2);
function guessSize(w: number, h: number, size: { width?: number; height?: number }) {
  if (size.width) return { width: size.width, height: even(Math.round((h * size.width) / w)) };
  return { width: even(Math.round((w * size.height!) / h)), height: size.height! };
}
