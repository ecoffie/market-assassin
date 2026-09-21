/**
 * Shared Awarded/Recompete pin shape — used by the bbox map AND the by-id share fallback.
 *
 * COMPOUND: one toPin() so /api/app/recompete-map and /api/app/recompete-row cannot drift.
 * id = contract_id, sol = piid. The map client’s toRow(recompete) reads this exact pin.
 */
import { setGroupKey, naicsCategory } from '@/lib/opportunities/map-data';
import { geocodeCity, stableSeed } from '@/lib/geo/city-geocode';
import { normalizeStateCode } from '@/lib/utils/us-states';

export const RECOMPETE_PIN_COLS =
  'contract_id, piid, incumbent_name, incumbent_uei, awarding_agency, awarding_sub_agency, naics_code, naics_description, '
  + 'potential_total_value, total_obligation, period_of_performance_current_end, set_aside_type, contract_type, '
  + 'place_of_performance_city, place_of_performance_state, map_lat, map_lng, map_loc_source, last_synced_at';

export function money(n: number): string {
  if (!n || n <= 0) return '';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
  return '$' + n;
}

export type RecompetePin = {
  id: string;
  src: 'RECOMPETE';
  title: string;
  contractType: string;
  agency: string;
  subAgency: string | null;
  cat: string;
  naics: string;
  set: string;
  value: string;
  valueNum: number | null;
  exp: string | null;
  loc: string;
  state: string;
  sol: string;
  uei: string | null;
  lat: number;
  lng: number;
  locPrecision: 'city' | 'state';
  synced: string | null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toPin(r: Record<string, any>): RecompetePin {
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
    // Title = the REAL incumbent (googleable), NOT a fabricated "<service line> recompete" label.
    // The data carries no award title (description/psc_description measured 0% populated 2026-07-27),
    // so the incumbent company is the honest, researchable headline. Service line stays in `cat`.
    title: r.incumbent_name || 'Incumbent',
    // Real award type (contract_type, 99% populated) → the card labels itself IDIQ vehicle / task
    // order / definitive / purchase order / BPA call, so the parent-vehicle vs task-order distinction
    // is explicit instead of calling everything "recompete". Human-labeled client-side.
    contractType: r.contract_type || '',
    agency: r.awarding_agency || '',
    // Sub-agency on the identity line, MATCHING opportunities (Eric 2026-08-05: "recompetes should
    // show sub agency like opportunities"). awarding_sub_agency is 100% populated (used for filtering
    // since 2026-07-30), so lcHeader shows "Air Force"/"Navy" instead of the parent dept "Defense".
    // Real value, never fabricated — null when genuinely absent, and the card falls back to agency.
    subAgency: r.awarding_sub_agency || null,
    cat: naicsCategory(r.naics_code) || (r.naics_description || 'Recompete'),
    naics: String(r.naics_code ?? ''),
    set: setGroupKey(r.set_aside_type),
    value: money(val),
    // Raw numeric ceiling (potential_total_value, 100% populated — measured 2026-07-26) — the
    // formatted `value` above ("$837.8M") can't be bucketed into a histogram or compared with
    // min/max, so the Value-range pill on the Opportunity Map reads THIS field.
    valueNum: val > 0 ? val : null,
    exp: r.period_of_performance_current_end || null,
    loc: city ? `${city}, ${state || ''}` : (state || ''),
    // 2-letter place-of-performance state code — threaded to the drawer so the cross-sell
    // "Open bids like this" fetch (/api/app/related-opps) can match same-NAICS+same-state.
    state: state || '',
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
