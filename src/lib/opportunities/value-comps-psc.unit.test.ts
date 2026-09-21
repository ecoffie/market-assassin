/**
 * #88 PSC-tier follow-up. Most opps carry a PSC, so the band is PSC-scoped — and the detail RPCs
 * (histogram/comps/timeline) were hidden there to avoid a NAICS-comps-vs-PSC-band mismatch, which
 * meant comps/timeline almost never showed. Fix: pass the SAME p_psc to the three detail RPCs so
 * they narrow on the PSC family too and MATCH the band. This locks: (a) all three helpers take a
 * pscArg and forward p_psc, (b) run() fetches them on the PSC tier (pscArg = the opp's psc), (c) the
 * migration adds p_psc to all three RPCs with the exact PSC-family CASE opp_value_range uses.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const vr = readFileSync(join(__dirname, 'value-range.ts'), 'utf8');
const migration = readFileSync(
  join(__dirname, '../../../supabase/migrations/20260808_m_estimate_detail_psc_tier.sql'),
  'utf8',
);

describe('#88 PSC-tier detail (comps/timeline/histogram match a PSC-scoped band)', () => {
  it('migration adds p_psc to all three detail RPCs + re-grants', () => {
    for (const fn of ['opp_value_histogram', 'opp_value_comps', 'opp_value_timeline']) {
      expect(migration).toContain(`FUNCTION ${fn}(`);
    }
    // p_psc appears in all three signatures (once per CREATE + once per GRANT + in the CASE).
    expect((migration.match(/p_psc text DEFAULT NULL/g) || []).length).toBe(3);
    // The PSC-family match (2-char group), same as opp_value_range's 20260803 migration.
    expect((migration.match(/upper\(psc_code\) LIKE upper\(left\(p_psc, greatest\(p_psc_prefix_len, 1\)\)\) \|\| '%'/g) || []).length).toBe(3);
    for (const fn of ['opp_value_histogram', 'opp_value_comps', 'opp_value_timeline']) {
      expect(migration).toContain(`GRANT EXECUTE ON FUNCTION ${fn}(text, text, text, int, text, int) TO service_role`);
    }
  });

  it('the three fetch helpers take a pscArg and forward p_psc only when set', () => {
    for (const fn of ['fetchDistribution', 'fetchComps', 'fetchTimeline']) {
      expect(vr).toMatch(new RegExp(`function ${fn}\\(ag: string \\| null, sa: string \\| null, pscArg: string \\| null\\)`));
    }
    // Each forwards p_psc via the spread-when-set pattern (backward compatible: no p_psc on NAICS tiers).
    expect((vr.match(/\.\.\.\(pscArg \? \{ p_psc: pscArg \} : \{\}\)/g) || []).length).toBe(3);
  });

  it('run() fetches the detail on the PSC tier too (no more byPsc skip)', () => {
    // The old skip is GONE.
    expect(vr).not.toContain('? [undefined, undefined, undefined]');
    // pscArg = the opp's psc on the PSC tier, null otherwise; all three fetched at that scope.
    expect(vr).toContain('const pscArg = byPsc ? psc : null;');
    expect(vr).toMatch(/Promise\.all\(\[\s*fetchDistribution\(ag, sa, pscArg\),\s*fetchComps\(ag, sa, pscArg\),\s*fetchTimeline\(ag, sa, pscArg\),\s*\]\)/);
  });
});
