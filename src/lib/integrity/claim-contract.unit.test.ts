import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { knownClaim, unavailableClaim, isDefensible, explainClaim, assessMarket, renderMarketAssessment } from './claim-contract';

/**
 * PHASE 3 is deliberately narrow: evidence travels only with claims consequential enough to
 * justify it. The first one is a GOVERNMENT ACQUISITION claim — a capable-supplier count that
 * can back a FAR Part 19 "rule of two" set-aside determination in an acquisition file.
 *
 * The failure these tests exist to prevent is specific and severe: an UNMEASURED count
 * rendering as ZERO would read as evidence AGAINST a set-aside — the opposite of the truth.
 */

const MRR = readFileSync(join(process.cwd(), 'src/lib/micc/mrr.ts'), 'utf8');
const SMB = readFileSync(join(process.cwd(), 'src/lib/bigquery/recipients.ts'), 'utf8');

describe('an unavailable supplier count can never become a number', () => {
  it('forces value to null and refuses to be presented', () => {
    const c = unavailableClaim<number>('count query returned nothing', {
      source: 'USASpending', describes: 'capable suppliers', measuredAt: new Date().toISOString(),
    });
    expect(c.value).toBeNull();
    expect(isDefensible(c)).toBe(false);
    expect(explainClaim(c)).toMatch(/^Unavailable/);
    // and critically, the rendering contains no digit that could be read as a count
    expect(explainClaim(c)).not.toMatch(/\b0\b/);
  });

  it('a MEASURED zero is different from an unavailable one', () => {
    const c = knownClaim(0, {
      population: 'complete', source: 'USASpending', describes: 'capable suppliers',
      measuredAt: new Date().toISOString(), limitations: ['federal award history only'],
    });
    expect(c.state).toBe('measured_zero');
    expect(isDefensible(c)).toBe(true);
  });
});

describe('the supplier count itself cannot be fabricated', () => {
  it('does NOT fall back to the current page length', () => {
    // The original code was `Number(totalRows[0]?.n || rows.length)` — an unavailable COUNT
    // silently became the size of the page, e.g. "50 capable suppliers".
    expect(SMB).not.toMatch(/totalRows\[0\]\?\.n \|\| rows\.length/);
    expect(SMB).toMatch(/typeof n === 'number' \? n : null/);
  });
});

describe('FAR 19 rule-of-two: no evidence means NO recommendation', () => {
  it('refuses to recommend when the small-business count is unmeasured', () => {
    expect(MRR).toContain('Undetermined — supplier evidence unavailable');
    // and says so explicitly rather than implying a shortage
    expect(MRR).toMatch(/deliberately NOT reported as "0 small businesses found"/);
  });

  it('never coerces a null count into the set-aside threshold comparison', () => {
    // `smallEnough >= 2` on a null would be false — silently recommending FULL AND OPEN.
    // The null branch must be handled BEFORE the threshold test.
    const nullBranch = MRR.indexOf('smallEnough === null');
    const thresholdTest = MRR.indexOf('smallEnough >= 2');
    expect(nullBranch).toBeGreaterThan(-1);
    expect(nullBranch).toBeLessThan(thresholdTest);
  });

  it('competition level is "unknown" rather than "limited" when unmeasured', () => {
    // "limited" would be a claim about the market; "unknown" is a claim about our evidence.
    expect(MRR).toMatch(/supplierCount === null \? 'unknown'/);
  });
});

describe('a government-facing claim states what it does NOT establish', () => {
  const c = knownClaim(80, {
    population: 'complete',
    source: 'USASpending federal award history (BigQuery)',
    describes: 'federal award winners matching NAICS 336611',
    measuredAt: '2026-08-23T00:00:00.000Z',
    limitations: [
      'counts firms with prior FEDERAL AWARD history only',
      'facility clearance, capacity and availability are NOT verified',
    ],
  });

  it('explains itself in one readable line', () => {
    const s = explainClaim(c);
    expect(s).toContain('80');
    expect(s).toContain('Source:');
    expect(s).toContain('Population: complete');
    expect(s).toContain('Measured: 2026-08-23');
    expect(s).toContain('Not established:');
  });

  it('the route ships that explanation to the caller', () => {
    const route = readFileSync(join(process.cwd(), 'src/app/api/app/osbp/smb-search/route.ts'), 'utf8');
    expect(route).toContain('whyMindySaysThis');
    expect(route).toMatch(/facility clearance/);
  });
});

describe('MARKET STATE vs EVIDENCE STATE — the two must never collapse', () => {
  // Eric: "Limited competition = a claim about the market. Unknown competition = a claim about
  // Mindy's evidence." The same error wears many costumes; these pin the general rule.
  const classify = (n: number) => (n >= 50 ? 'broad' : n >= 10 ? 'moderate' : 'limited');

  it('a real observation produces a market state', () => {
    const a = assessMarket(80, classify, 'supplier count unavailable');
    expect(a.kind).toBe('assessed');
    expect(a.kind === 'assessed' && a.state).toBe('broad');
  });

  it('a MEASURED small number is still a market state — zero is not automatically suspect', () => {
    const a = assessMarket(1, classify, 'supplier count unavailable');
    expect(a.kind === 'assessed' && a.state).toBe('limited');
  });

  it('an unavailable observation NEVER borrows a market word', () => {
    const a = assessMarket(null, classify, 'USASpending could not be read');
    expect(a.kind).toBe('indeterminate');
    const rendered = renderMarketAssessment(a);
    expect(rendered).toMatch(/^undetermined/);
    for (const marketWord of ['limited', 'broad', 'moderate', 'niche', 'concentrated']) {
      expect(rendered).not.toContain(marketWord);
    }
  });

  it('market-scan no longer reports a fetch failure as a niche market', () => {
    // MEASURED 2026-08-23: three exit paths returned `agencies: []` — a thrown error, a non-OK
    // HTTP response, and the success path — and determineMarketType() called the first two
    // 'niche'. A USASpending outage was being reported to the user as a market fact.
    const scan = readFileSync(join(process.cwd(), 'src/app/api/market-scan/route.ts'), 'utf8');
    expect(scan).toContain('spendingAvailable');
    expect(scan).toMatch(/if \(!spendingAvailable\) \{\s*\n\s*return 'undetermined';/);
    // every failure exit must carry the flag, not just the one that was noticed first
    expect((scan.match(/spendingAvailable: false/g) || []).length).toBeGreaterThanOrEqual(2);
  });
});
