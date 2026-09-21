/**
 * Industry taxonomy — structure, and the one documented exception.
 *
 * Re-cut 2026-08-13 from a census of 35,007 active opportunities rather than intuition:
 *   - Manufacturing was 41.7% of the whole map on its own            -> SPLIT in two
 *   - Office & Industrial Supplies held 15 rows, 100% inside 423/424 -> MERGED into its parent
 *   - 336xxx (3,878 rows, 11% of the map) was unreachable by browsing -> ADDED
 * Coverage went 62.9% -> 74.0%; the largest bucket went 41.7% -> 22.9%.
 *
 * These tests are STRUCTURAL on purpose. Counts move every week as SAM churns, so asserting "22.9%"
 * would fail on Tuesday for no reason. What must not drift is the SHAPE: mutual exclusivity, no
 * resurrected subset bucket, and the split staying split.
 */
import { describe, it, expect } from 'vitest';
import { INDUSTRY_PRESETS } from './industry-presets';

const byName = (n: string) => INDUSTRY_PRESETS.find((p) => p.name === n);

describe('the re-cut categories', () => {
  it('split Manufacturing — nothing owns all four codes again', () => {
    expect(byName('Manufacturing')).toBeUndefined();
    expect(byName('Machinery & Metal Fabrication')?.codes).toEqual(['332', '333']);
    expect(byName('Electronics & Electrical')?.codes).toEqual(['334', '335']);
    // The guard that matters: no single preset may swallow the whole 332-335 block again.
    for (const p of INDUSTRY_PRESETS) {
      const has = ['332', '333', '334', '335'].filter((c) => (p.codes || []).includes(c));
      expect(has.length).toBeLessThan(4);
    }
  });

  it('retired Office & Industrial Supplies into its parent', () => {
    expect(byName('Office & Industrial Supplies')).toBeUndefined();
    // 453210 was the only code that sat OUTSIDE 423/424, so it had to move rather than vanish.
    expect(byName('Products & Wholesale')?.codes).toContain('453210');
  });

  it('added the 336xxx blind spot', () => {
    expect(byName('Vehicles & Transportation Equipment')?.codes).toEqual(['336']);
  });
});

describe('mutual exclusivity — rule 1 of the taxonomy', () => {
  // The rule: a code may not live in two buckets, INCLUDING by prefix ('423' swallowing '423450').
  // Exactly one exception is documented and measured; anything else is a real regression.
  const DOCUMENTED = new Set(['Medical Supplies & Equipment|Products & Wholesale|423450|423']);

  it('has no undocumented overlap between any two categories', () => {
    const violations: string[] = [];
    for (const a of INDUSTRY_PRESETS) {
      for (const b of INDUSTRY_PRESETS) {
        if (a.name === b.name) continue;
        for (const ca of a.codes || []) {
          for (const cb of b.codes || []) {
            // cb is a prefix of ca => selecting b also returns a's work.
            if (ca !== cb && ca.startsWith(cb)) {
              const key = [a.name, b.name, ca, cb].join('|');
              if (!DOCUMENTED.has(key)) violations.push(key);
            }
            if (ca === cb) violations.push(`DUPLICATE ${ca} in ${a.name} + ${b.name}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('keeps Cybersecurity out of the IT NAICS codes', () => {
    // The original overlap this rule was written for: 541512/541519 were double-listed.
    const cyber = byName('Cybersecurity');
    expect(cyber?.codes).toEqual(['518210']);
    expect(cyber?.psc).toEqual(['DJ01', 'DJ10']);
    for (const c of ['541511', '541512', '541513', '541519']) expect(cyber?.codes).not.toContain(c);
  });
});

describe('every category is usable', () => {
  it('has a name, a description, and at least one code or PSC', () => {
    for (const p of INDUSTRY_PRESETS) {
      expect(p.name.length).toBeGreaterThan(0);
      expect(p.description.length).toBeGreaterThan(0);
      expect((p.codes || []).length + (p.psc || []).length).toBeGreaterThan(0);
    }
  });
  it('has unique names — the picker keys on them', () => {
    const names = INDUSTRY_PRESETS.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
