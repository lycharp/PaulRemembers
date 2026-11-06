/** True on iPhone and iPad (iPadOS says "Mac" but has a touch screen). */
export const isIPhoneOrIPad = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes('Mac') && navigator.maxTouchPoints > 1);

/**
 * On iPhone and iPad, Safari does not save a downloaded .zip by itself: it shows
 * a preview with "Open in <some app>" and "More…". This explains the extra step.
 * Shows nothing on other devices.
 */
export function IosSaveTip({ after = false }: { after?: boolean }) {
  if (!isIPhoneOrIPad()) return null;
  return (
    <div className="notice ok small">
      <span>
      <strong>{after ? 'One more step on iPhone and iPad:' : 'On iPhone and iPad there is one more step:'}</strong>{' '}
      {after ? 'your phone now shows the backup file.' : 'after you tap Download backup, your phone shows the backup file.'}{' '}
      Ignore any "Open in…" app it suggests. Tap <strong>More…</strong>, then <strong>Save to Files</strong>, pick a folder such as{' '}
      <strong>iCloud Drive</strong>, and tap <strong>Save</strong>.
      </span>
    </div>
  );
}
