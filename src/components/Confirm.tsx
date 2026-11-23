import { createRoot } from 'react-dom/client';
import type { ReactNode } from 'react';
import { Dialog } from './Sharing';

export interface SureOptions {
  /** What is about to happen, in plain words. */
  message: ReactNode;
  /** The red button, e.g. "Yes, delete". */
  yes: string;
  /** Shown after "This cannot be undone." (e.g. how to get it back another way). */
  note?: ReactNode;
  /** False for the few actions that can be undone (e.g. Block). Default true. */
  final?: boolean;
}

/**
 * The app's one "Are you sure?" pop-up, used before every delete or remove.
 * Resolves true when the person presses the red button, false on Cancel,
 * ×, Escape or a press outside. Use it like the browser's confirm():
 *   if (!(await askSure({ message: 'Delete this entry?', yes: 'Yes, delete' }))) return;
 */
export function askSure(opts: SureOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = (ok: boolean) => {
      root.unmount();
      host.remove();
      resolve(ok);
    };
    root.render(<SureDialog {...opts} onAnswer={done} />);
  });
}

export function SureDialog({ message, yes, note, final = true, onAnswer }: SureOptions & { onAnswer: (ok: boolean) => void }) {
  return (
    <Dialog title="Are you sure?" onClose={() => onAnswer(false)}>
      <div className="sure-text">
        <p>{message}</p>
        {final && <p><strong>This cannot be undone.</strong>{note && <> {note}</>}</p>}
        {!final && note && <p className="muted">{note}</p>}
      </div>
      <div className="row">
        <button type="button" className="btn delete-btn" onClick={() => onAnswer(true)}>{yes}</button>
        <button type="button" className="btn ghost" onClick={() => onAnswer(false)}>Cancel</button>
      </div>
    </Dialog>
  );
}
