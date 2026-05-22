/**
 * /api/app/target-accounts
 *
 * POST endpoint that returns the merged "Target Account" data set for
 * Market Research. Replaces the 3-card "Start Here" black box with a
 * full agency table the user can sort, filter, and add to their
 * Target Account List.
 *
 * Per the TAL roadmap (tasks/target-accounts-crm-roadmap.md), this
 * endpoint joins FOUR data sources per office row:
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
}

interface TargetAccountRow {
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
  contractCount: number;
  satSpending: number;
  satContractCount: number;

  // Pre-computed sort metrics. Each is a number 0..∞ so the UI
  // can just sort DESC on whichever the user picked.
  metric_top_spending: number;     // = setAsideSpending
  metric_contracts: number;        // = contractCount
  metric_easy_entry: number;       // satContractCount / max(contractCount,1)
  metric_budget_growth: number;    // YoY % growth (not yet computed — 0 for v1)

  // Enrichments
  painPointCount: number;          // # pain points logged for this agency
  openOppCount: number;            // # current SAM opps
  upcomingEventCount: number;      // # events in next 90 days

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
        if (age < CACHE_TTL_MS) {
          const rows = cacheRow.agencies as TargetAccountRow[];
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
      console.warn('[target-accounts] cache lookup failed (proceeding live):', cacheErr);
    }

    // Cache miss / stale. Call /api/usaspending/find-agencies internally
    // to get the agency list with money signals, then enrich.
    const findAgenciesStart = Date.now();
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL
      || (request.headers.get('x-forwarded-proto') && request.headers.get('host')
          ? `${request.headers.get('x-forwarded-proto')}://${request.headers.get('host')}`
          : 'http://localhost:3000');
    const findRes = await fetch(`${baseUrl}/api/usaspending/find-agencies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ naicsCode, businessType, veteranStatus, zipCode, pscCode, excludeDOD }),
    });
    const findData = (await findRes.json()) as FindAgenciesPayload;
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
      console.warn('[target-accounts] sam_opportunities count failed:', oppErr);
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
      console.warn('[target-accounts] sam_events count failed:', eventErr);
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

    // Build the merged target-account rows. Each row gets all 4 sort
    // metrics pre-computed so the UI can sort without re-fetching.
    const rows: TargetAccountRow[] = findAgencies.map((a) => {
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

      return {
        id: a.id,
        name: a.name,
        contractingOffice: a.contractingOffice || a.name,
        subAgency: a.subAgency || '',
        parentAgency: a.parentAgency || '',
        officeId: a.officeId || a.subAgencyCode || a.agencyCode || '',
        location: a.location || '',

        setAsideSpending: a.setAsideSpending || 0,
        contractCount: a.contractCount || 0,
        satSpending: a.satSpending || 0,
        satContractCount: a.satContractCount || 0,

        // Pre-computed sort metrics. Higher is better for all of them.
        metric_top_spending: a.setAsideSpending || 0,
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
      console.warn('[target-accounts] cache write failed:', cacheWriteErr);
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
    console.error('[target-accounts] error:', err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
