import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Cancel and Done that stay on screen while writing on a phone: just above the
 * keyboard when it's up, otherwise just above the bottom bar. (The ones at the
 * top of the entry scroll away, and the end of a long entry sits behind the
 * keyboard.) Phones only: hidden on wider screens by CSS.
 *
 * iPhone puts the keyboard over the page rather than shrinking it, so the bar
 * follows window.visualViewport, the part of the page you can actually see.
 */
export function EditBar({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const vv = window.visualViewport;
    const place = () => {
      const el = ref.current;
      if (!el) return;
      // How much of the bottom of the page is covered (by the keyboard).
      const covered = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
      if (covered > 80) {
        el.style.bottom = `${covered}px`;
      } else {
        const nav = document.querySelector('.sidebar') as HTMLElement | null;
        el.style.bottom = `${nav?.offsetHeight ?? 0}px`;
      }
    };
    place();
    vv?.addEventListener('resize', place);
    vv?.addEventListener('scroll', place);
    window.addEventListener('resize', place);
    return () => {
      vv?.removeEventListener('resize', place);
      vv?.removeEventListener('scroll', place);
      window.removeEventListener('resize', place);
    };
  }, []);

  return (
    // Tapping the bar mustn't take the cursor out of the text first: that would
    // drop the keyboard and move the bar out from under your finger.
    <div className="edit-bar" ref={ref} onMouseDown={(e) => e.preventDefault()}>
      {children}
    </div>
  );
}
