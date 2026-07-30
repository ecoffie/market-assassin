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
import { applyMapFilters, multiVal, parseMapFilters, type MapFilters } from '@/lib/opportunities/map-filters';
import { normalizeStateCode } from '@/lib/utils/us-states';

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
  const city = ((r.pop_city as string) || office?.city || '').trim();
  return {
    id: String(r.notice_id ?? ''),
    title: String(r.title ?? 'Untitled opportunity'),
    agency: String(r.department ?? ''),
    set: setGroupKey(r.set_aside_code as string),
    setLabel: (r.set_aside_description as string) || SET_LABEL[setGroupKey(r.set_aside_code as string)],
    naics: String(r.naics_code ?? ''),
    cat: naicsCategory(r.naics_code as string),
    loc: city ? `${city}, ${state}` : state,
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
  };
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
      const opps = await getMapOpportunities(limit);
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
    // totalForFilters — the headline count, NO bbox (reconciles with the dashboard).
    let totalQ = db.from('sam_opportunities').select('id', { count: 'exact', head: true }).not('map_lat', 'is', null);
    totalQ = applyFilters(totalQ, f);
    // pins + in-view count — same filters PLUS the bbox.
    let viewQ = db.from('sam_opportunities').select(PIN_COLS, { count: 'exact' })
      .not('map_lat', 'is', null)
      .gte('map_lat', south).lte('map_lat', north)
      .gte('map_lng', west).lte('map_lng', east)
      .order('response_deadline', { ascending: true })
      .limit(MAX_PINS);
    viewQ = applyFilters(viewQ, f);

    const [{ count: totalForFilters }, { data, count: totalInView, error }] = await Promise.all([totalQ, viewQ]);
    if (error) throw error;

    const pins = (data || []).map(toPin);

    // DIBBS (src:'DLA') pins, opt-in via ?sources=sam,dla. Now VIEWPORT-QUERIED IN SQL
    // (bbox before the limit) via the persisted map_lat/map_lng columns, exactly like SAM —
    // so EVERY open DLA bid in the current view renders, not a global top-400 subset (the
    // rank-then-filter bug: zooming into a DLA center used to show only whichever of the
    // national 400 fell in-view). Capped at MAX_PINS like SAM; the map clusters when dense.
    // A DIBBS failure must never take down SAM pins → caught independently.
    let dlaPins: ReturnType<typeof toPin>[] = [];
    if (wantDlaSources(p.get('sources'))) {
      try {
        // FSC filter (DLA's supply-class taxonomy) — comma-separated codes, e.g. fsc=5330,1560.
        const fscParam = (p.get('fsc') || '').split(',').map((s) => s.trim()).filter(Boolean);
        const dibbs = await getDibbsViewportPins({ west, south, east, north }, MAX_PINS, fscParam.length ? fscParam : null);
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

    const merged = [...pins, ...dlaPins, ...sbirPins];
    return NextResponse.json({
      success: true, mode: 'viewport', setGroups,
      // totalForFilters stays the SAM headline count (it reconciles with the Market
      // Dashboard); DIBBS + SBIR are reported separately so neither number silently absorbs the other.
      totalForFilters: totalForFilters ?? 0,
      totalInView: (totalInView ?? pins.length) + dlaPins.length + sbirPins.length,
      capped: (totalInView ?? 0) > pins.length,
      countsBySource: { SAM: pins.length, DLA: dlaPins.length, SBIR: sbirPins.length },
      pins: merged,
    });
  } catch (e) {
    return NextResponse.json({ success: false, error: (e as Error).message }, { status: 500 });
  }
}
