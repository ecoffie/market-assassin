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
import { getMIApiHeaders, authedFetch } from '../authHeaders';
import { isDistinctiveKeyword, sanitizeKeywords } from '@/lib/market/keyword-sanitize';

interface TargetingCardProps {
  email: string | null;
  onEdit?: (panel: AppPanel) => void;
  // When provided (Settings only), shows a "Start over" action in the header that
  // clears the profile so the user can rebuild from scratch — right next to Edit,
  // where it's discoverable (Eric QC 2026-06-17: the bottom-of-Settings reset was
  // unfindable from the dashboard).
  onReset?: () => void;
  // 'compact' (dashboards) = top piece only: codes/keywords/PSC/states + one
  // coverage line. 'full' (Settings) = adds the have-vs-missing gap list so the
  // user can act on it. Eric QC 2026-06-17: dashboards should be glanceable (what
  // I'm targeting), Settings is where you audit/fix gaps. Default compact.
  variant?: 'compact' | 'full';
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
  sectorMarket: number;   // $ in the user's own line of work (same-sector)
  naicsCount: number;
  coverageCount: number;  // # of codes in the tight ~90% set
  coveragePct: number;    // what that tight set captures of the market (~0.9)
  heldPct: number;        // % of the user's LINE OF WORK they cover (sector-scoped)
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

export default function TargetingCard({ email, onEdit, onReset, variant = 'compact' }: TargetingCardProps) {
  const [data, setData] = useState<Targeting | null>(null);
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  // Inline add/remove (Eric QC 2026-07-02): edit codes/keywords right on the card
  // like the top-of-page settings, without going through the Suggest flow. Saves
  // to the SAME source of truth (/api/alerts/preferences → user_notification_settings).
  const [saving, setSaving] = useState(false);
  const [addingField, setAddingField] = useState<null | 'naics' | 'psc' | 'keywords'>(null);
  const [addValue, setAddValue] = useState('');
  // Transient note shown after a keyword add when the sanitizer changed what the
  // user typed (dropped a generic filler word / kept fewer than entered) — so the
  // chip that appears is never a silent surprise ("suggests 2, saves 1").
  const [addNote, setAddNote] = useState<string | null>(null);

  // Persist one targeting field with the 30-day-token-cliff retry, then broadcast
  // so every other settings surface re-syncs. Optimistic: caller updates local
  // state first; on failure we reload from the server to snap back to truth.
  const persist = useCallback(async (patch: Partial<Targeting>) => {
    if (!email) return;
    setSaving(true);
    const body = JSON.stringify({
      email,
      ...(patch.naics !== undefined ? { naicsCodes: patch.naics } : {}),
      ...(patch.psc !== undefined ? { pscCodes: patch.psc } : {}),
      ...(patch.keywords !== undefined ? { keywords: patch.keywords } : {}),
    });
    const post = () => fetch('/api/alerts/preferences', {
      method: 'POST',
      headers: getMIApiHeaders(email, { 'Content-Type': 'application/json' }),
      body,
    });
    try {
      let res = await post();
      if (res.status === 401) {
        const refresh = await fetch('/api/auth/refresh-mi-session', {
          method: 'POST',
          headers: getMIApiHeaders(email, { 'Content-Type': 'application/json' }),
        });
        if (refresh.ok) {
          const j = await refresh.json().catch(() => null);
          if (j?.sessionToken && typeof window !== 'undefined') {
            window.localStorage.setItem('mi_beta_auth_token', j.sessionToken);
          }
          res = await post();
        }
      }
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.success) throw new Error(j?.error || 'save failed');
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('mindy:settings-saved'));
      }
    } catch {
      // Snap back to server truth so the card never shows an unsaved edit.
      load();
    } finally {
      setSaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email]);

  // Remove one code/keyword: update local state immediately, then persist.
  const removeItem = (field: 'naics' | 'psc' | 'keywords', value: string) => {
    setData((d) => {
      if (!d) return d;
      const next = { ...d, [field]: d[field].filter((v) => v !== value) };
      persist({ [field]: next[field] } as Partial<Targeting>);
      return next;
    });
  };

  // Add one code/keyword from the inline "+ add" box.
  const commitAdd = (field: 'naics' | 'psc' | 'keywords') => {
    const raw = addValue.trim();
    setAddValue('');
    setAddingField(null);
    setAddNote(null);
    if (!raw) return;
    let clean: string[];
    if (field === 'keywords') {
      // Keywords split on COMMAS ONLY — a space is part of the phrase. "medical
      // supplies" is ONE precise keyword; splitting on space would shatter it into
      // "medical" + generic "supplies" (the opposite of what we want — phrases are
      // the precise signal). Then run the SAME sanitizer the save path uses, so a
      // filler/generic word the profile would drop never shows as a chip that then
      // vanishes on reload. What you see committed == what persists.
      const entered = raw.split(',').map((t) => t.trim()).filter(Boolean);
      clean = sanitizeKeywords(entered);
      const dropped = entered.filter(
        (e) => !clean.some((c) => c.toLowerCase() === e.toLowerCase()),
      );
      if (dropped.length > 0) {
        setAddNote(
          `Skipped ${dropped.map((d) => `“${d}”`).join(', ')} — too generic to match on. Try a specific phrase (e.g. “custom cabinetry”).`,
        );
      }
    } else {
      // NAICS/PSC are single tokens — keep comma/space splitting + validation.
      const tokens = raw.split(/[,\s]+/).map((t) => t.trim()).filter(Boolean);
      clean = field === 'naics'
        ? tokens.filter((t) => /^\d{2,6}$/.test(t))
        : tokens.map((t) => t.toUpperCase());
    }
    if (clean.length === 0) return;
    setData((d) => {
      if (!d) return d;
      const merged = Array.from(new Set([...d[field], ...clean]));
      const next = { ...d, [field]: merged };
      persist({ [field]: merged } as Partial<Targeting>);
      return next;
    });
  };

  const load = useCallback(async () => {
    if (!email) { setLoading(false); return; }
    try {
      const res = await authedFetch(`/api/app/workspace?email=${encodeURIComponent(email)}`, email);
      if (!res.ok) { setLoading(false); return; }
      const j = await res.json();
      // Read ONLY the authoritative source: profile.notification =
      // user_notification_settings, the SAME table that drives alerts/feed. We do
      // NOT fall back to j.settings (mi_beta_user_settings) — that's a separate row
      // that can DISAGREE with what alerts actually use, so falling back to it would
      // show a profile different from what drives matching (Eric QC 2026-06-16). If
      // notification is absent, show the empty/setup state — never stale mi_beta data.
      const s = j.profile?.notification || {};
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
          const cr = await authedFetch(`/api/app/keyword-coverage?keyword=${encodeURIComponent(primary)}${haveParam}`, email);
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
  // the card reflects a fresh save without a full reload. ALSO re-fetch when any
  // settings surface (the top drawer or UnifiedSettingsPanel) saves in the SAME
  // tab — focus alone misses that, which is why edits in one surface didn't show
  // in the other until you tabbed away and back (Eric QC 2026-07-02).
  useEffect(() => {
    const onFocus = () => load();
    const onSaved = () => load();
    window.addEventListener('focus', onFocus);
    window.addEventListener('mindy:settings-saved', onSaved);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('mindy:settings-saved', onSaved);
    };
  }, [load]);

  if (loading || !data) return null;

  const { naics, keywords, psc, states } = data;
  const noKeywords = keywords.length === 0;
  // PRECISION. A keyword like "management" matches ~everything (254 active notices
  // vs 15 for the phrase "program management"); a profile of only generic single
  // words floods matching and produces vague "hot" cards. Flag when the user HAS
  // keywords but none are distinctive (a phrase or a specific term) so we can nudge
  // toward precise phrases — the biggest lever on making matches tight (Eric, Jul 7).
  const distinctiveCount = keywords.filter((k) => isDistinctiveKeyword(k)).length;
  const keywordsTooBroad = keywords.length > 0 && distinctiveCount === 0;
  // Also flag a wide code footprint: many NAICS across unrelated 3-digit subsectors
  // is the other half of an over-broad profile (Blue Heron: 8 NAICS, 5 subsectors).
  const naicsSubsectors = new Set(naics.map((c) => c.slice(0, 3))).size;
  const naicsTooWide = naics.length >= 6 && naicsSubsectors >= 4;
  // Only expose Edit affordances when a navigation handler is wired. On the Settings
  // panel itself there's no target to send the user to (they're already editing), so
  // onEdit is omitted and the buttons hide — no dead clicks.
  // `canEdit` gates the "Edit codes & keywords →" button that routes to Settings —
  // this card's ONLY editing path. Inline chip add/remove is DISABLED on purpose
  // (Eric QC 2026-07-02: "I don't want people adding here, only inside Settings"),
  // so all mutation happens in one place. Read-only display + a jump to Settings.
  const canEdit = typeof onEdit === 'function';
  const canInlineEdit = false;
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
        <div className="shrink-0 flex items-center gap-2">
          {typeof onReset === 'function' && (
            <button
              onClick={onReset}
              className="text-xs text-slate-400 hover:text-red-400 transition-colors"
              title="Clear your profile and start over"
            >
              ↺ Start over
            </button>
          )}
          {canEdit && (
            <button
              onClick={edit}
              className="rounded-lg bg-purple-600 hover:bg-purple-500 px-3 py-1.5 text-xs font-medium text-white"
            >
              Edit codes &amp; keywords →
            </button>
          )}
        </div>
      </div>

      {!collapsed && (
      <>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* NAICS — inline add/remove (edit right here, like the top settings). */}
        <div>
          <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">
            NAICS codes ({naics.length})
          </div>
          <div className="flex flex-wrap gap-1 items-center">
            {naics.map((c) => (
              <span key={c} className="group inline-flex items-center gap-1 rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-200">
                {c}
                {canInlineEdit && (
                  <button
                    onClick={() => removeItem('naics', c)}
                    disabled={saving}
                    className="text-slate-500 hover:text-red-400 disabled:opacity-40"
                    title={`Remove ${c}`}
                    aria-label={`Remove NAICS ${c}`}
                  >×</button>
                )}
              </span>
            ))}
            {canInlineEdit && (
              addingField === 'naics' ? (
                <input
                  autoFocus
                  value={addValue}
                  onChange={(e) => setAddValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') commitAdd('naics'); if (e.key === 'Escape') { setAddingField(null); setAddValue(''); } }}
                  onBlur={() => commitAdd('naics')}
                  placeholder="e.g. 541512"
                  className="w-24 rounded bg-slate-950 border border-slate-700 px-2 py-0.5 text-xs text-slate-100 outline-none focus:border-purple-500"
                />
              ) : (
                <button
                  onClick={() => { setAddingField('naics'); setAddValue(''); }}
                  disabled={saving}
                  className="rounded border border-dashed border-slate-600 px-2 py-0.5 text-xs text-slate-400 hover:text-purple-300 hover:border-purple-500 disabled:opacity-40"
                >+ add</button>
              )
            )}
            {naics.length === 0 && !canInlineEdit && (
              <span className="text-xs text-slate-500">No codes set</span>
            )}
          </div>
        </div>

        {/* Keywords — loudly flag the empty state (the half-onboarded profile). */}
        <div>
          <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">
            Keywords ({keywords.length})
          </div>
          <div className="flex flex-wrap gap-1 items-center">
            {keywords.map((k) => (
              <span key={k} className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-300">
                {k}
                {canInlineEdit && (
                  <button
                    onClick={() => removeItem('keywords', k)}
                    disabled={saving}
                    className="text-emerald-500/70 hover:text-red-400 disabled:opacity-40"
                    title={`Remove ${k}`}
                    aria-label={`Remove keyword ${k}`}
                  >×</button>
                )}
              </span>
            ))}
            {canInlineEdit && (
              addingField === 'keywords' ? (
                <input
                  autoFocus
                  value={addValue}
                  onChange={(e) => setAddValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') commitAdd('keywords'); if (e.key === 'Escape') { setAddingField(null); setAddValue(''); } }}
                  onBlur={() => commitAdd('keywords')}
                  placeholder="e.g. medical supplies"
                  className="w-40 rounded bg-slate-950 border border-slate-700 px-2 py-0.5 text-xs text-slate-100 outline-none focus:border-emerald-500"
                />
              ) : (
                <button
                  onClick={() => { setAddingField('keywords'); setAddValue(''); }}
                  disabled={saving}
                  className={noKeywords
                    ? 'rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-300 hover:bg-amber-500/20'
                    : 'rounded border border-dashed border-slate-600 px-2 py-0.5 text-xs text-slate-400 hover:text-emerald-300 hover:border-emerald-500 disabled:opacity-40'}
                >{noKeywords ? '⚠ Add keywords so alerts catch mislabeled opps' : '+ add'}</button>
              )
            )}
            {noKeywords && !canInlineEdit && (
              <span className="text-xs text-amber-300">⚠ No keywords yet — add in Settings</span>
            )}
          </div>
          {addNote && (
            <div className="mt-1 text-[11px] text-amber-300/90">{addNote}</div>
          )}
        </div>

        {/* PSC codes — what's BOUGHT (the precise axis). Display-only here; edit in Settings. */}
        <div>
          <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">
            PSC codes ({psc.length})
          </div>
          <div className="flex flex-wrap gap-1 items-center">
            {psc.map((c) => (
              <span key={c} className="inline-flex items-center gap-1 rounded bg-purple-500/15 px-2 py-0.5 text-xs text-purple-300">
                {c}
                {canInlineEdit && (
                  <button
                    onClick={() => removeItem('psc', c)}
                    disabled={saving}
                    className="text-purple-400/70 hover:text-red-400 disabled:opacity-40"
                    title={`Remove ${c}`}
                    aria-label={`Remove PSC ${c}`}
                  >×</button>
                )}
              </span>
            ))}
            {canInlineEdit && (
              addingField === 'psc' ? (
                <input
                  autoFocus
                  value={addValue}
                  onChange={(e) => setAddValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') commitAdd('psc'); if (e.key === 'Escape') { setAddingField(null); setAddValue(''); } }}
                  onBlur={() => commitAdd('psc')}
                  placeholder="e.g. 6515"
                  className="w-24 rounded bg-slate-950 border border-slate-700 px-2 py-0.5 text-xs text-slate-100 outline-none focus:border-purple-500"
                />
              ) : (
                <button
                  onClick={() => { setAddingField('psc'); setAddValue(''); }}
                  disabled={saving}
                  className="rounded border border-dashed border-slate-600 px-2 py-0.5 text-xs text-slate-400 hover:text-purple-300 hover:border-purple-500 disabled:opacity-40"
                >+ add</button>
              )
            )}
            {psc.length === 0 && !canInlineEdit && (
              <span className="text-xs text-slate-500">None set</span>
            )}
          </div>
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

      {/* PRECISION NUDGE — the over-broad profile (Blue Heron: 5 generic keywords +
          8 NAICS → 443 matches). Only shows when there's a real breadth problem; it
          teaches the fix (precise phrases) rather than just flagging. Not shown for
          the empty-keywords state (that has its own ⚠ above). */}
      {(keywordsTooBroad || naicsTooWide) && (
        <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs">
          <div className="font-medium text-amber-300 mb-0.5">
            {keywordsTooBroad
              ? 'Your keywords are broad — add specific phrases to sharpen matches'
              : 'Your profile spans several industries — matches may be noisy'}
          </div>
          <div className="text-slate-400">
            {keywordsTooBroad ? (
              <>Single words like <span className="text-slate-300">&ldquo;management&rdquo;</span> or{' '}
                <span className="text-slate-300">&ldquo;technical&rdquo;</span> match almost everything. Two-word
                phrases like <span className="text-emerald-300">&ldquo;program management&rdquo;</span> or{' '}
                <span className="text-emerald-300">&ldquo;technical writing&rdquo;</span> are far more precise.</>
            ) : (
              <>{naics.length} NAICS across {naicsSubsectors} different subsectors casts a wide net. Trimming to your
                core line of work makes every match more relevant.</>
            )}
            {canEdit && (
              <button onClick={edit} className="ml-1 font-medium text-amber-300 hover:text-amber-200">
                Refine in Settings →
              </button>
            )}
          </div>
        </div>
      )}

      {/* COMPACT (dashboards): one glanceable coverage line. No gap list, no
          "what's bought" — that's audit detail, it lives in Settings (Eric QC
          2026-06-17: dashboards = what I'm targeting, not noise). */}
      {coverage && coverage.totalMarket > 0 && variant === 'compact' && (
        <div className="mt-3 border-t border-slate-800 pt-3 text-xs">
          {coverage.missing.length === 0 ? (
            <span className="text-slate-300">
              Your <span className="text-emerald-300 font-semibold">{naics.length} code{naics.length !== 1 ? 's' : ''}</span> cover{' '}
              <span className="text-emerald-300 font-semibold">{Math.round((coverage.coveragePct || 0) * 100)}%</span>{' '}
              of your <span className="font-semibold">{fmtMoney(coverage.sectorMarket || coverage.totalMarket)}</span> &ldquo;{coverage.keyword}&rdquo; market.
              <span className="text-slate-500"> You&rsquo;re not missing the money — keywords catch the rest.</span>
            </span>
          ) : (
            <span className="text-slate-400">
              Tracking{' '}
              <span className="text-amber-300 font-semibold">{Math.round(coverage.heldPct * 100)}%</span>{' '}
              of your &ldquo;{coverage.keyword}&rdquo; market.
              <span className="text-slate-500"> {coverage.missing.length} high-value code{coverage.missing.length > 1 ? 's' : ''} missing — see Settings.</span>
            </span>
          )}
        </div>
      )}

      {/* FULL (Settings): just HAVE vs MISSING — the audit. No "what's bought"
          breakdown, no "not all these are your work" (that read like you had WRONG
          codes; Eric QC 2026-06-17). Only: what you have, what you're missing. */}
      {coverage && coverage.totalMarket > 0 && variant === 'full' && (
        <div className="mt-3 border-t border-slate-800 pt-3">
          {coverage.missing.length > 0 ? (
            <>
              <div className="text-xs text-slate-400 mb-2">
                You&rsquo;re tracking{' '}
                <span className="text-amber-300 font-semibold">{Math.round(coverage.heldPct * 100)}%</span>{' '}
                of your &ldquo;{coverage.keyword}&rdquo; line of work — add the codes below for full coverage.
              </div>
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5">
                <div className="text-xs font-medium text-amber-300 mb-1.5">
                  Missing {coverage.missing.length} code{coverage.missing.length > 1 ? 's' : ''} in your line of work:
                </div>
                <div className="space-y-1">
                  {coverage.missing.slice(0, 8).map((m) => (
                    <div key={m.code} className="flex items-center justify-between gap-2 text-xs">
                      <span className="min-w-0 truncate text-slate-300">
                        <span className="text-amber-400">{m.code}</span> {m.name}
                      </span>
                      <span className="shrink-0 text-slate-400">{fmtMoney(m.amount)}</span>
                    </div>
                  ))}
                </div>
                <button onClick={edit} className="mt-2 text-xs font-medium text-amber-300 hover:text-amber-200">
                  Add the missing codes ↓
                </button>
              </div>
            </>
          ) : (
            <div className="text-xs">
              <div className="text-emerald-400 font-medium">
                ✓ Full coverage — your {naics.length} code{naics.length !== 1 ? 's' : ''} cover {Math.round((coverage.coveragePct || 0) * 100)}% of your {fmtMoney(coverage.sectorMarket || coverage.totalMarket)} &ldquo;{coverage.keyword}&rdquo; market.
              </div>
              <div className="text-slate-500 mt-1">
                Fewer, precise codes mean less noise — not less opportunity. These capture the real spend, and your keywords catch anything mislabeled. (More codes just flood your alerts with work you don&rsquo;t do.)
              </div>
            </div>
          )}
        </div>
      )}
      </>
      )}
    </div>
  );
}
