/**
 * Zoomed-out map aggregation for the OPEN opportunities dataset (Eric 2026-07-28, PR2).
 *
 * Same problem/shape as the Recompetes clusters, but a DIFFERENT approach on purpose. Open's filter
 * set (status, full-text search OR, notice-type, agency, set-aside groups + Full&Open, NAICS/PSC
 * multi, state = pop_state OR office state, country, closing/posted windows, hasDocs/hasContact,
 * sapBuyer) is complex and lives in `applyMapFilters`. Duplicating ALL of that into a SQL RPC would
 * be a drift magnet — and a bubble count that disagrees with the pin query is the exact bug we're
 * killing. Open is small (~9k active opps), so instead we REUSE the same `applyMapFilters` query
 * builder, fetch only the lightweight state-deriving columns in-bbox (paginating past the 1000 cap),
 * and aggregate by the SAME derived state the pins use. Zero drift by construction; no second
 * migration.
 *
 * State is derived EXACTLY like toPin(): normalizeStateCode(pop_state || office_address.state).
 */
import { getReadClient } from '@/lib/supabase/server-clients';
import { applyMapFilters, type MapFilters } from '@/lib/opportunities/map-filters';
import { normalizeStateCode } from '@/lib/utils/us-states';
import { STATE_CENTROIDS } from '@/lib/geo/state-centroids';

export type OpenStateCluster = { state: string; count: number; lat: number; lng: number };
export type OpenClusterResult = {
  clusters: OpenStateCluster[];
  unknownCount: number; // opps with no mappable state (honest "location unknown" bucket)
  total: number;        // clusters + unknown — must equal the header totalInView
};

const PAGE = 1000;         // PostgREST hard cap per response
const MAX_PAGES = 14;      // Open is ~9k rows; 14 pages is a generous ceiling (never silently short)

/** The pins derive state as normalizeStateCode(pop_state || office_address.state) — mirror it exactly. */
function deriveState(row: { pop_state?: string | null; office_address?: { state?: string } | null }): string {
  const office = row.office_address || null;
  return normalizeStateCode((row.pop_state as string) || office?.state || '') || '';
}

export async function fetchOpenStateClusters(
  bbox: { south: number; north: number; west: number; east: number },
  filters: MapFilters,
): Promise<OpenClusterResult> {
  const sb = getReadClient();
  const rows: Array<{ pop_state?: string | null; office_address?: { state?: string } | null }> = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    let q = sb
      .from('sam_opportunities')
      .select('pop_state, office_address')
      .not('map_lat', 'is', null)
      .gte('map_lat', bbox.south).lte('map_lat', bbox.north)
      .gte('map_lng', bbox.west).lte('map_lng', bbox.east)
      .range(page * PAGE, page * PAGE + PAGE - 1);
    q = applyMapFilters(q, filters); // SAME filters as the pin query → counts reconcile by construction
    const { data, error } = await q;
    if (error) throw error; // surface — a swallowed error would silently show an empty/partial map
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < PAGE) break; // last page
  }

  const byState = new Map<string, number>();
  let unknownCount = 0;
  for (const r of rows) {
    const st = deriveState(r);
    if (!st || !STATE_CENTROIDS[st]) { unknownCount += 1; continue; } // honest unknown, never a fake pin
    byState.set(st, (byState.get(st) || 0) + 1);
  }
  const clusters: OpenStateCluster[] = [];
  for (const [st, count] of byState) {
    const c = STATE_CENTROIDS[st];
    clusters.push({ state: st, count, lat: c[0], lng: c[1] });
  }
  clusters.sort((a, b) => b.count - a.count);
  const total = clusters.reduce((s, c) => s + c.count, 0) + unknownCount;
  return { clusters, unknownCount, total };
}
