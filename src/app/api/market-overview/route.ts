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
 * GET /api/market-overview?keyword=wigs            (keyword → auto-derives NAICS)
 * GET /api/market-overview?naics=339113,812990     (explicit codes)
 *     &state=FL,GA   (optional place-of-performance scope, recompetes only)
 *     &email=...     (optional — returns the viewer's tier so the UI gates chips)
 *
 * Response (all counts + $ are FREE; `locked` marks what needs Pro to OPEN):
 *   { success, market: { keyword, totalMarket, naicsCount, codes, topPsc },
 *     tiles: [ { key, label, icon, count, value, locked, detailPanel } ],
 *     tier }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { keywordCoverage } from '@/lib/market/keyword-coverage';
import { getForecastsByNAICS, getForecastStatistics, type Forecast } from '@/lib/utils/agency-forecasts';
import { internalBaseUrl } from '@/lib/utils/internal-base-url';
import { verifyMIAccess } from '@/lib/api-auth';
import { fiscalYearTimePeriod } from '@/lib/utils/fiscal-year';
import primeDb from '@/data/prime-contractors-database.json';

/** Distinct federal agencies buying in the user's NAICS (USASpending). Best-effort
 *  — an external hiccup must never break the onboarding reveal (returns 0). */
async function agencyCount(codes: string[]): Promise<number> {
  if (!codes.length) return 0;
  try {
    const res = await fetch('https://api.usaspending.gov/api/v2/search/spending_by_category/awarding_agency/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filters: { naics_codes: codes, time_period: [fiscalYearTimePeriod()], award_type_codes: ['A', 'B', 'C', 'D'] },
        category: 'awarding_agency', limit: 100,
      }),
    });
    if (!res.ok) return 0;
    const j = await res.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (j.results || []).filter((r: any) => (r.amount || 0) > 0).length;
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

/** Forecast count + total $ across the NAICS set (local proprietary forecast list). */
function forecastTile(codes: string[]): { count: number; value: number } {
  const seen = new Set<string>();
  const merged: Forecast[] = [];
  for (const code of codes) {
    for (const f of getForecastsByNAICS(code)) {
      const id = f.id || `${f.agency}|${f.title}`;
      if (seen.has(id)) continue;
      seen.add(id);
      merged.push(f);
    }
  }
  const stats = getForecastStatistics(merged);
  return { count: stats.totalForecasts, value: stats.totalValue };
}

/** Recompete count + total ceiling $ for the NAICS set, plus how much of that
 *  expiring work is SMALL-BUSINESS SET-ASIDE (the "can I actually win it?" signal
 *  contractors care about — not competitor counts). Our proprietary recompete
 *  table joined to USASpending awards. */
async function recompeteTile(
  codes: string[],
): Promise<{ count: number; value: number; setAsideCount: number; setAsideValue: number }> {
  const empty = { count: 0, value: 0, setAsideCount: 0, setAsideValue: 0 };
  if (!supabaseUrl || !supabaseKey || codes.length === 0) return empty;
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
      return empty;
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
    return empty;
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

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const keyword = (sp.get('keyword') || '').trim();
  const explicitCodes = parseCodes(sp.get('naics'));
  const email = (sp.get('email') || '').toLowerCase().trim();

  if (!keyword && explicitCodes.length === 0) {
    return NextResponse.json(
      { success: false, error: 'keyword or naics is required' },
      { status: 400 },
    );
  }

  // 1) Market size + auto-derived NAICS set from the keyword (API-side join).
  const coverage = keyword ? await keywordCoverage(keyword).catch(() => null) : null;
  const codes = explicitCodes.length > 0
    ? explicitCodes
    : (coverage?.coverageCodes || []);

  // 2) Proprietary + API tiles in parallel.
  const [recompete, grants, agencies] = await Promise.all([
    recompeteTile(codes),
    grantTile(request, keyword),
    agencyCount(codes),
  ]);
  const forecasts = forecastTile(codes);

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
    { key: 'forecasts', label: 'Forecasted buys', icon: '📋', count: forecasts.count, value: forecasts.value, locked: !isPaid, detailPanel: 'forecasts' },
    { key: 'recompetes', label: 'Recompetes expiring (18 mo)', icon: '🔁', count: recompete.count, value: recompete.value, locked: !isPaid, detailPanel: 'recompetes' },
    { key: 'setasides', label: 'Reserved for small business', icon: '🎯', count: recompete.setAsideCount, value: recompete.setAsideValue, locked: !isPaid, detailPanel: 'recompetes', note: 'set-aside' },
    { key: 'grants', label: 'Grant opportunities', icon: '💰', count: grants.count, value: grants.value, locked: !isPaid, detailPanel: 'grants', note: 'award ceiling' },
  ];

  return NextResponse.json(
    {
      success: true,
      tier,
      market: {
        keyword: keyword || null,
        totalMarket: coverage?.totalMarket ?? 0,
        naicsCount: coverage?.naicsCount ?? codes.length,
        codes,
        topPsc: coverage?.topPsc ?? null,
      },
      // Extra scope counts for the onboarding reveal (not tiles — the "so many
      // contractors in your space" number). Best-effort; 0 just omits the stat.
      scope: { contractors: contractorCount(codes), agencies },
      tiles,
    },
    { headers: { 'Cache-Control': 'private, max-age=300' } },
  );
}
