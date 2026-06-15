'use client';

/**
 * "Your targeting" dashboard card — surfaces the user's current NAICS codes +
 * keywords right where they land after login, with one-click Edit → Settings.
 *
 * Why this exists (Eric QC 2026-06-15): codes/keywords lived ONLY in the Settings
 * panel, buried below a long sidebar scroll / behind the click-to-open account
 * menu. New users couldn't find how to see or reset them. SaaS convention for a
 * vertical tool: the user's working context (what they're searching for) is
 * visible on the home surface, not hidden in account admin. This card makes the
 * targeting state legible and editable from the dashboard. It also flags an EMPTY
 * keywords state loudly — the most common half-onboarded profile (keywords:None).
 *
 * Reads the SAME source the Settings panel reads for codes/keywords:
 * /api/app/workspace → data.settings.{naics_codes,keywords} (snake_case).
 * (The Settings panel uses /api/alerts/preferences only for frequency/states.)
 * No new data path.
 */

import { useCallback, useEffect, useState } from 'react';
import type { AppPanel } from '../UnifiedSidebar';
import { getMIApiHeaders } from '../authHeaders';

interface TargetingCardProps {
  email: string | null;
  onEdit?: (panel: AppPanel) => void;
}

interface Targeting {
  naics: string[];
  keywords: string[];
}

export default function TargetingCard({ email, onEdit }: TargetingCardProps) {
  const [data, setData] = useState<Targeting | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!email) { setLoading(false); return; }
    try {
      const res = await fetch(`/api/app/workspace?email=${encodeURIComponent(email)}`, {
        headers: getMIApiHeaders(email),
      });
      if (!res.ok) { setLoading(false); return; }
      const j = await res.json();
      const s = j.settings || {};
      setData({
        naics: Array.isArray(s.naics_codes) ? s.naics_codes.map(String) : [],
        keywords: Array.isArray(s.keywords) ? s.keywords.map(String) : [],
      });
    } catch {
      /* non-fatal — card just doesn't render */
    } finally {
      setLoading(false);
    }
  }, [email]);

  useEffect(() => { load(); }, [load]);

  // Re-fetch when the user returns to the dashboard after editing (tab focus) so
  // the card reflects a fresh save without a full reload.
  useEffect(() => {
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  if (loading || !data) return null;

  const { naics, keywords } = data;
  const noKeywords = keywords.length === 0;
  const edit = () => onEdit?.('settings');

  return (
    <div className="mb-4 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-white">Your targeting</div>
          <div className="text-xs text-slate-500">What Mindy matches your alerts against</div>
        </div>
        <button
          onClick={edit}
          className="shrink-0 rounded-lg bg-purple-600 hover:bg-purple-500 px-3 py-1.5 text-xs font-medium text-white"
        >
          Edit codes &amp; keywords →
        </button>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* NAICS */}
        <div>
          <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">
            NAICS codes ({naics.length})
          </div>
          {naics.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {naics.slice(0, 8).map((c) => (
                <span key={c} className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-200">{c}</span>
              ))}
              {naics.length > 8 && (
                <span className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-400">+{naics.length - 8} more</span>
              )}
            </div>
          ) : (
            <button onClick={edit} className="text-xs text-purple-400 hover:text-purple-300">
              No codes set — add yours →
            </button>
          )}
        </div>

        {/* Keywords — loudly flag the empty state (the half-onboarded profile). */}
        <div>
          <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">
            Keywords ({keywords.length})
          </div>
          {noKeywords ? (
            <button
              onClick={edit}
              className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-300 hover:bg-amber-500/20"
            >
              ⚠ No keywords yet — add them so alerts catch mislabeled opps →
            </button>
          ) : (
            <div className="flex flex-wrap gap-1">
              {keywords.slice(0, 10).map((k) => (
                <span key={k} className="rounded bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-300">{k}</span>
              ))}
              {keywords.length > 10 && (
                <span className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-400">+{keywords.length - 10}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
