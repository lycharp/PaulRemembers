/** Simple line icons (drawn, so they look the same on Windows and iPhone). */
export function Icon({ name, className = '' }: { name: 'photo' | 'paste' | 'mic' | 'stop' | 'locate'; className?: string }) {
  const parts = {
    photo: <><rect x="3" y="3" width="18" height="18" rx="4" /><circle cx="9" cy="9" r="1.8" /><path d="m21 15-4.5-4.5L6 21" /></>,
    paste: <><rect x="8" y="2" width="8" height="4" rx="1.2" /><path d="M16 4h1.5A2.5 2.5 0 0 1 20 6.5v13a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 19.5v-13A2.5 2.5 0 0 1 6.5 4H8" /><path d="M9 12.5h6M9 16.5h4" /></>,
    mic: <><rect x="9" y="2.5" width="6" height="12" rx="3" /><path d="M18.5 11a6.5 6.5 0 0 1-13 0M12 17.5V21.5" /></>,
    stop: <rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" />,
    locate: <path d="M3.5 10.8 20.5 3.5l-7.3 17-2-8.2z" strokeLinejoin="round" />,
  };
  return (
    <svg className={`icon ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {parts[name]}
    </svg>
  );
}
