import { useEffect, useState } from 'react';
import { APP_NAME } from './About';

/** After this long without the phone's own storage answering, offer "Try again". */
const SLOW_MS = 8000;

/**
 * Shown while the app reads this device's copy of the journal, so the screen
 * is never blank. If it takes more than about 8 seconds, it says so and offers
 * "Try again" (reopens the app). The moment the reading finishes, this goes
 * away by itself and the page shows, even after the 8 seconds.
 * `full` covers the whole screen (before the menus are drawn).
 */
export function Loading({ full }: { full?: boolean }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), SLOW_MS);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className={full ? 'splash' : 'loading-screen'} role="status">
      <img src="./icon.svg" alt="" />
      <span>{slow ? `Still opening ${APP_NAME}…` : `Opening ${APP_NAME}…`}</span>
      {slow && (
        <>
          <p className="loading-note">This is taking longer than usual. It will open by itself when it's ready, or you can try again.</p>
          <button className="btn primary" onClick={() => location.reload()}>Try again</button>
        </>
      )}
    </div>
  );
}
