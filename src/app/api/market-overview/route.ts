/**
 * Market Overview — the "here's everything we know about your market" aggregator.
 *
 * THE CONVERSION KEYSTONE (Eric, Jun 24 2026). Our moat isn't any single public
 * API — it's the layer where our PROPRIETARY data (forecast list, recompete table,
 * incumbent/competitor data) is pre-joined to the public APIs and resolved to ONE
 * market. This endpoint surfaces the BREADTH of that for a free user (every count +
 * dollar value — proof the treasure exists) while the DETAIL stays locked behind
 * Pro. One aggregator, three surfaces: onboarding map, daily-alert teaser, dashboard.
 *
 * GET /api/market-overview?keyword=wigs            (keyword → measured coverage + keyword-scoped tiles)
 * GET /api/market-overview?naics=339113,812990     (corroborated / explicit company NAICS)
 *     &state=FL,GA   (optional place-of-performance scope, recompetes only)
 *     &email=...     (optional — returns the viewer's tier so the UI gates chips)
 *
 * Keyword coverage candidates are MEASUREMENT display only. Forecast / recompete /
 * set-aside tiles use corroborated ?naics= when present; otherwise the keyword
 * language path. Never silently pin those tiles to coverageCodes alone.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { queryKeywordCoverage } from '@/lib/market/keyword-coverage';
import { getReadClient } from '@/lib/supabase/server-clients';
import { internalBaseUrl } from '@/lib/utils/internal-base-url';
import { verifyMIAccess } from '@/lib/api-auth';
import { fiscalYearTimePeriod } from '@/lib/utils/fiscal-year';
import primeDb from '@/data/prime-contractors-database.json';

/** Distinct federal agencies BUYING this market (USASpending). Scopes on PSC ("what was bought")
 *  when a specific/dominant PSC is in hand — else the NAICS set. Best-effort — an external hiccup
 *  must never break the onboarding reveal (returns 0).
 *  Why PSC-first (Eric 2026-08-03): counting agencies by a BROAD NAICS overcounts — every 541519 IT
 *  buyer, not the buyers of the actual product. When the keyword resolves to a distinctive PSC, that
 *  PSC is the true "who buys this" key (same NAICS-vs-PSC split as the map fixes). */
async function agencyCount(codes: string[], psc?: string | null): Promise<number> {
  if (!codes.length && !psc) return 0;
  // PSC scope REPLACES the NAICS scope (they disagree for a product buy); NAICS is the fallback.
  const scope = psc
    ? { psc_codes: [String(psc).toUpperCase()] }
    : { naics_codes: codes };
  try {
    const res = await fetch('https://api.usaspending.gov/api/v2/search/spending_by_category/awarding_agency/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filters: { ...scope, time_period: [fiscalYearTimePeriod()], award_type_codes: ['A', 'B', 'C', 'D'] },
        category: 'awarding_agency', limit: 100,
      }),
    });
    if (!res.ok) return 0;
    const j = await res.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const n = (j.results || []).filter((r: any) => (r.amount || 0) > 0).length;
    // PSC too thin (a rare/mis-tagged code) → fall back to the NAICS count rather than under-report.
    if (psc && n < 2 && codes.length) return agencyCount(codes, null);
    return n;
  } catch { return 0; }
}

/** Prime contractors active in the user's space (NAICS industry-group overlap).
 *  Static file → instant, no external call. Powers the onboarding reveal's
 *  "contractors in your space" (teaming partners + competitors). */
function contractorCount(codes: string[]): number {
  if (!codes.length) return 0;
  const prefixes = new Set(codes.map((c) => c.slice(0, 4)));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const primes = (((primeDb as any).primes) || []) as Array<{ naicsCategories?: string[] }>;
  let n = 0;
  for (const p of primes) {
    if ((p.naicsCategories || []).some((c) => prefixes.has(String(c).slice(0, 4)))) n++;
  }
  return n;
}

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

interface Tile {
  key: string;
  label: string;
  icon: string;
  count: number;
  value: number;        // total dollars (0 when unknown)
  locked: boolean;      // detail requires Pro to OPEN (count + $ are always shown)
  detailPanel: string;  // which /app panel the locked chip routes to
  note?: string;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Split a comma list of NAICS codes, trimmed + de-duped. */
function parseCodes(raw: string | null): string[] {
  return Array.from(new Set((raw || '').split(',').map((c) => c.trim()).filter(Boolean)));
}

/**
 * Forecast count + total $ across the NAICS set — from the LIVE agency_forecasts
 * table, not the static file.
 *
 * This tile used to read src/data/agency-forecasts-database.json: TWENTY
 * hardcoded records with synthetic ids (DOD-2025-Q2-001) and round values, while
 * Supabase agency_forecasts holds 33,228 real rows that other surfaces already
 * query (see getForecastViewportPins in lib/opportunities/map-data.ts).
 *
 * A Pro customer whose NAICS was not among those 20 saw "Forecasted buys: 0"
 * BEHIND A PAYWALL — a confident zero, drawn from a file, contradicting our own
 * database. Same class as the PSC "not a known PSC" bug: a stale local catalog
 * asserting an absence the live source disproves.
 *
 * Returns null on a query failure so the caller can OMIT the tile rather than
 * render a zero. An unknown count and a real zero must never look the same.
 */
async function forecastTileByNaics(codes: string[]): Promise<{ count: number; value: number } | null> {
  if (!codes.length) return null;
  try {
    const sb = getReadClient();
    // 6-digit exact match on the codes the user actually searched. estimated_value_max
    // is the ceiling the rest of Market Overview reports for forecasts.
    const { data, error } = await sb
      .from('agency_forecasts')
      .select('id, estimated_value_max, estimated_value_min')
      .in('naics_code', codes)
      .limit(5000);
    if (error) {
      console.error('[market-overview] forecast tile query failed:', error.message);
      return null;
    }
    const rows = data || [];
    const value = (rows as Array<{ estimated_value_max?: number | null; estimated_value_min?: number | null }>).reduce(
      (sum, r) => sum + (Number(r.estimated_value_max) || Number(r.estimated_value_min) || 0),
      0,
    );
    return { count: rows.length, value };
  } catch (err) {
    console.error('[market-overview] forecast tile threw:', err);
    return null;
  }
}

/** Keyword path — title/description match. Used when no corroborated NAICS exists. */
async function forecastTileByKeyword(keyword: string): Promise<{ count: number; value: number } | null> {
  const kw = keyword.trim();
  if (kw.length < 2) return null;
  try {
    const sb = getReadClient();
    const { data, error } = await sb
      .from('agency_forecasts')
      .select('id, estimated_value_max, estimated_value_min')
      .or(`title.ilike.%${kw}%,description.ilike.%${kw}%`)
      .limit(5000);
    if (error) {
      console.error('[market-overview] forecast keyword tile failed:', error.message);
      return null;
    }
    const rows = data || [];
    const value = (rows as Array<{ estimated_value_max?: number | null; estimated_value_min?: number | null }>).reduce(
      (sum, r) => sum + (Number(r.estimated_value_max) || Number(r.estimated_value_min) || 0),
      0,
    );
    return { count: rows.length, value };
  } catch (err) {
    console.error('[market-overview] forecast keyword tile threw:', err);
    return null;
  }
}

/** Recompete count + total ceiling $ for corroborated NAICS, plus how much of that
 *  expiring work is SMALL-BUSINESS SET-ASIDE (the "can I actually win it?" signal
 *  contractors care about — not competitor counts). Our proprietary recompete
 *  table joined to USASpending awards.
 *  Returns null when scope is not established (do not fabricate a measured zero). */
async function recompeteTileByNaics(
  codes: string[],
): Promise<{ count: number; value: number; setAsideCount: number; setAsideValue: number } | null> {
  if (!supabaseUrl || !supabaseKey || codes.length === 0) return null;
  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const today = new Date().toISOString().split('T')[0];
    const maxDate = new Date();
    maxDate.setMonth(maxDate.getMonth() + 18);
    // OR across the codes with prefix matching (541 → 541512), matching the
    // /api/recompete filter semantics (future expiry + quality quarantine).
    const orFilter = codes
      .map((c) => (c.length < 6 ? `naics_code.like.${c}%` : `naics_code.eq.${c}`))
      .join(',');
    const { data, count, error } = await supabase
      .from('recompete_opportunities')
      .select('potential_total_value, set_aside_type', { count: 'exact' })
      .gt('period_of_performance_current_end', today)
      .lte('period_of_performance_current_end', maxDate.toISOString().split('T')[0])
      .is('quality_flag', null)
      .or(orFilter)
      .limit(3000);
    if (error) {
      console.warn('[market-overview] recompete query failed:', error.message);
      return null;
    }
    const rows = data || [];
    let value = 0;
    let setAsideCount = 0;
    let setAsideValue = 0;
    // A non-empty set_aside_type that isn't full-and-open = reserved for small
    // business (Total SB, 8(a), WOSB, SDVOSB, HUBZone, VOSB…).
    const isSetAside = (s: string) => !!s && !/full and open|none|no set aside/i.test(s);
    for (const r of rows) {
      const v = num((r as Record<string, unknown>).potential_total_value);
      value += v;
      if (isSetAside(String((r as Record<string, unknown>).set_aside_type || '').trim())) {
        setAsideCount++;
        setAsideValue += v;
      }
    }
    return { count: count ?? rows.length, value, setAsideCount, setAsideValue };
  } catch (err) {
    console.warn('[market-overview] recompete tile threw:', err);
    return null;
  }
}

/** Keyword path on recompete description — when no corroborated NAICS. */
async function recompeteTileByKeyword(
  keyword: string,
): Promise<{ count: number; value: number; setAsideCount: number; setAsideValue: number } | null> {
  const kw = keyword.trim();
  if (!supabaseUrl || !supabaseKey || kw.length < 2) return null;
  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const today = new Date().toISOString().split('T')[0];
    const maxDate = new Date();
    maxDate.setMonth(maxDate.getMonth() + 18);
    const { data, count, error } = await supabase
      .from('recompete_opportunities')
      .select('potential_total_value, set_aside_type', { count: 'exact' })
      .gt('period_of_performance_current_end', today)
      .lte('period_of_performance_current_end', maxDate.toISOString().split('T')[0])
      .is('quality_flag', null)
      .ilike('description', `%${kw}%`)
      .limit(3000);
    if (error) {
      console.warn('[market-overview] recompete keyword query failed:', error.message);
      return null;
    }
    const rows = data || [];
    let value = 0;
    let setAsideCount = 0;
    let setAsideValue = 0;
    const isSetAside = (s: string) => !!s && !/full and open|none|no set aside/i.test(s);
    for (const r of rows) {
      const v = num((r as Record<string, unknown>).potential_total_value);
      value += v;
      if (isSetAside(String((r as Record<string, unknown>).set_aside_type || '').trim())) {
        setAsideCount++;
        setAsideValue += v;
      }
    }
    return { count: count ?? rows.length, value, setAsideCount, setAsideValue };
  } catch (err) {
    console.warn('[market-overview] recompete keyword tile threw:', err);
    return null;
  }
}

/** Grant count + total ceiling $ by keyword (Grants.gov via our /api/grants). Best-
 *  effort — an external-API hiccup must never break the onboarding map. */
async function grantTile(
  request: NextRequest,
  keyword: string,
): Promise<{ count: number; value: number }> {
  const kw = keyword.trim();
  if (!kw) return { count: 0, value: 0 };
  try {
    const base = internalBaseUrl(request);
    const res = await fetch(`${base}/api/grants?keyword=${encodeURIComponent(kw)}&limit=200&status=posted`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return { count: 0, value: 0 };
    const json = await res.json().catch(() => null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const grants = (json?.grants || []) as any[];
    const count = num(json?.total) || grants.length;
    const value = grants.reduce((s, g) => s + num(g?.awardCeiling), 0);
    return { count, value };
  } catch {
    return { count: 0, value: 0 };
  }
}

/** Active SAM solicitations reserved for small business (a real set-aside_code,
 *  excluding full-and-open "NONE"). Requires corroborated NAICS — returns null
 *  when market code is not established (do not fabricate a measured zero). */
async function setAsideTileByNaics(codes: string[]): Promise<{ count: number } | null> {
  if (!supabaseUrl || !supabaseKey || codes.length === 0) return null;
  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const orFilter = codes.map((c) => (c.length < 6 ? `naics_code.like.${c}%` : `naics_code.eq.${c}`)).join(',');
    // "biddable now" must mean the deadline hasn't passed — `active` alone counts
    // expired-but-not-yet-archived notices. Full now() timestamp OR null deadline.
    const nowIso = new Date().toISOString();
    const { count, error } = await supabase
      .from('sam_opportunities')
      .select('id', { count: 'exact', head: true })
      .eq('active', true)
      .or(`response_deadline.gte.${nowIso},response_deadline.is.null`)
      .or(orFilter)
      .not('set_aside_code', 'is', null)
      .neq('set_aside_code', '')
      .neq('set_aside_code', 'NONE');
    if (error) { console.warn('[market-overview] set-aside query failed:', error.message); return null; }
    return { count: count ?? 0 };
  } catch { return null; }
}

/** Keyword path on SAM title — when no corroborated NAICS. */
async function setAsideTileByKeyword(keyword: string): Promise<{ count: number } | null> {
  const kw = keyword.trim();
  if (!supabaseUrl || !supabaseKey || kw.length < 2) return null;
  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const nowIso = new Date().toISOString();
    const { count, error } = await supabase
      .from('sam_opportunities')
      .select('id', { count: 'exact', head: true })
      .eq('active', true)
      .or(`response_deadline.gte.${nowIso},response_deadline.is.null`)
      .ilike('title', `%${kw}%`)
      .not('set_aside_code', 'is', null)
      .neq('set_aside_code', '')
      .neq('set_aside_code', 'NONE');
    if (error) { console.warn('[market-overview] set-aside keyword query failed:', error.message); return null; }
    return { count: count ?? 0 };
  } catch { return null; }
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const keyword = (sp.get('keyword') || '').trim();
  // Explicit / corroborated NAICS only (SAM, user-selected, vault). Never treat
  // coverageCandidates as if they were passed here — callers must not launder.
  const corroboratedCodes = parseCodes(sp.get('naics'));
  const email = (sp.get('email') || '').toLowerCase().trim();

  if (!keyword && corroboratedCodes.length === 0) {
    return NextResponse.json(
      { success: false, error: 'keyword or naics is required' },
      { status: 400 },
    );
  }

  // 1) Market size + measured coverage candidates (warehouse description match).
  //    Candidates are MEASUREMENT display — not tile routing scope.
  const covResult = keyword ? await queryKeywordCoverage(keyword) : null;
  if (covResult?.status === 'NOT_ESTABLISHED') {
    return NextResponse.json({
      success: false,
      error: 'Market coverage is not established',
      evidence_status: 'NOT_ESTABLISHED',
      degraded: true,
    }, { status: 503 });
  }
  const coverage = covResult?.coverage ?? null;
  const coverageCandidates = coverage?.coverageCodes || [];
  const hasCorroboratedNaics = corroboratedCodes.length > 0;

  // 2) Proprietary + API tiles. Forecast/recompete/set-aside use corroborated
  //    NAICS when present; otherwise the keyword language path. Never silently
  //    pin those tiles to coverageCandidates alone.
  const [recompete, grants, agencies, setAside, forecasts] = await Promise.all([
    hasCorroboratedNaics
      ? recompeteTileByNaics(corroboratedCodes)
      : recompeteTileByKeyword(keyword),
    grantTile(request, keyword),
    hasCorroboratedNaics
      ? agencyCount(corroboratedCodes, null)
      : Promise.resolve(null as number | null),
    hasCorroboratedNaics
      ? setAsideTileByNaics(corroboratedCodes)
      : setAsideTileByKeyword(keyword),
    hasCorroboratedNaics
      ? forecastTileByNaics(corroboratedCodes)
      : forecastTileByKeyword(keyword),
  ]);

  // 3) Viewer tier — counts + $ are free for everyone; tier only tells the UI
  //    whether to render the locked-chip CTA (Pro/Team see the real detail).
  type ViewerTier = 'free' | 'pro' | 'team' | 'none';
  let tier: ViewerTier = 'free';
  if (email) {
    try {
      const access = await verifyMIAccess(email);
      tier = (access?.tier as ViewerTier) || 'free';
    } catch { /* default free */ }
  }
  const isPaid = tier === 'pro' || tier === 'team';

  const tiles: Tile[] = [
    // Omitted when the query failed OR scope not established (null): a tile
    // reading 0 would claim "no upcoming buys", which is stronger than "not checked".
    ...(forecasts
      ? [{ key: 'forecasts', label: 'Forecasted buys', icon: '📋', count: forecasts.count, value: forecasts.value, locked: !isPaid, detailPanel: 'forecasts', note: hasCorroboratedNaics ? undefined : 'matched by keyword' }]
      : []),
    ...(recompete
      ? [{ key: 'recompetes', label: 'Recompetes expiring (18 mo)', icon: '🔁', count: recompete.count, value: recompete.value, locked: !isPaid, detailPanel: 'recompetes', note: hasCorroboratedNaics ? undefined : 'matched by keyword' }]
      : []),
    ...(setAside
      ? [{ key: 'setasides', label: 'Reserved for small business', icon: '🎯', count: setAside.count, value: 0, locked: !isPaid, detailPanel: 'alerts', note: hasCorroboratedNaics ? undefined : 'matched by keyword' }]
      : []),
    { key: 'grants', label: 'Grant opportunities', icon: '💰', count: grants.count, value: grants.value, locked: !isPaid, detailPanel: 'grants', note: 'award ceiling' },
  ];

  return NextResponse.json(
    {
      success: true,
      tier,
      market: {
        keyword: keyword || null,
        totalMarket: coverage?.totalMarket ?? 0,
        naicsCount: coverage?.naicsCount ?? coverageCandidates.length,
        /** Measured coverage candidates — display only. Not tile routing scope. */
        coverageCandidates,
        /** Corroborated / explicit NAICS used for NAICS-scoped tiles. */
        corroboratedNaics: corroboratedCodes,
        /**
         * @deprecated Prefer coverageCandidates + corroboratedNaics.
         * Only corroborated/explicit codes — never coverageCandidates laundering.
         */
        codes: corroboratedCodes,
        topPsc: coverage?.topPsc ?? null,
        naicsScopeEstablished: hasCorroboratedNaics,
        awaitingMarketConfirmation: !hasCorroboratedNaics && Boolean(keyword),
      },
      // Extra scope counts for the onboarding reveal. Contractors/agencies need
      // corroborated NAICS — omit (null/0) rather than invent from coverage.
      scope: {
        contractors: hasCorroboratedNaics ? contractorCount(corroboratedCodes) : null,
        agencies: agencies,
        awaitingMarketConfirmation: !hasCorroboratedNaics && Boolean(keyword),
      },
      tiles,
    },
    { headers: { 'Cache-Control': 'private, max-age=300' } },
  );
}

