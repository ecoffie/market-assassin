/**
 * GET /api/app/opportunity-map — pins for the Opportunity Map explorer.
 *
 * TWO modes:
 *  • VIEWPORT (Airbnb/Google-style): pass `bbox=west,south,east,north` → returns pins whose
 *    precomputed coordinate (map_lat/map_lng) falls in the current map view, plus:
 *      - totalForFilters : count of the WHOLE filtered set, ignoring bbox (the headline —
 *                          reconciles with the Market Dashboard's "Active Opportunities")
 *      - totalInView     : count inside the bbox (may exceed returned pins when capped)
 *      - capped          : true when the view holds more than MAX_PINS
 *  • LEGACY: no bbox → the old getMapOpportunities(limit) list (kept for existing callers).
 *
 * Filters mirror mi-dashboard so the two surfaces never disagree: status (active|all|inactive),
 * search, noticeType, agency, setAside, naics, state (pop OR office), scope (all|profile),
 * hideCommodity (default FALSE — nothing is self-filtered; the user opts to hide FSC micro-buys).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getMapOpportunities, getDibbsMapPins, getDibbsViewportPins, SET_GROUPS, setGroupKey, SET_LABEL, naicsCategory } from '@/lib/opportunities/map-data';
import { getSbirMapPins } from '@/lib/sbir/sbir-map-pins';
import { sapBuyerTier } from '@/lib/opportunities/sap-friendly-agencies';
import { computeGenome } from '@/lib/opportunities/genome';
import { applyMapFilters, multiVal, parseMapFilters, type MapFilters } from '@/lib/opportunities/map-filters';
import { dedupeByListing, countDistinctListings } from '@/lib/opportunities/canonical-listing';
import { decorateWithEarlySignal, filterByEarlySignal, dodaacFromSolicitation } from '@/lib/opportunities/early-signal-pins';
import { isRepeatBuyer } from '@/lib/opportunities/repeat-buyer';
import { loadDodaacEarlySignal } from '@/lib/gov-contacts/dodaac-directory';
import { normalizeStateCode, US_STATE_NAMES } from '@/lib/utils/us-states';

export const dynamic = 'force-dynamic';

const MAX_PINS = 1000; // PostgREST hard-caps a response at 1000; clustering handles density.
const PIN_COLS = 'notice_id, title, department, sub_tier, office, naics_code, set_aside_code, set_aside_description, notice_type, response_deadline, posted_date, ui_link, solicitation_number, pop_state, pop_city, office_address, map_lat, map_lng, map_loc_source, has_sow_doc, attachments, points_of_contact, intel_value_range';
// FSC commodity micro-buy title: 1–4 leading digits then "--" ("48--VALVE,GLOBE").
const FSC_REGEX = '^[0-9]{1,4}--';

function sb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

/** Should this request include DIBBS (src:'DLA') pins? Opt-in via ?sources=sam,dla —
 *  omitting it keeps the exact SAM-only payload existing callers depend on. Shared by
 *  BOTH response modes so legacy and viewport can never disagree about what was asked for. */
function wantDlaSources(raw: string | null): boolean {
  const s = (raw || 'sam').toLowerCase();
  return s.includes('dla') || s.includes('dibbs') || s === 'all';
}
/** Include SAM opportunities? True by default (SAM is the base feed), but EXCLUDED when the
 *  caller asks for a specific NON-SAM source only — e.g. ?sources=dla (the "DLA only" top-bar
 *  filter). Without this the SAM base query always ran and "DLA only" still returned SAM pins
 *  (Eric 2026-07-30). 'all' and any list containing 'sam' keep SAM. */
function wantSamSources(raw: string | null): boolean {
  const s = (raw || 'sam').toLowerCase();
  if (!s || s === 'all') return true;
  return s.split(',').map((x) => x.trim()).includes('sam');
}
/** Include SBIR/STTR topics under Open Opps? Opt-in via ?sources=...,sbir (Eric 2026-07-28). Same
 *  opt-in shape as DIBBS so existing SAM-only callers are unchanged. */
function wantSbirSources(raw: string | null): boolean {
  const s = (raw || 'sam').toLowerCase();
  return s.includes('sbir') || s === 'all';
}

// Filter type + logic live in a SHARED lib so this API and the saved-search alert cron
// filter identically (a saved search re-runs exactly what the user saw).
type Filters = MapFilters;
const multi = multiVal;
const applyFilters = applyMapFilters;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toPin(r: Record<string, any>) {
  const office = r.office_address as { city?: string; state?: string } | null;
  const state = normalizeStateCode((r.pop_state as string) || office?.state || '');
  // SAM sometimes stores a junk placeholder city — "0", "-", "N/A", "None", "TBD" — where a real city
  // should be. Those are truthy, so `${city}, ${state}` would render "0, NJ". Treat them as no-city so
  // the location falls back to just the state (Eric 2026-08-04, screenshot showed "0, NJ").
  const rawCity = ((r.pop_city as string) || office?.city || '').trim();
  const city = /^(0|-+|n\/?a|none|null|tbd|unknown)$/i.test(rawCity) ? '' : rawCity;
  // Location label: "City, ST" when we have a real city; just the FULL STATE NAME otherwise (Eric
  // 2026-08-04 target shows "New Jersey", not "NJ" — a lone 2-letter code reads like a data field).
  const stateName = (state && US_STATE_NAMES[state]) || state || '';
  const locLabel = city ? `${city}, ${state}` : stateName;
  return {
    id: String(r.notice_id ?? ''),
    title: String(r.title ?? 'Untitled opportunity'),
    agency: String(r.department ?? ''),
    set: setGroupKey(r.set_aside_code as string),
    setLabel: (r.set_aside_description as string) || SET_LABEL[setGroupKey(r.set_aside_code as string)],
    naics: String(r.naics_code ?? ''),
    cat: naicsCategory(r.naics_code as string),
    loc: locLabel,
    close: (r.response_deadline as string) || null,
    posted: (r.posted_date as string) || null,
    sol: String(r.solicitation_number ?? ''),
    uiLink: (r.ui_link as string) || null,
    lat: Number(r.map_lat), lng: Number(r.map_lng), src: 'SAM' as const,
    locSrc: (r.map_loc_source as string) === 'office' ? 'office' : 'pop',
    // Extra real fields for the richer Zillow-style card (all real columns, no fabrication).
    subAgency: (r.sub_tier as string) || null,
    office: (r.office as string) || office?.city || null,
    noticeType: (r.notice_type as string) || null,
    docs: !!(r.has_sow_doc || (Array.isArray(r.attachments) && r.attachments.length)),
    pocs: Array.isArray(r.points_of_contact) ? r.points_of_contact.length : 0,
    // M-Estimate median (the value tag on the pin). Precomputed in sam_opportunities.
    // intel_value_range ({low, median, high}); null when we have no comparable-award estimate,
    // in which case the pin renders a neutral dot (never a fabricated price).
    est: (r.intel_value_range && typeof r.intel_value_range.median === 'number') ? r.intel_value_range.median : 0,
    // The comparable-award COUNT behind the estimate — for the card's grounded confidence line
    // ("Estimated from N similar awards", Eric 2026-08-04: "not AI, not a score"). It's stored in the
    // value-range's `label` ("62 comparable 336340 · PSC 25 contracts"); parse the leading integer.
    // 0 when absent → the card shows no confidence line (never a fabricated count).
    estN: estComparableCount(r.intel_value_range),
    // The real LOW/HIGH band behind the M-Estimate (25th–75th pct of comparable awards) — for the
    // "Likely $Low–$High" confidence line under the estimate (Eric 2026-08-05). Grounded from
    // intel_value_range.{low,high}; 0 when absent → the range line is omitted (never fabricated).
    estLow: (r.intel_value_range && typeof r.intel_value_range.low === 'number') ? r.intel_value_range.low : 0,
    estHigh: (r.intel_value_range && typeof r.intel_value_range.high === 'number') ? r.intel_value_range.high : 0,
  };
}

// Parse the real comparable-award count from a stored intel_value_range label
// ("62 comparable 336340 · PSC 25 contracts" -> 62). Returns 0 when unparseable/absent — the card
// then omits the confidence line rather than inventing a number (ground-in-real-data).
function estComparableCount(vr: unknown): number {
  const label = (vr && typeof vr === 'object' && typeof (vr as { label?: unknown }).label === 'string')
    ? (vr as { label: string }).label : '';
  const m = /^\s*(\d{1,6})\s+comparable\b/i.exec(label);
  return m ? parseInt(m[1], 10) : 0;
}

// Profile NAICS/states for scope=profile — same table/columns as mi-dashboard.
async function loadProfile(email: string): Promise<{ naics: string[]; states: string[] }> {
  try {
    const { data, error } = await sb()
      .from('user_notification_settings')
      .select('naics_codes, location_states')
      .eq('user_email', email)
      .maybeSingle();
    if (error) { console.error('[opportunity-map] profile load error:', error.message); return { naics: [], states: [] }; }
    return { naics: data?.naics_codes || [], states: data?.location_states || [] };
  } catch { return { naics: [], states: [] }; }
}

export async function GET(request: NextRequest) {
  const p = new URL(request.url).searchParams;
  const setGroups = SET_GROUPS.map((g) => ({ key: g.key, label: g.label, color: g.color }));

  // LEGACY list mode — no bbox (existing callers / simple pin dumps).
  const bbox = p.get('bbox');
  if (!bbox) {
    const limit = Math.min(1000, Math.max(50, Number(p.get('limit')) || 600));
    try {
      // DIBBS (src:'DLA') pins ride alongside SAM. Opt-in via ?sources=sam,dla so existing
      // callers keep the exact SAM-only payload they have today; the map explorer asks for
      // both. A DIBBS failure must never take down SAM pins, so it's caught independently.
      const wantDla = wantDlaSources(p.get('sources'));
      // SAM excluded when a specific non-SAM source is requested (?sources=dla → DLA only).
      const opps = wantSamSources(p.get('sources')) ? await getMapOpportunities(limit) : [];
      let dibbs: Awaited<ReturnType<typeof getDibbsMapPins>> = [];
      if (wantDla) {
        try {
          dibbs = await getDibbsMapPins(Math.min(400, limit));
        } catch (e) {
          console.error('[opportunity-map] DIBBS pins failed (SAM pins unaffected):', (e as Error).message);
        }
      }
      const merged = [...opps, ...dibbs];
      return NextResponse.json({
        success: true, mode: 'legacy', count: merged.length, setGroups,
        countsBySource: { SAM: opps.length, DLA: dibbs.length },
        opps: merged,
      });
    } catch (e) {
      return NextResponse.json({ success: false, error: (e as Error).message }, { status: 500 });
    }
  }

  // VIEWPORT mode.
  const parts = bbox.split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    return NextResponse.json({ success: false, error: 'bbox must be west,south,east,north' }, { status: 400 });
  }
  const [west, south, east, north] = parts;

  // Resolve profile only when scope=profile (default is All SAM — the full 11k).
  let profileNaics: string[] = [], profileStates: string[] = [];
  if (p.get('scope') === 'profile') {
    const email = (p.get('email') || '').trim().toLowerCase();
    if (email) { const prof = await loadProfile(email); profileNaics = prof.naics; profileStates = prof.states; }
  }

  // Use the SHARED parser (map-filters.ts) so this API and the saved-search cron never
  // drift — the whole point of the shared lib. (This block used to duplicate it, which is
  // exactly how the 4 new filters went missing here.)
  const f: Filters = parseMapFilters((k) => p.get(k), { profileNaics, profileStates });

  try {
    const db = sb();
    // SAM is the base feed, but EXCLUDED when the caller asks for a specific non-SAM source
    // only (?sources=dla → "DLA only"). When SAM isn't wanted, skip its queries entirely so the
    // map shows purely the requested pipeline (Eric 2026-07-30, the top-bar Source filter).
    const includeSam = wantSamSources(p.get('sources'));
    // totalForFilters — the headline count, NO bbox (reconciles with the dashboard). It must count
    // UNIQUE LISTINGS, not raw rows (Eric 2026-08-04: the pins are deduped by solicitation, so a raw
    // row count would read "4,712 results" over fewer unique pins — a second trust gap). A PostgREST
    // count(exact) can't count(distinct), so we fetch ONLY the two canonical-key columns for the
    // filtered set (cheap — 2 short columns, no bbox) and count distinct with the SAME
    // canonical-listing key the pins use (countDistinctListings). Paged to clear the 1000-row cap.
    // ⚡ PAGED IN PARALLEL, not sequentially. This count is VIEWPORT-INDEPENDENT (no bbox by
    // design — it reconciles with the dashboard), so it walks the whole filtered corpus: ~155k
    // mappable rows = ~156 pages. Awaiting them one after another made this the single slowest
    // thing on the map — measured 2026-08-17 on prod, ~3.4s of fixed cost on EVERY pan/zoom,
    // identical whether the viewport held 968 pins or 3 (a tiny-bbox request cost 3.65s while
    // grants-map on the same bbox cost 0.51s). fetchView() fans out to 4 horizon endpoints per
    // pan, so this route gated the whole interaction.
    //
    // The first page carries `count: 'exact'` for the filtered set, so ONE round-trip tells us how
    // many pages exist; the rest are fetched concurrently. Same rows, same order, same key.
    //
    // ⚠️ Deliberately still PostgREST + the shared applyFilters + countDistinctListings, NOT a
    // hand-written SQL RPC. applyMapFilters is the ONE filter builder shared with the viewport
    // query and saved-search alerts; re-expressing those predicates in SQL would fork the
    // definition of "what matches" and drift (the exact class the filters oracle guards).
    async function countUniqueListingsForFilters(): Promise<number> {
      const PAGE = 1000;
      const pageQuery = (from: number, withCount: boolean) => {
        let q = db.from('sam_opportunities')
          .select('solicitation_number, notice_id', withCount ? { count: 'exact' } : undefined)
          .not('map_lat', 'is', null)
          .order('notice_id', { ascending: true })
          .range(from, from + PAGE - 1);
        q = applyFilters(q, f);
        return q;
      };

      const { data: first, count, error: firstErr } = await pageQuery(0, true);
      if (firstErr) throw firstErr;
      const keyRows: Array<{ solicitation_number: string | null; notice_id: string | null }> =
        [...((first ?? []) as Array<{ solicitation_number: string | null; notice_id: string | null }>)];

      // count is the RAW filtered row count (pre-dedupe) — it sizes the pagination only; the
      // returned number is still countDistinctListings over the real keys. A null count means
      // UNKNOWN, never zero (Bug Prevention Rule #11) — fall back to sequential paging rather
      // than silently reporting whatever the first page happened to hold.
      if (count == null) {
        for (let from = PAGE; ; from += PAGE) {
          const { data: page, error: pErr } = await pageQuery(from, false);
          if (pErr) throw pErr;
          if (!page || !page.length) break;
          keyRows.push(...(page as typeof keyRows));
          if (page.length < PAGE) break;
        }
        return countDistinctListings(keyRows);
      }

      if (keyRows.length >= count) return countDistinctListings(keyRows);

      const offsets: number[] = [];
      for (let from = PAGE; from < count; from += PAGE) offsets.push(from);
      const pages = await Promise.all(offsets.map(async (from) => {
        const { data: page, error: pErr } = await pageQuery(from, false);
        if (pErr) throw pErr;
        return (page ?? []) as typeof keyRows;
      }));
      for (const page of pages) keyRows.push(...page);
      return countDistinctListings(keyRows);
    }
    const samQueries = includeSam
      ? (() => {
          const totalP = countUniqueListingsForFilters();
          let viewQ = db.from('sam_opportunities').select(PIN_COLS, { count: 'exact' })
            .not('map_lat', 'is', null)
            .gte('map_lat', south).lte('map_lat', north)
            .gte('map_lng', west).lte('map_lng', east)
            .order('response_deadline', { ascending: true })
            .limit(MAX_PINS);
          viewQ = applyFilters(viewQ, f);
          return Promise.all([totalP, viewQ]);
        })()
      : Promise.resolve([0, { data: [], count: 0, error: null }] as const);

    const [totalForFilters, { data, count: totalInView, error }] = await samQueries;
    if (error) throw error;

    // "Fits your NAICS" fit chip (Eric 2026-08-03, approved card artifact): flag each pin whose NAICS
    // is in the SIGNED-IN user's profile codes. Only set when scope=profile resolved a real profile
    // (profileNaics non-empty) — a signed-out / no-profile viewer gets NO fits flag, never a false ✓.
    // 6-digit profile codes match exact; a <6-digit profile code matches by prefix (the app convention).
    const fitsPin = (n: string): boolean => {
      if (!profileNaics.length || !n) return false;
      return profileNaics.some((pc) => pc.length >= 6 ? pc === n : n.startsWith(pc));
    };
    // sbf = SB-friendly DNA badge (sapBuyerTier 'most' = the buyer's real PO-share tier, GOS #11).
    // Computed HERE server-side (sapBuyerTier is a server lib) and shipped on the pin — the client
    // card reads pin.sbf. It must NOT be called from the client toRow (ReferenceError → toRow throws
    // → the open horizon .map() rejects → "Open: 0"). Open (SAM) pins only. (Eric 2026-08-03.)
    // DEDUPE BY CANONICAL LISTING (Eric 2026-08-04: "one solicitation → one listing → one pin →
    // one rail card → one drawer → one estimate → one result count"). One SAM solicitation is posted
    // as MULTIPLE notice_ids (combined synopsis + each amendment = its own row) — 5,181 active
    // solicitations have >1 row, one has 138. The map showed one row's pin while the drawer opened a
    // DIFFERENT row's notice_id, so the same listing rendered two different M-Estimates. The canonical
    // KEY + winner-selection live in ONE shared lib (canonical-listing.ts) so the pins AND the headline
    // count (below) collapse identically — never a second dedupe rule for the count. dedupeByListing
    // keeps one canonical row per listing (an M-Estimate beats none; tie → most recently posted); a
    // solicitation-less row falls back to its own notice_id so it stays a distinct listing.
    const dedupedRows = dedupeByListing((data || []) as Record<string, unknown>[]);
    const nowMs = Date.now();
    // Early-signal band per buying-office DoDAAC — loaded ONCE (in-process cached Map, TTL-gated, so
    // this is free on warm calls). Grounds the "Posts Early" genome strand: earlySignal 'high' = the
    // office reliably posts Sources-Sought/RFI ahead of the RFP. Fail-soft → empty map (strand dark).
    let earlyMap: Map<string, { band: string; pct: number }>;
    try { earlyMap = await loadDodaacEarlySignal(); }
    catch { earlyMap = new Map(); }
    const pins = dedupedRows.map((r) => {
      const pin = toPin(r);
      const sbf = sapBuyerTier(pin.agency) === 'most' ? 1 : 0;
      // Phase 1.5 grounded strands, computed server-side and passed into the pure genome fn:
      // repeatBuyer = this agency has ≥8 real awards in this NAICS (precomputed pair-set, cheap
      // membership); postsEarly = this office's early-signal band is 'high' (≥50% early — shapeable).
      const repeatBuyer = isRepeatBuyer(pin.agency, pin.naics) ? 1 : 0;
      const dodaac = dodaacFromSolicitation(pin.sol);
      const postsEarly = (dodaac && earlyMap.get(dodaac)?.band === 'high') ? 1 : 0;
      // Opportunity DNA (genome) — grounded strands computed from the pin's own real fields. ONE
      // shared lib (genome.ts) so the client renders, never computes, and the Phase-2 backfill
      // writes the same strands. src stays 'SAM' here (RECOMPETE/FORECAST pins are built elsewhere).
      const dna = computeGenome({ src: pin.src, noticeType: pin.noticeType, title: pin.title, set: pin.set, close: pin.close, sbf, repeatBuyer, postsEarly }, nowMs);
      return { ...pin, fits: fitsPin(pin.naics), sbf, dna };
    });

    // DIBBS (src:'DLA') pins, opt-in via ?sources=sam,dla. Now VIEWPORT-QUERIED IN SQL
    // (bbox before the limit) via the persisted map_lat/map_lng columns, exactly like SAM —
    // so EVERY open DLA bid in the current view renders, not a global top-400 subset (the
    // rank-then-filter bug: zooming into a DLA center used to show only whichever of the
    // national 400 fell in-view). Capped at MAX_PINS like SAM; the map clusters when dense.
    // A DIBBS failure must never take down SAM pins → caught independently.
    let dlaPins: ReturnType<typeof toPin>[] = [];
    let dlaTotal = 0; // DLA-only headline count (the whole mappable DIBBS corpus, not the pin cap)
    if (wantDlaSources(p.get('sources'))) {
      try {
        // FSC filter (DLA's supply-class taxonomy) — comma-separated codes, e.g. fsc=5330,1560.
        const fscParam = (p.get('fsc') || '').split(',').map((s) => s.trim()).filter(Boolean);
        const dibbs = await getDibbsViewportPins({ west, south, east, north }, MAX_PINS, fscParam.length ? fscParam : null);
        // The true DLA total for the "DLA only" headline (was 0 → the header showed the 1,000 pin cap,
        // Eric 2026-07-31 "DLA still says 1000"). Best-effort head count; falls back to pins on error.
        try {
          let cq = sb().from('dibbs_rfqs').select('solicitation_number', { count: 'exact', head: true }).not('map_lat', 'is', null);
          if (fscParam.length) cq = cq.in('fsc', fscParam);
          const { count: dc, error: dcErr } = await cq;
          if (!dcErr && dc != null) dlaTotal = dc;
        } catch { /* keep dlaTotal = 0, fall back to dlaPins.length below */ }
        dlaPins = dibbs.map((d) => ({
          // Shape-match the viewport pin contract so the client's toRow() reads DIBBS rows
          // identically to SAM rows — no branching in the template.
          id: d.id, title: d.title, agency: d.agency, set: d.set, setLabel: d.setLabel,
          naics: d.naics, cat: d.cat, loc: d.loc, close: d.close, posted: null,
          sol: d.sol, uiLink: d.uiLink, lat: d.lat, lng: d.lng,
          src: 'DLA' as const, locSrc: d.locSrc,
          subAgency: null, office: d.agency, noticeType: 'RFQ',
          docs: !!d.uiLink, pocs: 0, est: 0,
        })) as unknown as ReturnType<typeof toPin>[];
      } catch (e) {
        console.error('[opportunity-map] DIBBS viewport pins failed (SAM unaffected):', (e as Error).message);
      }
    }

    // SBIR/STTR topics under Open Opps (Eric 2026-07-28), opt-in via ?sources=...,sbir. Pinned at the
    // sponsoring branch HQ (APPROXIMATE — no place of performance), same fail-soft contract as DIBBS: a
    // SBIR read must never take down the SAM pins. bbox-filtered in JS (topics are a small set).
    let sbirPins: ReturnType<typeof toPin>[] = [];
    if (wantSbirSources(p.get('sources'))) {
      try {
        const all = await getSbirMapPins(400);
        sbirPins = all
          .filter((s) => s.lat >= south && s.lat <= north && s.lng >= west && s.lng <= east)
          .map((s) => ({
            id: s.id, title: s.title, agency: s.agency, set: s.set, setLabel: s.setLabel,
            naics: s.naics, cat: s.cat, loc: s.loc, close: s.close, posted: s.posted,
            sol: s.sol, uiLink: s.uiLink, lat: s.lat, lng: s.lng,
            src: 'SBIR' as const, locSrc: s.locSrc,
            subAgency: s.subAgency, office: s.office, noticeType: s.noticeType,
            docs: s.docs, pocs: s.pocs, est: s.est,
          })) as unknown as ReturnType<typeof toPin>[];
      } catch (e) {
        console.error('[opportunity-map] SBIR viewport pins failed (SAM unaffected):', (e as Error).message);
      }
    }

    // Early-signal badge. Decorated at the MERGE point so every source (SAM,
    // DLA, SBIR) gets it from one call — each pin already carries `sol`, whose
    // first 6 chars are the buying office's DoDAAC, so this costs one cached
    // directory load rather than a query per pin. Fails soft: no badge beats
    // no map.
    let merged = await decorateWithEarlySignal([...pins, ...dlaPins, ...sbirPins]);
    // ?early=high,medium — "show me only offices that telegraph work early".
    // Unscored offices are excluded by filterByEarlySignal: unknown is not
    // known-good, and including them would inflate the result.
    const earlyParam = multiVal(p.get('early') || '')
      .map((v) => v.trim().toLowerCase())
      .filter((v): v is 'high' | 'medium' | 'low' | 'none' =>
        v === 'high' || v === 'medium' || v === 'low' || v === 'none');
    if (earlyParam.length) merged = filterByEarlySignal(merged, earlyParam);
    // Headline count. When SAM is INCLUDED it's the SAM filter-set count of UNIQUE LISTINGS
    // (totalForFilters, computed via countDistinctListings — reconciles with the deduped pins/rail).
    // When SAM is EXCLUDED (e.g. "DLA only"), it's the DLA total — NOT 0, which the old
    // `totalForFilters ?? 0` produced and the client then showed as the 1,000 pin cap (Eric 2026-07-31).
    const samTotal = includeSam ? totalForFilters : 0;
    const headlineTotal = includeSam
      ? samTotal + (dlaTotal || dlaPins.length) + sbirPins.length
      : (dlaTotal || dlaPins.length) + sbirPins.length;
    // Capped when the RAW viewport exceeded the pin cap (we truncated BEFORE dedupe, so more unique
    // listings exist in view than we returned) or a DLA/SBIR layer hit its cap. Compared to the RAW
    // in-view count (totalInView) since that's the pre-dedupe fetch size the cap actually bit.
    const capped = (totalInView ?? 0) >= MAX_PINS || dlaPins.length >= MAX_PINS || (dlaTotal > dlaPins.length);
    // With ?early= active the DB-side totals describe a bigger set than we are
    // returning (the band filter runs in-process, after the queries). Reporting
    // them unchanged would show "1,247 of 12,000" over 40 pins. Fall back to
    // the real returned count so the headline can never overstate the map.
    const earlyFiltered = earlyParam.length > 0;
    const bySource = earlyFiltered
      ? merged.reduce(
          (acc, m) => { const k = (m as { src?: string }).src; if (k === 'SAM' || k === 'DLA' || k === 'SBIR') acc[k]++; return acc; },
          { SAM: 0, DLA: 0, SBIR: 0 } as Record<'SAM' | 'DLA' | 'SBIR', number>,
        )
      : { SAM: pins.length, DLA: dlaPins.length, SBIR: sbirPins.length };
    return NextResponse.json({
      success: true, mode: 'viewport', setGroups,
      totalForFilters: earlyFiltered ? merged.length : headlineTotal,
      // In-view total = the UNIQUE listings we actually return (pins is already deduped) + DLA + SBIR,
      // NOT the raw pre-dedupe viewport count — so "N in view" matches the rendered rail/pins.
      totalInView: earlyFiltered
        ? merged.length
        : pins.length + dlaPins.length + sbirPins.length,
      capped: earlyFiltered ? false : capped,
      countsBySource: bySource,
      pins: merged,
    });
  } catch (e) {
    return NextResponse.json({ success: false, error: (e as Error).message }, { status: 500 });
  }
}
