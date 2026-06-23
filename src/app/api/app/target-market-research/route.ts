/**
 * /api/app/target-market-research
 *
 * POST endpoint that returns the merged Target Market Research data
 * set for the Mindy research workspace. Replaces the 3-card "Start
 * Here" black box with a full agency table the user can sort, filter,
 * and use to plan their BD outreach.
 *
 * Naming note: the original draft of this route used "target-accounts"
 * but that's enterprise SaaS sales jargon. Mindy uses plain federal-BD
 * language per the project vocabulary rule — "Target Market Research"
 * is what BD people actually call it. See
 * `tasks/target-market-research-roadmap.md` for the broader vision.
 *
 * Per the roadmap, this endpoint joins FOUR data sources per office
 * row:
 *
 *   1. USASpending — via existing /api/usaspending/find-agencies
 *      → setAsideSpending, contractCount, satSpending, microSpending,
 *        sub-agency hierarchy, office codes
 *
 *   2. Pain points — from agency_pain_points.json via pain-points-linker
 *      → painPointCount, painPointCategories
 *
 *   3. SAM opportunities — from sam_opportunities table
 *      → openOppCount (current active SAM solicitations at this agency)
 *
 *   4. SAM events — from sam_events table per PRD-federal-events-database.md
 *      → upcomingEventCount (industry days / RFIs / webinars next 90 days)
 *
 * Pre-computed sort metrics per row so the UI can switch lenses
 * without re-fetching:
 *   - top_spending = setAsideSpending
 *   - easy_entry_sat = satContractCount / contractCount (% under SAT)
 *   - contracts = contractCount
 *   - vendor_density = (read from primes count when we add primes layer)
 *
 * Cached 24h in agency_target_data_cache keyed by
 * (naics, business_type, veteran_status). Cache miss = ~3-8s. Cache
 * hit = ~50ms.
 *
 * Pro-gated. Free users get a smaller teaser slice.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyMIAccess } from '@/lib/api-auth';
import { expandNAICSCodes, parseNAICSInput } from '@/lib/utils/naics-expansion';
import {
  getPainPointsForAgency,
  getPainPointsByNaics,
} from '@/lib/agency-hierarchy/pain-points-linker';
import { getPrimesByAgency } from '@/lib/utils/prime-contractors';
import { getEnhancedAgencyInfo, getAllCommands } from '@/lib/utils/command-info';
import { keywordCoverage, deriveCoverageKeywords, buildSearchKeywords, buildMarketFilter, marketFilterToUsaspending } from '@/lib/market/keyword-coverage';
import { internalBaseUrl } from '@/lib/utils/internal-base-url';
import { MARKET_SPEND_WINDOW, MARKET_SPEND_WINDOW_LABEL } from '@/lib/utils/usaspending-helpers';

const FREE_TIER_ROW_LIMIT = 10;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const EVENT_HORIZON_DAYS = 90;

// Normalize an agency name to a stable key by stripping department/agency
// filler and keeping the core tokens. Makes "DEPT OF DEFENSE",
// "Department of Defense", and "VETERANS AFFAIRS, DEPARTMENT OF" all match
// their spending-side equivalents. Used to join sam_opportunities /
// sam_events (keyed by top-level DEPARTMENT) to the spending agency rows.
function normalizeAgencyKey(s: string): string {
  return (s || '')
    .toUpperCase()
    .replace(/[.,]/g, ' ')
    .replace(/\b(DEPARTMENT|DEPT|OF|THE|U S|US|ADMINISTRATION|AGENCY|NATIONAL)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Best sub-agency category total from spending_by_category for ranking. */
function categoryTotalForAgency(
  categoryTotalByKey: Record<string, number>,
  subAgency?: string,
  parentAgency?: string,
  name?: string,
): number {
  // Only fall back to the PARENT department total for a department-level row
  // (no distinct sub-agency, or sub-agency === the department). A real
  // sub-agency (e.g. FERC under Department of Energy) must NOT inherit the
  // department-wide total — that's how FERC read $65.9B (Energy's number).
  // It keys off its own sub-agency/name total, falling to its sampled award
  // spend when it isn't in the category response.
  const subKey = normalizeAgencyKey(subAgency || '');
  const parentKey = normalizeAgencyKey(parentAgency || '');
  const isDeptRow = !subKey || subKey === parentKey;
  const lookups = isDeptRow ? [subAgency, parentAgency, name] : [subAgency, name];
  const keys = lookups.map((s) => normalizeAgencyKey(s || '')).filter(Boolean);
  return keys.reduce((best, k) => Math.max(best, categoryTotalByKey[k] || 0), 0);
}

// Derive SEARCH KEYWORDS moved to @/lib/market/keyword-coverage (deriveCoverageKeywords).

/**
 * Apply the market's place-of-performance state scope to a raw USASpending filter
 * object, matching how find-agencies scopes its search. Centralized so EVERY
 * USASpending call in this route scopes states the same way — the $116B/FERC bug
 * was the states dimension reaching find-agencies but NOT spending_by_category
 * because each call hand-built its own filter. Any new USASpending call must run
 * its filter through this (and read scope from the single `marketScope` object).
 */
function applyStateScope(filter: Record<string, unknown>, states: string[]): Record<string, unknown> {
  if (states.length > 0) {
    filter.place_of_performance_locations = states.map((state) => ({ country: 'USA', state }));
  }
  return filter;
}

/**
 * Dev/observability tripwire: the headline market total and the displayed rows
 * must be in the same ballpark, and no sub-agency can out-spend its own parent
 * department. When either invariant breaks, the numbers came from MISMATCHED
 * scopes (e.g. national total vs state-scoped rows) — log loudly so it's caught
 * in review/logs instead of by a user staring at $116B. Never throws.
 */
function reconcileMarketTotals(opts: {
  authoritativeMarketTotal: number;
  rows: Array<{ name?: string; totalSpending?: number; metric_top_total?: number }>;
  states: string[];
}): void {
  try {
    const { authoritativeMarketTotal, rows, states } = opts;
    if (!rows.length) return;
    const topRow = Math.max(...rows.map((r) => r.metric_top_total || r.totalSpending || 0));
    // A single agency/office can't exceed the WHOLE market total by a wide margin.
    // >2× means a row carries a broader (e.g. national/parent) figure than the
    // headline — the exact shape of the scope-mismatch + parent-inheritance bugs.
    if (authoritativeMarketTotal > 0 && topRow > authoritativeMarketTotal * 2) {
      console.warn(
        `[target-market-research] RECONCILE: top row ($${Math.round(topRow / 1e6)}M) exceeds the ` +
        `market total ($${Math.round(authoritativeMarketTotal / 1e6)}M) by >2× — likely a scope ` +
        `mismatch (rows vs headline) or a sub-agency inheriting a parent total. states=[${states.join(',')}]`,
      );
    }
  } catch { /* observability only — never affect the response */ }
}

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

// OSBP resolver (#29): match the contracting OFFICE/command against the stable
// 170-command directory FIRST (so NAVFAC → its own OSBP, not the Navy-wide one),
// then fall back to sub-agency/parent. Built once, cached.
type SmallBizOffice = { name?: string; director?: string; email?: string; phone?: string; address?: string };
let _commandOsbpIndex: Array<{ keys: string[]; sb: SmallBizOffice }> | null = null;
function commandOsbpIndex() {
  if (_commandOsbpIndex) return _commandOsbpIndex;
  _commandOsbpIndex = [];
  for (const c of getAllCommands()) {
    const sb = (c as { smallBusinessOffice?: SmallBizOffice }).smallBusinessOffice;
    if (!sb?.director) continue;
    const keys = [c.abbreviation, c.fullName].filter(Boolean).map(s => String(s).toUpperCase());
    _commandOsbpIndex.push({ keys, sb });
  }
  return _commandOsbpIndex;
}
function resolveOsbp(office?: string, subAgency?: string, parentAgency?: string): SmallBizOffice | null {
  const officeU = (office || '').toUpperCase();
  if (officeU) {
    // Command-specific match: the office name contains the command's abbrev/name.
    for (const entry of commandOsbpIndex()) {
      if (entry.keys.some(k => k.length >= 3 && (officeU.includes(k) || k.includes(officeU)))) return entry.sb;
    }
  }
  // Fall back to the agency-level OSBP (sub-agency, then parent).
  return getEnhancedAgencyInfo(office || subAgency || parentAgency || '', subAgency || '', parentAgency || '').smallBusinessContact
    || getEnhancedAgencyInfo(subAgency || '', subAgency || '', parentAgency || '').smallBusinessContact
    || null;
}

interface FindAgenciesAgency {
  id: string;
  name: string;
  contractingOffice?: string;
  subAgency?: string;
  parentAgency?: string;
  hasSpecificOffice?: boolean;
  agencyCode?: string;
  subAgencyCode?: string;
  officeId?: string;
  location?: string;
  setAsideSpending: number;
  contractCount: number;
  satSpending?: number;
  satContractCount?: number;
  microSpending?: number;
  microContractCount?: number;
  priorityScore?: number;
  avgBidders?: number | null;        // Added 2026-05-25: USAspending Number of Offers avg
  uniqueVendorCount?: number;        // Added 2026-05-25: distinct primes who won at this office
}

interface TargetMarketResearchRow {
  // Identity
  id: string;
  name: string;
  contractingOffice: string;
  subAgency: string;
  parentAgency: string;
  officeId: string;
  location: string;

  // USASpending money signals
  setAsideSpending: number;
  totalSpending: number;           // ALL contracts (no set-aside filter)
  contractCount: number;
  satSpending: number;
  satContractCount: number;

  // Pre-computed sort metrics. Each is a number 0..∞ so the UI
  // can just sort DESC on whichever the user picked.
  metric_top_spending: number;     // = setAsideSpending
  metric_top_total: number;        // = totalSpending — surfaces market giants like USACE
  metric_contracts: number;        // = contractCount
  metric_easy_entry: number;       // satContractCount / max(contractCount,1)
  metric_budget_growth: number;    // YoY % growth (not yet computed — 0 for v1)

  // Enrichments
  painPointCount: number;          // # pain points logged for this agency
  openOppCount: number;            // # current SAM opps
  upcomingEventCount: number;      // # events in next 90 days

  // Decision intel added 2026-05-25 for the triage card (StartTrackingModal).
  // Surfaces competitive density signals so users can pick smart targets,
  // not just biggest-spender targets.
  avgBidders: number | null;       // Avg # of offers received per contract; null if no data
  uniqueVendorCount: number;       // Distinct primes who won at this office (Recipient Name dedupe)
  smallBizPercent: number | null;  // From SBA Goaling Report (FY23). Null if no data for parent.
  topPrimes: Array<{ name: string; contractCount?: number; totalValue?: number }>;  // Top 3 incumbents

  // Display flags so the UI can render chips inline with the row
  hasOSBP: boolean;                // We have an OSBP contact for this agency
  osbp: { name?: string; director?: string; email?: string; phone?: string; address?: string } | null;  // Small Business office (stable command directory)
  isSubAgency: boolean;
  satRatio: number;                // 0..1, for the "Easy Entry" badge
}

interface FindAgenciesPayload {
  success: boolean;
  agencies?: FindAgenciesAgency[];
  totalCount?: number;
  totalSpending?: number;
  satSummary?: unknown;
  error?: string;
  // When find-agencies rejects the NAICS itself (validateNaicsCode failed),
  // it returns error:'invalid_naics' plus a human message + replacement codes.
  // Pass these through so the user gets a recovery path, not a dead end.
  naicsValidationError?: string;
  suggestedNaicsCodes?: Array<{ code: string; name: string }>;
  message?: string;
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();

  try {
    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const {
      naicsCode: rawNaicsCode,
      keyword,
      profileKeywords: rawProfileKeywords,
      businessType = '',
      veteranStatus = '',
      zipCode = '',
      pscCode = '',
      excludeDOD = false,
      locationStates = [],
      email,
    } = body as {
      naicsCode?: string;
      keyword?: string;        // KEYWORD-FIRST (#59): "drones" → Mindy auto-derives the NAICS set
      profileKeywords?: string[]; // Auto mode: saved profile keywords unioned into agency discovery
      businessType?: string;
      veteranStatus?: string;
      zipCode?: string;
      pscCode?: string;
      excludeDOD?: boolean;
      locationStates?: string[]; // States filter — scopes spend to these states (place of perf)
      email?: string;
    };

    if (!email) {
      return NextResponse.json({ error: 'email is required' }, { status: 400 });
    }

    // DEFAULT THE SET-ASIDE TO SMALL BUSINESS (Eric, Jun 23, 2026). With no
    // business type chosen, the WITH-set-aside pass collapsed to raw total, so
    // the "Set-Aside $" column mirrored "Total $" on every row (meaningless).
    // Default to general Total Small Business set-aside (setAsideMap['Small
    // Business'] = SBA/SBP) so the column always shows a real carve-out. A user
    // who picks a specific socioeconomic type (8(a)/SDVOSB/WOSB/HUBZone) still
    // overrides this. The no-set-aside TOTAL pass below stays at '' regardless.
    const effectiveBusinessType = (businessType || '').trim() || 'Small Business';

    // KEYWORD-FIRST resolution (#59 — Eric: NAICS is the wrong primary key; a
    // keyword like "drones" sprawls across 70+ codes and the obvious code is both
    // over-broad AND incomplete). When a keyword is given (and no explicit NAICS),
    // auto-derive the NAICS set that covers ~90% of that keyword's real market —
    // the user never manages codes. We attach coverage stats for the UI.
    let naicsCode = rawNaicsCode;
    let coverage: Awaited<ReturnType<typeof keywordCoverage>> | null = null;
    if (keyword && keyword.trim()) {
      // Always compute coverage when a keyword is present — it powers the LESSON
      // banner (total market, code count, hidden %). Sport mode also pins
      // suggest-codes chips into formData for report generation — but the agency
      // search MUST use the full 90%-coverage set from the keyword, not those
      // top-8 chips (Eric: every keyword returned the same ~96 agencies).
      coverage = await keywordCoverage(keyword.trim());
      if (coverage && coverage.coverageCodes.length) {
        naicsCode = coverage.coverageCodes.join(', ');
      }
    }

    // At least one classifier required — NAICS OR PSC OR a resolvable keyword.
    const hasNaics = !!(naicsCode && naicsCode.trim());
    const hasPsc = !!(pscCode && pscCode.trim());
    if (!hasNaics && !hasPsc) {
      return NextResponse.json({
        error: keyword ? `Couldn't find a federal market for "${keyword}". Try a broader term.` : 'naicsCode, pscCode, or keyword is required',
      }, { status: 400 });
    }
    // Normalize to definite strings for all downstream uses (cache key
    // + find-agencies bodies). Either may be '' now that PSC-only is
    // valid — find-agencies crosswalks PSC→NAICS when NAICS is blank.
    const naics = (naicsCode || '').trim();
    const psc = (pscCode || '').trim();

    const profileKeywords = Array.isArray(rawProfileKeywords)
      ? rawProfileKeywords.map((k) => String(k).trim()).filter((k) => k.length >= 3).slice(0, 5)
      : [];
    const searchKeywords = buildSearchKeywords({ keyword, coverage, profileKeywords });
    const marketFilter = buildMarketFilter({ coverage, pscCode: psc, keyword });

    // Tier check. Free users still see data, just fewer rows.
    const access = await verifyMIAccess(email);
    const isFree = access.tier === 'free' && !access.isStaff;

    // Normalize the states filter so it participates in the cache key (different
    // state selections = different markets = different cache rows). No states column
    // exists on the cache table, so fold it into naics_code (avoids a migration).
    const normStates = (Array.isArray(locationStates) ? locationStates : [])
      .map((s) => String(s).trim().toUpperCase()).filter((s) => /^[A-Z]{2}$/.test(s)).sort();
    const stateSuffix = normStates.length ? `|st:${normStates.join(',')}` : '';

    // SINGLE SOURCE OF TRUTH for the market scope. Every USASpending call below
    // derives its filter from THIS object — the $116B/FERC bug was the `states`
    // dimension reaching find-agencies but not spending_by_category because each
    // call hand-assembled its own filter. To add a filter dimension: add it here,
    // then thread it into both the find-agencies body AND the category filter.
    const marketScope = {
      naics,
      psc,
      searchKeywords,
      marketFilter,
      states: normStates,                 // place of performance (2-letter codes)
      businessType: effectiveBusinessType,
      veteranStatus: veteranStatus || '',
      zipCode,
      excludeDOD,
    };

    // Cache schema version. Bump when the COMPUTED figures change so stale rows
    // (24h TTL) don't serve old numbers. sv2 = state-scoped authoritative total +
    // sub-agencies no longer inherit the parent department's national total.
    const SPEND_SCHEMA_VERSION = 'sv2';
    const cacheKey = {
      naics_code: `${naics}${stateSuffix}|${SPEND_SCHEMA_VERSION}`,
      psc_code: psc,
      business_type: effectiveBusinessType,
      veteran_status: veteranStatus || '',
    };

    // Try cache first. 24h TTL. Cache misses (no row OR old row) fall
    // through to the live merge. Stale rows are overwritten by the
    // upsert at the bottom of the success path.
    const supabase = getSupabase();
    // SKIP the cache for KEYWORD searches. The cached return path doesn't include
    // keyword_coverage (the lesson banner + derived keywords), so a cache hit made
    // them vanish — "drones" showed no coverage/keywords while a fresh keyword
    // ("cybersecurity") worked. Keyword research is exploratory + teaching; always
    // compute it live so the coverage + keyword output is present and current.
    const skipCache = Boolean(keyword && keyword.trim()) || searchKeywords.length > 0;
    try {
      const { data: cacheRow } = skipCache ? { data: null } : await supabase
        .from('agency_target_data_cache')
        .select('*')
        .eq('naics_code', cacheKey.naics_code)
        .eq('psc_code', cacheKey.psc_code)
        .eq('business_type', cacheKey.business_type)
        .eq('veteran_status', cacheKey.veteran_status)
        .maybeSingle();

      if (cacheRow && cacheRow.generated_at) {
        const age = Date.now() - new Date(cacheRow.generated_at).getTime();
        const rows = (cacheRow.agencies || []) as TargetMarketResearchRow[];

        // Freshness gate. We used to ALSO force-refetch any cache whose
        // rows all had satSpending=0, to recover from an old broken code
        // path that wrote zeros for everyone. But that wrongly rejects
        // LEGITIMATE no-SAT results — e.g. PSC D316 (IT/cyber data
        // backup) buys above the $350K SAT threshold, so every row
        // genuinely has satSpending=0 and the cache could never hit.
        // The all-zero bug is moot now that the cache is psc-keyed on a
        // freshly-created table, so we trust any NON-EMPTY cached row
        // set and only treat an empty payload as stale.
        const cacheUsable = rows.length > 0;

        if (age < CACHE_TTL_MS && cacheUsable) {
          const sliced = isFree ? rows.slice(0, FREE_TIER_ROW_LIMIT) : rows;
          return NextResponse.json({
            success: true,
            agencies: sliced,
            total_count: rows.length,
            total_spending: cacheRow.total_spending,
            // Reconciled figure stashed in source_versions; fall back to total_spending.
            relevant_spending: cacheRow.source_versions?.relevant_spending || cacheRow.total_spending || 0,
            spend_window_label: MARKET_SPEND_WINDOW_LABEL,
            sat_summary: cacheRow.sat_summary,
            cached: true,
            cache_age_ms: age,
            free_tier_limited: isFree && rows.length > FREE_TIER_ROW_LIMIT,
          });
        }
      }
    } catch (cacheErr) {
      // Cache lookup is best-effort. Log and proceed to live merge.
      console.warn('[target-market-research] cache lookup failed (proceeding live):', cacheErr);
    }

    // Cache miss / stale. Two parallel find-agencies calls:
    //   (1) WITH set-aside filter -> per-office SET-ASIDE spend (existing)
    //   (2) WITHOUT set-aside filter -> per-office TOTAL spend
    // The second pass uses businessType/veteranStatus='' which short-
    // circuits the set-aside code build inside find-agencies, so we
    // get the raw total-contract spending per office (still filtered
    // by naics + state). Lets USACE/NAVFAC surface as the giants they
    // are even though only a slice of their work is set-aside.
    const findAgenciesStart = Date.now();
    // SAME-ORIGIN base URL from the incoming request — never a stale env var that may
    // point at an old (now-redirecting) domain. See internalBaseUrl() for the full bug.
    const baseUrl = internalBaseUrl(request);
    const findAgenciesInit = {
      method: 'POST' as const,
      headers: { 'Content-Type': 'application/json' },
      redirect: 'follow' as const, // belt + suspenders if a redirect ever sneaks in
    };
    const findAgenciesBody = (withSetAside: boolean) => JSON.stringify({
      naicsCode: marketScope.marketFilter ? '' : marketScope.naics,
      businessType: withSetAside ? marketScope.businessType : '',
      veteranStatus: withSetAside ? marketScope.veteranStatus : '',
      zipCode: marketScope.zipCode,
      locationStates: marketScope.states,   // states from the single scope object
      pscCode: marketScope.marketFilter ? '' : marketScope.psc,
      excludeDOD: marketScope.excludeDOD,
      searchKeywords: marketScope.searchKeywords,
      marketFilter: marketScope.marketFilter || undefined,
    });
    const [findRes, totalRes] = await Promise.all([
      fetch(`${baseUrl}/api/usaspending/find-agencies`, {
        ...findAgenciesInit,
        body: findAgenciesBody(true),
      }),
      fetch(`${baseUrl}/api/usaspending/find-agencies`, {
        ...findAgenciesInit,
        body: findAgenciesBody(false),
      }),
    ]);
    const findData = (await findRes.json()) as FindAgenciesPayload;
    const totalData = (await totalRes.json().catch(() => ({ success: false }))) as FindAgenciesPayload;
    const findAgenciesMs = Date.now() - findAgenciesStart;

    if (!findData.success || !findData.agencies || findData.agencies.length === 0) {
      // If find-agencies rejected the NAICS itself (invalid_naics), surface the
      // real reason + suggested replacement codes instead of the generic
      // "no matching agencies" dead end. This is what a profile with a stale /
      // malformed NAICS hits (e.g. a code half-replaced in onboarding) — the
      // user needs to know the code is bad, not that the market is empty.
      const isInvalidNaics = findData.error === 'invalid_naics';
      return NextResponse.json({
        success: false,
        error: isInvalidNaics
          ? 'invalid_naics'
          : (findData.error || 'No matching agencies found for this NAICS.'),
        message: isInvalidNaics
          ? (findData.message || findData.naicsValidationError || `The NAICS code "${naics}" isn't valid. Pick a suggested code or update your profile.`)
          : undefined,
        naicsValidationError: findData.naicsValidationError,
        suggestedNaicsCodes: findData.suggestedNaicsCodes,
        agencies: [],
        total_count: 0,
      });
    }

    const findAgencies = findData.agencies;

    // ACCURATE TOTAL SPEND (Eric: USACE/NAVFAC weren't surfacing — the sampled
    // award re-aggregation under-counts the giants). USASpending's
    // spending_by_category gives the TRUE aggregate spend per subagency for the
    // NAICS — the same source the FPDS leaderboard uses. We map it by normalized
    // agency name and use it as the authoritative metric_top_total. Falls back
    // to the sampled total when an agency isn't in the category response.
    const categoryTotalByKey: Record<string, number> = {};
    // Authoritative market total from spending_by_category at the DEPARTMENT level
    // (awarding_agency). Departments don't overlap, so summing them gives the true
    // market size WITHOUT the double-count you'd get summing sampled award rows.
    // This is what the top "Relevant spending" card should show (#2 reconciliation).
    let authoritativeMarketTotal = 0;
    const keywordGrounded = Boolean(marketFilter);
    try {
      // expandFullCodes=false: 6-digit codes stay EXACT so the authoritative
      // "Relevant spending" total reflects the SEARCHED market, not the whole
      // 3-digit subsector (was inflating 541512 → all of 541xxx, 7×). Prefixes
      // still expand. Matches find-agencies + fpds-top-n.
      const expanded = expandNAICSCodes(parseNAICSInput(naics), false);
      const catFilterBase: Record<string, unknown> = {
        // Canonical 3-FY window shared with find-agencies + fpds-top-n so the
        // accurate-total figures reconcile with the rest of the dashboard.
        time_period: [{ start_date: MARKET_SPEND_WINDOW.start_date, end_date: MARKET_SPEND_WINDOW.end_date }],
        award_type_codes: ['A', 'B', 'C', 'D'],
      };
      if (marketFilter) {
        Object.assign(catFilterBase, marketFilterToUsaspending(marketFilter));
      } else if (expanded.length > 0) {
        catFilterBase.naics_codes = expanded;
      }
      // Scope the authoritative total to the SAME states as the agency search
      // (place of performance), via the shared helper + single marketScope. Without
      // this the headline "Relevant spending" + the Total $ column showed NATIONAL
      // figures while the agency list was state-scoped — FL/GA janitorial read as
      // $116B and FERC inherited Department of Energy's national $65.9B.
      applyStateScope(catFilterBase, marketScope.states);
      if (marketFilter || expanded.length > 0) {
        // Sub-agency + parent department totals (keyword or NAICS). Parent-level
        // keys let DoD/HHS rank correctly; sub-agency keys surface USACE/Navy.
        for (const category of ['awarding_subagency', 'awarding_agency'] as const) {
          const catRes = await fetch('https://api.usaspending.gov/api/v2/search/spending_by_category', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              category,
              filters: catFilterBase,
              subawards: false, limit: 100, page: 1,
            }),
          });
          if (!catRes.ok) continue;
          const catJson = await catRes.json();
          const catResults = (catJson.results || []) as Array<{ name: string; amount: number }>;
          for (const r of catResults) {
            const k = normalizeAgencyKey(r.name || '');
            if (k) categoryTotalByKey[k] = Math.max(categoryTotalByKey[k] || 0, r.amount || 0);
          }
          // Department-level pass = the authoritative non-overlapping market total.
          if (category === 'awarding_agency') {
            authoritativeMarketTotal = catResults.reduce((s, r) => s + (r.amount || 0), 0);
          }
        }
      }
    } catch (catErr) {
      console.warn('[target-market-research] spending_by_category total failed:', catErr);
    }

    // Build officeId -> totalSpending map from the no-set-aside pass.
    // Same officeId scheme as the primary pass (find-agencies dedupes
    // by parentAgency+subAgency+contractingOffice), so the lookup is
    // a straight string match. Falls back to 0 when the office didn't
    // appear in the total pass at all (rare: would mean it has set-
    // aside spend but no other spend, which can't happen).
    const totalSpendingByOffice: Record<string, number> = {};
    if (totalData.success && Array.isArray(totalData.agencies)) {
      for (const t of totalData.agencies) {
        const key = t.officeId || t.subAgencyCode || t.agencyCode || t.id || '';
        if (key) totalSpendingByOffice[key] = t.setAsideSpending || 0;
      }
    }

    // Enrichment 1: open SAM opps per agency. Counts were ALWAYS 0 because
    // the old code matched sam_opportunities.department EXACTLY against the
    // spending-side agency names — but the formats differ ("DEPT OF DEFENSE"
    // vs "Department of Defense", "VETERANS AFFAIRS, DEPARTMENT OF" vs
    // "Department of Veterans Affairs"). Exact .in() never matched. Fix: pull
    // ALL future-deadline opps grouped by department and bucket by a NORMALIZED
    // key (core agency tokens, filler stripped), then look up rows by the same
    // normalized key. (Eric 2026-06-04: "open opportunities column shows 0".)
    const oppsStart = Date.now();
    const oppCounts: Record<string, number> = {};   // keyed by normalizeAgencyKey()
    try {
      const { data: oppRows } = await supabase
        .from('sam_opportunities')
        .select('department')
        .gte('response_deadline', new Date().toISOString());
      for (const row of oppRows || []) {
        const key = normalizeAgencyKey(row.department || '');
        if (!key) continue;
        oppCounts[key] = (oppCounts[key] || 0) + 1;
      }
    } catch (oppErr) {
      console.warn('[target-market-research] sam_opportunities count failed:', oppErr);
    }
    const oppsMs = Date.now() - oppsStart;

    // Enrichment 2: upcoming events per agency (next 90 days). Same
    // pattern. Uses sam_events from
    // tasks/PRD-federal-events-database.md.
    const eventsStart = Date.now();
    const eventHorizon = new Date();
    eventHorizon.setDate(eventHorizon.getDate() + EVENT_HORIZON_DAYS);
    const eventCounts: Record<string, number> = {};   // keyed by normalizeAgencyKey()
    try {
      const { data: eventRows } = await supabase
        .from('sam_events')
        .select('agency')
        .gte('event_date', new Date().toISOString().slice(0, 10))
        .lte('event_date', eventHorizon.toISOString().slice(0, 10));
      for (const row of eventRows || []) {
        const key = normalizeAgencyKey(row.agency || '');
        if (!key) continue;
        eventCounts[key] = (eventCounts[key] || 0) + 1;
      }
    } catch (eventErr) {
      console.warn('[target-market-research] sam_events count failed:', eventErr);
    }
    const eventsMs = Date.now() - eventsStart;

    // Enrichment 3: pain points per agency. Synchronous JSON lookup —
    // no async cost. Pre-warm a NAICS-keyed list once so we know which
    // agencies have NAICS-aligned pain points specifically (vs any
    // pain point logged at the agency).
    const painStart = Date.now();
    // PSC-only searches have no NAICS — getPainPointsByNaics('')
    // returns nothing, which is the right behavior (pain points are
    // NAICS-indexed; PSC alignment isn't available here).
    const naicsAlignedPainAgencies = new Set(
      naics ? getPainPointsByNaics(naics).map((r) => r.agency.toLowerCase()) : []
    );
    const painMs = Date.now() - painStart;

    // Enrichment 4 (triage card intel v1, 2026-05-25): SBA Goaling
    // small-business share per parent agency. One bulk query for the
    // whole FY (~200 rows total — multiple rows per dept, one per
    // category like 'Not a Small Business', 'Small Business', etc).
    //
    // Computation mirrors /api/sba-goaling/bulk: share = 1 - (nonSB / total).
    // Name matching uses normalizeAgency() — lowercase, strip
    // 'department of', 'dept', 'the', punctuation — then bidirectional
    // substring match. Fixes 'Interior, Department of' (SBA Goaling
    // format) vs 'Department of the Interior' (USAspending format).
    //
    // Stores TWO maps: by-normalized for lookup, by-display for debug.
    // Lookup at row-time normalizes the parentAgency the same way.
    const sbaStart = Date.now();
    const normalizeSbaAgency = (name: string): string =>
      (name || '')
        .toLowerCase()
        .replace(/,/g, ' ')
        .replace(/\bdepartment of\b/g, '')
        .replace(/\bdept(\.|of)?\b/g, '')
        .replace(/\bthe\b/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    const smallBizByNormalized = new Map<string, number>();
    try {
      const { data: goalingRows } = await supabase
        .from('sba_goaling')
        .select('funding_department, category, dollars, total')
        .eq('fiscal_year', 2023);
      const deptStats = new Map<string, { total: number; nonSb: number; normalized: string }>();
      for (const row of (goalingRows || []) as Array<{ funding_department: string; category: string; dollars: number; total: number }>) {
        const dept = row.funding_department;
        if (!dept) continue;
        if (!deptStats.has(dept)) {
          deptStats.set(dept, {
            total: Number(row.total || 0),
            nonSb: 0,
            normalized: normalizeSbaAgency(dept),
          });
        }
        if (row.category === 'Not a Small Business') {
          const stats = deptStats.get(dept)!;
          stats.nonSb = Number(row.dollars || 0);
        }
      }
      for (const { total, nonSb, normalized } of deptStats.values()) {
        if (total > 0 && normalized) {
          smallBizByNormalized.set(normalized, 1 - (nonSb / total));
        }
      }
    } catch (sbaErr) {
      console.warn('[target-market-research] SBA Goaling fetch failed:', sbaErr);
    }
    const sbaMs = Date.now() - sbaStart;
    // Bidirectional substring match — mirrors /api/sba-goaling/bulk.
    // Tries exact normalized match first, then either-direction
    // substring fallback so 'navy' matches 'department of the navy'.
    const lookupSmallBiz = (parentAgency: string): number | null => {
      const wanted = normalizeSbaAgency(parentAgency);
      if (!wanted) return null;
      const exact = smallBizByNormalized.get(wanted);
      if (exact !== undefined) return exact;
      for (const [normalized, share] of smallBizByNormalized.entries()) {
        if (normalized.includes(wanted) || wanted.includes(normalized)) return share;
      }
      return null;
    };

    // Enrichment 5 (triage card intel v1, 2026-05-25): top-3 incumbent
    // primes per office. Pre-build a (subAgency|parentAgency) -> top 3
    // primes map by sorting prime-contractors-database.json entries by
    // contract value. getPrimesByAgency() does a fuzzy substring match
    // so we just call it once per unique lookup key.
    const primesStart = Date.now();
    const primesByAgencyKey = new Map<string, Array<{ name: string; contractCount?: number; totalValue?: number }>>();
    function loadPrimesForKey(key: string) {
      if (!key || primesByAgencyKey.has(key)) return;
      const primes = getPrimesByAgency(key);
      const top3 = primes
        .sort((p1, p2) => (p2.totalContractValue || 0) - (p1.totalContractValue || 0))
        .slice(0, 3)
        .map(p => ({
          name: p.name,
          contractCount: p.contractCount ?? undefined,
          totalValue: p.totalContractValue ?? undefined,
        }));
      primesByAgencyKey.set(key, top3);
    }
    const primesMs = Date.now() - primesStart;

    // Build the merged research rows. Each row gets all 4 sort
    // metrics pre-computed so the UI can sort without re-fetching.
    const rows: TargetMarketResearchRow[] = findAgencies.map((a) => {
      const lookupKey = a.subAgency || a.parentAgency || a.name;
      const painData = getPainPointsForAgency(lookupKey || '');
      // AgencyPainPoints exposes painPoints[] + priorities[]; we
      // surface the combined count so the UI can show one "signal
      // strength" number per agency.
      const painPointCount = painData
        ? (painData.painPoints?.length || 0) + (painData.priorities?.length || 0)
        : 0;
      // Match opps/events by NORMALIZED agency key. SAM opps/events are keyed
      // by top-level DEPARTMENT, so try the row's parent department first, then
      // sub-agency / name. (This is what fixed the always-0 columns.)
      const oppKeyCandidates = [a.parentAgency, a.subAgency, a.name, lookupKey]
        .map(s => normalizeAgencyKey(s || ''))
        .filter(Boolean);
      const openOppCount = oppKeyCandidates.reduce((n, k) => n || oppCounts[k] || 0, 0);
      const upcomingEventCount = oppKeyCandidates.reduce((n, k) => n || eventCounts[k] || 0, 0);
      const satRatio = (a.contractCount && a.contractCount > 0)
        ? (a.satContractCount || 0) / a.contractCount
        : 0;
      const naicsAligned = naicsAlignedPainAgencies.has((lookupKey || '').toLowerCase());

      const lookupOfficeKey = a.officeId || a.subAgencyCode || a.agencyCode || a.id || '';
      // PER-OFFICE spend (Eric bug: every Army office showed the same $22.5B —
      // the sub-agency-wide category total was being stamped on each office row).
      // For an office-level row, use the office's OWN accumulated award spend
      // (a.totalSpending / a.setAsideSpending from find-agencies). The sub-agency
      // category aggregate is only the right number for a SUB-AGENCY-level row
      // (no distinct contractingOffice) — never stamp it on every office.
      const isOfficeLevel = !!(a.contractingOffice && a.contractingOffice !== a.subAgency && a.contractingOffice !== a.parentAgency);
      // The office's OWN accumulated award spend (find-agencies sums real awards
      // per office into setAsideSpending). This is the per-office number — use it
      // FIRST. Do NOT use totalSpendingByOffice[lookupOfficeKey] for office rows:
      // lookupOfficeKey falls back to subAgencyCode when officeId is empty, so it
      // returns the whole sub-agency total (the $22.5B-on-every-Army-office bug).
      const officeOwnTotal = a.setAsideSpending || totalSpendingByOffice[a.officeId || ''] || 0;
      const accurateTotal = categoryTotalForAgency(
        categoryTotalByKey,
        a.subAgency,
        a.parentAgency,
        a.name,
      );
      // Office row → its own spend. Agency/sub-agency rollup row → the accurate
      // category total (so the real giants still rank correctly).
      const totalSpending = isOfficeLevel
        ? officeOwnTotal
        : ((accurateTotal && accurateTotal > officeOwnTotal) ? accurateTotal : officeOwnTotal);
      // Keyword searches: ONLY USAspending category totals for this keyword — never
      // the NAICS-sample setAsideSpending (Eric: DOE $2B / NASA $6B on Set-Aside lens
      // while real keyword "excel" has DoD ~$380M, DOE ~$20M per spending_by_category).
      const metric_top_total = keywordGrounded
        ? accurateTotal
        : (accurateTotal > 0 ? accurateTotal : totalSpending);

      return {
        id: a.id,
        name: a.name,
        contractingOffice: a.contractingOffice || a.name,
        subAgency: a.subAgency || '',
        parentAgency: a.parentAgency || '',
        officeId: a.officeId || a.subAgencyCode || a.agencyCode || '',
        location: a.location || '',

        setAsideSpending: a.setAsideSpending || 0,
        totalSpending,
        contractCount: a.contractCount || 0,
        satSpending: a.satSpending || 0,
        satContractCount: a.satContractCount || 0,

        // Pre-computed sort metrics. Higher is better for all of them.
        metric_top_spending: keywordGrounded ? accurateTotal : (a.setAsideSpending || 0),
        metric_top_total,
        metric_contracts: a.contractCount || 0,
        // Easy Entry score combines SAT ratio (% of contracts under
        // $250K) with raw SAT count, so agencies with 80% SAT but only
        // 2 contracts don't beat agencies with 60% SAT and 50
        // contracts. Sqrt smoothing on count to avoid runaway.
        metric_easy_entry: satRatio * Math.sqrt(a.satContractCount || 0),
        metric_budget_growth: 0, // TODO: compute from FY/FY budget delta in Slice 2

        painPointCount: painPointCount + (naicsAligned ? 5 : 0), // boost for NAICS-aligned
        openOppCount,
        upcomingEventCount,

        // Decision intel: passed through from find-agencies aggregation
        avgBidders: a.avgBidders ?? null,
        uniqueVendorCount: a.uniqueVendorCount || 0,
        // Small biz % from SBA Goaling FY23 (parent-agency level).
        // Uses bidirectional substring match — handles 'Department of
        // the Interior' (USAspending) vs 'Interior, Department of'
        // (SBA Goaling) name format differences.
        smallBizPercent: lookupSmallBiz(a.parentAgency || a.subAgency || a.name || ''),
        // Top 3 incumbent primes for this office (fuzzy match on
        // sub-agency name first, falls back to parent). Cached per key
        // in this request scope.
        topPrimes: (() => {
          const subKey = a.subAgency || a.parentAgency || a.name || '';
          loadPrimesForKey(subKey);
          let result = primesByAgencyKey.get(subKey) || [];
          if (result.length === 0 && a.parentAgency && a.parentAgency !== subKey) {
            loadPrimesForKey(a.parentAgency);
            result = primesByAgencyKey.get(a.parentAgency) || [];
          }
          return result;
        })(),

        // OSBP from the stable 170-command directory (#29). Most-specific first:
        // match the contracting OFFICE/command directly (NAVFAC → Noel Rodriguez,
        // not the Navy-wide OSBP), else fall back to the sub-agency/parent OSBP.
        ...(() => {
          const sb = resolveOsbp(a.contractingOffice, a.subAgency, a.parentAgency);
          const osbp = sb?.director && !/ OSBP Director$/.test(sb.director)
            ? { name: sb.name, director: sb.director, email: sb.email, phone: sb.phone, address: sb.address }
            : (sb ? { name: sb.name, email: sb.email, phone: sb.phone, address: sb.address } : null); // keep office even if director is generic
          return { osbp, hasOSBP: !!osbp };
        })(),
        isSubAgency: !!a.subAgency && a.subAgency !== a.parentAgency,
        satRatio,
      };
    });

    // Default sort: top total $ (matches UI default lens + FPDS leaderboards).
    rows.sort((x, y) => y.metric_top_total - x.metric_top_total);

    // Tripwire (#2): the headline total and the rows must come from the SAME
    // scope. If the top row dwarfs the market total, the numbers are mismatched
    // (national vs state-scoped, or a sub-agency carrying a parent figure) — the
    // shape of the bug we just fixed. Logs loudly; never blocks the response.
    reconcileMarketTotals({
      authoritativeMarketTotal: authoritativeMarketTotal || findData.totalSpending || 0,
      rows,
      states: marketScope.states,
    });

    // Persist to cache. Idempotent upsert. Failures are non-fatal — we
    // still return the live data to the user.
    try {
      await supabase
        .from('agency_target_data_cache')
        .upsert({
          naics_code: cacheKey.naics_code,
          psc_code: cacheKey.psc_code,
          business_type: cacheKey.business_type,
          veteran_status: cacheKey.veteran_status,
          agencies: rows,
          total_count: rows.length,
          total_spending: findData.totalSpending || 0,
          sat_summary: findData.satSummary || null,
          generated_at: new Date().toISOString(),
          generation_ms: Date.now() - startedAt,
          source_versions: {
            find_agencies_ms: findAgenciesMs,
            opps_ms: oppsMs,
            events_ms: eventsMs,
            pain_ms: painMs,
            // Authoritative category total stashed here (no schema change needed) so
            // cache hits also serve the reconciled "Relevant spending" figure.
            relevant_spending: authoritativeMarketTotal || findData.totalSpending || 0,
          },
        }, { onConflict: 'naics_code,psc_code,business_type,veteran_status' });
    } catch (cacheWriteErr) {
      console.warn('[target-market-research] cache write failed:', cacheWriteErr);
    }

    const sliced = isFree ? rows.slice(0, FREE_TIER_ROW_LIMIT) : rows;

    return NextResponse.json({
      success: true,
      agencies: sliced,
      total_count: rows.length,
      total_spending: findData.totalSpending || 0,
      // Authoritative market total from spending_by_category (department level) —
      // the figure the "Relevant spending" card should show. Falls back to the
      // find-agencies total, then 0, if the category pass failed (#2 reconciliation).
      relevant_spending: authoritativeMarketTotal || findData.totalSpending || 0,
      spend_window_label: MARKET_SPEND_WINDOW_LABEL,
      sat_summary: findData.satSummary,
      // KEYWORD-FIRST coverage (#59) — when researched by keyword, tell the UI the
      // full market: "drones = $245M across 70+ codes; we covered 90%". Lets the
      // panel show coverage instead of asking the user to manage codes.
      keyword_coverage: coverage ? {
        keyword: coverage.keyword,
        total_market: coverage.totalMarket,
        naics_count: coverage.naicsCount,
        codes_used: coverage.coverageCodes.length,
        coverage_pct: Math.round(coverage.coveragePct * 100),
        top_code_pct: Math.round(coverage.topCodePct * 100),
        psc_count: coverage.pscCount,
        top_psc: coverage.topPsc,
        top_psc_pct: Math.round(coverage.topPscPct * 100),
        ranking_mode: marketFilter?.mode || 'keyword',
        ranking_label: marketFilter?.rankingLabel || `keyword "${coverage.keyword}"`,
        uses_psc_ranking: marketFilter?.mode === 'keyword_psc',
        keywords: deriveCoverageKeywords(coverage),
      } : null,
      cached: false,
      generation_ms: Date.now() - startedAt,
      source_versions: {
        find_agencies_ms: findAgenciesMs,
        opps_ms: oppsMs,
        events_ms: eventsMs,
        pain_ms: painMs,
      },
      free_tier_limited: isFree && rows.length > FREE_TIER_ROW_LIMIT,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[target-market-research] error:', err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
