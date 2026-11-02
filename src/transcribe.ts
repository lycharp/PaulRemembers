/**
 * Speech-to-text for audio recordings, run entirely in the browser with
 * Whisper (via transformers.js). The model (~75 MB) downloads on first use and
 * the browser caches it; nothing about the recording leaves the computer.
 * The library is loaded only when someone transcribes, so it costs nothing otherwise.
 */
const MODEL = 'onnx-community/whisper-base';

type Asr = (audio: Float32Array, opts: Record<string, unknown>) => Promise<{ text: string } | { text: string }[]>;
let loading: Promise<Asr> | null = null;

function loadModel(onProgress: (msg: string) => void): Promise<Asr> {
  if (!loading) {
    loading = (async () => {
      const { pipeline } = await import('@huggingface/transformers');
      const files = new Map<string, { loaded: number; total: number }>();
      const asr = await pipeline('automatic-speech-recognition', MODEL, {
        dtype: 'q8',
        progress_callback: (p: { status?: string; file?: string; loaded?: number; total?: number }) => {
          if (p.status !== 'progress' || !p.file) return;
          files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
          let loaded = 0;
          let total = 0;
          files.forEach((f) => ((loaded += f.loaded), (total += f.total)));
          if (total) onProgress(`Downloading the speech model (first time only)… ${Math.round((loaded / total) * 100)}%`);
        },
      });
      return asr as unknown as Asr;
    })();
    loading.catch(() => (loading = null));
  }
  return loading;
}

/** Decode any audio the browser can play into 16 kHz mono samples, which Whisper expects. */
async function toSamples(blob: Blob): Promise<Float32Array> {
  const ctx = new AudioContext({ sampleRate: 16000 });
  try {
    const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
    if (audio.numberOfChannels === 1) return audio.getChannelData(0);
    const a = audio.getChannelData(0);
    const b = audio.getChannelData(1);
    return a.map((v, i) => (v + b[i]) / 2);
  } finally {
    void ctx.close();
  }
}

export async function transcribe(blob: Blob, onProgress: (msg: string) => void): Promise<string> {
  onProgress('Getting ready…');
  const asr = await loadModel(onProgress);
  onProgress('Listening to the recording…');
  const samples = await toSamples(blob);
  onProgress('Writing it out… (this can take a little while for long recordings)');
  const out = await asr(samples, { chunk_length_s: 30, stride_length_s: 5 });
  const text = (Array.isArray(out) ? out.map((o) => o.text).join(' ') : out.text).trim();
  return text;
}
