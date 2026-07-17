/**
 * Recompete Intelligence API
 *
 * Returns expiring federal contracts for recompete opportunity tracking.
 * Part of Federal Market Intelligence System - Phase 4.
 *
 * GET /api/recompete
 *   ?naics=541512           Filter by NAICS code. Comma-separated = OR across codes
 *                           (?naics=236220,541512). <6 chars = prefix match.
 *   ?agency=DOD             Filter by agency (name or abbreviation)
 *   ?state=FL               Filter by place of performance state
 *   ?months=18              Contracts expiring within N months (default: 18)
 *   ?minValue=1000000       Minimum contract value
 *   ?maxValue=50000000      Maximum contract value
 *   ?incumbent=Booz         Search by incumbent name
 *   ?setAside=SDVOSB        Filter by set-aside type
 *   ?likelihood=high        Filter by recompete likelihood (high, medium, low)
 *   ?limit=50               Results per page (default: 50, max: 200)
 *   ?offset=0               Pagination offset
 *   ?sort=value             Sort field (value, date, agency, incumbent)
 *   ?order=desc             Sort order (asc, desc)
 *
 * GET /api/recompete?stats=true
 *   Returns summary statistics
 *
 * GET /api/recompete?id={contractId}
 *   Returns single contract details
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { groupRecompetesByVehicle } from '@/lib/recompete/vehicle-grouping';
import { parseNaicsCodes, naicsOrExpression } from '@/lib/recompete/query';
import { saveSnapshot, readSnapshot, freshMeta, degradedMeta } from '@/lib/resilience/last-good';
import { getVocabulary } from '@/lib/market/vocabulary';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Agency name normalization
const agencyAliases: Record<string, string[]> = {
  'DEPARTMENT OF DEFENSE': ['DOD', 'DEFENSE', 'PENTAGON'],
  'DEPARTMENT OF THE NAVY': ['NAVY', 'USN', 'DON'],
  'DEPARTMENT OF THE ARMY': ['ARMY', 'USA'],
  'DEPARTMENT OF THE AIR FORCE': ['AIR FORCE', 'USAF', 'AF'],
  'DEPARTMENT OF VETERANS AFFAIRS': ['VA', 'VETERANS'],
  'DEPARTMENT OF HEALTH AND HUMAN SERVICES': ['HHS', 'HEALTH'],
  'GENERAL SERVICES ADMINISTRATION': ['GSA'],
  'DEPARTMENT OF HOMELAND SECURITY': ['DHS', 'HOMELAND'],
  'NATIONAL AERONAUTICS AND SPACE ADMINISTRATION': ['NASA'],
  'DEPARTMENT OF ENERGY': ['DOE', 'ENERGY'],
  'DEFENSE LOGISTICS AGENCY': ['DLA'],
  'ENVIRONMENTAL PROTECTION AGENCY': ['EPA'],
};

function normalizeAgencyName(input: string): string[] {
  const upper = input.toUpperCase().trim();

  // Check if input is an alias
  for (const [fullName, aliases] of Object.entries(agencyAliases)) {
    if (aliases.includes(upper) || fullName.includes(upper)) {
      return [fullName, ...aliases];
    }
  }

  // Return as-is for partial matching
  return [input];
}

interface RecompeteOpportunity {
  id: string;
  contract_id: string;
  award_id: string;
  incumbent_name: string;
  incumbent_uei: string;
  awarding_agency: string;
  awarding_sub_agency: string;
  awarding_office: string;
  naics_code: string;
  naics_description: string;
  psc_code: string;
  description: string;
  total_obligation: number;
  potential_total_value: number;
  period_of_performance_start: string;
  period_of_performance_current_end: string;
  place_of_performance_state: string;
  place_of_performance_city: string;
  set_aside_type: string;
  competition_type: string;
  number_of_offers: number;
  options_exercised: number;
  options_remaining: number;
  estimated_recompete_date: string;
  lead_time_months: number;
  recompete_likelihood: string;
  last_synced_at: string;
}

interface RecompeteStats {
  total_contracts: number;
  total_value: number;
  high_likelihood: number;
  medium_likelihood: number;
  low_likelihood: number;
  expiring_6_months: number;
  expiring_12_months: number;
  expiring_18_months: number;
  agencies: number;
  incumbents: number;
  naics_codes: number;
  last_sync: string;
}

/**
 * Compute recompete stats directly from recompete_opportunities — the resilient
 * fallback for when the recompete_stats VIEW is missing (it currently is in prod,
 * which made ?stats=true return all-zeros despite thousands of rows). Scopes to
 * future-expiring + quality-clean rows, matching the list query. One read.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function computeRecompeteStatsFromTable(supabase: any) {
  const empty = {
    total_contracts: 0, total_value: 0, high_likelihood: 0, medium_likelihood: 0,
    low_likelihood: 0, expiring_6_months: 0, expiring_12_months: 0, expiring_18_months: 0,
    agencies: 0, incumbents: 0, naics_codes: 0, last_sync: null as string | null,
  };
  try {
    const now = new Date();
    const iso = (d: Date) => d.toISOString().split('T')[0];
    const plusMonths = (n: number) => { const d = new Date(now); d.setMonth(d.getMonth() + n); return iso(d); };
    const today = iso(now);
    const end18 = plusMonths(18);
    const statsCols = 'potential_total_value, recompete_likelihood, awarding_agency, incumbent_name, naics_code, period_of_performance_current_end';
    const statsBase = () => supabase
      .from('recompete_opportunities')
      .select(statsCols)
      .gt('period_of_performance_current_end', today)
      .lte('period_of_performance_current_end', end18)
      .limit(20000);
    // Same self-heal as the main path: try WITH the quality_flag filter, fall back
    // to WITHOUT it if the column is missing (else stats silently returned all-zeros).
    let { data, error } = await statsBase().is('quality_flag', null);
    // Non-essential filter — retry without it on ANY error (usually the missing
    // quality_flag column pre-migration) so stats don't silently return all-zeros.
    if (error) ({ data, error } = await statsBase());
    if (error || !data) return empty;
    const end6 = plusMonths(6);
    const end12 = plusMonths(12);
    const agencies = new Set<string>();
    const incumbents = new Set<string>();
    const naics = new Set<string>();
    const s = { ...empty };
    for (const r of data as Array<Record<string, unknown>>) {
      s.total_contracts++;
      s.total_value += Number(r.potential_total_value) || 0;
      const lk = String(r.recompete_likelihood || '').toLowerCase();
      if (lk === 'high') s.high_likelihood++;
      else if (lk === 'medium') s.medium_likelihood++;
      else if (lk === 'low') s.low_likelihood++;
      const end = String(r.period_of_performance_current_end || '');
      if (end && end <= end6) s.expiring_6_months++;
      if (end && end <= end12) s.expiring_12_months++;
      if (end && end <= end18) s.expiring_18_months++;
      const ag = String(r.awarding_agency || '').trim(); if (ag) agencies.add(ag);
      const inc = String(r.incumbent_name || '').trim().toUpperCase(); if (inc) incumbents.add(inc);
      const nc = String(r.naics_code || '').trim(); if (nc) naics.add(nc);
    }
    s.agencies = agencies.size;
    s.incumbents = incumbents.size;
    s.naics_codes = naics.size;
    return s;
  } catch {
    return empty;
  }
}

export async function GET(request: NextRequest) {
  // Outer guard: a network-level failure during a DB outage (fetch failed /
  // ECONNRESET) can THROW rather than return {error}, which would escape as an
  // unhandled 500 and skip the last-good serve below. Catch it, and if we have a
  // snapshot for this exact filter, serve it degraded instead of erroring.
  try {
    return await handleRecompeteGet(request);
  } catch (err) {
    const raw = (err as Error)?.message || '';
    const isUpstreamTimeout = /522|timed out|connection|fetch failed|ECONNRESET|EAI_AGAIN|network/i.test(raw);
    if (isUpstreamTimeout) {
      try {
        const key = recompeteSnapshotKey(new URL(request.url).searchParams);
        const snap = await readSnapshot<Record<string, unknown>>(key);
        if (snap) {
          return NextResponse.json(
            { ...snap.data, ...degradedMeta(snap.savedAt) },
            { status: 200, headers: { 'x-mindy-degraded': '1' } }
          );
        }
      } catch { /* fall through to 503 */ }
      return NextResponse.json(
        { success: false, error: 'The contracts database is temporarily unavailable. Please try again.', retryable: true },
        { status: 503 }
      );
    }
    console.error('[recompete] unhandled error:', raw);
    return NextResponse.json({ success: false, error: 'Database query failed' }, { status: 500 });
  }
}

// Build the last-good snapshot key from a filter's query params. Shared by the
// happy path (save), the returned-error path, and the thrown-error guard above.
function recompeteSnapshotKey(sp: URLSearchParams): string {
  return `recompete:${new URLSearchParams({
    naics: sp.get('naics') || '', agency: sp.get('agency') || '', state: sp.get('state') || '',
    months: sp.get('months') || '18', minValue: sp.get('minValue') || '', maxValue: sp.get('maxValue') || '',
    incumbent: sp.get('incumbent') || '', setAside: sp.get('setAside') || '',
    likelihood: sp.get('likelihood') || '', limit: sp.get('limit') || '50', offset: sp.get('offset') || '0',
    sort: sp.get('sort') || 'value', order: sp.get('order') || 'desc',
  }).toString()}`;
}

async function handleRecompeteGet(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  // Parse parameters
  const naicsParam = searchParams.get('naics');
  // Comma/space-separated list → sanitized codes, OR'd below. Empty for a
  // non-numeric value, which falls back to the legacy single-value path.
  const naicsCodes = parseNaicsCodes(naicsParam);
  const agencyParam = searchParams.get('agency');
  const stateParam = searchParams.get('state');
  const monthsParam = searchParams.get('months') || '18';
  const minValueParam = searchParams.get('minValue');
  const maxValueParam = searchParams.get('maxValue');
  const incumbentParam = searchParams.get('incumbent');
  const setAsideParam = searchParams.get('setAside');
  const likelihoodParam = searchParams.get('likelihood');
  const limitParam = searchParams.get('limit') || '50';
  const offsetParam = searchParams.get('offset') || '0';
  const sortParam = searchParams.get('sort') || 'value';
  const orderParam = searchParams.get('order') || 'desc';
  const statsParam = searchParams.get('stats');
  const idParam = searchParams.get('id');

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Last-good snapshot key for THIS filtered view. The main paged list is the
  // heavy read that times out during a Supabase outage; we key the snapshot by
  // the query so a filtered panel serves its OWN last-good, not another filter's.
  // (stats / id / single-contract branches return early and aren't snapshotted.)
  const snapshotKey = recompeteSnapshotKey(searchParams);

  // Return stats if requested
  if (statsParam === 'true') {
    const { data: stats, error } = await supabase
      .from('recompete_stats')
      .select('*')
      .single();

    // The recompete_stats VIEW is missing/unbuilt in prod, so this used to return
    // all-zeros even though recompete_opportunities has thousands of rows (Eric,
    // Jun 24). Compute the stats straight from the table instead — never report 0
    // when there's data. (If the view exists and works, we still prefer it.)
    if (error || !stats) {
      const computed = await computeRecompeteStatsFromTable(supabase);
      return NextResponse.json({ success: true, stats: computed });
    }

    return NextResponse.json({
      success: true,
      stats,
    });
  }

  // Return single contract if ID provided
  if (idParam) {
    const { data: contract, error } = await supabase
      .from('recompete_opportunities')
      .select('*')
      .eq('contract_id', idParam)
      .single();

    if (error || !contract) {
      return NextResponse.json(
        { success: false, error: 'Contract not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      contract,
    });
  }

  const monthsAhead = parseInt(monthsParam, 10) || 18;
  const maxDate = new Date();
  maxDate.setMonth(maxDate.getMonth() + monthsAhead);

  // Build a freshly-filtered query each call — lets us PAGE (PostgREST caps each
  // response at 1000) without reusing a consumed builder. All filters below are
  // applied inside; the caller adds .order()/.range().
  // applyQualityFilter: apply the quality_flag quarantine only when the column
  // exists. If migration 20260619 hasn't run in this environment, the filter would
  // 500 the WHOLE query (column does not exist) → the panel silently falls back to
  // stale static data. So we make it optional + self-healing (see the retry below).
  function buildBaseQuery(applyQualityFilter = true) {
  let query = supabase
    .from('recompete_opportunities')
    .select('*');

  // Filter: contracts expiring in the future
  query = query
    .gt('period_of_performance_current_end', new Date().toISOString().split('T')[0])
    .lte('period_of_performance_current_end', maxDate.toISOString().split('T')[0]);

  // Data-quality quarantine: hide rows flagged with corrupt values (implausible
  // $2.8T / round-number placeholders) — they'd sort to the top of the value view
  // and look fake on stage. Reversible; nothing deleted. (migration 20260619)
  if (applyQualityFilter) query = query.is('quality_flag', null);

  // NAICS filter. Accepts a COMMA-SEPARATED list ("236220,541512") and ORs across
  // the codes — a user profile carries 3-5 codes, and sending only the first one
  // hid most of their market. Prefix rule per code is unchanged (541 matches 541512).
  // Semantics live in the shared lib so this route, briefings and the MCP tool agree.
  if (naicsCodes.length > 1) {
    query = query.or(naicsOrExpression(naicsCodes));
  } else if (naicsCodes.length === 1) {
    const code = naicsCodes[0];
    query = code.length < 6
      ? query.like('naics_code', `${code}%`)
      : query.eq('naics_code', code);
  } else if (naicsParam) {
    // Non-numeric value: preserve the previous (0-row) behaviour rather than
    // silently widening an existing caller's result set.
    query = naicsParam.length < 6
      ? query.like('naics_code', `${naicsParam}%`)
      : query.eq('naics_code', naicsParam);
  }

  // Agency filter
  if (agencyParam) {
    const agencyNames = normalizeAgencyName(agencyParam);
    // Use ilike for partial matching
    query = query.or(
      agencyNames.map((name) => `awarding_agency.ilike.%${name}%`).join(',')
    );
  }

  // State filter
  if (stateParam) {
    query = query.eq('place_of_performance_state', stateParam.toUpperCase());
  }

  // Value filters
  if (minValueParam) {
    const minValue = parseFloat(minValueParam);
    if (!isNaN(minValue)) {
      query = query.gte('total_obligation', minValue);
    }
  }
  if (maxValueParam) {
    const maxValue = parseFloat(maxValueParam);
    if (!isNaN(maxValue)) {
      query = query.lte('total_obligation', maxValue);
    }
  }

  // Incumbent search
  if (incumbentParam) {
    query = query.ilike('incumbent_name', `%${incumbentParam}%`);
  }

  // Set-aside filter
  if (setAsideParam) {
    query = query.ilike('set_aside_type', `%${setAsideParam}%`);
  }

  // Likelihood filter
  if (likelihoodParam && ['high', 'medium', 'low'].includes(likelihoodParam)) {
    query = query.eq('recompete_likelihood', likelihoodParam);
  }

  return query;
  }

  // Sorting
  const sortField = {
    value: 'total_obligation',
    date: 'period_of_performance_current_end',
    agency: 'awarding_agency',
    incumbent: 'incumbent_name',
    lead_time: 'lead_time_months',
  }[sortParam] || 'total_obligation';

  const limit = Math.min(parseInt(limitParam, 10) || 50, 200);
  const offset = parseInt(offsetParam, 10) || 0;

  // GROUP-THEN-PAGINATE (Eric, Jun 25): to de-duplicate multiple-award IDIQs we
  // must group across the WHOLE filtered set, then paginate the VEHICLES — not the
  // raw awardee rows (per-page grouping was a no-op, since a vehicle's winners
  // rarely land on one page). PostgREST caps a single response at 1000 rows, so
  // PAGE THROUGH the filtered set (up to a safe cap), then group + slice. The
  // filtered set (after NAICS/agency/value) is normally well under this cap.
  const GROUP_FETCH_CAP = 6000;

  // Page through the filtered set with self-healing on a missing quality_flag column.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function fetchAllFiltered(applyQualityFilter: boolean): Promise<{ rows: any[]; error: { message?: string } | null }> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[] = [];
    for (let from = 0; from < GROUP_FETCH_CAP; from += 1000) {
      const pageQuery = buildBaseQuery(applyQualityFilter)
        .order(sortField, { ascending: orderParam === 'asc' })
        .range(from, from + 999);
      const { data: chunk, error: chunkErr } = await pageQuery;
      if (chunkErr) return { rows, error: chunkErr };
      if (!chunk || chunk.length === 0) break;
      rows.push(...chunk);
      if (chunk.length < 1000) break;
    }
    return { rows, error: null };
  }

  let { rows: allFiltered, error } = await fetchAllFiltered(true);
  // The quality_flag quarantine is NON-ESSENTIAL — if the filtered query errors for
  // ANY reason (most commonly: migration 20260619 hasn't run so the column is
  // missing), retry WITHOUT it rather than 500ing the whole panel into a silent
  // static-file fallback. Losing the filter just means corrupt-value rows aren't
  // hidden; the live data still flows. (Detecting the exact PostgREST message across
  // versions is brittle, so we retry on any error and only surface a 500 if the
  // unfiltered query ALSO fails — a genuine table/connection problem.)
  if (error) {
    console.warn('[recompete] filtered query failed — retrying without quality_flag:', error.message);
    ({ rows: allFiltered, error } = await fetchAllFiltered(false));
  }
  const contracts = allFiltered; // (kept name for the rest of the handler)

  if (error) {
    console.error('Recompete query error:', error);

    // Check if table doesn't exist yet
    if (error.message?.includes('does not exist')) {
      return NextResponse.json({
        success: false,
        error: 'Recompete table not initialized. Run migration first.',
        migration: 'supabase/migrations/20260405_recompete_intelligence.sql',
      }, { status: 500 });
    }

    // The 500 is most often a transient Supabase connection timeout (Cloudflare 522
    // on a heavier .select('*') paged read), NOT a code/data problem — the light
    // stats + id queries still succeed. Classify it so the client can say "try again"
    // instead of implying the data is broken.
    const raw = error.message || '';
    const isUpstreamTimeout = /522|timed out|connection|fetch failed|ECONNRESET|EAI_AGAIN/i.test(raw) || raw.trim().startsWith('<');

    // GRACEFUL DEGRADATION: on an upstream/DB outage, serve the last SUCCESSFUL
    // response for this exact filter (from KV, which survives a Supabase outage)
    // rather than an empty "try again" panel. The client shows an honest
    // "as of {time}" banner off `_degraded`/`_servedAt`. Only fall through to
    // the 503 when we have NO snapshot yet (first-ever outage for this view).
    if (isUpstreamTimeout) {
      const snap = await readSnapshot<Record<string, unknown>>(snapshotKey);
      if (snap) {
        return NextResponse.json(
          { ...snap.data, ...degradedMeta(snap.savedAt) },
          { status: 200, headers: { 'x-mindy-degraded': '1' } }
        );
      }
    }

    return NextResponse.json(
      {
        success: false,
        error: isUpstreamTimeout ? 'The contracts database is temporarily unavailable. Please try again.' : 'Database query failed',
        retryable: isUpstreamTimeout,
      },
      { status: isUpstreamTimeout ? 503 : 500 }
    );
  }

  // Calculate summary for response
  const totalValue = contracts?.reduce(
    (sum, c) => sum + (c.total_obligation || 0),
    0
  ) || 0;

  const likelyhoodCounts = {
    high: contracts?.filter((c) => c.recompete_likelihood === 'high').length || 0,
    medium: contracts?.filter((c) => c.recompete_likelihood === 'medium').length || 0,
    low: contracts?.filter((c) => c.recompete_likelihood === 'low').length || 0,
  };

  // Get top incumbents from results
  const incumbentCounts: Record<string, number> = {};
  contracts?.forEach((c) => {
    const name = c.incumbent_name || 'Unknown';
    incumbentCounts[name] = (incumbentCounts[name] || 0) + 1;
  });
  const topIncumbents = Object.entries(incumbentCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }));

  // VEHICLE ROLLUP (Eric, Jun 25): a multiple-award IDIQ has N winners stored as
  // N rows — counting them as N recompetes is inflated (1 vehicle, N awardees).
  // Group the WHOLE filtered set into vehicles, then paginate the VEHICLES so the
  // count + cards both reflect real vehicles (CIO-SP3 196 winners → 1 vehicle).
  const allGroups = groupRecompetesByVehicle(contracts || []);
  const vehicleTotal = allGroups.length;
  // Re-apply the requested sort at the VEHICLE level (group order isn't guaranteed
  // to match the row sort). Sort by the lead row's chosen field.
  const sortGetter = (v: { lead: Record<string, unknown> }): number | string => {
    const val = v.lead[sortField];
    return typeof val === 'number' ? val : String(val ?? '');
  };
  allGroups.sort((a, b) => {
    const av = sortGetter(a), bv = sortGetter(b);
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return orderParam === 'asc' ? cmp : -cmp;
  });
  const pageGroups = allGroups.slice(offset, offset + limit);

  // Real buyer vocabulary per code — the actual work-words agencies use for this
  // NAICS (naics_vocabulary). One lookup per DISTINCT code on the page (in-process
  // cached), attached as `vocab` so each card shows what the code really means.
  // Fails soft: any lookup error → that code just gets no terms.
  const pageCodes = Array.from(new Set(
    pageGroups.map((g) => String((g.lead as { naics_code?: string }).naics_code || '').trim()).filter(Boolean),
  ));
  const vocabByCode = new Map<string, string[]>();
  await Promise.all(pageCodes.map(async (code) => {
    const terms = await getVocabulary(code, { limit: 5 }).catch(() => []);
    vocabByCode.set(code, terms.map((t) => t.term));
  }));

  const vehicles = pageGroups.map((g) => ({
    ...g.lead,
    is_multi_award: g.members.length > 1,
    awardee_count: g.incumbentCount,
    awardees: g.incumbentNames.slice(0, 25),
    combined_ceiling: g.combinedCeiling,
    vehicle_expiry: g.latestExpiry,
    vehicle_key: g.key,
    vocab: vocabByCode.get(String((g.lead as { naics_code?: string }).naics_code || '').trim()) || [],
  }));
  const collapsedFrom = (contracts?.length || 0) - vehicleTotal;
  // The page of raw rows for back-compat consumers = the members of this page's vehicles.
  const pageContracts = pageGroups.flatMap((g) => g.members);

  const payload = {
    success: true,
    query: {
      naics: naicsParam,
      agency: agencyParam,
      state: stateParam,
      months: monthsAhead,
      minValue: minValueParam,
      maxValue: maxValueParam,
      incumbent: incumbentParam,
      setAside: setAsideParam,
      likelihood: likelihoodParam,
    },
    pagination: {
      limit,
      offset,
      // Count is now VEHICLES (de-inflated), not raw awardee rows.
      total: vehicleTotal,
      hasMore: (offset + limit) < vehicleTotal,
      rawRowTotal: contracts?.length || 0,  // pre-rollup count (for transparency)
      // TRUE if the filtered set hit GROUP_FETCH_CAP — then `total` is a FLOOR, not
      // a count (the scan stopped early), and a client must render it as "N+".
      // Without this a broad filter (e.g. no NAICS) reports the cap as if it were
      // the whole market — the same class of lie as the old static-file count.
      capped: (contracts?.length || 0) >= GROUP_FETCH_CAP,
    },
    summary: {
      resultCount: vehicles.length,         // vehicles on this page
      vehicleCount: vehicleTotal,           // total de-duplicated vehicles in the filtered set
      collapsedFrom,                        // awardee rows folded out across the whole set
      totalValue,
      totalValueFormatted: `$${(totalValue / 1000000).toFixed(1)}M`,
      byLikelihood: likelyhoodCounts,
      topIncumbents,
    },
    // Vehicle-grouped view (1 card per IDIQ with its awardees) — prefer this in UI.
    vehicles,
    // Raw awardee rows for THIS PAGE's vehicles (back-compat / drill-down).
    contracts: pageContracts,
    endpoints: {
      stats: '/api/recompete?stats=true',
      byNaics: '/api/recompete?naics=541512',
      byAgency: '/api/recompete?agency=DOD',
      byState: '/api/recompete?state=FL',
      highValue: '/api/recompete?minValue=10000000',
      highLikelihood: '/api/recompete?likelihood=high',
      syncData: '/api/admin/sync-recompete?password=...',
    },
  };

  // Store this successful response as the last-good snapshot for this filter,
  // so a future outage can serve it. Fire-and-forget — never block the response.
  saveSnapshot(snapshotKey, payload).catch(() => {});

  return NextResponse.json({ ...payload, ...freshMeta() });
}
