'use client';

import { useEffect, useState } from 'react';

/**
 * Top announcement bar for the live Mindy Bootcamp (launch June 27).
 * Pinned above the hero on the homepage. Dismissible — the × stores a flag in
 * localStorage so a returning visitor who closed it doesn't see it again.
 *
 * Keyed by date (`mindy-bootcamp-2026-06-27`) so the NEXT event's bar shows even
 * if a user dismissed this one — change the key when the launch date changes.
 */
const DISMISS_KEY = 'mindy-bootcamp-2026-06-27';

export function BootcampBar() {
  // Start hidden; reveal after the mount check so SSR/first paint never flashes
  // a bar the user already dismissed.
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(DISMISS_KEY) !== 'dismissed') setShow(true);
    } catch {
      setShow(true); // localStorage blocked (private mode) → still show it
    }
  }, []);

  function dismiss() {
    setShow(false);
    try { localStorage.setItem(DISMISS_KEY, 'dismissed'); } catch { /* non-fatal */ }
  }

  if (!show) return null;

  return (
    <div className="relative bg-gradient-to-r from-purple-600 via-purple-500 to-blue-600">
      <a
        href="https://govcongiants.com/mindy-launch"
        target="_blank"
        rel="noopener noreferrer"
        className="block text-white text-center px-10 py-2.5 text-sm font-semibold hover:opacity-95 transition-opacity"
      >
        <span className="inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
          <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs font-bold uppercase tracking-wide">Free Live · June 27</span>
          <span>🚀 Mindy Bootcamp — see how to win federal contracts with AI, live</span>
          <span className="underline underline-offset-2">Register free →</span>
        </span>
      </a>
      <button
        onClick={dismiss}
        aria-label="Dismiss bootcamp announcement"
        className="absolute right-2 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-full text-white/80 hover:bg-white/20 hover:text-white transition-colors"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
