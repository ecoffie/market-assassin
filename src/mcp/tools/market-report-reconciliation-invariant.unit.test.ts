/**
 * Market-report RECONCILIATION invariant (Eric's #2 real-run strength, memory
 * `mcp_tool_strengths_to_protect`). generate_market_report surfaces its OWN coverage math — "a single
 * NAICS captures ~28%, so a NAICS-anchored search misses the other 72%" + the PSC breakdown. Showing
 * the seams is what let Eric CATCH the keyword-coverage problem instead of repeating it. This guards
 * the reconciliation block so a refactor can't quietly drop it — AND locks its HONESTY gate:
 *   - reconciliation is a first-class result field (alongside basis),
 *   - it is SUPPRESSED on the dominant-NAICS path (there we and a NAICS tool use the SAME code, so a
 *     "you'd miss X%" line would be a lie the report tells about itself),
 *   - it is suppressed when the biggest code already ~IS the whole market (nothing missed),
 *   - missed_pct = 1 - the biggest code's share.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(__dirname, 'market-report.ts'), 'utf8');

describe('reconciliation is surfaced + honest (memory: mcp_tool_strengths_to_protect #2)', () => {
  it('basis + reconciliation are first-class result fields', () => {
    expect(src).toMatch(/basis:\s*MarketReportBasis\s*\|\s*null/);
    expect(src).toMatch(/reconciliation:\s*MarketReconciliation\s*\|\s*null/);
  });

  it('reconciliation is SUPPRESSED on the dominant-NAICS path (never a self-lie)', () => {
    expect(src).toContain('!scope?.rankedByDominantNaics');
  });

  it('reconciliation is gated on a MULTI-code market where the biggest is not ~the whole thing', () => {
    expect(src).toContain('coverage.naicsCount > 1');
    expect(src).toContain('coverage.topCodePct < 0.9');
  });

  it('missed_pct is derived from the biggest code share (the "you would miss X%" figure)', () => {
    expect(src).toMatch(/missed_pct:\s*Math\.max\(0,\s*1\s*-\s*coverage\.topCodePct\)/);
  });
});

// Pure-logic mirror of the reconciliation gate — pins exactly WHEN the honest "you'd miss X%" line
// shows vs is suppressed.
describe('reconciliation gate logic (mirror)', () => {
  const shouldReconcile = (opts: {
    rankedByDominantNaics: boolean; totalMarket: number; naicsCount: number; topCodePct: number;
  }) => !opts.rankedByDominantNaics && opts.totalMarket > 0 && opts.naicsCount > 1 && opts.topCodePct < 0.9;

  it('cross-cutting keyword (drones: lead ~28%, many codes, not dominant) → RECONCILE', () => {
    expect(shouldReconcile({ rankedByDominantNaics: false, totalMarket: 3.9e9, naicsCount: 191, topCodePct: 0.28 })).toBe(true);
  });
  it('dominant-NAICS path → SUPPRESS (we and a NAICS tool use the same code)', () => {
    expect(shouldReconcile({ rankedByDominantNaics: true, totalMarket: 1e9, naicsCount: 40, topCodePct: 0.28 })).toBe(false);
  });
  it('single-code market → SUPPRESS (nothing to reconcile)', () => {
    expect(shouldReconcile({ rankedByDominantNaics: false, totalMarket: 1e9, naicsCount: 1, topCodePct: 1.0 })).toBe(false);
  });
  it('biggest code IS ~the whole market (>=90%) → SUPPRESS (nothing missed)', () => {
    expect(shouldReconcile({ rankedByDominantNaics: false, totalMarket: 1e9, naicsCount: 5, topCodePct: 0.95 })).toBe(false);
  });
  it('missed_pct = 1 - topCodePct', () => {
    const missed = (topCodePct: number) => Math.max(0, 1 - topCodePct);
    expect(missed(0.28)).toBeCloseTo(0.72);
    expect(missed(1.0)).toBe(0);
  });
});
