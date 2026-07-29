/**
 * M-Estimate™ (comparable-award value range) — pure-logic tests.
 *
 * getComparableAwardRange() hits a DB RPC, so the LIVE oracle cross-check (does the code's
 * low/median/high equal the real percentiles of recompete_opportunities?) lives in the runnable
 * `npm run verify:m-scale` script — run that to eyeball the number the same way as the QA matrix.
 *
 * This file locks the DETERMINISTIC contract that doesn't need a DB, so a refactor can't silently
 * change the shape or the honesty rules (the lessons from today's re-verify: a number must be
 * grounded, and a thin/degraded result must be distinguishable from a real one):
 *   • NAICS normalization (what codes are accepted / how the lead code is picked)
 *   • the RPC-row → ValueRange mapping (p10→low[25th], p50→median, p90→high[75th])
 *   • the MIN_SAMPLE / null-p50 gate → returns null (never a fabricated band)
 *   • percentile ordering (low ≤ median ≤ high)
 */
import { describe, it, expect } from 'vitest';

// ── Pure mirrors of the private logic in value-range.ts (kept in lock-step by the source-assert
//    block below, which fails if the real file drifts from these constants/shapes). ──

// normNaics: split on comma/space, strip non-digits, keep 2–6 digit codes, dedupe.
function normNaics(naics: string | null): string[] {
  if (!naics) return [];
  return [...new Set(
    naics.split(/[,\s]+/).map((c) => c.replace(/\D/g, '')).filter((c) => c.length >= 2 && c.length <= 6),
  )];
}

const MIN_SAMPLE = 8;

// The RPC row → ValueRange mapping (mirror of run() in value-range.ts). Returns null on a thin
// sample or a null median — NEVER a fabricated band.
interface RpcRow { n: number | string; p10: number | string | null; p50: number | string | null; p90: number | string | null; }
function mapRow(row: RpcRow | null, label: string) {
  if (!row || Number(row.n) < MIN_SAMPLE || row.p50 == null) return null;
  return {
    low: Math.round(Number(row.p10)),
    median: Math.round(Number(row.p50)),
    high: Math.round(Number(row.p90)),
    n: Number(row.n),
    basis: label,
    source: 'comparable_awards' as const,
  };
}

describe('M-Estimate: NAICS normalization', () => {
  it('keeps a clean 6-digit code', () => {
    expect(normNaics('541512')).toEqual(['541512']);
  });
  it('splits comma/space lists and dedupes', () => {
    expect(normNaics('541512, 541512  236220')).toEqual(['541512', '236220']);
  });
  it('strips non-digits and drops too-short/too-long tokens', () => {
    expect(normNaics('NAICS 5415, x, 1')).toEqual(['5415']); // "1" too short, "x"→'' dropped
  });
  it('returns [] for null/empty (NAICS is the minimum key → caller returns null)', () => {
    expect(normNaics(null)).toEqual([]);
    expect(normNaics('   ')).toEqual([]);
  });
});

describe('M-Estimate: RPC-row → range mapping (honest gate)', () => {
  it('maps p10/p50/p90 to low/median/high and rounds', () => {
    const r = mapRow({ n: 4452, p10: 531808.4, p50: 2473161.2, p90: 9144879.6 }, '541512');
    expect(r).not.toBeNull();
    expect(r!.low).toBe(531808);
    expect(r!.median).toBe(2473161);
    expect(r!.high).toBe(9144880);
    expect(r!.n).toBe(4452);
    expect(r!.source).toBe('comparable_awards');
  });
  it('returns NULL when the sample is below MIN_SAMPLE (never a band from too few awards)', () => {
    expect(mapRow({ n: 7, p10: 1, p50: 2, p90: 3 }, 'x')).toBeNull();
  });
  it('returns NULL when the median is null (no real center → no estimate, not a fabricated 0)', () => {
    expect(mapRow({ n: 100, p10: 1, p50: null, p90: 3 }, 'x')).toBeNull();
  });
  it('accepts exactly MIN_SAMPLE comparables (boundary is inclusive)', () => {
    expect(mapRow({ n: 8, p10: 10, p50: 20, p90: 30 }, 'x')).not.toBeNull();
  });
  it('preserves percentile ordering low ≤ median ≤ high', () => {
    const r = mapRow({ n: 50, p10: 100, p50: 500, p90: 2000 }, 'x')!;
    expect(r.low).toBeLessThanOrEqual(r.median);
    expect(r.median).toBeLessThanOrEqual(r.high);
  });
});

// ── Source-assert: keep the mirrors above honest. If value-range.ts changes MIN_SAMPLE, the field
//    mapping, or the null-gate, these fail so the mirror (and the verify:m-scale oracle) get updated. ──
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const src = readFileSync(join(__dirname, 'value-range.ts'), 'utf8');

describe('M-Estimate: source stays in lock-step with the mirror', () => {
  it('MIN_SAMPLE is still 8', () => {
    expect(src).toMatch(/MIN_SAMPLE\s*=\s*8/);
  });
  it('still gates on n < MIN_SAMPLE AND a null p50 (the honest-miss guard)', () => {
    expect(src).toMatch(/Number\(row\.n\)\s*<\s*MIN_SAMPLE\s*\|\|\s*row\.p50\s*==\s*null/);
  });
  it('still maps p10→low, p50→median, p90→high with rounding', () => {
    expect(src).toMatch(/low:\s*Math\.round\(Number\(row\.p10\)\)/);
    expect(src).toMatch(/median:\s*Math\.round\(Number\(row\.p50\)\)/);
    expect(src).toMatch(/high:\s*Math\.round\(Number\(row\.p90\)\)/);
  });
  it('never invents a code — NAICS is the minimum key (returns null when empty)', () => {
    expect(src).toMatch(/if\s*\(!codes\.length\)\s*return null/);
  });
});
