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
  psc: string[];
  states: string[];
}

interface CoverageCode {
  code: string;
  name: string;
  amount: number;
  pct: number;
  have: boolean;
}

interface Coverage {
  keyword: string;
  totalMarket: number;
  naicsCount: number;
  coverageCount: number;
  coveragePct: number;
  heldPct: number;
  coverageCodes: CoverageCode[];
  missing: CoverageCode[];
  topPsc: { code: string; name: string; amount: number; pct: number }[];
}

function fmtMoney(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${Math.round(n / 1e6)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}

export default function TargetingCard({ email, onEdit }: TargetingCardProps) {
  const [data, setData] = useState<Targeting | null>(null);
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);

  const load = useCallback(async () => {
    if (!email) { setLoading(false); return; }
    try {
      const res = await fetch(`/api/app/workspace?email=${encodeURIComponent(email)}`, {
        headers: getMIApiHeaders(email),
      });
      if (!res.ok) { setLoading(false); return; }
      const j = await res.json();
      // Read the AUTHORITATIVE source: profile.notification = user_notification_settings,
      // the SAME table that drives alerts/feed. NOT j.settings (that's mi_beta_user_settings,
      // a separate per-user row that's empty for users set up via the alerts path — the card
      // showed "No codes" despite a correct profile; Eric QC 2026-06-16). Fall back to
      // j.settings only if notification is absent.
      const s = j.profile?.notification || j.settings || {};
      const keywords = Array.isArray(s.keywords) ? s.keywords.map(String) : [];
      setData({
        naics: Array.isArray(s.naics_codes) ? s.naics_codes.map(String) : [],
        keywords,
        psc: Array.isArray(s.psc_codes) ? s.psc_codes.map(String) : [],
        states: Array.isArray(s.location_states) ? s.location_states.map(String) : [],
      });

      // Coverage context for the user's PRIMARY keyword — the market size + the PSC
      // breakdown (what was actually bought) so they see the building-vs-ordnance
      // style split a single keyword spans. Every number matches a USASpending
      // search on this term. Non-blocking; the card renders without it.
      const primary = keywords[0];
      const naics = Array.isArray(s.naics_codes) ? s.naics_codes.map(String) : [];
      if (primary) {
        try {
          const haveParam = naics.length ? `&have=${encodeURIComponent(naics.join(','))}` : '';
          const cr = await fetch(`/api/app/keyword-coverage?keyword=${encodeURIComponent(primary)}${haveParam}`, {
            headers: getMIApiHeaders(email),
          });
          if (cr.ok) {
            const cj = await cr.json();
            setCoverage(cj.coverage || null);
          }
        } catch { /* coverage is optional */ }
      } else {
        setCoverage(null);
      }
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

  const { naics, keywords, psc, states } = data;
  const noKeywords = keywords.length === 0;
  // Only expose Edit affordances when a navigation handler is wired. On the Settings
  // panel itself there's no target to send the user to (they're already editing), so
  // onEdit is omitted and the buttons hide — no dead clicks.
  const canEdit = typeof onEdit === 'function';
  const edit = () => onEdit?.('settings');
  // One-line summary shown when collapsed (glanceable verify without the full card).
  const statesLabel = states.length > 0 ? states.join(', ') : 'Nationwide';

  return (
    <div className="mb-4 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="flex min-w-0 items-center gap-2 text-left"
          aria-expanded={!collapsed}
        >
          <span className={`text-slate-500 transition-transform ${collapsed ? '-rotate-90' : ''}`}>▾</span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-white">Your targeting</span>
            <span className="block text-xs text-slate-500">
              {collapsed
                ? `${naics.length} NAICS · ${keywords.length} keywords · ${psc.length} PSC · ${statesLabel}`
                : 'What Mindy matches your alerts against'}
            </span>
          </span>
        </button>
        {canEdit && (
          <button
            onClick={edit}
            className="shrink-0 rounded-lg bg-purple-600 hover:bg-purple-500 px-3 py-1.5 text-xs font-medium text-white"
          >
            Edit codes &amp; keywords →
          </button>
        )}
      </div>

      {!collapsed && (
      <>
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

        {/* PSC codes — what's BOUGHT (the precise axis). Display-only here; edit in Settings. */}
        <div>
          <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">
            PSC codes ({psc.length})
          </div>
          {psc.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {psc.slice(0, 10).map((c) => (
                <span key={c} className="rounded bg-purple-500/15 px-2 py-0.5 text-xs text-purple-300">{c}</span>
              ))}
            </div>
          ) : canEdit ? (
            <button onClick={edit} className="text-xs text-purple-400 hover:text-purple-300">
              Add PSC codes (what the gov buys) →
            </button>
          ) : (
            <span className="text-xs text-slate-500">None set — add in the PSC field below</span>
          )}
        </div>

        {/* Coverage area — the states alerts are scoped to. "Nationwide" when empty. */}
        <div>
          <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">
            Coverage area
          </div>
          <div className="flex flex-wrap gap-1">
            {states.length > 0 ? (
              states.map((st) => (
                <span key={st} className="rounded bg-blue-500/15 px-2 py-0.5 text-xs text-blue-300">{st}</span>
              ))
            ) : (
              <span className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300">🌎 Nationwide</span>
            )}
          </div>
        </div>
      </div>

      {/* Market coverage + what-was-bought — derived live from the primary keyword,
          every number matches a USASpending search on that term. The PSC list shows
          the real sub-markets a single keyword spans (e.g. "demolition" = Demolition
          of Structures vs Ammunition Facilities — building vs ordnance work). */}
      {coverage && coverage.totalMarket > 0 && (
        <div className="mt-3 border-t border-slate-800 pt-3">
          {/* Held coverage — what the user's CURRENT codes capture, vs the full
              ~90% set. Green when they have it all; amber when there are gaps. */}
          <div className="text-xs text-slate-400">
            Your codes cover{' '}
            <span className={`font-semibold ${coverage.missing.length === 0 ? 'text-emerald-300' : 'text-amber-300'}`}>
              {Math.round(coverage.heldPct * 100)}%
            </span>{' '}
            of a{' '}
            <span className="text-emerald-300 font-semibold">{fmtMoney(coverage.totalMarket)}</span>{' '}
            &ldquo;{coverage.keyword}&rdquo; market ({coverage.naicsCount} codes bought it).{' '}
            <span className="text-slate-500">Verify: search &ldquo;{coverage.keyword}&rdquo; on USASpending.</span>
          </div>

          {/* Gap — coverage codes with real spend the user is NOT tracking. This is
              the "do I have FULL coverage?" answer. */}
          {coverage.missing.length > 0 ? (
            <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5">
              <div className="text-xs font-medium text-amber-300 mb-1">
                ⚠ Missing {coverage.missing.length} code{coverage.missing.length > 1 ? 's' : ''} with real spend — you&rsquo;re not seeing all of this market:
              </div>
              <div className="space-y-1">
                {coverage.missing.slice(0, 6).map((m) => (
                  <div key={m.code} className="flex items-center justify-between gap-2 text-xs">
                    <span className="min-w-0 truncate text-slate-300">
                      <span className="text-amber-400">{m.code}</span> {m.name}
                    </span>
                    <span className="shrink-0 text-slate-400">{fmtMoney(m.amount)}</span>
                  </div>
                ))}
              </div>
              <button onClick={edit} className="mt-2 text-xs font-medium text-amber-300 hover:text-amber-200">
                Add these in Settings → full coverage
              </button>
            </div>
          ) : (
            <div className="mt-1.5 text-xs text-emerald-400">✓ Full coverage — you&rsquo;re tracking every high-value code for this market.</div>
          )}

          {coverage.topPsc.length > 0 && (
            <div className="mt-2">
              <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">
                What&rsquo;s actually bought (top product codes)
              </div>
              <div className="space-y-1">
                {coverage.topPsc.map((p) => (
                  <div key={p.code} className="flex items-center justify-between gap-2 text-xs">
                    <span className="min-w-0 truncate text-slate-300">
                      <span className="text-slate-500">{p.code}</span> {p.name}
                    </span>
                    <span className="shrink-0 text-slate-400">{fmtMoney(p.amount)}</span>
                  </div>
                ))}
              </div>
              <button onClick={edit} className="mt-2 text-xs text-purple-400 hover:text-purple-300">
                Not all of these are your work? Edit your codes →
              </button>
            </div>
          )}
        </div>
      )}
      </>
      )}
    </div>
  );
}
