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
import { isUsableContactCard } from '@/lib/gov-contacts/contact-quality';
import { formatAgencyDisplay } from '@/lib/mindy/agency-display';

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
  if (params.agency) q = q.ilike('department_ind_agency', `%${params.agency}%`);

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
    pins.push({
      id: String(r.id),
      lat: at[0], lng: at[1],
      name: r.contact_fullname,
      title: r.contact_title || '',
      // Clean, readable agency ("STATE, DEPARTMENT OF" → "Department of State"), not the
      // bare "State" the client-side clean() produced. Empty → neutral "Government".
      agency: formatAgencyDisplay(r.department_ind_agency) || 'Government',
      office: r.sub_tier || r.office || '',
      state: loc.state,
      city: loc.city, // '' unless a confirmed city↔state pairing — never "ForeignCity, WrongState"
      locApprox: !!loc.approxNote, // buying-office fallback (state-level)
      locPrecision: precision,
    });
    if (pins.length >= MAX_PINS) break;
  }
  // totalInView = pins actually placed in the viewport (honest map count); totalForFilters =
  // the broader DB match count (may exceed what's geocodable/in-view). See companiesPins note.
  return { pins, totalInView: pins.length, totalForFilters: count ?? pins.length };
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
  // Companies only — searchRecipients honors naics on its rollup path (state+naics scoped
  // together, cheap). Buyers only — agency ilike (department_ind_agency, 100% populated).
  const naics = (p.get('naics') || '').trim();
  const agency = (p.get('agency') || '').trim();

  try {
    const out = type === 'buyers'
      ? await buyersPins({ bbox, state, search, agency })
      : await companiesPins({ bbox, state, search, sort, setAside, naics });
    return NextResponse.json({ success: true, mode: 'contacts', type, ...out });
  } catch (e) {
    console.error('[contacts-map] error:', (e as Error).message);
    return NextResponse.json({ success: false, error: (e as Error).message }, { status: 500 });
  }
}
