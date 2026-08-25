/**
 * 8(a) CURRENT ELIGIBILITY — 8(a) only, and the other programs must stay untouched.
 *
 * THE DEFECT: `certifications[]` records that a program was ASSERTED; it does not prove the
 * certification is CURRENTLY VALID. Measured — of 5,957 firms this filter returned as 8(a),
 * **1,542 hold an EXPIRED 8(a)**, and 1,541 of those have an ACTIVE SAM registration so
 * nothing else flags them.
 *
 * LIVE EFFECT of this change, measured against the backfilled mirror:
 *   8(a) pool 5,510 → 4,066 (Active, not excluded) — 1,444 removed (26.2%)
 *   0 of 30 real NAICS+state Rule-of-Two determinations flip
 *   KILIUDA CONSULTING: excluded from current, still present in certifications[]
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = () => {
  const s = readFileSync(join(process.cwd(), 'src/lib/gov-buyer/market-research.ts'), 'utf8');
  return s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
          .replace(/^([^\n]*?)\/\/.*$/gm, '$1');
};

describe('8(a) requires a CURRENT certification', () => {
  it('filters on certification_records, not certifications[]', () => {
    const c = src();
    expect(c).toContain("currentCertFilter(EIGHT_A)");
    expect(c).toContain("certification_status: 'current'");
  });

  it('applies the SAME predicate to the pool and the count', () => {
    // If they disagree, eligible_population describes a different population than the firms
    // actually returned — the exact class of defect P0-3 already fixed once here.
    const c = src();
    expect((c.match(/currentCertFilter\(EIGHT_A\)/g) || []).length).toBe(2);
  });
});

describe('every other program is deliberately untouched', () => {
  it('HUBZone / SDVOSB / WOSB / VOSB still use certifications[]', () => {
    // HUBZone is 89% undated: only 408 of 4,843 carry a date. Requiring currency would drop
    // 90% of the population and turn "we don't know" into "not eligible".
    expect(src()).toContain("q.contains('certifications', [setAsideRaw])");
  });

  it('the current-cert path is reached ONLY for 8(a)', () => {
    const c = src();
    expect(c).toContain("setAsideRaw === EIGHT_A");
    // No other literal program name may gate the current-cert branch.
    expect(c).not.toMatch(/setAsideRaw === ['"]HUBZone['"]/);
  });

  it('the general small-business path is unchanged', () => {
    // Size and socioeconomic program are different questions — P0-3.
    expect(src()).toContain("q.contains('small_business_naics', [params.naics])");
  });
});

describe('history remains visible', () => {
  it('this change never writes or narrows certifications[]', () => {
    const c = src();
    expect(c).not.toMatch(/\.update\(\s*\{[^}]*certifications/);
  });
});
