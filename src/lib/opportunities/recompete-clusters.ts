/**
 * Zoomed-out map aggregation for the Recompetes dataset (Eric 2026-07-28).
 *
 * When a map view holds more contracts than the pin cap, returning 1,000 raw $-tags is an illegible
 * pile that ALSO drops ~99% of results. Instead the endpoint returns per-STATE counts (rendered as
 * count bubbles) so 100% of contracts are represented — the Zillow/Airbnb "1,234 here" model. Below
 * the threshold it returns the individual $-tag pins (the deliberate "wall", Eric 2026-07-27/28).
 *
 * This lib calls the `recompete_map_state_counts` RPC (which applies the SAME filters as the pin
 * query, so a bubble's count reconciles with the header total), then attaches a centroid to each
 * state from STATE_CENTROIDS. A NULL state_code row is the "location unknown" bucket — surfaced
 * honestly (never dropped), but with no centroid it gets no bubble on the map.
 */
import { getReadClient } from '@/lib/supabase/server-clients';
import { STATE_CENTROIDS } from '@/lib/geo/state-centroids';

export type ClusterFilters = {
  setAside?: string | null;
  agency?: string | null;
  naics?: string | null;
  state?: string | null;
  subAgency?: string | null;
  minValue?: number | null;
  maxValue?: number | null;
  sap?: string | null;
  likelihood?: string | null;
  leadMax?: number | null;
  includePast?: boolean;
};

export type StateCluster = {
  state: string; // 2-letter code
  count: number;
  lat: number;
  lng: number;
};

export type ClusterResult = {
  clusters: StateCluster[];
  unknownCount: number; // contracts with no mappable state (honest "location unknown" bucket)
  total: number;        // clusters + unknown — must equal the header totalInView
};

export async function fetchRecompeteStateClusters(
  bbox: { south: number; north: number; west: number; east: number },
  filters: ClusterFilters = {},
): Promise<ClusterResult> {
  const sb = getReadClient();
  const { data, error } = await sb.rpc('recompete_map_state_counts', {
    p_south: bbox.south,
    p_north: bbox.north,
    p_west: bbox.west,
    p_east: bbox.east,
    p_set_aside: filters.setAside ?? null,
    p_agency: filters.agency ?? null,
    p_naics: filters.naics ?? null,
    p_state: filters.state ?? null,
    p_sub_agency: filters.subAgency ?? null,
    p_min_value: filters.minValue ?? null,
    p_max_value: filters.maxValue ?? null,
    p_sap: filters.sap ?? null,
    p_likelihood: filters.likelihood ?? null,
    p_lead_max: filters.leadMax ?? null,
    p_include_past: filters.includePast ?? false,
  });
  if (error) throw error; // surface — a swallowed aggregation error would silently show an empty map

  const rows = (data || []) as Array<{ state_code: string | null; cnt: number | string }>;
  const clusters: StateCluster[] = [];
  let unknownCount = 0;
  for (const r of rows) {
    const cnt = Number(r.cnt) || 0;
    const code = (r.state_code || '').toUpperCase().trim();
    const centroid = code ? STATE_CENTROIDS[code] : undefined;
    if (!code || !centroid) {
      // No state OR a state we can't place (rare foreign/blank) → the honest unknown bucket, not a
      // fabricated pin. It still counts toward the total so the header reconciles.
      unknownCount += cnt;
      continue;
    }
    clusters.push({ state: code, count: cnt, lat: centroid[0], lng: centroid[1] });
  }
  clusters.sort((a, b) => b.count - a.count); // biggest first (render order + legibility)
  const total = clusters.reduce((s, c) => s + c.count, 0) + unknownCount;
  return { clusters, unknownCount, total };
}
