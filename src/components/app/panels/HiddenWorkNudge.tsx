'use client';

/**
 * "Unlock Hidden Work" — profile-completion nudge for users still on the placeholder
 * seed profile.
 *
 * WHY: Hidden Work Discovery (semantic "💡 your kind of work" alerts) fires ONLY for
 * users who set a REAL NAICS or keyword — the seed sweep is deliberately excluded so we
 * never fire "matches your capabilities" at someone who never told us their capabilities
 * (memory: prefilled_naics_not_real_signal). Measured: ~29% of the alerts-on audience
 * still carries only the seed sweep, so they silently get ZERO hidden matches. This card
 * tells them exactly what to do to unlock it — and vanishes the instant they do.
 *
 * Gate = hasRealProfile() from profile-setup.ts — the SAME check the capability vector
 * uses, so "who sees the nudge" and "who gets no matches" are guaranteed identical.
 * Re-checks on window focus, so returning from Settings hides it immediately.
 */

import { useCallback, useEffect, useState } from 'react';
import { Lightbulb } from 'lucide-react';
import type { AppPanel } from '../UnifiedSidebar';
import { authedFetch } from '../authHeaders';
import { getActiveWorkspace } from '../activeWorkspace';
import { hasRealProfile } from '@/lib/alerts/profile-setup';

interface HiddenWorkNudgeProps {
  email: string | null;
  onGo?: (panel: AppPanel) => void;
}

const DISMISS_KEY = 'mindy_hidden_work_nudge_dismissed';

export default function HiddenWorkNudge({ email, onGo }: HiddenWorkNudgeProps) {
  const [show, setShow] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [inClientMode, setInClientMode] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.localStorage.getItem(DISMISS_KEY) === '1') {
      setDismissed(true);
    }
    setInClientMode(!!getActiveWorkspace());
  }, []);

  const load = useCallback(async () => {
    if (!email || inClientMode) return;
    const e = encodeURIComponent(email);
    const ws = await authedFetch(`/api/app/workspace?email=${e}`, email)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    const notif = ws?.profile?.notification || {};
    // Show precisely when the profile is NOT real (seed-only / generic) → the user
    // gets no hidden matches. hasRealProfile is the single source of truth.
    setShow(!hasRealProfile({ naics_codes: notif.naics_codes, keywords: notif.keywords }));
  }, [email, inClientMode]);

  useEffect(() => { if (!inClientMode) load(); }, [load, inClientMode]);
  // Re-check when the user returns after editing their profile → hide immediately.
  useEffect(() => {
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  if (inClientMode || dismissed || !show) return null;

  const dismiss = () => {
    setDismissed(true);
    if (typeof window !== 'undefined') window.localStorage.setItem(DISMISS_KEY, '1');
  };

  return (
    <div className="mb-4 rounded-xl border border-purple-500/40 bg-gradient-to-br from-purple-950/40 to-slate-900 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Lightbulb className="h-4 w-4 shrink-0 text-amber-400" strokeWidth={2} />
            <span className="text-sm font-bold text-white">Unlock Hidden Work</span>
          </div>
          <div className="text-xs text-muted mt-1 leading-relaxed">
            The government bundles scopes under names you&apos;d never search — a
            &ldquo;building envelope&rdquo; contract that&apos;s really cybersecurity.
            Set your <span className="text-purple-300 font-medium">real NAICS codes and keywords</span> and
            Mindy will match contracts to what you actually do — by meaning, not just keywords.
          </div>
        </div>
        <button
          onClick={dismiss}
          className="shrink-0 text-xs text-faint hover:text-ink-soft"
          title="Hide"
        >
          Hide
        </button>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={() => onGo?.('settings')}
          className="rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-500 transition-colors"
        >
          Set up my profile →
        </button>
        <span className="text-[11px] text-faint">Takes about 30 seconds.</span>
      </div>
    </div>
  );
}
