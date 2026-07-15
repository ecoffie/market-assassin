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
import { MARKET_SPEND_WINDOW, MARKET_SPEND_WINDOW_LABEL, setAsideMap, veteranMap } from '@/lib/utils/usaspending-helpers';
import { SIMPLIFIED_ACQUISITION_THRESHOLD } from '@/lib/utils/agency-priority';

// Bounded per-agency contract-count calls (anchored rows, cache-miss only) push the
// worst case past the default; give the function room. Cache hits are instant.
export const maxDuration = 120;
import { dodaacCodesForAgency } from '@/lib/gov-contacts/dodaac-directory';

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
}): number {
  const { authoritativeMarketTotal, rows, states } = opts;
  try {
    if (!rows.length) return authoritativeMarketTotal;
    // Sum of the DISTINCT top-level (parent-department) rows — a conservative
    // floor for the market total. We use the max per parent so multiple offices
    // under one department don't double-count.
    const byParent = new Map<string, number>();
    for (const r of rows) {
      const key = (r.name || '').trim().toLowerCase();
      const v = r.metric_top_total || r.totalSpending || 0;
      if (key && v > byParent.get(key)!) byParent.set(key, v);
      else if (key && !byParent.has(key)) byParent.set(key, v);
    }
    const topRow = Math.max(0, ...rows.map((r) => r.metric_top_total || r.totalSpending || 0));
    // A single agency/office can't exceed the WHOLE market total. When it does,
    // the headline came from a narrower scope than the rows (the $14.5M-headline-
    // over-$1.8B-CMS-row bug, Jul 8). Floor the headline at the largest single
    // component so it can never be smaller than a number shown beneath it.
    if (authoritativeMarketTotal > 0 && topRow > authoritativeMarketTotal * 2) {
      console.warn(
        `[target-market-research] RECONCILE: top row ($${Math.round(topRow / 1e6)}M) exceeds the ` +
        `market total ($${Math.round(authoritativeMarketTotal / 1e6)}M) by >2× — flooring headline to ` +
        `the largest component. states=[${states.join(',')}]`,
      );
      return Math.max(authoritativeMarketTotal, topRow);
    }
    return authoritativeMarketTotal;
  } catch {
    return authoritativeMarketTotal; // never let reconciliation break the response
  }
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
  openOppCount: number;            // # current SAM opps (office-anchored for DoD sub-agencies)
  // For a DoDAAC-anchored DoD sub-agency, the broader department-wide open count
  // — so the UI can be honest when the office count is 0 ("none open at DARPA now;
  // N at DoD-wide"). null for agencies that aren't office-anchored.
  oppCountDodWide?: number | null;
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
      refresh?: boolean;       // staff-only: bypass the 24h cache to force a fresh compute (verification)
    };

    if (!email) {
      return NextResponse.json({ error: 'email is required' }, { status: 400 });
    }
    const wantRefresh = Boolean((body as { refresh?: boolean }).refresh);

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
    // A "keyword" that is really NAICS code(s) (e.g. "236220" or "236220, 238220")
    // must NOT be text-searched — keywordCoverage would run a USASpending keyword
    // search for the literal number (matches nothing meaningful, then ranked NASA
    // for 236220) and balloon it into related codes. Treat it as an exact NAICS
    // input instead. Eric, Jul 15 2026 (defense-in-depth for any caller incl. MCP).
    const kwTrim = (keyword || '').trim();
    const kwTokens = kwTrim ? kwTrim.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean) : [];
    const keywordIsNaics = kwTokens.length > 0 && kwTokens.every((t) => /^\d{2,6}$/.test(t));
    const keywordForCoverage = keywordIsNaics && !(rawNaicsCode && rawNaicsCode.trim())
      ? '' // a numeric NAICS keyword is not a discovery term — use the code path
      : kwTrim;
    if (keywordIsNaics && !(rawNaicsCode && rawNaicsCode.trim())) {
      naicsCode = kwTokens.join(', '); // exact NAICS ranking, no coverage expansion
    } else if (keywordForCoverage) {
      // Always compute coverage when a keyword is present — it powers the LESSON
      // banner (total market, code count, hidden %). Sport mode also pins
      // suggest-codes chips into formData for report generation — but the agency
      // search MUST use the full 90%-coverage set from the keyword, not those
      // top-8 chips (Eric: every keyword returned the same ~96 agencies).
      coverage = await keywordCoverage(keywordForCoverage);
      if (coverage && coverage.coverageCodes.length) {
        naicsCode = coverage.coverageCodes.join(', ');
      }
    }

    // At least one classifier required — NAICS OR PSC OR a resolvable keyword.
    const hasNaics = !!(naicsCode && naicsCode.trim());
    const hasPsc = !!(pscCode && pscCode.trim());
    if (!hasNaics && !hasPsc) {
      return NextResponse.json({
        error: keywordForCoverage ? `Couldn't find a federal market for "${keywordForCoverage}". Try a broader term.` : 'naicsCode, pscCode, or keyword is required',
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
    const searchKeywords = buildSearchKeywords({ keyword: keywordForCoverage, coverage, profileKeywords });
    const marketFilter = buildMarketFilter({ coverage, pscCode: psc, keyword: keywordForCoverage });

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

    // The keyword_coverage payload (#59 lesson banner + derived keywords). Built
    // ONCE here so it can be both returned live AND persisted to the cache — that
    // way a keyword search can be cached without the coverage vanishing on a hit
    // (the original reason keyword searches skipped the cache).
    // A keyword search whose market concentrates in one NAICS ranks by that code
    // (buildMarketFilter suppressed the keyword/PSC filter — DOMINANT_NAICS_SHARE).
    // Reflect that in the lesson banner so it doesn't claim "ranks by keyword" while
    // the chart is actually NAICS-ranked (Eric's NASA-for-236220 report, Jul 15).
    const rankedByDominantNaics = Boolean(coverage?.keyword) && !marketFilter;
    const dominantNaicsCode = rankedByDominantNaics
      ? (coverage!.allNaics?.[0]?.code || coverage!.coverageCodes[0] || '')
      : '';
    const keywordCoveragePayload = coverage ? {
      keyword: coverage.keyword,
      total_market: coverage.totalMarket,
      naics_count: coverage.naicsCount,
      codes_used: coverage.coverageCodes.length,
      coverage_pct: Math.round(coverage.coveragePct * 100),
      top_code_pct: Math.round(coverage.topCodePct * 100),
      psc_count: coverage.pscCount,
      top_psc: coverage.topPsc,
      top_psc_pct: Math.round(coverage.topPscPct * 100),
      ranking_mode: marketFilter?.mode || (rankedByDominantNaics ? 'naics' : 'keyword'),
      ranking_label: marketFilter?.rankingLabel || (rankedByDominantNaics
        ? `NAICS ${dominantNaicsCode} (${Math.round(coverage.topCodePct * 100)}% of this market)`
        : `keyword "${coverage.keyword}"`),
      uses_psc_ranking: marketFilter?.mode === 'keyword_psc',
      keywords: deriveCoverageKeywords(coverage),
    } : null;

    // Cache schema version. Bump when the COMPUTED figures change so stale rows
    // (24h TTL) don't serve old numbers. sv2 = state-scoped authoritative total +
    // sub-agencies no longer inherit the parent department's national total.
    // sv4 = keyword searches are now cached (keyed on the phrase) — bump so the
    // first post-deploy hit for any keyword recomputes once and then stays put.
    // sv5 = agency roster anchored to spending_by_category (complete + stable buyer
    // list); bump so any sv4 rows recompute with the full roster.
    // sv6 = anchored rows now carry authoritative Set-Aside $ + SAT $ columns.
    // sv7 = anchored rows now carry contract COUNT (bounded per-agency count calls).
    // sv8 = fleet-wide flush of any lingering pre-Jul-8 rows (the broadened-sample
    // fallback that showed State #1 at $13.5B for NAICS 236220 vs its true $2.9B,
    // and a $45.1B headline vs the real $94.4B). The compute has been correct since
    // 40fb9413 (Jul 8); this bump orphans every old entry so no stale render survives.
    const SPEND_SCHEMA_VERSION = 'sv8';
    // Stable cache token. KEYWORD searches key on the normalized phrase — the
    // derived NAICS coverage set can drift run-to-run (keywordCoverage re-queries
    // live), so keying on it would miss every repeat and recompute different
    // numbers each time (Eric: "different even using the same search terms").
    // Keying on the phrase makes repeats deterministic + instant. Code searches
    // key on the NAICS set, folding in any profile keywords that also scope it.
    const kwNorm = (keywordForCoverage || '').trim().toLowerCase();
    const cacheToken = kwNorm
      ? `kw:${kwNorm}`
      : `${naics}${searchKeywords.length ? `|sk:${searchKeywords.join(',').toLowerCase()}` : ''}`;
    const cacheKey = {
      naics_code: `${cacheToken}${stateSuffix}|${SPEND_SCHEMA_VERSION}`,
      psc_code: psc,
      business_type: effectiveBusinessType,
      veteran_status: veteranStatus || '',
    };

    // Try cache first. 24h TTL. Cache misses (no row OR old row) fall
    // through to the live merge. Stale rows are overwritten by the
    // upsert at the bottom of the success path.
    const supabase = getSupabase();
    // Keyword searches are now CACHEABLE: the cache key is keyed on the phrase
    // (cacheToken above) and keyword_coverage is persisted in source_versions and
    // returned on a hit, so the lesson banner + derived keywords survive. This
    // makes repeat keyword research deterministic (same phrase → same numbers)
    // AND instant — the fix for "different even using the same search terms" and
    // the "still loading" wait. (Previously keyword/profile-keyword searches
    // skipped the cache, recomputing a live, slightly-different result each time.)
    // Staff can force a fresh compute (bypass the 24h cache) with { refresh: true }
    // — needed to verify a fix without waiting out the TTL. Non-staff can't, so a
    // user can't hammer the expensive USASpending fan-out on demand.
    const skipCache = wantRefresh && access.isStaff;
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
            // #59 lesson banner survives the cache hit (persisted on write below).
            keyword_coverage: cacheRow.source_versions?.keyword_coverage || null,
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
    // find-agencies fans out to USASpending and, on a giant national market (e.g.
    // NAICS 561720 with no state), can itself hit its function budget → Vercel
    // returns a 504 HTML page, NOT JSON. A bare .json() there throws and the whole
    // route 500s with an unparseable-JSON error. Parse defensively: a non-JSON
    // primary response means the upstream timed out → return a clean, actionable
    // "narrow it down" result the panel already knows how to render, instead of a
    // 500. (Bug fix 2026-07-09 — reported as Market Research "Network error".)
    const safeJson = async (res: Response): Promise<FindAgenciesPayload> => {
      const ct = res.headers.get('content-type') || '';
      if (!res.ok || !ct.includes('application/json')) {
        return { success: false, error: res.status >= 500 ? 'upstream_timeout' : 'upstream_error' } as FindAgenciesPayload;
      }
      return (await res.json().catch(() => ({ success: false, error: 'upstream_error' }))) as FindAgenciesPayload;
    };
    const findData = await safeJson(findRes);
    const totalData = await safeJson(totalRes);
    const findAgenciesMs = Date.now() - findAgenciesStart;

    // Upstream (find-agencies) timed out on a market too big to break down in the
    // budget. Tell the user how to make it succeed rather than dead-ending. The
    // panel keys on error==='market_too_large' to show the "narrow it down" copy.
    if (findData.error === 'upstream_timeout') {
      return NextResponse.json({
        success: false,
        error: 'market_too_large',
        message:
          'This market is large enough that the full breakdown timed out. Narrow it down — pick a state, add a set-aside, or use a more specific NAICS/PSC — then try again.',
        agencies: [],
        total_count: 0,
      });
    }

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
    // Authoritative sub-agency roster (name + true total) from spending_by_category.
    // This is the COMPLETE, deterministic list of buyers in this market — used below
    // to anchor the agency rows so the chart/table can't be missing a real buyer just
    // because it didn't land in the sampled-award set (Eric: "it should not change
    // that drastically"). The sampled awards only ENRICH (offices, vendors, SAT).
    const subagencyCategoryTotals: Array<{ name: string; amount: number }> = [];
    // Authoritative per-sub-agency SET-ASIDE $ and SAT-eligible $ (≤ SAT threshold),
    // both from spending_by_category with the matching filter — deterministic, like
    // the total. Used to fill the Set-Aside $ and Easy-Entry/SAT columns on the
    // category-anchored rows (the buyers the award sample missed). Keyed by
    // normalizeAgencyKey(name).
    const setAsideCatByKey: Record<string, number> = {};
    const satCatByKey: Record<string, number> = {};
    // Authoritative market total from spending_by_category at the DEPARTMENT level
    // (awarding_agency). Departments don't overlap, so summing them gives the true
    // market size WITHOUT the double-count you'd get summing sampled award rows.
    // This is what the top "Relevant spending" card should show (#2 reconciliation).
    let authoritativeMarketTotal = 0;
    const keywordGrounded = Boolean(marketFilter);
    // Shared category filter — hoisted out of the try so the anchored-row contract
    // COUNT calls below can reuse the exact same market scope.
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
    const catScopeUsable = Boolean(marketFilter || expanded.length > 0);
    // Tracks whether the AUTHORITATIVE department total (the headline "Relevant
    // spending") was actually obtained. When USASpending's aggregation endpoint
    // 5xx/times-out, this stays false and the headline would silently fall back to
    // the sampled row-sum — a 14× understatement with no signal (e.g. $2.79B shown
    // for a market that's truly $40B). We retry it, and if it STILL fails we flag
    // the response as partial so the UI/caller knows the headline is degraded
    // instead of trusting a wrong-but-plausible number. (Bug found by the
    // verify:data harness, Jul 9 2026.)
    let authoritativeTotalObtained = false;
    // Bounded fetch helper with one retry for a slow/5xx category call. The
    // department total is the headline, so it's worth a second attempt.
    const fetchCategory = async (category: string, retries = 0): Promise<Array<{ name: string; amount: number }> | null> => {
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const res = await fetch('https://api.usaspending.gov/api/v2/search/spending_by_category', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(20_000),
            body: JSON.stringify({ category, filters: catFilterBase, subawards: false, limit: 100, page: 1 }),
          });
          if (res.ok) return ((await res.json()).results || []) as Array<{ name: string; amount: number }>;
        } catch { /* fall through to retry / null */ }
      }
      return null;
    };
    try {
      if (catScopeUsable) {
        // Sub-agency + parent department totals (keyword or NAICS). Parent-level
        // keys let DoD/HHS rank correctly; sub-agency keys surface USACE/Navy.
        for (const category of ['awarding_subagency', 'awarding_agency'] as const) {
          // Retry ONLY the department total (the headline). The sub-agency roster
          // enriches rows and can degrade gracefully, but a missing headline is the
          // silent-wrong-number bug — so give it a second chance.
          const catResults = await fetchCategory(category, category === 'awarding_agency' ? 2 : 0);
          if (!catResults) continue;
          for (const r of catResults) {
            const k = normalizeAgencyKey(r.name || '');
            if (k) categoryTotalByKey[k] = Math.max(categoryTotalByKey[k] || 0, r.amount || 0);
          }
          // Keep the SUB-AGENCY roster (true totals) to anchor the agency rows below.
          if (category === 'awarding_subagency') {
            for (const r of catResults) {
              if (r.name && (r.amount || 0) > 0) subagencyCategoryTotals.push({ name: r.name, amount: r.amount });
            }
          }
          // Department-level pass = the authoritative non-overlapping market total.
          if (category === 'awarding_agency') {
            authoritativeMarketTotal = catResults.reduce((s, r) => s + (r.amount || 0), 0);
            authoritativeTotalObtained = authoritativeMarketTotal > 0;
          }
        }

        // TWO more deterministic sub-agency aggregates so the anchored rows get real
        // Set-Aside $ and SAT $ columns (not just the total). Same scope/filter as the
        // total — just adds (a) the SB set-aside codes for this businessType/veteran
        // status, and (b) the ≤ SAT-threshold amount bound. One call each, not per
        // agency, so it stays cheap + deterministic.
        const setAsideTypeCodes = [
          ...(setAsideMap[effectiveBusinessType] || []),
          ...(veteranMap[veteranStatus || ''] || []),
        ];
        const extraPasses: Array<{ key: 'setAside' | 'sat'; filters: Record<string, unknown> }> = [];
        if (setAsideTypeCodes.length > 0) {
          extraPasses.push({ key: 'setAside', filters: { ...catFilterBase, set_aside_type_codes: setAsideTypeCodes } });
        }
        extraPasses.push({
          key: 'sat',
          filters: { ...catFilterBase, award_amounts: [{ lower_bound: 1, upper_bound: SIMPLIFIED_ACQUISITION_THRESHOLD }] },
        });
        await Promise.all(extraPasses.map(async ({ key, filters }) => {
          try {
            const res = await fetch('https://api.usaspending.gov/api/v2/search/spending_by_category', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              signal: AbortSignal.timeout(20_000),
              body: JSON.stringify({ category: 'awarding_subagency', filters, subawards: false, limit: 100, page: 1 }),
            });
            if (!res.ok) return;
            const json = await res.json();
            const results = (json.results || []) as Array<{ name: string; amount: number }>;
            const target = key === 'setAside' ? setAsideCatByKey : satCatByKey;
            for (const r of results) {
              const k = normalizeAgencyKey(r.name || '');
              if (k) target[k] = Math.max(target[k] || 0, r.amount || 0);
            }
          } catch { /* best-effort; column falls back to 0 */ }
        }));
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
    // DoDAAC-anchored count: opps grouped by the 6-char DoDAAC prefix of their
    // solicitation_number. A DoD sub-agency (DARPA/MDA) shares ONE department
    // label, so the department count over-counts the whole DoD; the prefix count
    // is the agency's REAL open-opp number (mirrors the contacts fix). Eric, Jun 25.
    const oppCountsByDodaac: Record<string, number> = {};
    try {
      const { data: oppRows, error: oppRowsErr } = await supabase
        .from('sam_opportunities')
        .select('department, solicitation_number')
        .gte('response_deadline', new Date().toISOString());
      if (oppRowsErr) console.error('[target-market-research] sam query error:', oppRowsErr.message);
      for (const row of oppRows || []) {
        const key = normalizeAgencyKey(row.department || '');
        if (key) oppCounts[key] = (oppCounts[key] || 0) + 1;
        const sol = (row.solicitation_number || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (sol.length >= 6) {
          const code = sol.slice(0, 6);
          oppCountsByDodaac[code] = (oppCountsByDodaac[code] || 0) + 1;
        }
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
    const eventCounts: Record<string, number> = {};          // keyed by normalizeAgencyKey()
    const eventCountsByDodaac: Record<string, number> = {};   // keyed by 6-char inferred DoDAAC
    const eventCountsByOffice: Record<string, number> = {};   // keyed by normalized inferred_office name
    try {
      // backfill-event-offices tags each event's REAL buying office via the
      // solicitation-number DoDAAC (`inferred_dodaac`). Pull it alongside `agency`
      // so a specific DoD office gets ITS event count, not the whole-DoD bucket —
      // the same anchoring the opportunities count uses. (sam_events.agency is
      // department-level, so without this every DARPA/USACE office inherits all of
      // DoD's events.)
      //
      // Also pull `inferred_office` — SAM's OWN office name, populated on
      // pre-award notices (RFI/Sources Sought/Industry Day) where FPDS has no
      // DoDAAC-award office yet. 94% of undecodable-DoDAAC events are pre-award
      // (audit 2026-07-10), so this office-name bucket rescues the events the
      // DoDAAC path can't anchor. Keyed by normalizeAgencyKey(office) so it
      // matches the row's contractingOffice/name the same way.
      const { data: eventRows, error: eventRowsErr } = await supabase
        .from('sam_events')
        .select('agency, inferred_dodaac, inferred_office')
        .gte('event_date', new Date().toISOString().slice(0, 10))
        .lte('event_date', eventHorizon.toISOString().slice(0, 10));
      if (eventRowsErr) console.error('[target-market-research] events query error:', eventRowsErr.message);
      for (const row of eventRows || []) {
        const key = normalizeAgencyKey(row.agency || '');
        if (key) eventCounts[key] = (eventCounts[key] || 0) + 1;
        const dod = String(row.inferred_dodaac || '').toUpperCase().trim();
        if (dod.length >= 6) {
          const code = dod.slice(0, 6);
          eventCountsByDodaac[code] = (eventCountsByDodaac[code] || 0) + 1;
        }
        const officeKey = normalizeAgencyKey(String(row.inferred_office || ''));
        if (officeKey) eventCountsByOffice[officeKey] = (eventCountsByOffice[officeKey] || 0) + 1;
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
      const { data: goalingRows, error: goalingRowsErr } = await supabase
        .from('sba_goaling')
        .select('funding_department, category, dollars, total')
        .eq('fiscal_year', 2023);
      if (goalingRowsErr) console.error('[target-market-research] goaling query error:', goalingRowsErr.message);
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

    // Pre-resolve each agency's DoDAAC office codes (async) so the row map below
    // can look up the DoDAAC-anchored opp count synchronously. Only sub-agencies
    // in dodaac_directory resolve; others stay on the department count.
    //
    // TIME BUDGET (Bug fix 2026-07-09 — big national markets 504'd): on a cache
    // miss the DoDAAC directory cold-loads (pages up to 60k rows once) and then
    // this fans out one resolve per unique sub-agency. On a large market (e.g.
    // NAICS 561720, hundreds of agencies) that pushed the whole request past the
    // 120s function limit → HTTP 504 + a useless "Network error" for the user.
    // This enrichment is a NICE-TO-HAVE (office-anchored opp counts); the core
    // deliverable is the spend + agency table. So we skip it when we're already
    // past a soft budget, letting rows fall back to the department-wide opp count.
    // Partial (department-level) data beats a 504.
    const DODAAC_BUDGET_MS = 75_000; // leave ~45s headroom under the 120s cap
    const dodaacByAgency = new Map<string, string[]>();
    let dodaacEnrichmentSkipped = false;
    if (Date.now() - startedAt > DODAAC_BUDGET_MS) {
      dodaacEnrichmentSkipped = true;
      console.warn(
        `[target-market-research] skipping DoDAAC enrichment — already ${Math.round((Date.now() - startedAt) / 1000)}s in (budget ${DODAAC_BUDGET_MS / 1000}s)`,
      );
    } else {
      await Promise.all(
        Array.from(new Set(findAgencies.map((a) => a.subAgency || a.name).filter(Boolean) as string[]))
          .map(async (nm) => {
            try { dodaacByAgency.set(nm, await dodaacCodesForAgency(nm)); } catch { /* skip */ }
          }),
      );
    }

    // A SPECIFIC socioeconomic/veteran set-aside was requested (not the general
    // "Small Business" default). This matters for the Set-Aside $ column below:
    // find-agencies BROADENS the award set when a narrow set-aside returns too few
    // agencies (relaxes to all-SB, then to no-set-aside — see find-agencies
    // ~L813-852), so a.setAsideSpending on that pass is NOT the requested set-aside
    // figure — it's the broadened total (WOSB read $4.2B at CMS when true WOSB is
    // <$120M nationwide). USASpending's per-award 'Set-Aside Type' field is
    // unreliable (comes back blank even on filtered queries), so we can't re-filter
    // the sample client-side. The ONLY trustworthy set-aside $ for a specific type
    // is the authoritative spending_by_category set-aside pass (setAsideCatByKey),
    // which filters server-side by the codes. So for a specific set-aside we use
    // that figure and 0 when the category pass has no entry — never the broadened
    // find-agencies fallback. (Bug found by verify:data harness, Jul 9 2026.)
    const isSpecificSetAside =
      effectiveBusinessType !== 'Small Business' || Boolean((veteranStatus || '').trim());

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
      // DoDAAC-anchored count first: if this (sub-)agency maps to office codes,
      // sum the opps whose solicitation prefix is one of those codes — the REAL
      // count (DARPA ≠ all-of-DoD). Fall back to the department count otherwise.
      const dodaacCodes = dodaacByAgency.get(a.subAgency || a.name || '') || [];
      const dodaacOppCount = dodaacCodes.reduce((n, c) => n + (oppCountsByDodaac[c] || 0), 0);
      const deptWideOppCount = oppKeyCandidates.reduce((n, k) => n || oppCounts[k] || 0, 0);
      const isOfficeAnchored = dodaacCodes.length > 0;
      // Is this row a SPECIFIC office (vs a department / sub-agency)? A distinct
      // contractingOffice names an actual buying office (e.g. "Engineer District
      // Tulsa"). Such a row must NEVER inherit the whole-department count — for
      // BOTH opps and events (the "295 on every Army district" leak). It shows its
      // own DoDAAC/office count, or 0. Department/sub-agency-tier rows (empty
      // contractingOffice) legitimately keep the rolled-up dept count.
      const officeName = (a.contractingOffice || '').trim();
      const isSpecificOffice =
        isOfficeAnchored
        || (officeName.length > 0
            && normalizeAgencyKey(officeName) !== normalizeAgencyKey(a.subAgency || '')
            && normalizeAgencyKey(officeName) !== normalizeAgencyKey(a.parentAgency || ''));
      // A specific office shows its own DoDAAC opps, or 0 — never dept-wide.
      // (Opps have no inferred_office bucket — sam_opportunities lacks that column
      // — so the office signal here is the DoDAAC count only.)
      const openOppCount = isSpecificOffice ? dodaacOppCount : deptWideOppCount;
      // Expose the department-wide number for specific offices so the card can say
      // "0 open at DARPA now · N dept-wide" honestly.
      const oppCountDodWide = isSpecificOffice ? deptWideOppCount : null;
      // Events anchor the SAME way as opps: an office-anchored agency counts only
      // events tagged to ITS DoDAACs (via inferred_dodaac), not the whole-DoD bucket.
      const dodaacEventCount = dodaacCodes.reduce((n, c) => n + (eventCountsByDodaac[c] || 0), 0);
      const deptWideEventCount = oppKeyCandidates.reduce((n, k) => n || eventCounts[k] || 0, 0);
      // SAM-office match: for pre-award notices (RFI/Sources Sought) with no
      // decodable DoDAAC, SAM's inferred_office still names the buying office.
      // Match it to this row's office/name. This is office-specific (like the
      // DoDAAC path), so it's safe to prefer over the whole-department count.
      const officeEventKeys = [a.contractingOffice, a.name, a.subAgency]
        .map(s => normalizeAgencyKey(s || ''))
        .filter(Boolean);
      const officeEventCount = officeEventKeys.reduce((n, k) => n || eventCountsByOffice[k] || 0, 0);
      // Events use the SAME isSpecificOffice gate (computed above with opps), plus
      // the SAM-office bucket for pre-award notices the DoDAAC path can't anchor.
      const upcomingEventCount = isSpecificOffice
        ? (dodaacEventCount || officeEventCount) // office's own events, or 0 — never dept-wide
        : (officeEventCount || deptWideEventCount);
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
      // The office's OWN total award spend. Prefer the UNFILTERED pass
      // (totalSpendingByOffice, keyed by a.officeId — the exact key totalData is
      // built with) so the Total $ column is the real total, NOT the set-aside
      // number. Without this, Total $ == Set-Aside $ on every office row (State
      // $207.3M/$207.3M, VA $250M/$250M — Jul 8), because a.setAsideSpending is
      // the set-aside-filtered spend from findData.
      // IMPORTANT: key ONLY on a.officeId (never lookupOfficeKey, which falls back
      // to subAgencyCode → the whole sub-agency total = the $22.5B-on-every-Army-
      // office bug). Fall back to a.setAsideSpending only when this office isn't in
      // the unfiltered set.
      const officeTrueTotal = a.officeId ? (totalSpendingByOffice[a.officeId] || 0) : 0;
      const officeOwnTotal = officeTrueTotal > 0
        ? Math.max(officeTrueTotal, a.setAsideSpending || 0)
        : (a.setAsideSpending || 0);
      const accurateTotal = categoryTotalForAgency(
        categoryTotalByKey,
        a.subAgency,
        a.parentAgency,
        a.name,
      );
      // Authoritative SET-ASIDE for this sub-agency (server-computed over ALL
      // matching records, same scope as accurateTotal) — resolved by the SAME key
      // logic as the total. This is the real set-aside number ($3M for NPS wood),
      // vs the find-agencies SAMPLED a.setAsideSpending which over-counted to equal
      // the total ($43M/$43M was the Jul 8 bug — total == setaside on rollup rows).
      const accurateSetAside = categoryTotalForAgency(
        setAsideCatByKey,
        a.subAgency,
        a.parentAgency,
        a.name,
      );
      // Office row → its own spend. Agency/sub-agency rollup row → the AUTHORITATIVE
      // category total whenever present (server-computed over ALL matching records),
      // NOT max(accurate, sampled): the find-agencies sample over-counts (NPS wood
      // showed $43M sampled vs $20M real — Jul 8), so taking the max kept the
      // inflated number. Fall back to the sample only when the category pass had no
      // match for this row.
      const totalSpending = isOfficeLevel
        ? officeOwnTotal
        : (accurateTotal > 0 ? accurateTotal : officeOwnTotal);
      // Set-Aside column: prefer the authoritative server figure for rollup rows;
      // fall back to the sampled number only for office rows / when the category
      // pass had no match. Never let it exceed the row's own total (a subset can't
      // be larger than the whole).
      //
      // For a SPECIFIC socioeconomic/veteran set-aside, the find-agencies fallback
      // (a.setAsideSpending) is the BROADENED figure, not the requested type — so we
      // trust ONLY the authoritative category pass and use 0 when it has no entry
      // (that agency genuinely has no spend in this set-aside type). For the general
      // "Small Business" default the sampled fallback is fine (it wasn't broadened
      // past small-business). This is what fixes WOSB reading ~$13.6B when the true
      // figure is <$120M.
      const setAsideFallback = isSpecificSetAside ? 0 : (a.setAsideSpending || 0);
      const resolvedSetAside = Math.min(
        totalSpending,
        (!isOfficeLevel && accurateSetAside > 0) ? accurateSetAside : setAsideFallback,
      );
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

        setAsideSpending: resolvedSetAside,
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
        oppCountDodWide,
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

    // ---- Roster anchoring (Eric, Jun 26 2026) ----
    // Append an agency-level row for every authoritative sub-agency buyer the
    // SAMPLED award set missed. The sampled-award path only sees ~5k awards, so a
    // real buyer that didn't make the slice vanished from the chart/table and
    // reappeared on the next run (the "it should not change that drastically" bug).
    // spending_by_category gives the COMPLETE, deterministic buyer list with true
    // totals — anchor to it. Double-count-safe: each sampled office row already
    // carries its sub-agency's accurate total in metric_top_total and
    // rollupChartBuyers takes the MAX per agency, so an already-present agency keeps
    // its value; only genuinely-missing buyers get a new row. Award-sample-only
    // fields (contractCount, set-aside split, SAT, bidders) stay 0/null — honest:
    // we have the true spend but didn't sample this buyer's individual awards.
    const representedKeys = new Set<string>();
    for (const r of rows) {
      for (const cand of [r.subAgency, r.parentAgency, r.name]) {
        const k = normalizeAgencyKey(cand || '');
        if (k) representedKeys.add(k);
      }
    }
    for (const { name, amount } of subagencyCategoryTotals) {
      const key = normalizeAgencyKey(name);
      if (!key || representedKeys.has(key)) continue;
      representedKeys.add(key); // guard against category-response dupes

      const nk = normalizeAgencyKey(name);
      const openOppCount = oppCounts[nk] || 0;
      // These are DEPARTMENT/sub-agency spend-total rows (buyers present in the
      // spend rollup but NOT sampled as individual offices) — so the dept-level
      // event count is the RIGHT granularity here. Do NOT add the office-name
      // match used in the findAgencies rows above: there's no specific office to
      // anchor to at this level.
      const upcomingEventCount = eventCounts[nk] || 0;
      const painData = getPainPointsForAgency(name);
      const painPointCount = painData
        ? (painData.painPoints?.length || 0) + (painData.priorities?.length || 0)
        : 0;
      const naicsAligned = naicsAlignedPainAgencies.has(name.toLowerCase());
      loadPrimesForKey(name);
      const topPrimes = primesByAgencyKey.get(name) || [];
      const sb = resolveOsbp('', name, '');
      const osbp = sb?.director && !/ OSBP Director$/.test(sb.director)
        ? { name: sb.name, director: sb.director, email: sb.email, phone: sb.phone, address: sb.address }
        : (sb ? { name: sb.name, email: sb.email, phone: sb.phone, address: sb.address } : null);

      // Authoritative dollar columns from the extra category passes (deterministic).
      const setAsideSpending = setAsideCatByKey[key] || 0;
      const satSpending = satCatByKey[key] || 0;
      // Dollar-based SAT ratio (sample-free): share of this buyer's spend that's
      // under the SAT threshold. Stands in for the count-based ratio the sampled
      // rows use (no per-agency contract-count aggregate exists in USASpending).
      const satRatio = amount > 0 ? Math.min(1, satSpending / amount) : 0;

      rows.push({
        id: `cat:${key}`,
        name,
        contractingOffice: name,
        subAgency: name,
        parentAgency: '',
        officeId: '',
        location: '',
        setAsideSpending,
        totalSpending: amount,
        contractCount: 0,
        satSpending,
        satContractCount: 0,
        // Set-Aside lens sort: real set-aside $ for NAICS searches now that we have
        // it; keyword searches still rank on the keyword-grounded total.
        metric_top_spending: keywordGrounded ? amount : setAsideSpending,
        metric_top_total: amount,
        metric_contracts: 0,
        // Easy-Entry magnitude: SAT $ scaled by the SAT ratio (replaces the
        // count-based score the sampled rows use). Ranks SAT-friendly buyers up.
        metric_easy_entry: satRatio * Math.sqrt(satSpending),
        metric_budget_growth: 0,
        painPointCount: painPointCount + (naicsAligned ? 5 : 0),
        openOppCount,
        oppCountDodWide: null,
        upcomingEventCount,
        avgBidders: null,
        uniqueVendorCount: 0,
        smallBizPercent: lookupSmallBiz(name),
        topPrimes,
        osbp,
        hasOSBP: !!osbp,
        isSubAgency: true,
        satRatio,
      });
    }

    // Default sort: top total $ (matches UI default lens + FPDS leaderboards).
    rows.sort((x, y) => y.metric_top_total - x.metric_top_total);

    // Fill contract COUNT on the top category-anchored rows. There's no grouped
    // count aggregate in USASpending, so it's one spending_by_award_count call per
    // agency — bounded to the highest-spend anchored rows (the ones that actually
    // show) and run in small parallel batches so it stays inside maxDuration. Only
    // the recovered rows (id 'cat:') need it; sampled rows already counted real
    // awards. Runs only on a cache MISS (cache hits already carry the counts).
    // COST BUDGET (Bug fix 2026-07-09): this contract-count enrichment is the last
    // — and, on a scoped-but-large market, most expensive — step: up to 20 per-
    // agency USASpending calls after the whole request has already spent time on
    // find-agencies + category aggregates + opp/event scans. It's cosmetic (fills
    // the "contracts" column on recovered rows; they show "—" without it). If
    // we're already past the budget, SKIP it and ship the spend + agency table
    // we've built — a complete table beats a 504 with no data at all.
    const COUNT_BUDGET_MS = 90_000; // ~30s headroom under the 120s cap for the upsert + response
    if (catScopeUsable && Date.now() - startedAt < COUNT_BUDGET_MS) {
      const ANCHORED_COUNT_CAP = 20;
      const CONC = 6;
      const needCount = rows
        .filter((r) => r.id.startsWith('cat:'))
        .sort((a, b) => b.totalSpending - a.totalSpending)
        .slice(0, ANCHORED_COUNT_CAP);
      for (let i = 0; i < needCount.length; i += CONC) {
        // Re-check the budget between batches so a slow first round doesn't drag
        // the request to the cliff.
        if (Date.now() - startedAt >= COUNT_BUDGET_MS) break;
        const batch = needCount.slice(i, i + CONC);
        await Promise.all(batch.map(async (r) => {
          try {
            const res = await fetch('https://api.usaspending.gov/api/v2/search/spending_by_award_count/', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              signal: AbortSignal.timeout(15_000),
              body: JSON.stringify({
                filters: { ...catFilterBase, agencies: [{ type: 'awarding', tier: 'subtier', name: r.name }] },
              }),
            });
            if (!res.ok) return;
            const j = await res.json();
            const c = j?.results?.contracts;
            if (typeof c === 'number' && c > 0) {
              r.contractCount = c;
              r.metric_contracts = c;
            }
          } catch { /* leave 0 → table shows "—" for unsampled rows */ }
        }));
      }
    }

    // FULL-MARKET total for the "Relevant spending" headline + SB-mix denominator.
    // CRITICAL: findData is the WITH-set-aside pass (defaulted to Small Business),
    // so findData.totalSpending is the SET-ASIDE number, NOT the market. totalData
    // is the no-set-aside pass = the real market. Use the authoritative category
    // total first; fall back to the no-set-aside total (NEVER the set-aside one).
    // Using findData here is what made the headline collapse to $160M and pushed
    // the SB mix past 100% ($646M ÷ $160M = 403%) when the category call returned 0.
    const noSetAsideMarketTotal = (totalData.success && typeof totalData.totalSpending === 'number' && totalData.totalSpending > 0)
      ? totalData.totalSpending
      : (findData.totalSpending || 0);
    const rawRelevantSpending = authoritativeMarketTotal || noSetAsideMarketTotal || 0;

    // DEGRADED-HEADLINE SIGNAL (Bug found Jul 9): if the authoritative department
    // total couldn't be obtained (USASpending 5xx/timeout even after retry), the
    // headline above is the SAMPLED row-sum, which can be many times too low. Flag
    // it so the response can tell the UI "this number is approximate / partial"
    // instead of presenting a silently-wrong figure as authoritative.
    const spendingIsPartial = !authoritativeTotalObtained;
    if (spendingIsPartial) {
      console.warn(
        `[target-market-research] PARTIAL: authoritative department total unavailable after retry — headline $${Math.round(rawRelevantSpending / 1e6)}M is the sampled fallback, not the true market total. naics=${naics} states=[${marketScope.states.join(',')}]`,
      );
    }

    // Reconcile (#3): the headline total and the rows must come from the SAME
    // scope. If the top row dwarfs the market total (national vs state-scoped, or
    // a sub-agency carrying a parent figure), floor the headline to the largest
    // component so a $1.8B CMS bar can never sit under a $14.5M headline (Jul 8).
    const relevantSpending = reconcileMarketTotals({
      authoritativeMarketTotal: rawRelevantSpending,
      rows,
      states: marketScope.states,
    });

    // Persist to cache. Idempotent upsert. Failures are non-fatal — we
    // still return the live data to the user.
    // BUT never cache a PARTIAL (degraded-headline) result: it would freeze a
    // silently-wrong "Relevant spending" figure for 24h. Skip the write so the next
    // request recomputes when USASpending is healthy again. The user still gets this
    // response (flagged partial); we just don't persist the bad number.
    if (spendingIsPartial) {
      console.warn('[target-market-research] skipping cache write — result is partial (degraded headline)');
    } else try {
      await supabase
        .from('agency_target_data_cache')
        .upsert({
          naics_code: cacheKey.naics_code,
          psc_code: cacheKey.psc_code,
          business_type: cacheKey.business_type,
          veteran_status: cacheKey.veteran_status,
          agencies: rows,
          total_count: rows.length,
          total_spending: noSetAsideMarketTotal,
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
            relevant_spending: relevantSpending,
            // #59 coverage payload so keyword searches keep their lesson banner on a hit.
            keyword_coverage: keywordCoveragePayload,
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
      total_spending: noSetAsideMarketTotal,
      // Authoritative market total from spending_by_category (department level) —
      // the figure the "Relevant spending" card should show. Falls back to the
      // NO-SET-ASIDE market total (never the set-aside pass), then 0, if the
      // category pass returned nothing (#2 reconciliation).
      relevant_spending: relevantSpending,
      // True when the authoritative department total couldn't be obtained and the
      // headline is the sampled fallback (USASpending was degraded) — the UI should
      // mark "Relevant spending" as approximate rather than present it as exact.
      spending_is_partial: spendingIsPartial,
      spend_window_label: MARKET_SPEND_WINDOW_LABEL,
      sat_summary: findData.satSummary,
      // KEYWORD-FIRST coverage (#59) — when researched by keyword, tell the UI the
      // full market: "drones = $245M across 70+ codes; we covered 90%". Lets the
      // panel show coverage instead of asking the user to manage codes. Built once
      // above (keywordCoveragePayload) so the cache write persists the same shape.
      keyword_coverage: keywordCoveragePayload,
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
