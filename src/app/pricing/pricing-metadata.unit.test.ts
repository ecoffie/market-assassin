import { describe, it, expect } from 'vitest';
import { metadata } from './page';

// The /pricing search snippet is copy that ships to Google. Every comparison in it must be
// arithmetic a reader can check against Mindy's own pages. The GovWin range Mindy publishes
// (src/app/compare/govwin/page.tsx) is $15,000–$50,000+/yr; Pro is $149/mo = $1,788/yr,
// which is roughly 8–28x, never "100x".
const GOVWIN_LOW_USD_PER_YEAR = 15_000;
const GOVWIN_HIGH_USD_PER_YEAR = 50_000;

describe('/pricing metadata', () => {
  const description = String(metadata.description ?? '');

  it('makes no multiplier claim against GovWin that the published prices do not support', () => {
    const proMonthly = Number(/Pro at \$(\d+)\/mo/.exec(description)?.[1]);
    expect(proMonthly).toBeGreaterThan(0);
    const proYearly = proMonthly * 12;
    const maxRatio = GOVWIN_HIGH_USD_PER_YEAR / proYearly;
    for (const m of description.matchAll(/(\d+)\s*x\s+cheaper/gi)) {
      expect(Number(m[1])).toBeLessThanOrEqual(Math.floor(maxRatio));
    }
    expect(description).not.toMatch(/100x/i);
    expect(maxRatio).toBeLessThan(100);
  });

  it('states the GovWin range Mindy publishes on /compare/govwin', () => {
    expect(description).toContain('GovWin');
    expect(description).toContain('$15K');
    expect(description).toContain('$50K');
    expect(GOVWIN_LOW_USD_PER_YEAR).toBeLessThan(GOVWIN_HIGH_USD_PER_YEAR);
  });

  it('keeps the visible plan prices in the snippet', () => {
    expect(description).toContain('$149/mo');
    // Team: the 2-user seat price when the seat picker is on (as in production), else $499.
    expect(description).toContain(process.env.NEXT_PUBLIC_TEAM_SEAT_PRICING === 'on' ? 'Team from $249/mo' : '$499/mo');
  });
});
