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
import { type MarketFilter } from '@/lib/market/keyword-coverage';
import {
  resolveMarketScope,
  buildSpendingFilters,
  fetchSpendingCategory,
  type SpendRow,
} from '@/lib/market/spend-query';
import { MARKET_SPEND_WINDOW_LABEL } from '@/lib/utils/usaspending-helpers';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const DEFAULT_LIMIT = 10;

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

  // ONE shared decision (src/lib/market/spend-query.ts) — the report, this leaderboard
  // and any future surface must resolve "what market is this" the same way, or their
  // dollars stop reconciling (the PR #245 lesson). A 6-digit NAICS stays EXACT inside
  // resolveMarketScope (never sweep the 3-digit subsector — that inflated "Relevant
  // spending" 7×).
  const scope = await resolveMarketScope({ keyword, naics, pscCode: pscParam });
  if (!scope) {
    return NextResponse.json(
      { error: `No federal market found for ${keyword ? `keyword "${keyword}"` : pscParam ? `PSC ${pscParam}` : `NAICS ${naics}`}` },
      { status: 404 },
    );
  }

  // ⚠️ A dominant-NAICS keyword is NOT a 404. This route used to treat
  // buildMarketFilter()'s null as "no market" and returned
  // `No federal market found for keyword "security guard"` — for a $6B market
  // (also janitorial services, roofing…). The gate always promised callers would
  // "fall through to their NAICS path"; resolveMarketScope is that fall-through, so a
  // dominant keyword now ranks by its ~90% coverage set and returns real leaderboards.
  const marketFilter: MarketFilter | null = scope.marketFilter;
  const expandedNaics: string[] = scope.naicsCodes;
  const filterKey = keyword
    ? `kw:${keyword}${marketFilter?.psc_codes?.length ? `:psc:${marketFilter.psc_codes[0]}` : ''}${scope.rankedByDominantNaics ? ':naics' : ''}`
    : pscParam
      ? `psc:${pscParam}`
      : naics;

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
    fetchSpendingCategory('awarding_agency', filters, DEFAULT_LIMIT * 2, 'fpds-top-n'), // pull 20 so post-DOD-exclusion still has 10
    fetchSpendingCategory('awarding_subagency', filters, DEFAULT_LIMIT, 'fpds-top-n'),
    fetchSpendingCategory('recipient', filters, DEFAULT_LIMIT, 'fpds-top-n'),
    fetchSpendingCategory('funding_agency', filters, DEFAULT_LIMIT, 'fpds-top-n'),
  ]);

  // Post-filter: drop DOD from departments + contracting if excludeDOD.
  // USAspending doesn't accept negation filters, so we filter results
  // client-side. Cheap; we already have the data.
  const isDodRow = (r: SpendRow) =>
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
