'use client';

/**
 * Today — the one home screen after sign-in (behind NEXT_PUBLIC_TODAY_HOME, default OFF).
 * What it shows and where each piece comes from: src/lib/app/today-home.ts.
 * Presentational + two reads of existing APIs. Never marks the Watchlist seen.
 */
import { useEffect, useState } from 'react';
import type { AppPanel } from '../UnifiedSidebar';
import { getMIApiHeaders } from '../authHeaders';
import { MAP_SELECTED_OPP_KEY, serializeMapSelectedOpp } from '@/lib/chat/chat-handoff';
import {
  parseTodayMatches,
  parseTodaySearches,
  savedSearchLine,
  todayRequests,
  type Loadable,
  type TodayMatch,
  type TodaySearch,
} from '@/lib/app/today-home';

type Load<T> = Loadable<T> | { state: 'loading' };

export interface TodayViewProps {
  searches: Load<TodaySearch[]>;
  matches: Load<TodayMatch[]>;
  onAskMindy: (m: TodayMatch) => void;
  onOpenMap: () => void;
  onOpenWatchlist: () => void;
}

const UNAVAILABLE = 'Unavailable right now. Please refresh to try again.';

/** The render, split out so it can be tested without fetch. */
export function TodayView({ searches, matches, onAskMindy, onOpenMap, onOpenWatchlist }: TodayViewProps) {
  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6" data-testid="today-home">
      <h1 className="text-2xl font-semibold">Today</h1>

      <section aria-label="Your saved searches" data-testid="today-searches" className="rounded-xl border border-surface bg-ground p-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h2 className="text-base font-semibold">Your saved searches</h2>
          <button type="button" onClick={onOpenWatchlist} className="text-sm text-[#006aff] hover:underline">Open Watchlist</button>
        </div>
        {searches.state === 'loading' && <p className="text-sm text-muted">Loading…</p>}
        {searches.state === 'unavailable' && <p className="text-sm text-muted" data-testid="today-searches-unavailable">{UNAVAILABLE}</p>}
        {searches.state === 'ok' && searches.value.length === 0 && (
          <p className="text-sm text-muted">You have no saved searches yet. Save a search on the Map to see what is new here each day.</p>
        )}
        {searches.state === 'ok' && searches.value.length > 0 && (
          <ul className="divide-y divide-surface">
            {searches.value.map((s) => (
              <li key={s.id} className="py-2" data-testid="today-search">
                <div className="text-sm font-medium">{s.name}</div>
                <div className="text-xs text-muted">{savedSearchLine(s)}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Closing soonest" data-testid="today-matches" className="rounded-xl border border-surface bg-ground p-4">
        <h2 className="text-base font-semibold">Closing soonest</h2>
        <p className="text-xs text-muted mb-3">Open opportunities, soonest deadline first.</p>
        {matches.state === 'loading' && <p className="text-sm text-muted">Loading…</p>}
        {matches.state === 'unavailable' && <p className="text-sm text-muted" data-testid="today-matches-unavailable">{UNAVAILABLE}</p>}
        {matches.state === 'ok' && matches.value.length === 0 && (
          <p className="text-sm text-muted">No open matches to show right now.</p>
        )}
        {matches.state === 'ok' && matches.value.length > 0 && (
          <ul className="space-y-3">
            {matches.value.map((m) => (
              <li key={m.noticeId} className="flex flex-wrap items-start justify-between gap-3" data-testid="today-match">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{m.title}</div>
                  <div className="text-xs text-muted">
                    {[m.buyer, m.deadline ? `Due ${m.deadline}` : ''].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onAskMindy(m)}
                  data-tip="today-ask-mindy"
                  className="h-9 px-3 rounded-lg border border-surface text-sm font-medium hover:bg-surface"
                >
                  Ask Mindy about this
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <button
        type="button"
        onClick={onOpenMap}
        data-testid="today-open-map"
        className="h-10 px-4 rounded-lg bg-[#006aff] hover:bg-[#0057d1] text-white text-sm font-semibold"
      >
        Open the Map
      </button>
    </div>
  );
}

interface TodayPanelProps {
  email: string | null;
  onPanelChange?: (panel: AppPanel, context?: Record<string, unknown>) => void;
}

async function readJson(url: string, email: string): Promise<unknown> {
  try {
    const res = await fetch(url, { headers: getMIApiHeaders(email) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export default function TodayPanel({ email, onPanelChange }: TodayPanelProps) {
  const [searches, setSearches] = useState<Load<TodaySearch[]>>({ state: 'loading' });
  const [matches, setMatches] = useState<Load<TodayMatch[]>>({ state: 'loading' });

  useEffect(() => {
    if (!email) return;
    let cancelled = false;
    const urls = todayRequests(email);
    void readJson(urls.searches, email).then((j) => { if (!cancelled) setSearches(parseTodaySearches(j)); });
    void readJson(urls.matches, email).then((j) => { if (!cancelled) setMatches(parseTodayMatches(j)); });
    return () => { cancelled = true; };
  }, [email]);

  return (
    <TodayView
      searches={searches}
      matches={matches}
      onAskMindy={(m) => {
        // The existing Map → Ask Mindy handoff: chat attaches this notice on mount (never auto-sends).
        try {
          sessionStorage.setItem(MAP_SELECTED_OPP_KEY, serializeMapSelectedOpp({ notice_id: m.noticeId, title: m.title, deadline: m.deadline }));
        } catch { /* sessionStorage unavailable: chat opens without the chip */ }
        onPanelChange?.('chat');
      }}
      onOpenMap={() => onPanelChange?.('map')}
      onOpenWatchlist={() => onPanelChange?.('watchlist')}
    />
  );
}
