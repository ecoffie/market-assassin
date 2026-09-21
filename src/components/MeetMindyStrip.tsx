'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';

/**
 * "New here? Meet Mindy" strip for PUBLIC / logged-out pages (newcomer-clarity
 * PRD). A student asked "what is Mindy?" — public pages must self-introduce the
 * product + offer a free signup. Dismissible (per-session via state).
 *
 * Auth-aware: HIDDEN for logged-in Mindy users (they reach these public pages via
 * the in-app global lookup; nagging an existing member to "Try free" is wrong).
 *
 * Drop into any public page. Links to the getmindy.ai signup.
 */
export default function MeetMindyStrip({ variant = 'banner' }: { variant?: 'banner' | 'card' }) {
  const [dismissed, setDismissed] = useState(false);
  // Suppress for signed-in Mindy users. Start hidden until we've checked, so a
  // member never sees a flash of the "Try free" acquisition CTA.
  const [hideForMember, setHideForMember] = useState(true);
  useEffect(() => {
    const loggedIn = typeof window !== 'undefined' && Boolean(
      localStorage.getItem('mi_beta_auth_token') ||
      localStorage.getItem('mi_beta_2fa_token') ||
      localStorage.getItem('mi_beta_email'),
    );
    setHideForMember(loggedIn);
  }, []);

  if (dismissed || hideForMember) return null;

  if (variant === 'card') {
    return (
      <div className="rounded-xl border border-purple-500/30 bg-gradient-to-br from-purple-950/40 to-slate-900 p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-purple-600 to-emerald-500 text-lg font-bold text-white">M</div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-white">New here? Meet Mindy.</p>
            <p className="mt-0.5 text-sm text-slate-400">
              Mindy is your 24/7 federal market intelligence analyst — it scans 24,000+ opportunities daily, scores your fit, and tells you what to bid on.
            </p>
            <Link
              href="https://getmindy.ai"
              className="mt-3 inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
            >
              Try Mindy free →
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // banner (default) — a slim top strip.
  return (
    <div className="flex items-center justify-center gap-3 border-b border-purple-500/20 bg-gradient-to-r from-purple-950/40 to-emerald-950/30 px-4 py-2.5 text-sm">
      <span className="flex h-6 w-6 items-center justify-center rounded bg-gradient-to-br from-purple-600 to-emerald-500 text-xs font-bold text-white">M</span>
      <span className="text-slate-300">
        <span className="font-semibold text-white">Mindy</span> finds federal opportunities that fit you, daily.
      </span>
      <Link href="https://getmindy.ai" className="rounded-md bg-emerald-600 px-3 py-1 font-medium text-white transition-colors hover:bg-emerald-500">
        Try free →
      </Link>
      <button onClick={() => setDismissed(true)} className="ml-1 text-slate-500 hover:text-slate-300" aria-label="Dismiss">✕</button>
    </div>
  );
}
