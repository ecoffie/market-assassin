/**
 * /api/usaspending/fpds-top-n
 *
 * Returns the 4 top-10 leaderboards a BD person used to get from
 * the FPDS-NG search sidebar:
 *   - Top 10 Departments  (awarding_agency category)
 *   - Top 10 Contracting Agencies (awarding_subagency)
 *   - Top 10 Vendors  (recipient)
 *   - Top 10 Funding Agencies (funding_agency)
 *
 * SAM.gov retired FPDS in Feb 2026 but USAspending API now serves
 * the same award-derived aggregations via spending_by_category.
 *
 * Strategy:
 *   1. Cache lookup against fpds_top_n_cache (24h TTL).
 *   2. Cache miss → 4 parallel USAspending calls (one per category).
 *   3. Write through to cache, return JSON.
 *
 * Verbs:
 *   GET ?naics=541512[&state=FL][&fy=2024][&excludeDOD=true]
 *
 * Response shape:
 *   { success, cached, top_departments[], top_contracting[],
 *     top_vendors[], top_funding_agencies[], total_obligation,
 *     total_award_count, fiscal_year, generated_at }
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { expandNAICSCodes } from '@/lib/utils/naics-expansion';
import {
  buildMarketFilter,
  keywordCoverage,
  marketFilterToUsaspending,
  type MarketFilter,
} from '@/lib/market/keyword-coverage';
import { MARKET_SPEND_WINDOW, MARKET_SPEND_WINDOW_LABEL } from '@/lib/utils/usaspending-helpers';

const USASPENDING_URL = 'https://api.usaspending.gov/api/v2/search/spending_by_category';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const DEFAULT_LIMIT = 10;

// USASpending contract award type codes (FPDS scope).
// We want contract obligations, not grants/loans/IDV-only.
const CONTRACT_AWARD_TYPE_CODES = ['A', 'B', 'C', 'D'];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _supabase: any = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _supabase;
}

interface TopRow {
  name: string;
  amount: number;
  count: number;
  rank: number;
}

interface CategoryResult {
  results: Array<{
    id?: number | string | null;
    name?: string | null;
    code?: string | null;
    amount?: number | null;
  }>;
  category?: string;
  messages?: string[];
}

/**
 * Build the USASpending filter shared by all 4 category calls.
 * Keyword/PSC mode ranks by what was bought; NAICS mode is legacy profile search.
 */
function buildSpendingFilters(opts: {
  naicsCodes?: string[];
  marketFilter?: MarketFilter | null;
  state?: string;
}) {
  // Use the SAME canonical 3-FY window as the rest of the Market Research
  // dashboard (find-agencies, TMR) so the FPDS leaderboard totals reconcile with
  // the headline "Relevant spending" figure. Previously this used a single fiscal
  // year, which is why "Tracked total $1.5B" looked tiny next to "$97.2B".
  let filters: Record<string, unknown> = {
    award_type_codes: CONTRACT_AWARD_TYPE_CODES,
    time_period: [{ start_date: MARKET_SPEND_WINDOW.start_date, end_date: MARKET_SPEND_WINDOW.end_date }],
  };

  if (opts.marketFilter) {
    // marketFilterToUsaspending RETURNS a merged object; it does NOT mutate in
    // place. The old code ignored the return value, so keyword/PSC constraints
    // were silently dropped → every keyword search queried ALL federal spend
    // (drones showed $2.1T = the whole budget). Capture the return value.
    filters = marketFilterToUsaspending(opts.marketFilter, filters);
  } else if (opts.naicsCodes?.length) {
    filters.naics_codes = opts.naicsCodes;
  }

  if (opts.state) {
    filters.place_of_performance_locations = [{ country: 'USA', state: opts.state }];
  }

  return filters;
}

/**
 * Single-category USAspending call.
 *
 * USAspending category endpoints accept the same filter shape but
 * return aggregations keyed by the category. Rate-limited at ~1
 * req/sec; we call 4 in parallel which has worked fine empirically
 * (USAspending's rate limit appears per-IP per-minute, not strict
 * per-second).
 */
async function fetchCategory(
  category: 'awarding_agency' | 'awarding_subagency' | 'recipient' | 'funding_agency',
  filters: Record<string, unknown>,
  limit: number
): Promise<TopRow[]> {
  const body = {
    category,
    filters,
    limit,
    page: 1,
    subawards: false,
  };

  let response: Response;
  try {
    response = await fetch(USASPENDING_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      // USAspending occasionally hangs on very-broad queries.
      // 25s cap matches Vercel's default function timeout buffer.
      signal: AbortSignal.timeout(25_000),
    });
  } catch (err) {
    console.warn(`[fpds-top-n] ${category} fetch failed:`, err);
    return [];
  }

  if (!response.ok) {
    console.warn(`[fpds-top-n] ${category} HTTP ${response.status}`);
    return [];
  }

  const payload = (await response.json().catch(() => null)) as CategoryResult | null;
  if (!payload?.results) return [];

  return payload.results.slice(0, limit).map((row, idx) => ({
    name: row.name || row.code || `Unknown ${category}`,
    amount: typeof row.amount === 'number' ? row.amount : 0,
    // USAspending category results don't always include count —
    // we infer 0 here and the UI can show "—" for missing data.
    count: 0,
    rank: idx + 1,
  }));
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const naics = url.searchParams.get('naics')?.trim() || '';
  const keyword = url.searchParams.get('keyword')?.trim() || '';
  const pscParam = url.searchParams.get('psc')?.trim().toUpperCase() || '';
  const state = (url.searchParams.get('state') || '').trim().toUpperCase();
  const excludeDOD = url.searchParams.get('excludeDOD') === 'true';
  if (!naics && !keyword && !pscParam) {
    return NextResponse.json({ error: 'naics, keyword, or psc is required' }, { status: 400 });
  }
  // The spend window is FIXED (MARKET_SPEND_WINDOW, 3 FYs) so the dashboard dollars
  // reconcile. The `fy` param no longer changes the window; we pin the cache's
  // fiscal_year to a VERSION sentinel so one entry serves all callers AND stale
  // entries from prior logic aren't reused. v2 = 6-digit-exact NAICS + keyword/PSC
  // filter actually applied (the marketFilterToUsaspending return value was dropped,
  // so keyword searches queried ALL federal spend — drones showed $2.1T). Bumped to
  // bust rows written before either fix.
  const fiscalYear = 2;

  let marketFilter: MarketFilter | null = null;
  let expandedNaics: string[] = [];
  let filterKey: string;

  if (keyword) {
    const coverage = await keywordCoverage(keyword);
    marketFilter = buildMarketFilter({ coverage, keyword, pscCode: pscParam || undefined });
    if (!marketFilter) {
      return NextResponse.json({ error: `No federal market found for keyword "${keyword}"` }, { status: 404 });
    }
    filterKey = `kw:${keyword}${marketFilter.psc_codes?.length ? `:psc:${marketFilter.psc_codes[0]}` : ''}`;
  } else if (pscParam) {
    marketFilter = buildMarketFilter({ pscCode: pscParam });
    filterKey = `psc:${pscParam}`;
  } else {
    // expandFullCodes=false: a 6-digit code stays EXACT (don't sweep its whole
    // 3-digit subsector — that inflated "Relevant spending" 7× by pulling in all
    // of 541xxx for a 541512 search). Prefixes the user typed (2-4 digit) still
    // expand. Mirrors find-agencies' 6-digit-exact behavior so widgets reconcile.
    expandedNaics = expandNAICSCodes([naics], false);
    filterKey = naics;
  }

  const cacheKey = {
    naics_code: filterKey,
    state_code: state,
    fiscal_year: fiscalYear,
    exclude_dod: excludeDOD,
  };

  // 1) Cache lookup
  try {
    const supabase = getSupabase();
    const { data: cached } = await supabase
      .from('fpds_top_n_cache')
      .select('*')
      .eq('naics_code', cacheKey.naics_code)
      .eq('state_code', cacheKey.state_code)
      .eq('fiscal_year', cacheKey.fiscal_year)
      .eq('exclude_dod', cacheKey.exclude_dod)
      .maybeSingle();

    if (cached?.generated_at) {
      const age = Date.now() - new Date(cached.generated_at).getTime();
      // Treat any partially-empty result as STALE. The previous check
      // only invalidated when ALL four leaderboards were empty, which
      // let rows like { departments: [10], vendors: [] } stick around
      // and break the Top 10 Vendors panel for the cache's lifetime.
      // Any of the 4 being empty for a real NAICS is anomalous —
      // refetch and overwrite. (Truly dead NAICS will keep empty
      // results, that's fine — TTL still applies.)
      const cachedDepartments = cached.top_departments || [];
      const cachedContracting = cached.top_contracting || [];
      const cachedVendors = cached.top_vendors || [];
      const cachedFunding = cached.top_funding_agencies || [];
      const anyEmpty =
        cachedDepartments.length === 0 ||
        cachedContracting.length === 0 ||
        cachedVendors.length === 0 ||
        cachedFunding.length === 0;
      if (age < CACHE_TTL_MS && !anyEmpty) {
        return NextResponse.json({
          success: true,
          cached: true,
          cache_age_ms: age,
          spend_window_label: MARKET_SPEND_WINDOW_LABEL,
          top_departments: cachedDepartments,
          top_contracting: cachedContracting,
          top_vendors: cachedVendors,
          top_funding_agencies: cachedFunding,
          total_obligation: cached.total_obligation,
          total_award_count: cached.total_award_count,
          generated_at: cached.generated_at,
        });
      }
    }
  } catch (cacheErr) {
    console.warn('[fpds-top-n] cache lookup failed (proceeding live):', cacheErr);
  }

  // 2) Cache miss — 4 parallel USAspending calls
  const filters = buildSpendingFilters({
    naicsCodes: expandedNaics.length ? expandedNaics : undefined,
    marketFilter,
    state: state || undefined,
  });

  const [departments, contracting, vendors, funding] = await Promise.all([
    fetchCategory('awarding_agency', filters, DEFAULT_LIMIT * 2), // pull 20 so post-DOD-exclusion still has 10
    fetchCategory('awarding_subagency', filters, DEFAULT_LIMIT),
    fetchCategory('recipient', filters, DEFAULT_LIMIT),
    fetchCategory('funding_agency', filters, DEFAULT_LIMIT),
  ]);

  // Post-filter: drop DOD from departments + contracting if excludeDOD.
  // USAspending doesn't accept negation filters, so we filter results
  // client-side. Cheap; we already have the data.
  const isDodRow = (r: TopRow) =>
    /department of defense|\bdod\b|\barmy\b|\bnavy\b|\bair force\b|\bmarine\b/i.test(r.name);

  const finalDepartments = (excludeDOD ? departments.filter(r => !isDodRow(r)) : departments)
    .slice(0, DEFAULT_LIMIT)
    .map((r, i) => ({ ...r, rank: i + 1 }));

  const finalContracting = (excludeDOD ? contracting.filter(r => !isDodRow(r)) : contracting)
    .slice(0, DEFAULT_LIMIT)
    .map((r, i) => ({ ...r, rank: i + 1 }));

  const totalObligation = finalDepartments.reduce((s, r) => s + (r.amount || 0), 0);

  // 3) Write-through cache (best effort)
  try {
    const supabase = getSupabase();
    await supabase
      .from('fpds_top_n_cache')
      .upsert({
        ...cacheKey,
        top_departments: finalDepartments,
        top_contracting: finalContracting,
        top_vendors: vendors,
        top_funding_agencies: funding,
        total_obligation: totalObligation,
        total_award_count: null, // We could fetch this from spending_by_award but it's expensive
        source_endpoint: 'usaspending_v2',
        generated_at: new Date().toISOString(),
      }, { onConflict: 'naics_code,state_code,fiscal_year,exclude_dod' });
  } catch (writeErr) {
    console.warn('[fpds-top-n] cache write failed (non-fatal):', writeErr);
  }

  return NextResponse.json({
    success: true,
    cached: false,
    spend_window_label: MARKET_SPEND_WINDOW_LABEL,
    naics_requested: naics || null,
    keyword: keyword || null,
    ranking_label: marketFilter?.rankingLabel || null,
    naics_expanded: expandedNaics.length ? expandedNaics : null,
    naics_expansion_count: expandedNaics.length || null,
    top_departments: finalDepartments,
    top_contracting: finalContracting,
    top_vendors: vendors,
    top_funding_agencies: funding,
    total_obligation: totalObligation,
    generated_at: new Date().toISOString(),
  });
}
