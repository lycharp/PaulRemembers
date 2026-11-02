import { useId, useState } from 'react';
import { Dialog } from './Sharing';

export const APP_NAME = 'PaulRemembers';
export const APP_VERSION = '1.0';

/** The PoquitoWare hummingbird. */
export function PoquitoLogo({ size = 40 }: { size?: number }) {
  const grad = useId();
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} role="img" aria-label="PoquitoWare hummingbird logo" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id={grad} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff9a3c" />
          <stop offset="1" stopColor="#e5365f" />
        </linearGradient>
      </defs>
      <circle cx="60" cy="60" r="58" fill={`url(#${grad})`} />
      <path d="M31 72 L14 86 L38 80 Z" fill="#fff" opacity=".9" />
      <path d="M30 72 C36 52 60 46 76 54 C86 59 88 68 82 74 C72 86 48 90 30 72 Z" fill="#fff" />
      <circle cx="80" cy="53" r="10" fill="#fff" />
      <path d="M89 51 L110 43" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" />
      <path d="M50 58 C44 36 58 22 80 20 C78 36 70 50 60 62 Z" fill="#ffd9b0" />
      <circle cx="83" cy="51" r="2.2" fill="#3a1020" />
    </svg>
  );
}

export function AboutBox({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="About" onClose={onClose}>
      <div className="about">
        <PoquitoLogo size={96} />
        <h3>{APP_NAME}</h3>
        <p className="brand-line">Brought to you by PoquitoWare</p>
        <p>Version {APP_VERSION}</p>
        <p className="small">
          <a href={`${import.meta.env.BASE_URL}privacy.html`} target="_blank" rel="noreferrer">Privacy Policy</a>
          {' · '}
          <a href={`${import.meta.env.BASE_URL}terms.html`} target="_blank" rel="noreferrer">Terms of Service</a>
        </p>
        <p className="muted small">&copy; {new Date().getFullYear()} PoquitoWare. All rights reserved.</p>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn primary" onClick={onClose}>Close</button>
      </div>
    </Dialog>
  );
}

/** "Brought to you by PoquitoWare", opening the About box. */
export function PoquitoBadge({ className = '' }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={`poquito-badge ${className}`} onClick={() => setOpen(true)} title="About">
        <PoquitoLogo size={28} />
        <span>Brought to you by <strong>PoquitoWare</strong></span>
      </button>
      {open && <AboutBox onClose={() => setOpen(false)} />}
    </>
  );
}
