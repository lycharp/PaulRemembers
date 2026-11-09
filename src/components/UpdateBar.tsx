import { useEffect, useState } from 'react';

declare const __BUILD_ID__: string;
export const BUILD_ID = __BUILD_ID__;

/** Checks for a newer published version when the app opens or comes back
 *  to the front (no timer), and offers a one-tap refresh. Never reloads by
 *  itself, so a half-written entry is never lost. */
export function UpdateBar() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!import.meta.env.PROD) return;
    let busy = false;
    const check = async () => {
      if (busy || document.visibilityState !== 'visible') return;
      busy = true;
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}version.json`, { cache: 'no-store' });
        const { build } = (await res.json()) as { build?: string };
        if (build && build !== BUILD_ID) setReady(true);
      } catch {
        // Offline or not published yet: try again next time.
      } finally {
        busy = false;
      }
    };
    check();
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => {
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
    };
  }, []);

  if (!ready) return null;
  const refresh = async () => {
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      await reg?.update();
    } catch {
      // Reload anyway.
    }
    location.reload();
  };
  return (
    <div className="update-bar" role="status">
      <span>A new version is ready.</span>
      <button className="btn primary" onClick={refresh}>Refresh</button>
      <button className="link" onClick={() => setReady(false)} aria-label="Not now">Not now</button>
    </div>
  );
}

/** "9 Nov 2026" from the build id, for the About box. */
export function buildDate() {
  const d = new Date(BUILD_ID);
  return isNaN(+d) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
