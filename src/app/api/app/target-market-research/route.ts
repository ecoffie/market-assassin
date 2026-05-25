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
import {
  getPainPointsForAgency,
  getPainPointsByNaics,
} from '@/lib/agency-hierarchy/pain-points-linker';
import { getPrimesByAgency } from '@/lib/utils/prime-contractors';

const FREE_TIER_ROW_LIMIT = 10;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const EVENT_HORIZON_DAYS = 90;

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
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();

  try {
    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const {
      naicsCode,
      businessType = '',
      veteranStatus = '',
      zipCode = '',
      pscCode = '',
      excludeDOD = false,
      email,
    } = body as {
      naicsCode?: string;
      businessType?: string;
      veteranStatus?: string;
      zipCode?: string;
      pscCode?: string;
      excludeDOD?: boolean;
      email?: string;
    };

    if (!email) {
      return NextResponse.json({ error: 'email is required' }, { status: 400 });
    }
    if (!naicsCode || !naicsCode.trim()) {
      return NextResponse.json({ error: 'naicsCode is required' }, { status: 400 });
    }

    // Tier check. Free users still see data, just fewer rows.
    const access = await verifyMIAccess(email);
    const isFree = access.tier === 'free' && !access.isStaff;

    const cacheKey = {
      naics_code: naicsCode.trim(),
      business_type: businessType || '',
      veteran_status: veteranStatus || '',
    };

    // Try cache first. 24h TTL. Cache misses (no row OR old row) fall
    // through to the live merge. Stale rows are overwritten by the
    // upsert at the bottom of the success path.
    const supabase = getSupabase();
    try {
      const { data: cacheRow } = await supabase
        .from('agency_target_data_cache')
        .select('*')
        .eq('naics_code', cacheKey.naics_code)
        .eq('business_type', cacheKey.business_type)
        .eq('veteran_status', cacheKey.veteran_status)
        .maybeSingle();

      if (cacheRow && cacheRow.generated_at) {
        const age = Date.now() - new Date(cacheRow.generated_at).getTime();
        const rows = (cacheRow.agencies || []) as TargetMarketResearchRow[];

        // Recovery check — treat cache rows with all-zero satSpending
        // as stale regardless of age. This catches the case where an
        // earlier broken code path wrote satSpending=0 for every
        // agency; without this, the chart would show empty SAT data
        // for 24h after we deploy a fix. Pattern mirrored from
        // /api/usaspending/fpds-top-n.
        const cacheHasSatData = rows.some((r) => (r.satSpending || 0) > 0);

        if (age < CACHE_TTL_MS && cacheHasSatData) {
          const sliced = isFree ? rows.slice(0, FREE_TIER_ROW_LIMIT) : rows;
          return NextResponse.json({
            success: true,
            agencies: sliced,
            total_count: rows.length,
            total_spending: cacheRow.total_spending,
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
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL
      || (request.headers.get('x-forwarded-proto') && request.headers.get('host')
          ? `${request.headers.get('x-forwarded-proto')}://${request.headers.get('host')}`
          : 'http://localhost:3000');
    const [findRes, totalRes] = await Promise.all([
      fetch(`${baseUrl}/api/usaspending/find-agencies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ naicsCode, businessType, veteranStatus, zipCode, pscCode, excludeDOD }),
      }),
      fetch(`${baseUrl}/api/usaspending/find-agencies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ naicsCode, businessType: '', veteranStatus: '', zipCode, pscCode, excludeDOD }),
      }),
    ]);
    const findData = (await findRes.json()) as FindAgenciesPayload;
    const totalData = (await totalRes.json().catch(() => ({ success: false }))) as FindAgenciesPayload;
    const findAgenciesMs = Date.now() - findAgenciesStart;

    if (!findData.success || !findData.agencies || findData.agencies.length === 0) {
      return NextResponse.json({
        success: false,
        error: findData.error || 'No matching agencies found for this NAICS.',
        agencies: [],
        total_count: 0,
      });
    }

    const findAgencies = findData.agencies;

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
    const agencyNames = Array.from(new Set(
      findAgencies.flatMap((a) => [a.subAgency, a.parentAgency, a.contractingOffice]).filter(Boolean) as string[]
    ));

    // Enrichment 1: open SAM opps per agency. ONE grouped query, not
    // N+1. We aggregate by department name client-side after the
    // fetch (Postgres GROUP BY is fine but the typed query gets ugly
    // through PostgREST).
    const oppsStart = Date.now();
    let oppCounts: Record<string, number> = {};
    try {
      const { data: oppRows } = await supabase
        .from('sam_opportunities')
        .select('department')
        .in('department', agencyNames)
        .gte('response_deadline', new Date().toISOString());
      for (const row of oppRows || []) {
        const dept = row.department || '';
        oppCounts[dept] = (oppCounts[dept] || 0) + 1;
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
    let eventCounts: Record<string, number> = {};
    try {
      const { data: eventRows } = await supabase
        .from('sam_events')
        .select('agency')
        .in('agency', agencyNames)
        .gte('event_date', new Date().toISOString().slice(0, 10))
        .lte('event_date', eventHorizon.toISOString().slice(0, 10));
      for (const row of eventRows || []) {
        const ag = row.agency || '';
        eventCounts[ag] = (eventCounts[ag] || 0) + 1;
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
    const naicsAlignedPainAgencies = new Set(
      getPainPointsByNaics(naicsCode.trim()).map((r) => r.agency.toLowerCase())
    );
    const painMs = Date.now() - painStart;

    // Enrichment 4 (triage card intel v1, 2026-05-25): SBA Goaling
    // small-business share per parent agency. One bulk query for the
    // whole FY (~200 rows total — multiple rows per dept, one per
    // category like 'Not a Small Business', 'Small Business', etc).
    // Returns a map of UPPERCASE dept name -> share (0..1).
    //
    // Computation mirrors /api/sba-goaling/bulk: share = 1 - (nonSB / total).
    // The `Not a Small Business` row carries the non-SB dollar amount;
    // `total` is repeated on every category row for the same dept so
    // we track it once.
    const sbaStart = Date.now();
    const smallBizByParent = new Map<string, number>();
    try {
      const { data: goalingRows } = await supabase
        .from('sba_goaling')
        .select('funding_department, category, dollars, total')
        .eq('fiscal_year', 2023);
      const deptStats = new Map<string, { total: number; nonSb: number }>();
      for (const row of (goalingRows || []) as Array<{ funding_department: string; category: string; dollars: number; total: number }>) {
        const dept = (row.funding_department || '').toUpperCase().trim();
        if (!dept) continue;
        if (!deptStats.has(dept)) {
          deptStats.set(dept, { total: Number(row.total || 0), nonSb: 0 });
        }
        if (row.category === 'Not a Small Business') {
          const stats = deptStats.get(dept)!;
          stats.nonSb = Number(row.dollars || 0);
        }
      }
      for (const [dept, { total, nonSb }] of deptStats.entries()) {
        if (total > 0) smallBizByParent.set(dept, 1 - (nonSb / total));
      }
    } catch (sbaErr) {
      console.warn('[target-market-research] SBA Goaling fetch failed:', sbaErr);
    }
    const sbaMs = Date.now() - sbaStart;

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
      const openOppCount = oppCounts[lookupKey] || oppCounts[a.parentAgency || ''] || 0;
      const upcomingEventCount = eventCounts[lookupKey] || eventCounts[a.parentAgency || ''] || 0;
      const satRatio = (a.contractCount && a.contractCount > 0)
        ? (a.satContractCount || 0) / a.contractCount
        : 0;
      const naicsAligned = naicsAlignedPainAgencies.has((lookupKey || '').toLowerCase());

      const lookupOfficeKey = a.officeId || a.subAgencyCode || a.agencyCode || a.id || '';
      const totalSpending = totalSpendingByOffice[lookupOfficeKey]
        // Fallback: if the total pass missed this office under the same
        // key (rare but possible if the dedupe keying drifts), at least
        // use the set-aside number so the row isn't an obvious zero.
        ?? (a.setAsideSpending || 0);

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
        metric_top_spending: a.setAsideSpending || 0,
        metric_top_total: totalSpending,
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
        // Falls back to null if no data — UI shows '—' with tooltip.
        smallBizPercent: (() => {
          const parentNormalized = (a.parentAgency || '').toUpperCase().trim();
          const share = smallBizByParent.get(parentNormalized);
          return share !== undefined ? share : null;
        })(),
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

        hasOSBP: false, // TODO: wire from agency-hierarchy lib in Slice 1.5D drawer pass
        isSubAgency: !!a.subAgency && a.subAgency !== a.parentAgency,
        satRatio,
      };
    });

    // Default sort: top spending. UI applies its own sort on top.
    rows.sort((x, y) => y.metric_top_spending - x.metric_top_spending);

    // Persist to cache. Idempotent upsert. Failures are non-fatal — we
    // still return the live data to the user.
    try {
      await supabase
        .from('agency_target_data_cache')
        .upsert({
          naics_code: cacheKey.naics_code,
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
          },
        }, { onConflict: 'naics_code,business_type,veteran_status' });
    } catch (cacheWriteErr) {
      console.warn('[target-market-research] cache write failed:', cacheWriteErr);
    }

    const sliced = isFree ? rows.slice(0, FREE_TIER_ROW_LIMIT) : rows;

    return NextResponse.json({
      success: true,
      agencies: sliced,
      total_count: rows.length,
      total_spending: findData.totalSpending || 0,
      sat_summary: findData.satSummary,
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
