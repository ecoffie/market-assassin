'use client';
import { useEffect } from 'react';

/**
 * Parks a `?ref=<code>` referral code in a first-party `mindy_ref` cookie so it survives from
 * the landing page → the user's first verified sign-in (where the referral is qualified).
 * Deliberately SEPARATE from the `gca_attr` purchase-attribution cookie (that one mirrors
 * govcon-funnels and feeds the shared purchases dashboard — don't overload it).
 *
 * First-touch: does not overwrite an existing code, so the first referrer to bring a visitor wins.
 */
export default function RefCapture() {
  useEffect(() => {
    try {
      const ref = new URLSearchParams(window.location.search).get('ref');
      if (!ref) return;
      const code = ref.trim().slice(0, 64);
      if (!code) return;
      if (document.cookie.split('; ').some((c) => c.startsWith('mindy_ref='))) return; // first-touch wins
      const oneYear = 60 * 60 * 24 * 365;
      document.cookie = `mindy_ref=${encodeURIComponent(code)}; Max-Age=${oneYear}; Path=/; SameSite=Lax`;
    } catch { /* non-fatal */ }
  }, []);
  return null;
}
