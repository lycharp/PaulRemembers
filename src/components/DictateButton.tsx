import { useEffect, useRef, useState, type RefObject } from 'react';

/*
 * 🎤 Speak-to-write button for the entry text.
 * Uses the browser's own speech recognition (Edge, Chrome, iPhone Safari).
 * Where a browser has none, the button is not shown.
 * Everything for this feature lives in this file, so it can be removed in one go.
 */

// The browser's speech recognition isn't in TypeScript's built-in types yet.
type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type RecognitionCtor = new () => Recognition;

function recognitionClass(): RecognitionCtor | undefined {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

const ERRORS: Record<string, string> = {
  'not-allowed': 'The microphone is blocked. Allow the microphone for this site in your browser settings, then try again. On iPhone, if this keeps happening, use the microphone key on the keyboard instead.',
  'service-not-allowed': 'Speaking to write is not allowed here. On iPhone, try opening the app in Safari, or use the microphone key on the keyboard instead.',
  'audio-capture': 'No microphone was found.',
  network: 'Speaking to write needs an internet connection.',
};

export function DictateButton({ target, text, onText }: {
  target: RefObject<HTMLTextAreaElement>;
  text: string;
  onText: (text: string) => void;
}) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState('');
  const rec = useRef<Recognition | null>(null);
  const textRef = useRef(text);
  textRef.current = text;

  // Stop listening if the editor closes.
  useEffect(() => () => rec.current?.abort(), []);

  const Ctor = recognitionClass();
  if (!Ctor) return null;

  const start = () => {
    setError('');
    const box = target.current;
    const current = textRef.current;
    // Words go where the cursor is (or at the end if the box wasn't selected).
    const at = box && document.activeElement === box ? box.selectionStart : current.length;
    const before = current.slice(0, at);
    const after = current.slice(at);
    const gapBefore = before && !/\s$/.test(before) ? ' ' : '';
    const gapAfter = after && !/^\s/.test(after) ? ' ' : '';

    const r = new Ctor();
    r.lang = navigator.language || 'en-US';
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      // Rebuild from every result each time, so words are never doubled up.
      let spoken = '';
      for (let i = 0; i < e.results.length; i++) spoken += e.results[i][0].transcript;
      spoken = spoken.trim();
      if (!spoken) return;
      spoken = spoken.charAt(0).toUpperCase() + spoken.slice(1);
      const start = before + gapBefore;
      onText(start + spoken + gapAfter + after);
      const pos = start.length + spoken.length;
      requestAnimationFrame(() => target.current?.setSelectionRange(pos, pos));
    };
    r.onerror = (e) => {
      if (e.error !== 'no-speech' && e.error !== 'aborted') setError(ERRORS[e.error] ?? `Speaking to write stopped (${e.error}).`);
    };
    r.onend = () => { setListening(false); rec.current = null; };
    try {
      r.start();
      rec.current = r;
      setListening(true);
    } catch (err) {
      setError(`Could not start the microphone: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const stop = () => rec.current?.stop();

  return (
    <div className="dictate">
      <button type="button" className={`dictate-btn ${listening ? 'on' : ''}`}
        // Keep the text box selected so the iPhone keyboard doesn't jump around.
        onMouseDown={(e) => e.preventDefault()}
        onClick={listening ? stop : start}
        title={listening ? 'Stop listening' : 'Speak to write'}
        aria-label={listening ? 'Stop listening' : 'Speak to write'}>
        {listening ? '⏹' : '🎤'}
      </button>
      {listening
        ? <span className="dictate-note">Listening… select ⏹ when you're done</span>
        : <span className="muted dictate-hint">Speak to write</span>}
      {error && <span className="dictate-error">{error}</span>}
    </div>
  );
}
