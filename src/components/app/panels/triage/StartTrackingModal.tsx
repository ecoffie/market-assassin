'use client';

/**
 * StartTrackingModal — triage flow for picking your starter target agencies.
 *
 * Designed 2026-05-25 per Eric's BD principle: small contractors should
 * commit to 3-5 agencies they'll work for the next 12-18 months. The
 * old model (just buttons on every row of a 96-row table) invited
 * overtracking — users would click 20 buttons because the action was
 * cheap. This modal forces a per-agency decision (Track / Defer / Skip)
 * with rich context and a soft cap at 5 to surface the focus signal.
 *
 * Triage pattern: similar to how Front and Superhuman queue items
 * through one at a time. Each card shows the data needed to make a
 * real BD decision: spend, contracts, SAT %, pain points, open opps,
 * location, OSBP signal.
 *
 * Actions:
 *   1 / Track       → POST /api/app/triage action=track → user_target_list
 *   2 / Defer       → POST /api/app/triage action=defer → 30d cooldown
 *   3 / Skip forever → POST /api/app/triage action=skip → permanent for this NAICS profile
 *
 * Cards sorted by the parent's active sort lens (Top Total $ default).
 * Already-tracked + already-dismissed offices are filtered out before
 * the modal opens (via the GET /api/app/triage context call).
 *
 * Soft cap at 5 tracked: shows celebration banner but lets user keep
 * going. Hard cap or auto-close was rejected because some users
 * legitimately want 8-10 targets.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { authedFetch } from '../../authHeaders';

// Mirrors the AgencyTableRow shape from MarketResearchPanel. We accept
// a loose subset here so the modal stays decoupled from the parent's
// internal types (parent passes whatever rows it has).
export interface TriageAgencyCard {
  id: string;
  name: string;
  contractingOffice?: string;
  subAgency?: string;
  parentAgency?: string;
  officeId?: string;
  location?: string;
  totalSpending?: number;
  setAsideSpending?: number;
  contractCount?: number;
  satRatio?: number;
  satContractCount?: number;
  painPointCount?: number;
  openOppCount?: number;
  upcomingEventCount?: number;
  // Decision intel added 2026-05-25 (v1 card upgrade)
  avgBidders?: number | null;     // Competitive density: avg # offers per contract
  uniqueVendorCount?: number;     // Vendor diversity: distinct primes winning here
  smallBizPercent?: number | null; // SBA Goaling small-biz share (fetched client-side)
  topPrimes?: Array<{ name: string; share?: number }>; // Top 3 incumbents (client lookup)
}

interface StartTrackingModalProps {
  open: boolean;
  onClose: () => void;
  email: string | null;
  /** Comma-joined NAICS string; used to scope dismissals per profile. */
  naicsCode: string;
  /** Sorted-by-active-lens, pre-filtered list of candidate offices to triage. */
  agencies: TriageAgencyCard[];
  /** Fires after each successful action so parent can refresh its own state. */
  onAction?: (action: 'track' | 'defer' | 'skip', officeName: string) => void;
}

function formatMoney(n: number | undefined): string {
  if (!n || n <= 0) return '—';
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

export default function StartTrackingModal({
  open,
  onClose,
  email,
  naicsCode,
  agencies,
  onAction,
}: StartTrackingModalProps) {
  const [index, setIndex] = useState(0);
  const [trackedCount, setTrackedCount] = useState(0);
  const [skippedCount, setSkippedCount] = useState(0);
  const [deferredCount, setDeferredCount] = useState(0);
  const [submitting, setSubmitting] = useState<'track' | 'defer' | 'skip' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCelebration, setShowCelebration] = useState(false);

  // Reset state when modal opens with a fresh batch.
  useEffect(() => {
    if (open) {
      setIndex(0);
      setTrackedCount(0);
      setSkippedCount(0);
      setDeferredCount(0);
      setShowCelebration(false);
      setError(null);
    }
  }, [open]);

  const current = agencies[index];
  const remaining = agencies.length - index;

  const submit = useCallback(async (action: 'track' | 'defer' | 'skip') => {
    if (!current || !email || submitting) return;
    setSubmitting(action);
    setError(null);

    try {
      const res = await authedFetch('/api/app/triage', email, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          email,
          naics: naicsCode,
          office_name: current.contractingOffice || current.name,
          agency_name: current.parentAgency || current.subAgency || current.name,
          sub_agency_name: current.subAgency || null,
          track_payload: action === 'track' ? {
            office_code: current.officeId || null,
            location: current.location || null,
            set_aside_spending: current.setAsideSpending || 0,
            contract_count: current.contractCount || 0,
            sat_ratio: current.satRatio || 0,
            pain_point_count: current.painPointCount || 0,
            open_opp_count: current.openOppCount || 0,
            upcoming_event_count: current.upcomingEventCount || 0,
          } : undefined,
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }

      // Update counters
      if (action === 'track') setTrackedCount(c => c + 1);
      if (action === 'defer') setDeferredCount(c => c + 1);
      if (action === 'skip') setSkippedCount(c => c + 1);

      onAction?.(action, current.contractingOffice || current.name);

      // Soft cap celebration at 5 tracked. Show banner but allow continue.
      const nextTracked = action === 'track' ? trackedCount + 1 : trackedCount;
      if (nextTracked === 5 && !showCelebration) {
        setShowCelebration(true);
      }

      // Advance to next card
      setIndex(i => i + 1);
    } catch (err) {
      console.error('[triage] submit failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSubmitting(null);
    }
  }, [current, email, naicsCode, submitting, trackedCount, showCelebration, onAction]);

  // Keyboard shortcuts: 1 track, 2 defer, 3 skip, Esc close
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === '1') { e.preventDefault(); submit('track'); }
      else if (e.key === '2') { e.preventDefault(); submit('defer'); }
      else if (e.key === '3') { e.preventDefault(); submit('skip'); }
      else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, submit, onClose]);

  const moneyDisplay = useMemo(() => {
    if (!current) return { total: '—', setAside: '—' };
    return {
      total: formatMoney(current.totalSpending),
      setAside: formatMoney(current.setAsideSpending),
    };
  }, [current]);

  if (!open) return null;

  // End-of-list state: nothing more to triage.
  const isDone = index >= agencies.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl rounded-2xl border border-hairline bg-ground shadow-2xl">
        {/* Header — progress + close */}
        <div className="flex items-center justify-between border-b border-surface px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-white">Start Tracking Targets</h2>
            <p className="mt-0.5 text-xs text-faint">
              {isDone
                ? `Done — ${trackedCount} tracked · ${deferredCount} deferred · ${skippedCount} skipped`
                : `${index + 1} of ${agencies.length}  ·  ${trackedCount} tracked  ·  ${skippedCount} skipped  ·  ${deferredCount} deferred`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-faint hover:bg-surface hover:text-slate-200"
            aria-label="Close triage"
          >
            ✕
          </button>
        </div>

        {/* Celebration banner — appears at 5 tracked, stays for the session */}
        {showCelebration && (
          <div className="border-b border-emerald-500/30 bg-emerald-500/10 px-6 py-3 text-sm text-emerald-200">
            <span className="font-semibold">🎯 You&apos;ve got your starter list.</span>
            <span className="ml-2 text-emerald-300/80">Five focused targets beat fifty scattered ones. Keep going if you want, or hit Done below.</span>
          </div>
        )}

        {/* Body — current card OR end state */}
        {isDone ? (
          <div className="flex flex-col items-center px-6 py-12 text-center">
            <div className="mb-4 text-5xl">🎯</div>
            <h3 className="text-xl font-bold text-white">You&apos;re all caught up</h3>
            <p className="mt-2 max-w-md text-sm text-muted">
              {trackedCount === 0
                ? "You didn't track anything this round. Come back when you want to add starter targets."
                : `${trackedCount} ${trackedCount === 1 ? 'agency' : 'agencies'} now in your target list. Open My Target List to start outreach.`}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-6 rounded-lg bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500"
            >
              Done
            </button>
          </div>
        ) : current ? (
          <>
            <div className="px-6 py-5 space-y-4">
              {/* Agency identity */}
              <div>
                <div className="text-lg font-bold text-white">
                  {current.contractingOffice || current.name}
                </div>
                <div className="mt-1 text-xs text-muted">
                  {[current.subAgency, current.parentAgency]
                    .filter(Boolean)
                    .filter((v, i, arr) => arr.indexOf(v) === i)
                    .join(' · ')}
                  {current.location && (
                    <span className="ml-2 text-faint">📍 {current.location}</span>
                  )}
                </div>
                {/* Incumbents line — top 3 primes who win at this
                    office. Tells the user the competitive landscape
                    before they commit. Added 2026-05-25 v1. */}
                {current.topPrimes && current.topPrimes.length > 0 && (
                  <div className="mt-2 text-[11px] text-faint">
                    <span className="font-semibold text-muted">INCUMBENTS:</span>{' '}
                    {current.topPrimes.map((p, i) => (
                      <span key={p.name}>
                        {i > 0 && ' · '}
                        <span className="text-ink-soft">{p.name}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Money stats — Total $ + Set-Aside $ + Small Biz % */}
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border border-surface bg-ground-deep/50 p-3">
                  <div className="text-[10px] uppercase tracking-wider text-faint">Total Spend</div>
                  <div className="mt-1 text-xl font-bold text-white">{moneyDisplay.total}</div>
                  <div className="mt-0.5 text-[10px] text-slate-600">All contracts in your NAICS</div>
                </div>
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
                  <div className="text-[10px] uppercase tracking-wider text-emerald-300">Set-Aside Spend</div>
                  <div className="mt-1 text-xl font-bold text-emerald-400">{moneyDisplay.setAside}</div>
                  <div className="mt-0.5 text-[10px] text-emerald-300/60">Your business type only</div>
                </div>
                {/* Small Biz % tile — the real accessibility signal.
                    Source: SBA Goaling Report FY23 (parent agency level).
                    Honest '—' when no data. */}
                <div className={`rounded-lg border p-3 ${
                  (current.smallBizPercent ?? 0) >= 0.3
                    ? 'border-blue-500/30 bg-blue-500/5'
                    : (current.smallBizPercent ?? 0) > 0
                      ? 'border-amber-500/30 bg-amber-500/5'
                      : 'border-surface bg-ground-deep/50'
                }`}>
                  <div className="text-[10px] uppercase tracking-wider text-muted">Small Biz Share</div>
                  <div className={`mt-1 text-xl font-bold ${
                    (current.smallBizPercent ?? 0) >= 0.3
                      ? 'text-blue-400'
                      : (current.smallBizPercent ?? 0) > 0
                        ? 'text-amber-400'
                        : 'text-faint'
                  }`}>
                    {current.smallBizPercent != null
                      ? `${Math.round(current.smallBizPercent * 100)}%`
                      : '—'}
                  </div>
                  <div className="mt-0.5 text-[10px] text-slate-600">
                    {current.smallBizPercent != null
                      ? 'of agency spend to small biz (SBA FY23)'
                      : 'No SBA Goaling data for parent'}
                  </div>
                </div>
              </div>

              {/* Signal chips */}
              <div className="flex flex-wrap gap-2 text-[11px]">
                <span className="rounded bg-surface px-2 py-1 text-ink-soft">
                  {(current.contractCount || 0).toLocaleString()} contracts
                </span>
                <span
                  className="rounded bg-surface px-2 py-1 text-ink-soft"
                  title="Avg # of bidders per contract from USAspending Number of Offers Received. Lower = less competition."
                >
                  {current.avgBidders != null && current.avgBidders > 0
                    ? `${current.avgBidders} avg bidders`
                    : 'Bidders —'}
                </span>
                {(current.uniqueVendorCount || 0) > 0 && (
                  <span
                    className="rounded bg-surface px-2 py-1 text-ink-soft"
                    title="Distinct primes who won contracts here. High = open door for new vendors."
                  >
                    {current.uniqueVendorCount} unique vendors
                  </span>
                )}
                <span className="rounded bg-surface px-2 py-1 text-ink-soft">
                  {(current.satContractCount || 0) > 0
                    ? `${Math.round((current.satRatio || 0) * 100)}% SAT`
                    : 'SAT —'}
                </span>
                {(current.painPointCount || 0) > 0 && (
                  <span className="rounded bg-amber-500/10 px-2 py-1 text-amber-300">
                    {current.painPointCount} pain pts
                  </span>
                )}
                {(current.openOppCount || 0) > 0 && (
                  <span className="rounded bg-emerald-500/10 px-2 py-1 text-emerald-300">
                    {current.openOppCount} open opps
                  </span>
                )}
                {(current.upcomingEventCount || 0) > 0 && (
                  <span className="rounded bg-purple-500/10 px-2 py-1 text-purple-300">
                    {current.upcomingEventCount} events
                  </span>
                )}
              </div>

              {error && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                  {error}
                </div>
              )}
            </div>

            {/* Action footer */}
            <div className="border-t border-surface px-6 py-4">
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => submit('skip')}
                  disabled={!!submitting}
                  className="rounded-lg border border-hairline bg-surface/40 px-3 py-2.5 text-sm font-medium text-ink-soft hover:bg-surface disabled:opacity-50"
                  title="Skip forever — don't show this office again for your current NAICS profile (Press 3)"
                >
                  {submitting === 'skip' ? '…' : (
                    <>Skip <span className="ml-1 text-[10px] text-faint">(3)</span></>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => submit('defer')}
                  disabled={!!submitting}
                  className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-sm font-medium text-amber-300 hover:bg-amber-500/10 disabled:opacity-50"
                  title="Defer 30 days — surface again in a month (Press 2)"
                >
                  {submitting === 'defer' ? '…' : (
                    <>Defer 30d <span className="ml-1 text-[10px] text-amber-300/60">(2)</span></>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => submit('track')}
                  disabled={!!submitting}
                  className="rounded-lg bg-emerald-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                  title="Track — add to My Target List (Press 1)"
                >
                  {submitting === 'track' ? '…' : (
                    <>Track <span className="ml-1 text-[10px] text-emerald-200">(1)</span></>
                  )}
                </button>
              </div>
              <p className="mt-3 text-center text-[10px] text-slate-600">
                Use keys 1 / 2 / 3 to triage faster · Esc to close · {remaining} {remaining === 1 ? 'office' : 'offices'} remaining
              </p>
            </div>
          </>
        ) : (
          <div className="px-6 py-12 text-center text-faint">No agencies to triage right now.</div>
        )}
      </div>
    </div>
  );
}
