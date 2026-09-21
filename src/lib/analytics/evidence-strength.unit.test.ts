import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { evidenceStrength, marginOfErrorPct, plainRate } from './competition-depth';

/**
 * ACCURACY IS NOT PRECISION.
 *
 * Eric, looking at /admin/competition-health: "it says sample size 42 or a low number which
 * makes this not seem credible." The card printed "47.9% single-bid rate" from 48 observations.
 * That figure is mathematically accurate for those 48 awards and still communicates far more
 * certainty than the evidence supports — at n=48 the 95% CI is roughly ±14 points, so the true
 * rate sits somewhere between about 34% and 62%.
 *
 * The fix is two independent things, and this file pins both:
 *   1. RAISE the sample (60 -> 100; measured live: 48 -> 85 awards with offer counts, MoE
 *      ±14 -> ±10.6, and avgBidders moved 3.4 -> 4.4 — a 29% swing that is itself evidence
 *      the old n was too thin).
 *   2. STOP IMPLYING POPULATION PRECISION. Headline reads "About half"; the exact value, n
 *      and margin live underneath for analysts.
 *
 * ⚠️ EVIDENCE STRENGTH IS NOT MIN_SAMPLE. Eric: "don't solve this by simply raising
 * MIN_SAMPLE. Keep the floor as an epistemic guard — below it, don't report. Then separately
 * communicate sample strength. A sample can be valid enough to observe while still not being
 * strong enough for a sweeping headline."
 */

const DEPTH = readFileSync(join(__dirname, 'competition-depth.ts'), 'utf8');
const PAGE = readFileSync(
  join(process.cwd(), 'src/app/admin/competition-health/page.tsx'),
  'utf8',
);
/** Comments quote the old bad output while explaining it — strip before matching. */
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('evidence strength is separate from the reporting floor', () => {
  it('MIN_SAMPLE still gates whether we report at all', () => {
    expect(DEPTH).toContain('const MIN_SAMPLE = 12');
    // and it is still consulted before returning an average
    expect(strip(DEPTH)).toContain('withData < MIN_SAMPLE');
  });

  it('tiers the strength of a sample we DO report', () => {
    expect(evidenceStrength(8)).toBe('insufficient');   // below the floor
    expect(evidenceStrength(12)).toBe('limited');       // reportable, but thin
    expect(evidenceStrength(29)).toBe('limited');
    expect(evidenceStrength(30)).toBe('sampled');
    expect(evidenceStrength(99)).toBe('sampled');
    expect(evidenceStrength(100)).toBe('strong');
  });

  it('a bigger sample never lowers the stated strength', () => {
    const order = ['insufficient', 'limited', 'sampled', 'strong'];
    let prev = -1;
    for (const n of [1, 12, 30, 60, 100, 500]) {
      const idx = order.indexOf(evidenceStrength(n));
      expect(idx).toBeGreaterThanOrEqual(prev);
      prev = idx;
    }
  });
});

describe('the headline does not imply precision the sample lacks', () => {
  it('reports a plain band, not a decimal', () => {
    expect(plainRate(47.9)).toBe('About half');
    expect(plainRate(5)).toBe('Rare');
    expect(plainRate(95)).toBe('Nearly all');
    expect(plainRate(null)).toBeNull();
  });

  it('computes a real margin of error, and it SHRINKS as n grows', () => {
    const at48 = marginOfErrorPct(47.9, 48)!;
    const at85 = marginOfErrorPct(47.9, 85)!;
    expect(at48).toBeGreaterThan(13);   // the ±14 that made 47.9% misleading
    expect(at85).toBeLessThan(at48);    // the whole point of raising the sample
  });

  it('the card leads with the band and puts the exact value BELOW it', () => {
    const page = strip(PAGE);
    expect(page).toContain('singleBidPlain');
    expect(page).toContain('Observed single-bid rate');
    // the exact rate is rounded — no decimal place anywhere in the rendered figure
    expect(page).toContain('Math.round(h.competitionDepth.singleBidPct)');
    expect(page).not.toMatch(/\{h\.competitionDepth\.singleBidPct\}%/);
  });

  it('states n (and the margin) wherever the exact rate appears', () => {
    const page = strip(PAGE);
    expect(page).toContain('sampledWithData');
    expect(page).toContain('singleBidMoe');
  });
});

describe('exact and sampled are visually distinguishable', () => {
  it('has one provenance component used for both kinds', () => {
    expect(PAGE).toContain('function Provenance');
    expect(strip(PAGE)).toContain('kind="exact"');
    expect(strip(PAGE)).toContain('kind="sampled"');
  });

  it('the sampled chip carries n so the reader can weigh it', () => {
    const comp = PAGE.slice(PAGE.indexOf('function Provenance'), PAGE.indexOf('function Kpi'));
    expect(comp).toContain('with offer counts');
    expect(comp).toContain('Insufficient evidence');
    expect(comp).toContain('Strong sample');
  });
});

describe('the sample was actually raised', () => {
  it('defaults to 100 awards, not 60', () => {
    expect(strip(DEPTH)).toContain('sampleSize = 100');
    expect(strip(DEPTH)).not.toContain('sampleSize = 60');
  });
});
