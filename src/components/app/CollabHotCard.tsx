'use client';

/**
 * CollabHotCard — the in-app "⭐ Best fit for you" hero.
 *
 * Surfaces the SINGLE best-matched OPEN opportunity for the active profile
 * (strongest distinctive-keyword / PSC / NAICS match, sooner deadline), with a
 * concrete reason it fits ("matches 'program management' · PSC R408"). Replaced
 * the old "most-tracked across Mindy" card (July 2026), which drew from other
 * users' tracked opps whose deadlines were ~93% expired. Tracker count is kept as
 * a secondary social-proof garnish when the opp happens to be tracked.
 *
 * Real interactive card (NOT a canvas image) so the CTA is clickable. Renders only
 * when the profile has a strong open match; otherwise nothing (best-effort, never
 * blocks the dashboard). Anonymous counts only.
 */

import { useCallback, useEffect, useState } from 'react';
import { getMIApiHeaders } from './authHeaders';
import { useAppTracker } from './track';
import type { AppPanel } from './UnifiedSidebar';
import { bestFitAction } from '@/lib/today/best-fit-link';

interface HotOpp {
  noticeId: string;
  title: string;
  agency: string | null;
  trackerCount: number;
  isSourcesSought: boolean;
  responseDeadline: string | null;
  matchReason?: string;
  message: string;
}

interface CollabHotCardProps {
  email: string | null;
  onPanelChange?: (panel: AppPanel, context?: Record<string, unknown>) => void;
}

const CTA_CLASS =
  'mt-3 inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-purple-600 to-fuchsia-600 hover:from-purple-500 hover:to-fuchsia-500 text-white text-sm font-semibold px-4 py-2 transition shadow shadow-purple-900/30';

export function CollabHotCard({ email, onPanelChange }: CollabHotCardProps) {
  const [hot, setHot] = useState<HotOpp | null>(null);
  const [hidden, setHidden] = useState(false);

  // Re-poll every 60s so the hero refreshes as the open pool / profile changes.
  // (Best-fit is profile-driven, not crowd-driven, so it changes slowly — no need
  // for the old 15s demo cadence.)
  useEffect(() => {
    if (!email) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(
          `/api/app/hot-opportunity?email=${encodeURIComponent(email)}`,
          { headers: getMIApiHeaders(email) }
        );
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled && data.hot) setHot(data.hot);
      } catch {
        // silent — card just won't render
      }
    };
    poll();
    const interval = setInterval(poll, 60000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [email]);

  const track = useAppTracker(email);

  // Sources Sought → Proposal Assist to DRAFT a response to THIS notice (unchanged
  // workflow). Any other opportunity → open EXACTLY this notice on the map via
  // ?opp=<notice_id> (see src/lib/today/best-fit-link.ts — this branch used to drop the
  // id and dump the user on the profile-wide Source Feed, "604 matches found").
  // Only an id the map cannot resolve (the demo card) falls back to the feed.
  const action = hot ? bestFitAction(hot) : null;

  const trackClick = useCallback(() => {
    if (!hot || !action) return;
    track('link_click', 'todays_intel', {
      action: 'best_fit_view',
      notice_id: hot.noticeId,
      destination: action.kind,
      is_sources_sought: hot.isSourcesSought,
    });
  }, [track, hot, action]);

  const handlePanelAction = useCallback(() => {
    if (!action) return;
    trackClick();
    if (action.kind === 'sources_sought') onPanelChange?.(action.panel, action.context);
    else if (action.kind === 'feed') onPanelChange?.(action.panel);
  }, [onPanelChange, action, trackClick]);

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
        {/* Eyebrow row: BEST FIT pill + optional Sources Sought tag + tracker garnish */}
        <div className="flex items-center gap-2 mb-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 text-amber-300 text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 ring-1 ring-amber-400/30">
            ⭐ Best fit for you
          </span>
          {hot.isSourcesSought && (
            <span className="inline-flex items-center rounded-full bg-purple-500/15 text-purple-300 text-[11px] font-semibold px-2 py-0.5 ring-1 ring-purple-400/30">
              Sources Sought
            </span>
          )}
          {hot.trackerCount > 0 && (
            <span className="ml-auto mr-7 inline-flex items-center gap-1 text-xs font-semibold text-cyan-300">
              👥 {hot.trackerCount} tracking
            </span>
          )}
        </div>

        {/* Title */}
        <h3 className="text-base md:text-lg font-bold text-white leading-snug pr-6">
          {hot.title}
        </h3>

        {/* Sub line: agency + deadline */}
        <p className="mt-1 text-xs text-muted">
          {hot.agency || 'Federal opportunity'}
          {deadline && <span className="text-faint"> · responses due {deadline}</span>}
        </p>

        {/* WHY it fits — the credibility line for "best fit". */}
        {hot.matchReason && (
          <p className="mt-2 inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-300 ring-1 ring-emerald-400/20">
            ✓ {hot.matchReason}
          </p>
        )}

        {/* Action line */}
        <p className="mt-2.5 text-sm text-slate-200">
          {hot.message}
        </p>

        {/* CTA */}
        {action?.kind === 'record' ? (
          <a
            href={action.href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={trackClick}
            data-notice-id={action.noticeId}
            className={CTA_CLASS}
          >
            View opportunity →
          </a>
        ) : (
          <button onClick={handlePanelAction} className={CTA_CLASS}>
            {action?.kind === 'sources_sought' ? 'Respond to this Sources Sought' : 'View in Source Feed'} →
          </button>
        )}
      </div>
    </div>
  );
}
