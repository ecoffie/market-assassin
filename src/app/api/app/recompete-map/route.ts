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
import { setGroupKey, naicsCategory } from '@/lib/opportunities/map-data';
import { geocodeCity, stableSeed } from '@/lib/geo/city-geocode';
import { normalizeStateCode } from '@/lib/utils/us-states';

export const dynamic = 'force-dynamic';

const MAX_PINS = 1000;
const COLS = 'contract_id, piid, incumbent_name, incumbent_uei, awarding_agency, naics_code, naics_description, '
  + 'potential_total_value, total_obligation, period_of_performance_current_end, set_aside_type, '
  + 'place_of_performance_city, place_of_performance_state, map_lat, map_lng, map_loc_source, last_synced_at';

function sb() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!); }

function money(n: number): string {
  if (!n || n <= 0) return '';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
  return '$' + n;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toPin(r: Record<string, any>) {
  const state = normalizeStateCode(r.place_of_performance_state || '');
  const city = (r.place_of_performance_city || '').trim();
  const val = Number(r.potential_total_value ?? r.total_obligation ?? 0);
  // Location precision, in priority order:
  //  1) map_loc_source==='task_order_city' — the city-recovery backfill (2026-07-27) found a REAL
  //     task-order city for this contract and stamped map_lat/map_lng to it. Trust those coords +
  //     report precision:'city'. (place_of_performance_city is 0/143K populated — the parent award
  //     never carries a city — so the recovered value lives ONLY in map_lat/map_lng+map_loc_source;
  //     reading place_of_performance_city alone made the whole ~99.6K-row recovery invisible.)
  //  2) a populated place_of_performance_city — live-geocode it (future-proofs a real-city backfill).
  //  3) otherwise the stored map_lat/map_lng is a state-centroid → precision:'state' (honest).
  const locSource = r.map_loc_source || '';
  const live = (!locSource || locSource === 'state_approx') && city
    ? geocodeCity(city, state, stableSeed(String(r.contract_id ?? '')))
    : null;
  const isTaskOrderCity = locSource === 'task_order_city' && Number.isFinite(Number(r.map_lat));
  const lat = live ? live.lat : Number(r.map_lat);
  const lng = live ? live.lng : Number(r.map_lng);
  const precision: 'city' | 'state' = isTaskOrderCity ? 'city' : (live ? live.precision : 'state');
  return {
    id: String(r.contract_id ?? ''),
    src: 'RECOMPETE' as const,
    title: r.incumbent_name || 'Incumbent',
    agency: r.awarding_agency || '',
    cat: naicsCategory(r.naics_code) || (r.naics_description || 'Recompete'),
    naics: String(r.naics_code ?? ''),
    set: setGroupKey(r.set_aside_type),
    value: money(val),
    // Raw numeric ceiling (potential_total_value, 100% populated — measured 2026-07-26) — the
    // formatted `value` above ("$837.8M") can't be bucketed into a histogram or compared with
    // min/max, so the Value-range pill on the Opportunity Map reads THIS field.
    valueNum: val > 0 ? val : null,
    exp: r.period_of_performance_current_end || null,
    loc: city ? `${city}, ${state}` : state,
    // 2-letter place-of-performance state code — threaded to the drawer so the cross-sell
    // "Open bids like this" fetch (/api/app/related-opps) can match same-NAICS+same-state.
    state,
    sol: r.piid || '',
    // Threaded through so the drawer can fetch the real task-order spend stream
    // on-demand (GET /api/app/recompete-task-orders) — the proven-safe join key
    // needs BOTH the piid AND the incumbent's UEI (see src/lib/recompete/task-orders.ts).
    uei: r.incumbent_uei || null,
    lat, lng,
    locPrecision: precision,
    // Real sync timestamp (recompete_opportunities.last_synced_at) — powers the drawer's
    // Zillow-style "updated <relTime>" freshness line. Never fabricated: absent → the
    // drawer's freshnessSec() simply omits the "updated" clause (relTime('') → '').
    synced: r.last_synced_at || null,
  };
}

export async function GET(request: NextRequest) {
  const p = new URL(request.url).searchParams;
  const bbox = p.get('bbox');
  if (!bbox) return NextResponse.json({ success: false, error: 'bbox required' }, { status: 400 });
  const parts = bbox.split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    return NextResponse.json({ success: false, error: 'bbox must be west,south,east,north' }, { status: 400 });
  }
  const [west, south, east, north] = parts;
  const setAside = p.get('setAside') || '';
  const agency = p.get('agency') || '';
  const naics = p.get('naics') || '';
  // State — place_of_performance_state is 99.9% populated (125,830/125,917 measured
  // 2026-07-26), so this is a real, honest filter (unlike psc — see below).
  const state = normalizeStateCode(p.get('state') || '') || '';
  // Sub-agency — awarding_sub_agency is 100% populated. Free-text ilike, mirrors the
  // open-opp path's subAgency handling.
  const subAgency = p.get('subAgency') || '';
  // Value range — the client already sends minValue/maxValue for recompete (FILT.valueRange).
  // potential_total_value is populated on 100% of rows (measured 2026-07-26).
  const minValue = p.get('minValue') ? Number(p.get('minValue')) : null;
  const maxValue = p.get('maxValue') ? Number(p.get('maxValue')) : null;
  // "How this buyer buys" as a FILTER (GOS #11) — contract_type is 99% populated (measured
  // 2026-07-27: DELIVERY ORDER 438 / PURCHASE ORDER 222 / DEFINITIVE 104 / BPA CALL 31 / null 5
  // in an 800-row sample; fleet split PO 25,860 / DO 77,586). A PURCHASE ORDER is a
  // simplified-acquisition buy a small firm can win directly; a DELIVERY ORDER is a task order
  // under a vehicle you must already hold. So `sap=friendly` keeps PO+BPA CALL (the SB-winnable
  // buys), `sap=gated` keeps DELIVERY ORDER (vehicle-gated). Definitive contracts are neither
  // bucket's signal, so each filter EXCLUDES them (honest — we only claim the two we can defend).
  const sap = (p.get('sap') || '').toLowerCase(); // '' | 'friendly' | 'gated'
  // Recompete likelihood — measured 2026-07-27 the ONLY real values are high (51,591) and
  // medium (92,011); low is 0 fleet-wide, so there is NO "low" option (would be a dead control).
  // `likelihood=high` narrows to the strongest recompete signal.
  const likelihood = (p.get('likelihood') || '').toLowerCase(); // '' | 'high'
  // Lead time — months until the incumbent's period of performance ends. 100% populated;
  // measured buckets ≤6 / 7-12 / 13-18 all real (>18 is ~0). "Expiring within N months" = the
  // recompete-window planning filter. lead_time_months <= N (N ∈ {6,12,18}).
  const leadMax = p.get('leadMax') ? Number(p.get('leadMax')) : null;
  // NOTE: psc_code is measured 0/125,917 populated on this table (2026-07-26) — a PSC
  // filter here would be a dead control (always empty or always everything). Deliberately
  // NOT wired; the UI hides the PSC control for Awarded (see route.ts syncFilterVis).

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const applyFilters = (q: any) => {
    q = q.is('quality_flag', null).not('map_lat', 'is', null);
    if (setAside) q = q.eq('set_aside_type', setAside);
    if (agency) q = q.ilike('awarding_agency', `%${agency}%`);
    if (naics) q = q.or(`naics_code.eq.${naics},naics_code.like.${naics.substring(0, 3)}%`);
    if (state) q = q.eq('place_of_performance_state', state);
    if (subAgency) q = q.ilike('awarding_sub_agency', `%${subAgency}%`);
    if (minValue != null && Number.isFinite(minValue)) q = q.gte('potential_total_value', minValue);
    if (maxValue != null && Number.isFinite(maxValue)) q = q.lte('potential_total_value', maxValue);
    // SAP-friendly (contract_type). friendly = PO + BPA CALL (SB-winnable); gated = DELIVERY ORDER.
    if (sap === 'friendly') q = q.in('contract_type', ['PURCHASE ORDER', 'BPA CALL']);
    else if (sap === 'gated') q = q.eq('contract_type', 'DELIVERY ORDER');
    // Recompete likelihood — only 'high' is offered (medium is the majority default, low=0).
    if (likelihood === 'high') q = q.eq('recompete_likelihood', 'high');
    // Expiring within N months (lead time). Guard the parsed number.
    if (leadMax != null && Number.isFinite(leadMax)) q = q.lte('lead_time_months', leadMax);
    return q;
  };

  try {
    const db = sb();
    const totalQ = applyFilters(db.from('recompete_opportunities').select('contract_id', { count: 'exact', head: true }));
    const viewQ = applyFilters(db.from('recompete_opportunities').select(COLS, { count: 'exact' }))
      .gte('map_lat', south).lte('map_lat', north).gte('map_lng', west).lte('map_lng', east)
      .order('period_of_performance_current_end', { ascending: true }).limit(MAX_PINS);
    const [{ count: totalForFilters }, { data, count: totalInView, error }] = await Promise.all([totalQ, viewQ]);
    if (error) throw error;
    const pins = (data || []).map(toPin);
    return NextResponse.json({
      success: true, mode: 'recompete',
      totalForFilters: totalForFilters ?? 0, totalInView: totalInView ?? pins.length,
      capped: (totalInView ?? 0) > pins.length, pins,
    });
  } catch (e) {
    return NextResponse.json({ success: false, error: (e as Error).message }, { status: 500 });
  }
}
