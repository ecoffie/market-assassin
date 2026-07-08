'use client';

import { useEffect, useState } from 'react';
import type { AppPanel } from './UnifiedSidebar';
import { authedFetch } from './authHeaders';
import { getActiveWorkspace, getActiveWorkspaceName, clearActiveWorkspace } from './activeWorkspace';

type ActiveClient = {
  businessName: string;
  workspaceId: string;
  profile?: { naicsCount: number; keywordCount: number; states?: string[] } | null;
  /** True once the coach API has returned the real profile. Until then we must
   *  NOT render "No profile yet" — profile is simply unknown, and flashing the
   *  alarming empty-state on every client switch reads as a bug (Eric, Jul 7). */
  enriched?: boolean;
};

export default function ClientWorkspaceBanner({
  email,
  coachModeAllowed = false,
  onPanelChange,
  activePanel,
}: {
  email: string | null;
  coachModeAllowed?: boolean;
  onPanelChange: (panel: AppPanel) => void;
  activePanel?: AppPanel;
}) {
  const [client, setClient] = useState<ActiveClient | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') {
      setClient(null);
      return;
    }
    const ws = getActiveWorkspace();
    if (!ws) {
      setClient(null);
      return;
    }

    // SAFETY: the active-workspace key drives the `x-active-workspace` header on
    // EVERY workspace-scoped request (see authHeaders.ts), so as long as it's
    // set we MUST surface it — even if coach mode isn't "allowed" or the coach
    // check fails. A stale key must never silently make you operate as a client.
    // Show the banner immediately from the key alone, then best-effort enrich
    // with the friendly client name when we're allowed to call the coach API.
    // Seed the name from the stash saved at switch time (getActiveWorkspaceName)
    // so we show "Blue Heron Consulting" immediately instead of a generic "Client"
    // flash. profile stays unknown (enriched:false) until the coach API returns.
    const stashedName = getActiveWorkspaceName();
    setClient({ businessName: stashedName || 'Client', workspaceId: ws, enriched: false });

    if (!email || !coachModeAllowed) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await authedFetch(`/api/app/coach?email=${encodeURIComponent(email)}`, email);
        const d = await res.json();
        if (cancelled || !d.isCoach) return;
        const match = (d.clients || []).find((c: { workspaceId: string }) => c.workspaceId === ws);
        if (match) {
          setClient({
            businessName: match.businessName,
            workspaceId: match.workspaceId,
            profile: match.profile,
            enriched: true,
          });
        } else if (!cancelled) {
          // Authorized coach, but this workspace isn't in their client list —
          // still mark enriched so we stop suppressing (avoids a permanent blank).
          setClient((prev) => (prev ? { ...prev, enriched: true } : prev));
        }
      } catch {
        /* keep the key-only fallback already set above */
      }
    })();

    return () => { cancelled = true; };
  }, [email, coachModeAllowed]);

  if (!client || activePanel === 'coach') return null;

  const exit = () => {
    clearActiveWorkspace();
    window.location.href = '/app';
  };

  const prof = client.profile;
  const hasProfile = !!prof && (prof.naicsCount > 0 || prof.keywordCount > 0);
  const profLine = hasProfile
    ? `${prof!.naicsCount} NAICS · ${prof!.keywordCount} keywords${prof!.states?.length ? ` · ${prof!.states.join('/')}` : ''}`
    : 'No profile yet';

  return (
    <div className="border-b border-emerald-500/30 bg-emerald-950/40 px-4 md:px-6 py-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wider text-emerald-400/80">Working as client</p>
          <p className="text-lg font-semibold text-white truncate">{client.businessName}</p>
          {coachModeAllowed ? (
            !client.enriched ? (
              // Profile not loaded yet — show a quiet placeholder, never the
              // alarming "No profile yet" (it flashed on every switch, Jul 7).
              <p className="text-xs text-slate-500 truncate">Loading profile…</p>
            ) : hasProfile ? (
              <p className="text-xs text-slate-400 truncate">{profLine}</p>
            ) : (
              // First thing to do for a brand-new client: set up their market
              // profile. Make it an action, not a dead-end hint. (Eric, Jun 23.)
              <button
                type="button"
                onClick={() => onPanelChange('settings')}
                className="mt-0.5 inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-300 hover:bg-amber-500/25"
              >
                ⚠️ No profile yet — set up their codes &amp; keywords →
              </button>
            )
          ) : (
            <p className="text-xs text-slate-400 truncate">
              Viewing {client.workspaceId} — exit to return to your own workspace
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {coachModeAllowed && (
            <>
              <span className="text-[11px] text-slate-500 mr-1 hidden sm:inline">Their workspace →</span>
              {([
                ['pipeline', 'Pipeline'],
                ['target-list', 'Target agencies'],
                ['research', 'Market research'],
              ] as const).map(([panel, label]) => (
                <button
                  key={panel}
                  type="button"
                  onClick={() => onPanelChange(panel)}
                  className="h-8 px-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-xs font-medium text-emerald-200 hover:bg-emerald-500/20"
                >
                  {label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => onPanelChange('coach')}
                className="h-8 px-3 rounded-lg border border-slate-700 text-xs text-slate-400 hover:text-white"
              >
                My Clients
              </button>
            </>
          )}
          <button
            type="button"
            onClick={exit}
            className="h-8 px-3 rounded-lg text-xs font-medium text-purple-300 hover:text-purple-200 underline"
          >
            Exit to my workspace
          </button>
        </div>
      </div>
    </div>
  );
}
