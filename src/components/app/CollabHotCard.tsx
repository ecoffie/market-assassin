'use client';

/**
 * CollabHotCard — the in-app "🔥 Hot right now" social-proof hero.
 *
 * Surfaces the SINGLE most-tracked, collab-ready opportunity across Mindy
 * ("8 contractors are researching this Sources Sought — respond together").
 * This is the big-SaaS spotlight pattern (LinkedIn "12 connections work here",
 * Booking "3 others looking"): one focal moment at the top of the dashboard,
 * paired with the ambient per-opp badge in the Alerts list.
 *
 * Real interactive card (NOT a canvas image) so the "respond together →" CTA
 * is clickable. Renders only when a hot opp clears COLLAB_THRESHOLD; otherwise
 * nothing (best-effort, never blocks the dashboard). Anonymous counts only.
 */

import { useCallback, useEffect, useState } from 'react';
import { getMIApiHeaders } from './authHeaders';
import type { AppPanel } from './UnifiedSidebar';

interface HotOpp {
  noticeId: string;
  title: string;
  agency: string | null;
  trackerCount: number;
  isSourcesSought: boolean;
  responseDeadline: string | null;
  message: string;
}

interface CollabHotCardProps {
  email: string | null;
  onPanelChange?: (panel: AppPanel) => void;
}

export function CollabHotCard({ email, onPanelChange }: CollabHotCardProps) {
  const [hot, setHot] = useState<HotOpp | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!email) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/app/hot-opportunity?email=${encodeURIComponent(email)}`,
          { headers: getMIApiHeaders(email) }
        );
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data.hot) setHot(data.hot);
      } catch {
        // silent — card just won't render
      }
    })();
    return () => { cancelled = true; };
  }, [email]);

  // Take the user to the Alerts panel (where the opp + its badge live) so they
  // can act. Falls back to a no-op if the dashboard didn't pass the handler.
  const handleRespond = useCallback(() => {
    onPanelChange?.('alerts');
  }, [onPanelChange]);

  if (hidden || !hot) return null;

  const deadline = hot.responseDeadline
    ? new Date(hot.responseDeadline).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : null;

  return (
    <div className="relative mb-6 rounded-2xl overflow-hidden border border-purple-400/20 bg-gradient-to-br from-slate-900 via-purple-950/60 to-slate-900 shadow-lg shadow-purple-900/20">
      {/* Dismiss */}
      <button
        onClick={() => setHidden(true)}
        className="absolute top-2.5 right-2.5 z-10 text-white/50 hover:text-white text-lg leading-none w-6 h-6 flex items-center justify-center rounded-full bg-black/30 hover:bg-black/50"
        aria-label="Hide"
        title="Hide for this session"
      >
        ×
      </button>

      <div className="p-4 md:p-5">
        {/* Eyebrow row: HOT pill + count */}
        <div className="flex items-center gap-2 mb-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-orange-500/15 text-orange-300 text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 ring-1 ring-orange-400/30">
            🔥 Hot right now
          </span>
          {hot.isSourcesSought && (
            <span className="inline-flex items-center rounded-full bg-purple-500/15 text-purple-300 text-[11px] font-semibold px-2 py-0.5 ring-1 ring-purple-400/30">
              Sources Sought
            </span>
          )}
          <span className="ml-auto mr-7 inline-flex items-center gap-1 text-sm font-bold text-cyan-300">
            👥 {hot.trackerCount} contractors
          </span>
        </div>

        {/* Title */}
        <h3 className="text-base md:text-lg font-bold text-white leading-snug pr-6">
          {hot.title}
        </h3>

        {/* Sub line: agency + deadline */}
        <p className="mt-1 text-xs text-slate-400">
          {hot.agency || 'Federal opportunity'}
          {deadline && <span className="text-slate-500"> · responses due {deadline}</span>}
        </p>

        {/* Social-proof line */}
        <p className="mt-2.5 text-sm text-slate-200">
          {hot.isSourcesSought
            ? "You're not the only one researching this. The more capable businesses that respond, the stronger the signal to the agency — respond together."
            : "You're not the only one pursuing this. Sharpen your response before it closes."}
        </p>

        {/* CTA */}
        <button
          onClick={handleRespond}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-purple-600 to-fuchsia-600 hover:from-purple-500 hover:to-fuchsia-500 text-white text-sm font-semibold px-4 py-2 transition shadow shadow-purple-900/30"
        >
          {hot.isSourcesSought ? 'Respond together' : 'View opportunity'} →
        </button>
      </div>
    </div>
  );
}
