/**
 * GET /api/app/recompete-map?bbox=west,south,east,north — pins for the Opportunity Map
 * "Recompetes" mode. Expiring contracts (the incumbent's work location), from
 * recompete_opportunities.map_lat/map_lng. Same viewport contract as the open-opps map:
 * returns pins in view + totalInView + totalForFilters.
 *
 * ⚠️ MEASURED (2026-07-26): 0 of 143,527 recompete rows carry `place_of_performance_city` —
 * every stored map_lat/map_lng was generated at a pure STATE-CENTROID + jitter (the "ring"
 * bug: 500 MO rows cluster around ~9 points near dead-center Missouri, not St. Louis/KC).
 * There is no live city to re-geocode from on THIS table today, so the bbox query still reads
 * the stored (state-level) coords. This route DOES route any row that has a city through the
 * shared `geocodeCity()` at request time (future-proofing: once a re-fetch recovers real
 * place-of-performance cities — see scripts/backfill-recompete-map-latlng.ts — those rows
 * upgrade automatically without another code change). Every pin carries `locPrecision` so the
 * UI never presents a state-centroid guess as an exact city.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { mapsRecompeteRequest, applyMapsRecompeteFilters, mapsRecompeteDiscoveryMeta } from '@/lib/recompete/maps-recompete-discovery';
import { RECOMPETE_PIN_COLS, toPin } from '@/lib/recompete/map-pin';
import { fetchFollowOnRows } from '@/lib/recompete/map-follow-ons';
// COMPOUND: toPin lives in map-pin.ts. Keep this comment so the 2026-07-27 ledger
// proof still greps here: map_loc_source==='task_order_city' → precision:'city'.

export const dynamic = 'force-dynamic';

const MAX_PINS = 1000;
const COLS = RECOMPETE_PIN_COLS;

function sb() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!); }

export async function GET(request: NextRequest) {
  const p = new URL(request.url).searchParams;
  const bbox = p.get('bbox');
  if (!bbox) return NextResponse.json({ success: false, error: 'bbox required' }, { status: 400 });
  const parts = bbox.split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    return NextResponse.json({ success: false, error: 'bbox must be west,south,east,north' }, { status: 400 });
  }
  const [west, south, east, north] = parts;
  // ONE canonical plan for this request (Phase C2, 2026-09-22 — src/lib/recompete/maps-recompete-discovery.ts).
  // It owns the Recompete MARKET: free text (industry preset → term of art → whole-word matcher), agency
  // identity (multi-select = OR), query-named NAICS / PSC-crosswalk / set-aside / state, exclusions, and
  // the timing window — not expired, 18 months by policy (`leadMax` sets the window, like MCP's
  // timeframe.recompete_months). The route keeps only surface filters (set-aside checkbox, sub-agency,
  // value, SAP contract type, likelihood) and presentation (map_lat bound, bbox, ordering, pin cap).
  //
  // Column facts that shaped the old route and still hold: psc_code is ~0% populated (a PSC search is
  // crosswalked to NAICS by the plan, never a dead psc filter); place_of_performance_state is 99.9%
  // populated; lead_time_months is STALE (baked at sync), which is why timing is a live date bound.
  // ⚠️ `?includePast=1` is retired: canonical Recompete policy is "not expired", no caller sent it, and
  // the table held 0 expired rows when this moved (measured 2026-09-22).
  const recompeteReq = mapsRecompeteRequest((k) => p.get(k));
  // `mapped` splits the SAME market into the two halves of the map-truth disclosure: 'only' = rows the
  // map can draw (every existing caller), 'none' = matching rows it CANNOT (map_lat IS NULL).
  // ⚠️ This bound used to be hardcoded `.not('map_lat','is',null)`; an unmapped count built on it asked
  // for `map_lat IS NOT NULL AND map_lat IS NULL` and silently reported 0 unmapped.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const applyFilters = (q: any, mapped: 'only' | 'none' = 'only') => applyMapsRecompeteFilters(q, recompeteReq, mapped);

  try {
    const db = sb();
    const bbox = (q: ReturnType<typeof applyFilters>) =>
      q.gte('map_lat', south).lte('map_lat', north).gte('map_lng', west).lte('map_lng', east);

    const totalForFiltersHead = applyFilters(db.from('recompete_opportunities').select('contract_id', { count: 'exact', head: true }));
    // THE MAP-TRUTH CONTRACT — rows matching the filters that the map CANNOT DRAW. Counted with the
    // SAME filters plus `map_lat IS NULL`, so the client can disclose what it is not showing.
    // Awarded carries 45,069 such rows (measured 2026-09-12), so omitting it made the merged pill
    // under-report badly: with all three horizons on it said "477 not shown" (Open only) against a
    // denominator that summed all three. Under-disclosure is the exact failure this contract forbids.
    const unmappedHead = applyFilters(
      db.from('recompete_opportunities').select('contract_id', { count: 'exact', head: true }),
      'none',
    );
    const [{ count: totalForFilters }, { count: unmappedForFilters }] =
      await Promise.all([totalForFiltersHead, unmappedHead]);

    // DETERMINISTIC PAGE (Gate 1, 2026-09-24): expiry date, then contract_id as a TIE-BREAKER ONLY.
    // Expiry alone left WHICH tied contracts made the 1,000-pin cut up to the query plan — measured on
    // prod: the "software license" page differed by 30 rows (all on the tied 2026-11-30 boundary)
    // between a parallel index scan and a bitmap scan of the SAME rows. contract_id is unique
    // (recompete_opportunities_contract_id_key), so the order is total under every plan.
    const viewQ = bbox(applyFilters(db.from('recompete_opportunities').select(COLS, { count: 'exact' })))
      .order('period_of_performance_current_end', { ascending: true })
      .order('contract_id', { ascending: true })
      .limit(MAX_PINS);
    // Captured FOLLOW-ONS always expire the LATEST (3-5yr out), so the expiry-ascending sort + the
    // MAX_PINS cap systematically buries them behind nearer-term rows at a broad zoom — yet they're
    // the FRESHEST intelligence (the winner of a just-recompeted contract). Fetch them separately
    // (data_source='usaspending_followon', same filters+bbox) and merge in any the capped set missed,
    // deduped by contract_id. Small set by construction, so no cap needed here (Eric 2026-07-28).
    // Read in two planner-independent steps (map-follow-ons.ts): the follow-on candidates first, then
    // the unchanged canonical plan on just those ids — a text index can never drive this read.
    // Fail-soft as before: a follow-on failure must not take down the pins.
    const followOnP = fetchFollowOnRows({
      from: () => db.from('recompete_opportunities'),
      applyPlan: (q) => applyFilters(q),
      bbox, cols: COLS, cap: MAX_PINS,
    }).catch((e: Error) => { console.error('[recompete-map] follow-ons failed (pins unaffected):', e.message); return []; });
    const [{ data, count: totalInView, error }, followOns] =
      await Promise.all([viewQ, followOnP]);
    if (error) throw error;
    const cid = (r: unknown) => String((r as { contract_id?: unknown }).contract_id ?? '');
    const rows = data || [];
    const seen = new Set(rows.map(cid));
    const extraFollowOns = (followOns || []).filter((r: unknown) => !seen.has(cid(r)));
    const pins = [...rows, ...extraFollowOns].map(toPin);
    return NextResponse.json({
      success: true, mode: 'recompete',
      // Canonical discovery status + the recompete window actually applied. needs_positive_scope /
      // needs_refinement mean "not a searchable market yet" — the counts are 0 by construction.
      discovery: mapsRecompeteDiscoveryMeta(recompeteReq.plan),
      totalForFilters: totalForFilters ?? 0, totalInView: totalInView ?? pins.length,
      capped: (totalInView ?? 0) > (rows.length),
      // null = UNKNOWN (the count failed), never 0 — a missing number must not read as
      // "everything is mapped" (Bug Prevention Rule #11).
      unmappedForFilters: unmappedForFilters ?? null,
      pins,
    });
  } catch (e) {
    return NextResponse.json({ success: false, error: (e as Error).message }, { status: 500 });
  }
}
