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
import { termOfArtNaicsCodes } from '@/lib/market/sector-expansions';
import { resolveQueryIntent, setAsideOrExpr, pscToNaicsCodes } from '@/lib/search/query-intent';
import { multiAgency, agencyOrExpr } from '@/lib/opportunities/map-filters';

export const dynamic = 'force-dynamic';

const MAX_PINS = 1000;
const COLS = 'contract_id, piid, incumbent_name, incumbent_uei, awarding_agency, awarding_sub_agency, naics_code, naics_description, '
  + 'potential_total_value, total_obligation, period_of_performance_current_end, set_aside_type, contract_type, '
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
  let naics = p.get('naics') || '';
  // TERM-OF-ART search (Eric 2026-07-28) — recompete rows have NO searchable notice text (incumbent
  // NAME + agency only; description/psc 0% populated), so a text search for "drones" can't match. The
  // honest equivalent is to filter recompetes IN that industry: resolve a term-of-art `q` to its
  // CURATED NAICS set (verified codes, not the noisy full-coverage tail) and apply it as the NAICS
  // filter. Only when the user hasn't already set an explicit NAICS. Non-term-of-art `q` is a no-op
  // here (there's genuinely nothing to text-search — we don't fabricate a match).
  const q = (p.get('q') || '').trim();
  // SEARCH BRAIN (Eric 2026-08-01) — resolve what the user TYPED into an intent, applied the SAME
  // way as SAM/forecast so "8a"/"236220"/"cyber" mean the same thing across all 3 horizons:
  //   set-aside term ("8a"/"women owned") → set_aside_type (recompete's set-aside column)
  //   NAICS code ("236220") / term-of-art phrase ("cybersecurity"→codes) → the naics filter
  //   free text → keyword ilike on incumbent/naics_desc/agency.
  // NO PSC branch here: recompete's psc_code is measured 0/125,917 populated (100% NULL) — filtering
  // it would silently return ZERO (a dead filter). So a PSC search falls through to keyword. This is
  // the honest "source lacks the data" case, like DLA has no set-aside. (filter-parity gate enforces it.)
  let qKeyword = '', qSetAside = '';
  if (q && !naics) {
    const intent = resolveQueryIntent(q);
    if (intent.kind === 'setAside' && intent.setAside) {
      qSetAside = setAsideOrExpr(intent.setAside, { textCols: ['set_aside_type'] });
    } else if (intent.kind === 'naics' && intent.naics?.length) {
      naics = intent.naics.join(',');
    } else if (intent.kind === 'psc' && intent.psc) {
      // recompete's psc_code is ~100% NULL, so instead of a dead PSC filter, CROSSWALK the PSC to its
      // equivalent NAICS and filter by industry (the brain solve). No mapping → keyword fallback.
      const xw = pscToNaicsCodes(intent.psc);
      if (xw.length) naics = xw.join(','); else qKeyword = intent.psc;
    } else {
      // Free text: term-of-art → curated NAICS; else keyword ilike on the populated columns
      // (incumbent_name/naics_description/awarding_agency).
      const toaCodes = termOfArtNaicsCodes(q);
      if (toaCodes && toaCodes.length) naics = toaCodes.join(',');
      else qKeyword = q;
    }
  }
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

  // Exclude ALREADY-EXPIRED contracts from the default view (Eric 2026-07-27). A contract past its
  // period-of-performance end has already recompeted — its follow-on is (or soon will be) awarded, so
  // it's a dead lead, not a live "get ahead of the rebid" target. Measured 2026-07-27: only 2,150 of
  // 134,220 rows (1.6%) are past-expiry (0 expired >6mo ago — the sync prunes old ones), so this is a
  // thin recently-slipped edge, not a scope change. `?includePast=1` opts back in (favorites/audits).
  // ⚠️ Root cause noted separately: the EXPIRED parent is in the table but its already-awarded
  // follow-on often is NOT — a sync gap tracked as Layer-2 follow-up, not fixed by this filter.
  const includePast = p.get('includePast') === '1';
  const todayYmd = new Date().toISOString().slice(0, 10);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const applyFilters = (q: any) => {
    q = q.is('quality_flag', null).not('map_lat', 'is', null);
    if (!includePast) q = q.gte('period_of_performance_current_end', todayYmd);
    if (setAside) q = q.eq('set_aside_type', setAside);
    // Agency multi-select — pipe-joined needles OR'd into awarding_agency via agencyOrExpr (matches
    // both word orders: recompete stores "Department of State", SAM stores "STATE, DEPARTMENT OF").
    const agencyExpr = agencyOrExpr('awarding_agency', multiAgency(agency));
    if (agencyExpr) q = q.or(agencyExpr);
    if (naics) {
      // Support a comma-separated list (term-of-art expansion sends N curated codes) OR a single code.
      // Single code keeps the prefix-widen (eq OR like 3-digit); multiple codes → exact OR of each.
      const codes = naics.split(',').map((c) => c.trim()).filter(Boolean);
      if (codes.length > 1) {
        q = q.or(codes.map((c) => `naics_code.eq.${c}`).join(','));
      } else if (codes.length === 1) {
        // A FULL 6-digit code means that code, not its family. The prefix-widen here used to fire
        // for every single-code search: "333612" became `eq 333612 OR like 333%`, so the count
        // described the whole 333 family (3,528) while the rows the user saw were the 118 real
        // matches. The map header sums each horizon's totalForFilters, so that 3,528 landed in a
        // "3,555 results" headline on a search with 805 true matches — and a demo attendee read it,
        // correctly, as "I cant filter with 333612" (2026-08-22).
        //
        // Widening still helps a SHORT code, where the user typed a sector and means the family.
        // Threshold is <6, not <=4: stored naics_code is 6 digits, so a 5-digit search must widen
        // by prefix or it matches nothing at all (measured: `33361` returned 0 with an eq).
        const c0 = codes[0];
        q = c0.length < 6 ? q.like('naics_code', `${c0}%`) : q.eq('naics_code', c0);
      }
    }
    if (state) q = q.eq('place_of_performance_state', state);
    if (subAgency) q = q.ilike('awarding_sub_agency', `%${subAgency}%`);
    // Set-aside term from the search brain → recompete's set_aside_type column.
    if (qSetAside) q = q.or(qSetAside);
    // (No PSC filter — psc_code is 100% NULL on recompete; a PSC search falls through to keyword.)
    // Free-text keyword (non-NAICS, non-term-of-art, non-set-aside) → match the incumbent name, NAICS
    // description, or awarding agency (the searchable recompete columns; no award title in this table).
    if (qKeyword) {
      const esc = qKeyword.replace(/[%,()]/g, ' ');
      q = q.or(`incumbent_name.ilike.%${esc}%,naics_description.ilike.%${esc}%,awarding_agency.ilike.%${esc}%`);
    }
    if (minValue != null && Number.isFinite(minValue)) q = q.gte('potential_total_value', minValue);
    if (maxValue != null && Number.isFinite(maxValue)) q = q.lte('potential_total_value', maxValue);
    // SAP-friendly (contract_type). friendly = PO + BPA CALL (SB-winnable); gated = DELIVERY ORDER.
    if (sap === 'friendly') q = q.in('contract_type', ['PURCHASE ORDER', 'BPA CALL']);
    else if (sap === 'gated') q = q.eq('contract_type', 'DELIVERY ORDER');
    // Recompete likelihood — only 'high' is offered (medium is the majority default, low=0).
    if (likelihood === 'high') q = q.eq('recompete_likelihood', 'high');
    // Expiring within N months (lead time). FM-U06 (Eric/QA 2026-07-29): the stored lead_time_months
    // is STALE (baked at sync time, often 0), so filter on the LIVE relationship instead — a contract
    // "expiring within N months" is one whose PoP-end is between today and today+N months. This is the
    // same live intent the shared queryExpiringContracts computes; the map read the raw column and
    // bypassed it. Guard the parsed number.
    if (leadMax != null && Number.isFinite(leadMax)) {
      const bound = new Date();
      bound.setMonth(bound.getMonth() + Math.round(leadMax));
      q = q.lte('period_of_performance_current_end', bound.toISOString().slice(0, 10));
    }
    return q;
  };

  try {
    const db = sb();
    const bbox = (q: ReturnType<typeof applyFilters>) =>
      q.gte('map_lat', south).lte('map_lat', north).gte('map_lng', west).lte('map_lng', east);

    const totalForFiltersHead = applyFilters(db.from('recompete_opportunities').select('contract_id', { count: 'exact', head: true }));
    const [{ count: totalForFilters }] = await Promise.all([totalForFiltersHead]);

    const viewQ = bbox(applyFilters(db.from('recompete_opportunities').select(COLS, { count: 'exact' })))
      .order('period_of_performance_current_end', { ascending: true }).limit(MAX_PINS);
    // Captured FOLLOW-ONS always expire the LATEST (3-5yr out), so the expiry-ascending sort + the
    // MAX_PINS cap systematically buries them behind nearer-term rows at a broad zoom — yet they're
    // the FRESHEST intelligence (the winner of a just-recompeted contract). Fetch them separately
    // (data_source='usaspending_followon', same filters+bbox) and merge in any the capped set missed,
    // deduped by contract_id. Small set by construction, so no cap needed here (Eric 2026-07-28).
    const followOnQ = bbox(applyFilters(db.from('recompete_opportunities').select(COLS)))
      .eq('data_source', 'usaspending_followon').limit(MAX_PINS);
    const [{ data, count: totalInView, error }, { data: followOns }] =
      await Promise.all([viewQ, followOnQ]);
    if (error) throw error;
    const cid = (r: unknown) => String((r as { contract_id?: unknown }).contract_id ?? '');
    const rows = data || [];
    const seen = new Set(rows.map(cid));
    const extraFollowOns = (followOns || []).filter((r: unknown) => !seen.has(cid(r)));
    const pins = [...rows, ...extraFollowOns].map(toPin);
    return NextResponse.json({
      success: true, mode: 'recompete',
      totalForFilters: totalForFilters ?? 0, totalInView: totalInView ?? pins.length,
      capped: (totalInView ?? 0) > (rows.length), pins,
    });
  } catch (e) {
    return NextResponse.json({ success: false, error: (e as Error).message }, { status: 500 });
  }
}
