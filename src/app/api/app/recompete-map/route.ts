/**
 * GET /api/app/recompete-map?bbox=west,south,east,north — pins for the Opportunity Map
 * "Recompetes" mode. Expiring contracts (the incumbent's work location), from
 * recompete_opportunities.map_lat/map_lng. Same viewport contract as the open-opps map:
 * returns pins in view + totalInView + totalForFilters.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { setGroupKey, naicsCategory } from '@/lib/opportunities/map-data';
import { normalizeStateCode } from '@/lib/utils/us-states';

export const dynamic = 'force-dynamic';

const MAX_PINS = 1000;
const COLS = 'contract_id, piid, incumbent_name, awarding_agency, naics_code, naics_description, '
  + 'potential_total_value, total_obligation, period_of_performance_current_end, set_aside_type, '
  + 'place_of_performance_city, place_of_performance_state, map_lat, map_lng';

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
  return {
    id: String(r.contract_id ?? ''),
    src: 'RECOMPETE' as const,
    title: r.incumbent_name || 'Incumbent',
    agency: r.awarding_agency || '',
    cat: naicsCategory(r.naics_code) || (r.naics_description || 'Recompete'),
    naics: String(r.naics_code ?? ''),
    set: setGroupKey(r.set_aside_type),
    value: money(val),
    exp: r.period_of_performance_current_end || null,
    loc: city ? `${city}, ${state}` : state,
    sol: r.piid || '',
    lat: Number(r.map_lat), lng: Number(r.map_lng),
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const applyFilters = (q: any) => {
    q = q.is('quality_flag', null).not('map_lat', 'is', null);
    if (setAside) q = q.eq('set_aside_type', setAside);
    if (agency) q = q.ilike('awarding_agency', `%${agency}%`);
    if (naics) q = q.or(`naics_code.eq.${naics},naics_code.like.${naics.substring(0, 3)}%`);
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
