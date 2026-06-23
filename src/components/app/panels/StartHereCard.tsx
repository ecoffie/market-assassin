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
import type { AppPanel } from '../UnifiedSidebar';
import { getMIApiHeaders } from '../authHeaders';

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

  useEffect(() => {
    if (typeof window !== 'undefined' && window.localStorage.getItem(DISMISS_KEY) === '1') {
      setDismissed(true);
    }
  }, []);

  const load = useCallback(async () => {
    if (!email) return;
    const h = getMIApiHeaders(email);
    const e = encodeURIComponent(email);
    // Fetch all signals in parallel; any failure degrades that step to "not done"
    // rather than breaking the card.
    const [ws, tl, pl, lib] = await Promise.all([
      fetch(`/api/app/workspace?email=${e}`, { headers: h }).then((r) => r.ok ? r.json() : null).catch(() => null),
      fetch(`/api/app/target-list?email=${e}`, { headers: h }).then((r) => r.ok ? r.json() : null).catch(() => null),
      fetch(`/api/pipeline?email=${e}`, { headers: h }).then((r) => r.ok ? r.json() : null).catch(() => null),
      fetch(`/api/app/library?email=${e}`, { headers: h }).then((r) => r.ok ? r.json() : null).catch(() => null),
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
      { key: 'psc', label: 'Add your PSC codes', detail: 'The product/service codes the government actually buys.', done: hasPsc, panel: 'settings' },
      { key: 'targets', label: 'Build your target list', detail: 'Pick the agencies + offices you want to pursue.', done: targetCount > 0, panel: 'target-list' },
      { key: 'pursuit', label: 'Save your first pursuit', detail: 'Track an opportunity you’re going after.', done: pipelineCount > 0, panel: 'pipeline' },
      { key: 'bid', label: 'Draft your first response', detail: 'Let Mindy help you write a proposal/LOI.', done: libraryCount > 0, panel: 'proposals' },
    ]);
  }, [email]);

  useEffect(() => { load(); }, [load]);
  // Re-check when the user returns to the dashboard after doing a step.
  useEffect(() => {
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  if (dismissed || !steps) return null;
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
            <span className="text-base">🏅</span>
            <span className="text-sm font-bold text-white">First time? Start here</span>
            <span className="text-xs text-purple-300">{doneCount}/{steps.length} done</span>
          </div>
          <div className="text-xs text-slate-400 mt-0.5">5 quick steps to get value from Mindy today.</div>
        </div>
        <button onClick={dismiss} className="shrink-0 text-xs text-slate-500 hover:text-slate-300" title="Hide">Hide</button>
      </div>

      {/* progress bar */}
      <div className="mt-3 h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
        <div className="h-full bg-emerald-500 transition-all" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
      </div>

      <div className="mt-3 space-y-1.5">
        {steps.map((s, i) => (
          <button
            key={s.key}
            onClick={() => !s.done && onGo?.(s.panel)}
            className={`w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${s.done ? 'opacity-60' : 'hover:bg-slate-800/60'}`}
          >
            <span className={`shrink-0 flex h-5 w-5 items-center justify-center rounded-full text-xs ${s.done ? 'bg-emerald-500 text-slate-950' : 'border border-purple-400/50 text-purple-300'}`}>
              {s.done ? '✓' : i + 1}
            </span>
            <span className="min-w-0">
              <span className={`block text-xs font-medium ${s.done ? 'text-slate-400 line-through' : 'text-white'}`}>{s.label}</span>
              {!s.done && <span className="block text-[11px] text-slate-500">{s.detail}</span>}
            </span>
            {!s.done && <span className="ml-auto shrink-0 text-xs text-purple-400">Start →</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
