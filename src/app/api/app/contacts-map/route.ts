/**
 * GET /api/app/contacts-map — pins for the Opportunity Map "Contacts" mode.
 *
 * TWO sub-datasets (?type=companies|buyers, default companies):
 *  • companies — award-winning federal contractors from BigQuery (searchRecipients),
 *    scoped to the state(s) actually visible in the viewport (explicit ?state= wins;
 *    otherwise inferred from the bbox via statesOverlappingBbox) so a region shows
 *    ITS OWN companies rather than the national top-100-by-$ (see companiesPins doc
 *    comment for the bug this replaced). Each firm carries a real HQ city+state
 *    (recipients_rollup_merged) — placed via the shared `geocodeCity()` (the same
 *    ~29.5K-city GeoNames table the opportunity map uses), so a Louisville firm sits
 *    on Louisville, not a decorative ring around Kentucky's centroid. Falls back to
 *    the state centroid only when the city isn't in the table (precision:'state',
 *    surfaced honestly, never presented as an exact city hit). Set-aside eligibility
 *    (?type=companies only) is derived per-firm from real awards
 *    (getSetAsidesForRecipients) — a firm with no set-aside award carries no chip,
 *    never a fabricated one. ?sort= accepts value|awards|az (default value = $
 *    obligated, highest first).
 *  • buyers — government decision-makers (contracting officers / POCs) from
 *    federal_contacts. That table carries NO city (only a state, recovered via a JOIN
 *    to sam_opportunities by solicitation_number), so buyers geocode to
 *    precision:'state' almost always — honestly labeled, not overclaimed.
 *
 * Both: MI-token authed (same as opportunity-map), capped at MAX_PINS, filtered to
 * the viewport bbox AFTER geocoding, and — critically — a pin is placed ONLY when we
 * have a REAL 2-letter state. Rows with no location are skipped, never fabricated.
 *
 * Response mirrors the other map endpoints: { success, pins, totalForFilters }.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { statesOverlappingBbox } from '@/lib/geo/state-centroids';
import { geocodeCity, stableSeed, resolveBuyerLocation } from '@/lib/geo/city-geocode';
import { normalizeStateCode } from '@/lib/utils/us-states';
import { searchRecipients, getSetAsidesForRecipients, SET_ASIDE_BUCKET_LABEL } from '@/lib/bigquery/recipients';
import { termOfArtNaicsCodes } from '@/lib/market/sector-expansions';
import { isUsableContactCard } from '@/lib/gov-contacts/contact-quality';
import { formatAgencyDisplay } from '@/lib/mindy/agency-display';
import { multiAgency, agencyOrExpr } from '@/lib/opportunities/agency-match';
import { isValidDodaac } from '@/lib/gov-contacts/agency-key';

export const dynamic = 'force-dynamic';

const MAX_PINS = 400; // sensible cap (task spec) — keeps the map readable + BQ/DB cheap.

function sb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

function money(n: number): string {
  if (!n || n <= 0) return '';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
  return '$' + n;
}

// A pin is inside the viewport bbox. (west,south,east,north)
function inBbox(lat: number, lng: number, b: [number, number, number, number]) {
  return lat >= b[1] && lat <= b[3] && lng >= b[0] && lng <= b[2];
}

// Geocode a row's city+state via the shared board-wide geocoder. Tracks a per-key
// occurrence count so repeated rows landing on the SAME real city (or, absent a city hit,
// the same state centroid) fan out with a small deterministic jitter instead of stacking on
// one pixel — the jitter is per-COLLISION, not a state-wide ring, and only ever applied when
// two+ rows share the exact same resolved point.
function placeRow(
  city: string,
  state: string,
  seenPerKey: Map<string, number>,
): { at: [number, number]; precision: 'city' | 'state' } | null {
  const key = `${(city || '').toUpperCase().trim()}|${state}`;
  const seed = seenPerKey.get(key) || 0;
  seenPerKey.set(key, seed + 1);
  const g = geocodeCity(city, state, seed);
  if (!g) return null;
  return { at: [g.lat, g.lng], precision: g.precision };
}

// ── Companies: award-winning contractors (BigQuery) ─────────────────────────
// ROOT-CAUSE FIX (2026-07-26): this used to call searchRecipients({sortBy:
// 'total_obligated', limit:100}) with NO state — the GLOBAL top-100 firms by
// obligated $, filtered to the viewport AFTER the fact. In any region smaller
// than the whole country that's every national mega-prime and ~0 local firms
// (measured: 0/100 RI firms make the national top 100 — Tavares LLC $35.5M/41
// awards and Excell Construction Corp $9.1M/29 awards, both real, rank deep in
// RI's own 908-firm list but nowhere near nationwide top-100). Fix: filter by
// the VIEWPORT'S state(s) FIRST, then rank — so a region shows that region's
// own companies. `searchRecipients` already honors `state` on its no-NAICS
// path (WHERE r.state = @state, ~12-24 MB per state — cheap, never the 63M-row
// awards table).
const SORT_TO_RECIPIENT_SORT: Record<string, 'total_obligated' | 'award_count' | 'recipient_name'> = {
  value: 'total_obligated',
  awards: 'award_count',
  az: 'recipient_name',
};

// "Recommended" sort — the Zillow "Homes for You" analog (Eric 2026-07-28: the default was silently
// $-won-desc, so national mega-primes like Lockheed/Fluor dominated every local view). A transparent
// blend of REAL row fields — NO fabricated inputs, $ won is ONE factor not the sole rank:
//   • $ won, LOG-scaled → a $28B prime no longer swamps a relevant $50M local firm (log squashes the
//     6-orders-of-magnitude spread into a bounded ~0..1 contribution).
//   • recency → firms that won recently rank above dormant ones (last_action_date; a firm last active
//     8+ yrs ago is down-ranked hard). This is the single biggest de-whale lever.
//   • agency breadth → an established, diversified firm (distinct_agency_count) over a one-agency shop.
//   • set-aside relevance → a firm holding a real SBA cert gets a boost (teamable / small-biz-relevant),
//     the signal a mega-prime lacks.
// All terms normalized to ~0..1 and weighted; returns a single score, higher = more recommended.
const NOW_YEAR = new Date().getFullYear();
function recommendedScore(
  r: { total_obligated?: number | null; last_action_date?: string | null; distinct_agency_count?: number | null },
  hasSetAside: boolean,
): number {
  const dollars = Math.max(0, Number(r.total_obligated) || 0);
  // log10 of $ won, mapped so ~$10K→0 and ~$10B→1 (10 decades). Bounded 0..1.
  const dollarTerm = dollars > 0 ? Math.min(1, Math.max(0, (Math.log10(dollars) - 4) / 6)) : 0;
  // Recency: full credit if active this/last year, decaying to 0 by ~8 years dormant.
  const ly = Number(String(r.last_action_date || '').slice(0, 4)) || 0;
  const yearsStale = ly ? Math.max(0, NOW_YEAR - ly) : 12; // no date → treat as very stale
  const recencyTerm = Math.max(0, 1 - yearsStale / 8);
  // Agency breadth: 1 agency→low, ~15+ agencies→saturated. Bounded 0..1.
  const breadthTerm = Math.min(1, (Number(r.distinct_agency_count) || 0) / 15);
  // Set-aside relevance: a flat boost for holding a real SBA cert (the teamable/SB-relevant signal).
  const setAsideTerm = hasSetAside ? 1 : 0;
  // Weights: recency + $ lead (a real, still-active player), breadth + set-aside shape the rest.
  return 0.34 * recencyTerm + 0.30 * dollarTerm + 0.20 * breadthTerm + 0.16 * setAsideTerm;
}

async function companiesPins(params: {
  bbox: [number, number, number, number];
  state: string;
  search: string;
  sort: string;
  setAside: string; // comma-joined bucket keys (SDVOSB,8A,WOSB,HZ,SB) — filters to firms holding ANY of them
  naics: string; // filter parity (2026-07-26): searchRecipients already supports a `naics` arg
  // on its cheap pre-aggregated rollup path, scoped by state INSIDE the same BQ call (never
  // ranked-then-filtered — the rank-then-filter gate would flag threading state alone after a
  // naics-ranked fetch; here both scope params go into the SAME searchRecipients call).
  agency: string; // "sells-to-agency" scope (2026-08-03) — pipe-joined agency needles, same
  // vocabulary as the map's Agency filter. searchRecipients scans the awards table (grouped by
  // recipient, ranked by $) when this is set — the plain NAICS rollup has no agency column.
  // Threaded into the SAME searchRecipients call as state/naics (never ranked-then-filtered).
}) {
  // Explicit state filter wins; otherwise infer the state(s) actually visible in
  // the current viewport from their centroids (cheap, no polygon data needed —
  // see statesOverlappingBbox). Capped at 6 states so a zoomed-out view can't
  // fan out into a dozen parallel BQ calls.
  const states = params.state ? [params.state] : statesOverlappingBbox(params.bbox, 3, 6);

  const sortBy = SORT_TO_RECIPIENT_SORT[params.sort] || 'total_obligated';
  // Over-fetch per state (300-500 pre-bbox-filter, per task spec) so small
  // firms actually in view surface instead of being crowded out by a couple
  // of dominant primes within that same state.
  const PER_STATE_LIMIT = 300;

  let total = 0;
  const byUei = new Map<string, { r: Awaited<ReturnType<typeof searchRecipients>>['rows'][number] }>();
  if (states.length === 0) {
    // No state resolvable from the viewport (e.g. zoomed out to the whole US,
    // or OCONUS) — fall back to the prior global-top behavior rather than
    // returning nothing; this only affects the "zoomed way out" case, where
    // showing the biggest national names is a reasonable default view.
    const { rows, total: t } = await searchRecipients({
      search: params.search || undefined,
      naics: params.naics || undefined,
      agency: params.agency || undefined,
      sortBy,
      limit: 100,
      liveBq: true,
    });
    total = t;
    for (const r of rows) byUei.set(r.recipient_uei || r.recipient_name, { r });
  } else {
    const results = await Promise.all(
      states.map((st) =>
        searchRecipients({
          search: params.search || undefined,
          naics: params.naics || undefined,
          agency: params.agency || undefined,
          state: st,
          sortBy,
          limit: PER_STATE_LIMIT,
          liveBq: true, // authed in-app request — must hit live BQ, else 0 on a cold cache.
        }),
      ),
    );
    for (const { rows, total: t } of results) {
      total += t;
      for (const r of rows) {
        const key = r.recipient_uei || r.recipient_name;
        if (!byUei.has(key)) byUei.set(key, { r });
      }
    }
  }

  // Re-rank the merged, deduped set the same way the caller asked (per-state
  // pages arrive pre-sorted, but merging states can interleave them).
  const merged = Array.from(byUei.values()).map((x) => x.r);
  merged.sort((a, b) => {
    if (sortBy === 'recipient_name') return (a.recipient_name || '').localeCompare(b.recipient_name || '');
    if (sortBy === 'award_count') return (b.award_count || 0) - (a.award_count || 0);
    return (b.total_obligated || 0) - (a.total_obligated || 0);
  });

  // Geocode + bbox-filter FIRST (free — no BQ). If a set-aside filter/sort is
  // requested we need set-aside data for a wider candidate pool than just the
  // first MAX_PINS — otherwise filtering to "SDVOSB only" could starve the
  // result to near-zero pins even when plenty exist further down the ranked
  // list. Cap the candidate pool at a reasonable multiple of MAX_PINS so the
  // set-aside lookup (cost scales with UEI count) stays bounded.
  const wantSetAside = params.setAside.length > 0 || params.sort === 'setaside';
  const CANDIDATE_CAP = wantSetAside ? MAX_PINS * 3 : MAX_PINS;
  const seenPerKey = new Map<string, number>();
  const candidates: Array<{ r: (typeof merged)[number]; state: string; at: [number, number]; precision: 'city' | 'state' }> = [];
  for (const r of merged) {
    const state = normalizeStateCode(r.state || '') || '';
    if (!/^[A-Z]{2}$/.test(state)) continue; // real state only — never fabricate a location
    const placed = placeRow(r.city || '', state, seenPerKey);
    if (!placed) continue;
    const { at, precision } = placed;
    if (!inBbox(at[0], at[1], params.bbox)) continue;
    candidates.push({ r, state, at, precision });
    if (candidates.length >= CANDIDATE_CAP) break;
  }

  // Set-aside chips + filter/sort: batch-lookup ONLY the candidate UEIs (bounded,
  // never a state-wide/nationwide scan — see getSetAsidesForRecipients cost
  // notes). A firm with no set-aside award gets no chip (never fabricated).
  const ueisToLookup = candidates.map((c) => c.r.recipient_uei).filter(Boolean);
  const setAsideMap = ueisToLookup.length
    ? await getSetAsidesForRecipients(ueisToLookup, true)
    : new Map<string, string[]>();

  const wantBuckets = new Set(params.setAside.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean));
  let filtered = candidates;
  if (wantBuckets.size) {
    filtered = candidates.filter((c) => {
      const buckets = setAsideMap.get(c.r.recipient_uei) || [];
      return buckets.some((b) => wantBuckets.has(b));
    });
  }
  if (params.sort === 'setaside') {
    // Firms WITH a set-aside first (grouped by bucket ranking), then by $ obligated.
    filtered = filtered.slice().sort((a, b) => {
      const ba = setAsideMap.get(a.r.recipient_uei) || [];
      const bb = setAsideMap.get(b.r.recipient_uei) || [];
      const hasA = ba.length ? 0 : 1, hasB = bb.length ? 0 : 1;
      if (hasA !== hasB) return hasA - hasB;
      return (b.r.total_obligated || 0) - (a.r.total_obligated || 0);
    });
  } else if (!params.sort) {
    // "Recommended" (the empty default) — the Zillow relevance blend, NOT raw $-desc (Eric
    // 2026-07-28). Explicit sorts (value/awards/az/setaside) above/earlier are untouched; this
    // only re-orders the default view so local/relevant firms surface over dormant mega-primes.
    filtered = filtered.slice().sort((a, b) => {
      const sa = recommendedScore(a.r, (setAsideMap.get(a.r.recipient_uei) || []).length > 0);
      const sb = recommendedScore(b.r, (setAsideMap.get(b.r.recipient_uei) || []).length > 0);
      if (sb !== sa) return sb - sa;
      return (b.r.total_obligated || 0) - (a.r.total_obligated || 0); // stable tiebreak
    });
  }
  const placed = filtered.slice(0, MAX_PINS);

  const pins: Array<Record<string, unknown>> = [];
  for (const { r, state, at, precision } of placed) {
    const parts: string[] = [];
    if (r.award_count) parts.push(`${r.award_count.toLocaleString()} award${r.award_count === 1 ? '' : 's'}`);
    if (r.total_obligated) parts.push(money(r.total_obligated) + ' won');
    if (r.distinct_agency_count) parts.push(`${r.distinct_agency_count} agenc${r.distinct_agency_count === 1 ? 'y' : 'ies'}`);
    const buckets = (setAsideMap.get(r.recipient_uei) || []).slice(0, 2);
    pins.push({
      id: r.recipient_uei || r.recipient_name,
      lat: at[0], lng: at[1],
      name: r.recipient_name,
      state,
      city: (r.city || '').trim(),
      locPrecision: precision, // 'city' = exact GeoNames hit, 'state' = honest centroid fallback
      meta: parts.join(' · '),
      setAsides: buckets,
      setAsideLabels: buckets.map((b) => SET_ASIDE_BUCKET_LABEL[b] || b),
      awardCount: r.award_count || 0,
      totalObligated: r.total_obligated || 0,
      // Discrete field (not just inside `meta`) so the list card's polished facts grid can show a
      // real "Agencies" cell alongside Won / Awards — matching the Awarded card's 3-cell grid.
      distinctAgencyCount: r.distinct_agency_count || 0,
    });
  }
  // `totalForFilters` is the BROADER match count (firms matching search/naics across the
  // candidate states, pre-bbox). `totalInView` is what actually survived geocode + bbox-filter —
  // i.e. what the map shows. They diverge when matches are sparse or off-viewport (search
  // "tavares" → 26 firms match in-state but 0 land in the visible NE box). Returning BOTH lets the
  // UI show the honest "N in view" instead of claiming 26 while the map is empty (the count/pins
  // mismatch bug). See [[rank_then_filter_starves_local]] — same family, count-vs-pins honesty.
  return {
    pins,
    totalInView: pins.length,
    totalForFilters: wantBuckets.size ? placed.length : (total || pins.length),
  };
}

// ── Buyers: government decision-makers (federal_contacts ⋈ sam_opportunities) ──
async function buyersPins(params: {
  bbox: [number, number, number, number];
  state: string;
  search: string;
  agency: string; // filter parity (2026-07-26): department_ind_agency is 100% populated
  // (measured: 98,024/98,024 usable rows) — a real, honest ilike filter, unlike NAICS
  // (contacts have no NAICS column at all — deliberately not added, per task spec).
  office: string; // a 6-char DoDAAC (W912PL). Matched on the solicitation_number PREFIX,
  // NEVER on the `office` column: measured 2026-08-14, `office` is NULL on ALL 126,097
  // usable federal_contacts rows, so an office ILIKE returns 0 every time — the same trap
  // that made a USACE district card fall back to dept-wide DoD. W912PL by sol-number = 116
  // real contacts; by office = 0. (Shared rule: src/lib/gov-contacts/agency-key.ts.)
}) {
  const db = sb();
  // federal_contacts has NO state column, so recover location from the notice the POC
  // is named on: join by solicitation_number → sam_opportunities (pop_state, then the
  // buying-office state as a fallback — both are ~2-letter uppercase). We over-fetch
  // because many rows dedupe (same person on many notices) and many drop for no state.
  //
  // Ghost-card guard (2026-07-26): federal_contacts has ~3,912 rows where
  // contact_fullname is a literal SAM placeholder like "Telephone: 7175503112"
  // (no real name exists upstream — not recoverable). Excluding the "telephone/
  // phone/fax/tel:" shape at the QUERY keeps `count` honest for the "N of M"
  // label; isUsableContactCard below is the belt-and-suspenders in case a row
  // slips the ILIKE (e.g. a bare digit string with no label prefix).
  let q = db
    .from('federal_contacts')
    .select('id, contact_fullname, contact_title, department_ind_agency, office, sub_tier, solicitation_number', { count: 'exact' })
    .not('contact_fullname', 'is', null)
    .not('solicitation_number', 'is', null)
    .not('contact_fullname', 'ilike', 'telephone:%')
    .not('contact_fullname', 'ilike', 'phone:%')
    .not('contact_fullname', 'ilike', 'fax:%')
    .not('contact_fullname', 'ilike', 'tel:%')
    .limit(4000);
  if (params.search) q = q.ilike('contact_fullname', `%${params.search}%`);
  // Agency multi-select (pipe-joined needles; both word orders) → department_ind_agency ("STATE,
  // DEPARTMENT OF" here). Empty/all-checked sends nothing → no narrowing (whole map).
  const agencyExpr = agencyOrExpr('department_ind_agency', multiAgency(params.agency || ''));
  if (agencyExpr) q = q.or(agencyExpr);
  // Office (DoDAAC) — the solicitation_number prefix IS the office key here. Applied INSIDE
  // the query (before the 4000-row limit), never as a post-filter: a post-filter would rank
  // the whole corpus first and starve a single district of its own people.
  if (isValidDodaac(params.office)) q = q.ilike('solicitation_number', `${params.office.toUpperCase()}%`);

  const { data, count, error } = await q;
  if (error) throw error;

  // Resolve each POC's notice → state. Batch the sol-number lookups.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = ((data || []) as Record<string, any>[]).filter((r) => isUsableContactCard(r));
  const solNums = Array.from(
    new Set(rows.map((r) => String(r.solicitation_number || '')).filter(Boolean)),
  ).slice(0, 2000);

  // Map solicitation_number → a coherent US {city,state}. `resolveBuyerLocation` is the ONE
  // place the "Seoul, DC" bug is fixed: a State-Dept POC's notice carries a FOREIGN place of
  // performance (pop_city="Seoul", pop_state="KR-11" — a foreign ISO subdivision, not a US
  // state) bought by a DC office. The old code kept the pop CITY and fell the STATE back to
  // the office's "DC", pairing a foreign city with a US state it isn't in. The resolver
  // instead pairs city+state coherently: a city is kept ONLY when it's a real GeoNames city
  // IN the resolved state; a foreign/unusable place of performance falls back to the buying
  // office (state-level, noted), never to "ForeignCity, WrongState".
  const solLoc = new Map<string, { city: string; state: string; approxNote: string }>();
  const CHUNK = 200;
  for (let i = 0; i < solNums.length; i += CHUNK) {
    const chunk = solNums.slice(i, i + CHUNK);
    const { data: opps, error: oErr } = await db
      .from('sam_opportunities')
      .select('solicitation_number, pop_city, pop_state, office_address')
      .in('solicitation_number', chunk);
    if (oErr) throw oErr;
    for (const o of (opps || []) as Array<{ solicitation_number: string; pop_city: string | null; pop_state: string | null; office_address: { city?: string; state?: string } | null }>) {
      if (solLoc.has(o.solicitation_number)) continue;
      const resolved = resolveBuyerLocation({
        popCity: o.pop_city,
        popState: o.pop_state,
        officeCity: o.office_address?.city ?? null,
        officeState: o.office_address?.state ?? null,
      });
      if (!resolved) continue; // no real US state → no pin (never fabricate)
      solLoc.set(o.solicitation_number, resolved);
    }
  }

  // Activity per person = how many DISTINCT solicitations name them (a buyer running 40 notices is
  // more worth reaching than one on a single notice). Counted over the whole result set BEFORE dedup,
  // keyed the same way as the person-dedupe below. Real signal, powers the "Recommended" sort + card.
  const oppCountByPerson = new Map<string, Set<string>>();
  for (const r of rows) {
    const k = `${(r.contact_fullname || '').toLowerCase()}|${(r.department_ind_agency || '').toLowerCase()}`;
    const sol = String(r.solicitation_number || '');
    if (!sol) continue;
    const set = oppCountByPerson.get(k) || new Set<string>();
    set.add(sol);
    oppCountByPerson.set(k, set);
  }
  // A contracting-AUTHORITY title (KO / Contracting Officer) ranks a person above a generic POC.
  const isAuthorityTitle = (t: string): boolean =>
    /contracting officer|contract officer|procurement officer|\bko\b/i.test(t || '');

  const seenPerKey = new Map<string, number>();
  const seenPeople = new Set<string>();
  const pins: Array<Record<string, unknown>> = [];
  for (const r of rows) {
    // Filter by requested state (post-geocode) — buyers location is derived from the notice.
    const loc = solLoc.get(String(r.solicitation_number || ''));
    if (!loc) continue; // no real location → no pin (never fabricate)
    if (params.state && loc.state !== params.state) continue;
    // Dedupe the same person (they appear on many notices).
    const key = `${(r.contact_fullname || '').toLowerCase()}|${(r.department_ind_agency || '').toLowerCase()}`;
    if (seenPeople.has(key)) continue;
    seenPeople.add(key);
    const placed = placeRow(loc.city, loc.state, seenPerKey);
    if (!placed) continue;
    const { at, precision } = placed;
    if (!inBbox(at[0], at[1], params.bbox)) continue;
    const oppCount = (oppCountByPerson.get(key)?.size) || 1;
    const title = r.contact_title || '';
    // "Recommended" score for a buyer (Eric 2026-07-28: fix Recommended for all 4 datasets). A person's
    // relevance is thinner than a firm's — the two honest, real signals are ACTIVITY (how many
    // solicitations name them: an active buyer is more worth reaching) and ROLE AUTHORITY (a
    // Contracting Officer/KO ranks above a generic POC). Both bounded ~0..1, weighted.
    const activityTerm = Math.min(1, Math.log10(oppCount + 1) / Math.log10(41)); // 1→0 .. 40+→~1
    const authorityTerm = isAuthorityTitle(title) ? 1 : (title ? 0.4 : 0);
    const recScore = 0.6 * activityTerm + 0.4 * authorityTerm;
    pins.push({
      id: String(r.id),
      lat: at[0], lng: at[1],
      name: r.contact_fullname,
      title,
      // Clean, readable agency ("STATE, DEPARTMENT OF" → "Department of State"), not the
      // bare "State" the client-side clean() produced. Empty → neutral "Government".
      agency: formatAgencyDisplay(r.department_ind_agency) || 'Government',
      office: r.sub_tier || r.office || '',
      state: loc.state,
      city: loc.city, // '' unless a confirmed city↔state pairing — never "ForeignCity, WrongState"
      locApprox: !!loc.approxNote, // buying-office fallback (state-level)
      locPrecision: precision,
      oppCount, // # distinct solicitations naming this person (drives the sort + a card signal)
      recScore, // internal — the "Recommended" rank key (stripped before the client sees pins? no: harmless)
    });
    // NOTE: no MAX_PINS break here anymore — we must score the FULL candidate set before capping, or
    // "Recommended" would only rank an arbitrary DB-ordered slice (the rank-then-filter trap). The
    // candidate pool is already bounded by the 2000-solNum cap + person-dedup upstream.
  }
  // "Recommended" (default, empty sort) — rank buyers by relevance (activity + role authority), THEN
  // cap to MAX_PINS. So the most-active decision-makers survive the cap, not whoever the DB returned
  // first. (There are no explicit buyer sort options today, so this is the only order.)
  pins.sort((a, b) => (Number(b.recScore) || 0) - (Number(a.recScore) || 0));
  const capped = pins.slice(0, MAX_PINS);
  // totalInView = pins actually placed in the viewport (honest map count); totalForFilters =
  // the broader DB match count (may exceed what's geocodable/in-view). See companiesPins note.
  return { pins: capped, totalInView: capped.length, totalForFilters: count ?? capped.length };
}

export async function GET(request: NextRequest) {
  const p = new URL(request.url).searchParams;
  const email = (p.get('email') || '').trim().toLowerCase();

  const auth = requireMIAuthSession(request, email || null);
  if (!auth.ok) return auth.response;

  const bboxRaw = p.get('bbox');
  if (!bboxRaw) return NextResponse.json({ success: false, error: 'bbox required' }, { status: 400 });
  const parts = bboxRaw.split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    return NextResponse.json({ success: false, error: 'bbox must be west,south,east,north' }, { status: 400 });
  }
  const bbox = parts as [number, number, number, number];

  const type = (p.get('type') || 'companies').toLowerCase() === 'buyers' ? 'buyers' : 'companies';
  const state = normalizeStateCode(p.get('state') || '') || '';
  const search = (p.get('search') || p.get('q') || '').trim();
  const sort = (p.get('sort') || '').trim().toLowerCase();
  // Set-aside GROUP keys — same vocabulary as the opportunity map's SET_GROUPS
  // (SDVOSB/SB/8A/WOSB/HZ), so one param name means the same thing everywhere.
  const setAside = (p.get('setAside') || '').trim().toUpperCase();
  // Companies — searchRecipients honors naics on its rollup path (state+naics scoped together,
  // cheap); as of 2026-08-03 it ALSO honors agency (an awards-table scan when set — see
  // searchRecipients doc comment). Buyers — agency ilike (department_ind_agency, 100% populated).
  // Same `agency` param serves both sub-datasets.
  let naics = (p.get('naics') || '').trim();
  const agency = (p.get('agency') || '').trim();
  // Office = a 6-char DoDAAC (W912PL). BUYERS-ONLY and deliberately so: a DoDAAC is a
  // government buying-office code, so it has no meaning for a company pin. An invalid/junk
  // code is IGNORED (no narrowing) rather than silently returning an empty map.
  const office = (p.get('office') || '').trim().toUpperCase();

  // TERM-OF-ART search on COMPANIES (Eric 2026-07-28) — companies search matches a firm's NAME, so a
  // text search for "drones" finds nothing useful (no firm is named "drones"/"UAS"). The honest
  // equivalent is "firms IN this industry": resolve a term-of-art search to its CURATED NAICS set and
  // search by that instead of the name. Only when no explicit NAICS was set. We DROP the name-search
  // in this case (searchCompanies) so it doesn't AND away the NAICS matches. Buyers have no industry
  // axis (a person isn't in a NAICS), so their name search is left untouched.
  let searchCompanies = search;
  if (type === 'companies' && search && !naics) {
    const toaCodes = termOfArtNaicsCodes(search);
    if (toaCodes && toaCodes.length) { naics = toaCodes.join(','); searchCompanies = ''; }
  }

  // An office filter is a GOVERNMENT buying-office code — it cannot describe a company. Rather
  // than ignore it on the companies dataset (which would leave every firm on screen and read as
  // "the filter did nothing"), return an honest empty set + a reason the UI can show. Silently
  // dropping a filter the user set is the same class of bug as the NAICS freetext box.
  const officeApplied = isValidDodaac(office);
  if (officeApplied && type === 'companies') {
    return NextResponse.json({
      success: true, mode: 'contacts', type, pins: [], totalInView: 0, totalForFilters: 0,
      notApplicable: `Office ${office} is a government buying office — it applies to Government Buyers, not companies.`,
    });
  }

  try {
    const out = type === 'buyers'
      ? await buyersPins({ bbox, state, search, agency, office })
      : await companiesPins({ bbox, state, search: searchCompanies, sort, setAside, naics, agency });
    return NextResponse.json({ success: true, mode: 'contacts', type, ...out });
  } catch (e) {
    console.error('[contacts-map] error:', (e as Error).message);
    return NextResponse.json({ success: false, error: (e as Error).message }, { status: 500 });
  }
}
