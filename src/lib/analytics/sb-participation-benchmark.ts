/**
 * Small-Business Participation Benchmark — the data behind RES-003, the Mindy Institute's first
 * public publication. A per-AGENCY ranking of small-business participation on active federal
 * solicitations, derived directly from the production Observatory metrics OBS-001 + OBS-002.
 *
 * ⚠️ HONESTY (this is a PUBLIC, citable research artifact — the bar is absolute):
 *  - Every figure is an EXACT head-count per department (never a sampled ratio — the 1000-row-cap
 *    trap OBS-001 already avoids). Participation % = (active solicitations carrying a small-business
 *    set-aside) / (all active solicitations), per department.
 *  - A MINIMUM-VOLUME FLOOR excludes departments below `MIN_ACTIVE` active solicitations, where a
 *    percentage is statistical noise (a 33% on 3 opps is meaningless next to a 38% on 21,000). The
 *    floor is DISCLOSED on the page — excluded ≠ hidden.
 *  - Ranked by active-solicitation volume (the market size), not by the % itself, so the biggest
 *    buyers anchor the benchmark and a tiny high-% office can't top the list.
 *
 * ⚠️ READ-ONLY. Only exact head-counts. Touches no write path, no migration.
 *
 * Cites: OBS-001 (Small-business participation) + OBS-002 (Awarded set-aside mix).
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export const MIN_ACTIVE = 30;   // below this an agency's participation % is noise — excluded + disclosed
export const TOP_N = 25;         // the benchmark lists the top N buyers by active-solicitation volume

export interface AgencyRow {
  department: string;
  active: number;                // active solicitations for this buyer (the market size)
  withSetAside: number;          // of those, how many carry a small-business set-aside
  pct: number;                   // participation % — exact, not sampled
}

export interface Benchmark {
  generatedAtNote: string;       // caller stamps the real time
  rows: AgencyRow[];             // top-N by volume, each above the floor
  fleetActive: number;           // total active solicitations across ALL departments (context)
  fleetWithSetAside: number;     // fleet-wide set-aside count (the OBS-001 headline)
  fleetPct: number | null;       // fleet-wide participation % (the OBS-001 number)
  agenciesRanked: number;        // how many departments cleared the floor (the real population)
  agenciesExcluded: number;      // how many were below the floor (disclosed, not hidden)
  minActive: number;
  error: string | null;
}

// Exact head-count helper (count≠null contract): binds { count, error }, never coalesced to 0.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function headCount(sb: SupabaseClient, build?: (q: any) => any) {
  let q = sb.from('sam_opportunities').select('*', { count: 'exact', head: true });
  if (build) q = build(q);
  const { count, error } = await q;
  return { count: (count ?? null) as number | null, error };
}

/**
 * Compute the benchmark. Reads the per-department active + set-aside counts, applies the floor,
 * ranks by volume, and also returns the fleet-wide OBS-001 number for context. Every count is exact.
 *
 * Implementation note: we pull the (department, set_aside_code) pairs for ACTIVE opps and aggregate
 * in memory — a department GROUP BY. This is NOT the 1000-row-cap trap: we select only two tiny
 * columns and page through the whole active set so the per-department counts are complete + exact.
 */
export async function computeSbBenchmark(sb: SupabaseClient, nowIso: string): Promise<Benchmark> {
  const empty = (error: string): Benchmark => ({
    generatedAtNote: nowIso, rows: [], fleetActive: 0, fleetWithSetAside: 0, fleetPct: null,
    agenciesRanked: 0, agenciesExcluded: 0, minActive: MIN_ACTIVE, error,
  });

  // Fleet-wide OBS-001 numbers (exact head-counts) — the headline + context.
  const activeRes = await headCount(sb, (q) => q.eq('active', true));
  if (activeRes.error) return empty(`benchmark active head-count failed: ${activeRes.error.message}`);
  const saRes = await headCount(sb, (q) => q.eq('active', true).not('set_aside_code', 'is', null).neq('set_aside_code', '').neq('set_aside_code', 'NONE'));
  if (saRes.error) return empty(`benchmark set-aside head-count failed: ${saRes.error.message}`);
  const fleetActive = activeRes.count ?? 0;
  const fleetWithSetAside = saRes.count ?? 0;
  const fleetPct = fleetActive > 0 ? Math.round((fleetWithSetAside / fleetActive) * 1000) / 10 : null;

  // Per-department aggregation. Page the active set (dept + set_aside only) to get COMPLETE counts.
  const byDept = new Map<string, { active: number; withSetAside: number }>();
  const PAGE = 1000;
  let from = 0;
  // Cap the paging generously; the active set is ~31k rows today.
  for (let guard = 0; guard < 200; guard++) {
    const { data, error } = await sb
      .from('sam_opportunities')
      .select('department, set_aside_code')
      .eq('active', true)
      .not('department', 'is', null)
      .neq('department', '')
      .range(from, from + PAGE - 1);
    if (error) return empty(`benchmark department page failed: ${error.message}`);
    const rows = data || [];
    for (const r of rows) {
      const dept = (r.department || '').trim();
      if (!dept) continue;
      const rec = byDept.get(dept) || byDept.set(dept, { active: 0, withSetAside: 0 }).get(dept)!;
      rec.active += 1;
      const sa = (r.set_aside_code || '').trim().toUpperCase();
      if (sa !== '' && sa !== 'NONE') rec.withSetAside += 1;
    }
    if (rows.length < PAGE) break; // last page
    from += PAGE;
  }

  const all = [...byDept.entries()].map(([department, v]) => ({
    department, active: v.active, withSetAside: v.withSetAside,
    pct: v.active > 0 ? Math.round((v.withSetAside / v.active) * 1000) / 10 : 0,
  }));
  const above = all.filter((r) => r.active >= MIN_ACTIVE);
  const rows = above.sort((a, b) => b.active - a.active).slice(0, TOP_N);

  return {
    generatedAtNote: nowIso,
    rows,
    fleetActive, fleetWithSetAside, fleetPct,
    agenciesRanked: above.length,
    agenciesExcluded: all.length - above.length,
    minActive: MIN_ACTIVE,
    error: null,
  };
}
