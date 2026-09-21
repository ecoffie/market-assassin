'use client';

/**
 * "First time? Start Here" — a 5-step new-user checklist on Today's Intel.
 *
 * Eric (Jun 2026): people new to software don't know where to start. The guided
 * journeys (walkthrough videos) exist, but a plain "do these 5 things first" medallion
 * is what a first-timer needs. Each step AUTO-CHECKS from real data (no manual marking)
 * and links straight to the action. The whole card is dismissible and auto-hides once
 * all 5 are done, so it never nags an established user.
 *
 * Steps map to concrete signals so "done" is always truthful:
 *   1. Profile (NAICS + keywords)      → /api/app/workspace profile.notification
 *   2. PSC codes (what the gov buys)   → profile.notification.psc_codes
 *   3. Target list (who you pursue)    → /api/app/target-list count
 *   4. First pursuit saved             → /api/pipeline length
 *   5. First bid drafted               → /api/app/library length
 */

import { useCallback, useEffect, useState } from 'react';
import { Award, Check } from 'lucide-react';
import type { AppPanel } from '../UnifiedSidebar';
import { getMIApiHeaders, authedFetch } from '../authHeaders';
import { getActiveWorkspace } from '../activeWorkspace';

interface StartHereCardProps {
  email: string | null;
  onGo?: (panel: AppPanel) => void;
}

interface Step {
  key: string;
  label: string;
  detail: string;
  done: boolean;
  panel: AppPanel;
}

const DISMISS_KEY = 'mindy_start_here_dismissed';

export default function StartHereCard({ email, onGo }: StartHereCardProps) {
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [dismissed, setDismissed] = useState(false);
  // Coach Mode: when operating inside a client workspace, the personal
  // "first time, set up your profile" checklist doesn't apply — the coach set
  // the client up when they created it, and a coach with clients isn't a
  // first-timer. Hide the card entirely in client mode. (Eric, Jun 23.)
  const [inClientMode, setInClientMode] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.localStorage.getItem(DISMISS_KEY) === '1') {
      setDismissed(true);
    }
    setInClientMode(!!getActiveWorkspace());
  }, []);

  const load = useCallback(async () => {
    if (!email || inClientMode) return;
    const h = getMIApiHeaders(email);
    const e = encodeURIComponent(email);
    // Fetch all signals in parallel; any failure degrades that step to "not done"
    // rather than breaking the card.
    const [ws, tl, pl, lib] = await Promise.all([
      authedFetch(`/api/app/workspace?email=${e}`, email).then((r) => r.ok ? r.json() : null).catch(() => null),
      authedFetch(`/api/app/target-list?email=${e}`, email).then((r) => r.ok ? r.json() : null).catch(() => null),
      fetch(`/api/pipeline?email=${e}`, { headers: h }).then((r) => r.ok ? r.json() : null).catch(() => null),
      authedFetch(`/api/app/library?email=${e}`, email).then((r) => r.ok ? r.json() : null).catch(() => null),
    ]);
    const notif = ws?.profile?.notification || {};
    const hasNaics = Array.isArray(notif.naics_codes) && notif.naics_codes.length > 0;
    const hasKeywords = Array.isArray(notif.keywords) && notif.keywords.length > 0;
    const hasPsc = Array.isArray(notif.psc_codes) && notif.psc_codes.length > 0;
    const targetCount = Number(tl?.count) || (Array.isArray(tl?.targets) ? tl.targets.length : 0);
    // /api/pipeline returns { opportunities: [...] }; /api/app/library returns
    // { entries: [...], total }. The old parse looked for `items`/`count` (which
    // neither sends), so both always read 0 → "Save your first pursuit" / "Draft
    // your first response" stayed unchecked even with pursuits + drafts (Eric, Jun 22).
    const pipelineCount = Array.isArray(pl?.opportunities) ? pl.opportunities.length
      : Array.isArray(pl?.items) ? pl.items.length
      : Array.isArray(pl) ? pl.length
      : Number(pl?.count) || 0;
    const libraryCount = Array.isArray(lib?.entries) ? lib.entries.length
      : Number(lib?.total)
      || (Array.isArray(lib?.items) ? lib.items.length : (Array.isArray(lib) ? lib.length : Number(lib?.count) || 0));

    setSteps([
      { key: 'profile', label: 'Set up your profile', detail: 'Add your codes + keywords so Mindy knows what to watch.', done: hasNaics && hasKeywords, panel: 'settings' },
      // PSC is auto-derived from NAICS (the daily-alerts matcher crosswalks
      // NAICS→PSC), so this is DONE the moment the user has NAICS — adding PSC
      // by hand is an optional precision tweak, not a required step. This stops
      // the checklist contradicting the targeting card's "your codes already
      // cover 96% — keywords catch the rest." (Eric, Jun 23 2026.)
      { key: 'psc', label: 'PSC codes (auto-handled)', detail: 'Mindy derives these from your NAICS automatically. Add specific ones in Settings for extra precision (optional).', done: hasPsc || hasNaics, panel: 'settings' },
      // Routes to Auto-setup ("Set up my Mindy") so a first-timer gets their
      // Target List populated in one click instead of facing an empty list.
      // Once they have targets, the step is done and the link is moot.
      { key: 'targets', label: 'Build your target list', detail: 'Let Mindy add the agencies buying in your market — or pick your own.', done: targetCount > 0, panel: 'my-market' },
      { key: 'pursuit', label: 'Save your first pursuit', detail: 'Track an opportunity you’re going after.', done: pipelineCount > 0, panel: 'pipeline' },
      { key: 'bid', label: 'Draft your first response', detail: 'Let Mindy help you write a proposal/LOI.', done: libraryCount > 0, panel: 'proposals' },
    ]);
  }, [email]);

  useEffect(() => { if (!inClientMode) load(); }, [load, inClientMode]);
  // Re-check when the user returns to the dashboard after doing a step.
  useEffect(() => {
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  // Never show the first-timer checklist while operating a client workspace.
  if (inClientMode || dismissed || !steps) return null;
  const doneCount = steps.filter((s) => s.done).length;
  // Auto-hide once everything is done — never nag an established user.
  if (doneCount === steps.length) return null;

  const dismiss = () => {
    setDismissed(true);
    if (typeof window !== 'undefined') window.localStorage.setItem(DISMISS_KEY, '1');
  };

  return (
    <div className="mb-4 rounded-xl border border-purple-500/40 bg-gradient-to-br from-purple-950/40 to-slate-900 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Award className="h-4 w-4 shrink-0 text-amber-400" strokeWidth={2} />
            <span className="text-sm font-bold text-white">First time? Start here</span>
            <span className="text-xs text-purple-300">{doneCount}/{steps.length} done</span>
          </div>
          <div className="text-xs text-muted mt-0.5">5 quick steps to get value from Mindy today.</div>
        </div>
        <button onClick={dismiss} className="shrink-0 text-xs text-faint hover:text-ink-soft" title="Hide">Hide</button>
      </div>

      {/* progress bar */}
      <div className="mt-3 h-1.5 w-full rounded-full bg-surface overflow-hidden">
        <div className="h-full bg-emerald-500 transition-all" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
      </div>

      <div className="mt-3 space-y-1.5">
        {steps.map((s, i) => (
          <button
            key={s.key}
            onClick={() => !s.done && onGo?.(s.panel)}
            className={`w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${s.done ? 'opacity-60' : 'hover:bg-surface/60'}`}
          >
            <span className={`shrink-0 flex h-5 w-5 items-center justify-center rounded-full text-xs ${s.done ? 'bg-emerald-500 text-slate-950' : 'border border-purple-400/50 text-purple-300'}`}>
              {s.done ? <Check className="h-4 w-4" strokeWidth={3} /> : i + 1}
            </span>
            <span className="min-w-0">
              <span className={`block text-xs font-medium ${s.done ? 'text-muted line-through' : 'text-white'}`}>{s.label}</span>
              {!s.done && <span className="block text-[11px] text-faint">{s.detail}</span>}
            </span>
            {!s.done && <span className="ml-auto shrink-0 text-xs text-purple-400">Start →</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
