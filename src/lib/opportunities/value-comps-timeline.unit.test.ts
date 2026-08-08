/**
 * M-Estimate DATED COMPS + VALUE-HISTORY TIMELINE (#88). Source-asserts the contract so a future
 * edit can't silently drop the two per-award RPCs, break the same-tier fetch, or fabricate on a
 * missing migration. The RPCs themselves are proven against the LIVE DB by scripts/verify-m88.mjs
 * (post-migration); this locks the wiring + the honest-degrade guarantee.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const vr = readFileSync(join(__dirname, 'value-range.ts'), 'utf8');
const intel = readFileSync(join(__dirname, 'opp-intel.ts'), 'utf8');
const migration = readFileSync(
  join(__dirname, '../../../supabase/migrations/20260808_m_estimate_comps_timeline.sql'),
  'utf8',
);
const route = readFileSync(join(__dirname, '../../app/opportunity-map/route.ts'), 'utf8');

describe('#88 — dated comps + value-history timeline', () => {
  it('migration defines BOTH RPCs, service-role granted, same filter as opp_value_range', () => {
    expect(migration).toContain('FUNCTION opp_value_comps(');
    expect(migration).toContain('FUNCTION opp_value_timeline(');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION opp_value_comps');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION opp_value_timeline');
    // Same outlier cap + NAICS-prefix logic as the band, so they describe ONE comparable set.
    expect((migration.match(/total_obligation BETWEEN 1000 AND 500000000/g) || []).length).toBe(2);
  });

  it('timeline uses MEDIAN (not mean) per year + a min-per-year floor (no 1-point "trend")', () => {
    expect(migration).toContain('percentile_cont(0.50) WITHIN GROUP (ORDER BY total_obligation)');
    expect(migration).toContain('HAVING COUNT(*) >= GREATEST(1, p_min_per_year)');
  });

  it('value-range fetches comps + timeline and returns them typed', () => {
    expect(vr).toContain("db.rpc('opp_value_comps'");
    expect(vr).toContain("db.rpc('opp_value_timeline'");
    expect(vr).toContain('export interface ValueComp');
    expect(vr).toContain('export interface ValueTimelinePoint');
    // Fetched on the SAME winning tier as the histogram/band (one Promise.all). The PSC-tier
    // follow-up threads pscArg so a PSC-scoped band gets PSC-scoped detail too (all three match).
    expect(vr).toMatch(/Promise\.all\(\[\s*fetchDistribution\(ag, sa, pscArg\),\s*fetchComps\(ag, sa, pscArg\),\s*fetchTimeline\(ag, sa, pscArg\),\s*\]\)/);
  });

  it('degrades to undefined on a missing/errored RPC (never throws, never fabricates)', () => {
    // Each helper binds { data, error } and returns undefined on error — the pre-migration path.
    expect(vr).toMatch(/opp_value_comps[\s\S]*?if \(error\) \{[\s\S]*?return undefined;/);
    expect(vr).toMatch(/opp_value_timeline[\s\S]*?if \(error\) \{[\s\S]*?return undefined;/);
    // pscArg is the opp's psc on the PSC tier, null otherwise (the PSC-tier follow-up replaced the
    // old byPsc skip so a PSC-scoped band now gets matching PSC-scoped detail).
    expect(vr).toContain('const pscArg = byPsc ? psc : null;');
  });

  it('opp-intel passes comps + timeline through ONLY on the comparable_awards source', () => {
    expect(intel).toContain('comps?: { incumbent: string; value: number; awardDate: string | null; subAgency: string | null }[]');
    expect(intel).toContain('timeline?: { year: number; median: number; n: number }[]');
    expect(intel).toContain('...(cr.comps ? { comps: cr.comps } : {})');
    expect(intel).toContain('...(cr.timeline ? { timeline: cr.timeline } : {})');
  });

  it('the drawer renders both, degrading to empty string when absent', () => {
    expect(route).toContain('function vrTimeline(tl)');
    expect(route).toContain('function vrComps(comps)');
    expect(route).toContain('+ vrTimeline(vr.timeline)');
    expect(route).toContain('+ vrComps(vr.comps)');
    // Honest empty: each returns '' when its data is absent/thin.
    expect(route).toMatch(/function vrTimeline\(tl\)\{\s*if\(!tl\|\|tl\.length<2\)return '';/);
    expect(route).toMatch(/function vrComps\(comps\)\{\s*if\(!comps\|\|!comps\.length\)return '';/);
  });
});
