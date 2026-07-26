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
import { getMapOpportunities, SET_GROUPS, setGroupKey, SET_LABEL, naicsCategory } from '@/lib/opportunities/map-data';
import { applyMapFilters, multiVal, parseMapFilters, type MapFilters } from '@/lib/opportunities/map-filters';
import { normalizeStateCode } from '@/lib/utils/us-states';

export const dynamic = 'force-dynamic';

const MAX_PINS = 1000; // PostgREST hard-caps a response at 1000; clustering handles density.
const PIN_COLS = 'notice_id, title, department, sub_tier, office, naics_code, set_aside_code, set_aside_description, notice_type, response_deadline, posted_date, ui_link, solicitation_number, pop_state, pop_city, office_address, map_lat, map_lng, map_loc_source, has_sow_doc, attachments, points_of_contact';
// FSC commodity micro-buy title: 1–4 leading digits then "--" ("48--VALVE,GLOBE").
const FSC_REGEX = '^[0-9]{1,4}--';

function sb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
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
      const opps = await getMapOpportunities(limit);
      return NextResponse.json({ success: true, mode: 'legacy', count: opps.length, setGroups, opps });
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
    return NextResponse.json({
      success: true, mode: 'viewport', setGroups,
      totalForFilters: totalForFilters ?? 0,
      totalInView: totalInView ?? pins.length,
      capped: (totalInView ?? 0) > pins.length,
      pins,
    });
  } catch (e) {
    return NextResponse.json({ success: false, error: (e as Error).message }, { status: 500 });
  }
}
