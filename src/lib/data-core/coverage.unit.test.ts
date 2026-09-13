import { describe, it, expect } from 'vitest';
import { measureCoverage, describeCoverage } from './coverage';

describe('C5 — POPULATION coverage (the corpus-size claim)', () => {
  it('the canonical population store MAY support a corpus-size claim', () => {
    const r = measureCoverage({
      kind: 'population', storeId: 'recipients_rollup_merged',
      covered: 296_445, denominator: 296_445,
      basis: 'BigQuery recipients_rollup_merged, one row per company (Phase 0D)',
    });
    expect(r.maySupportCorpusSizeClaim).toBe(true);
    expect(r.state).toBe('measured');
  });

  it('an ENRICHMENT overlay may NOT support a corpus-size claim (the 107x incident)', () => {
    const r = measureCoverage({
      kind: 'population', storeId: 'contractors.json',
      covered: 2_768, denominator: 2_768, basis: 'static overlay',
    });
    expect(r.maySupportCorpusSizeClaim).toBe(false);
  });

  it('enrichment and editorial can NEVER back a corpus claim, whatever the store', () => {
    for (const kind of ['enrichment', 'editorial'] as const) {
      const r = measureCoverage({
        kind, storeId: 'recipients_rollup_merged', covered: 1, denominator: 10, basis: 'x',
      });
      expect(r.maySupportCorpusSizeClaim).toBe(false);
    }
  });
});

describe('C5 — ENRICHMENT coverage (contractors.json contact fields)', () => {
  it('1.4% email is stated as enrichment, not as "only 1.4% of contractors exist"', () => {
    const r = measureCoverage({
      kind: 'enrichment', storeId: 'contractors.json',
      covered: 40, denominator: 2_768,
      basis: 'email present in the curated overlay (Phase 0B measurement)',
    });
    expect(r.percent).toBe(1.4);
    expect(r.maySupportCorpusSizeClaim).toBe(false);
    expect(describeCoverage(r)).toContain('enrichment available for');
    expect(describeCoverage(r)).not.toMatch(/of the canonical population/);
  });

  it('the denominator is explicit in the description (no ambiguous share)', () => {
    const r = measureCoverage({
      kind: 'enrichment', storeId: 'contractors.json',
      covered: 72, denominator: 2_768, basis: 'sblo_name present in the overlay',
    });
    expect(describeCoverage(r)).toContain('2,768');
  });
});

describe('C5 — EDITORIAL coverage (SAT friendliness)', () => {
  it('19 labelled agencies is reported as editorial coverage, not a score', () => {
    const r = measureCoverage({
      kind: 'editorial', covered: 19, denominator: 307,
      basis: 'hand-authored SAT labels vs agencies in agency-pain-points (Phase 0A/0C)',
    });
    expect(r.kind).toBe('editorial');
    expect(r.state).toBe('measured');
    expect(describeCoverage(r)).toContain('absence is uncovered, not negative');
  });

  it('zero editorial labels is UNCOVERED, never 0% and never negative', () => {
    const r = measureCoverage({ kind: 'editorial', covered: 0, denominator: 307, basis: 'no labels' });
    expect(r.state).toBe('uncovered');
    expect(r.percent).toBeNull();          // not 0
    expect(describeCoverage(r)).toContain('not 0%');
  });
});

describe('C5 — HARD RULE: no denominator, no percentage', () => {
  it('an undefined denominator yields percent = null, never a fabricated share', () => {
    const r = measureCoverage({
      kind: 'enrichment', covered: 40, denominator: null,
      basis: 'overlay emails with no agreed denominator',
    });
    expect(r.percent).toBeNull();
    expect(r.denominator).toBeNull();
    expect(describeCoverage(r)).toContain('denominator undefined');
  });

  it('a zero denominator does not divide into a percentage', () => {
    const r = measureCoverage({ kind: 'enrichment', covered: 0, denominator: 0, basis: 'empty' });
    expect(r.percent).toBeNull();
  });
});

describe('C5 — HARD RULE: unavailable is never 0%', () => {
  it('an unreachable source returns unavailable with null counts', () => {
    const r = measureCoverage({
      kind: 'population', storeId: 'recipients_rollup_merged',
      covered: null, denominator: null, basis: 'BigQuery', sourceUnavailable: true,
    });
    expect(r.state).toBe('unavailable');
    expect(r.percent).toBeNull();
    expect(r.covered).toBeNull();
    expect(describeCoverage(r)).toContain('not 0%');
  });
});

describe('C5 — partial coverage honestly represented stays VALID (Phase 0C pop_state)', () => {
  it('pop_state at 34.3% is measured and honest — not a failure state', () => {
    const r = measureCoverage({
      kind: 'enrichment', covered: 12_252, denominator: 35_743,
      basis: 'sam_opportunities.pop_state on active rows; SAM omits it on ~64% of notices (documented)',
      measuredAt: '2026-09-12',
    });
    expect(r.state).toBe('measured');
    expect(r.percent).toBe(34.3);
    expect(r.basis).toContain('documented');
  });
});

describe('C5 + C2 — a hardcoded claim contradicted by measurement is rejected', () => {
  it('registry.ts coveragePercent: 95 is contradicted by the measured enrichment coverage', () => {
    // C2 (Phase 1) owns the gate; C5 supplies the measurement it is judged against.
    const measured = measureCoverage({
      kind: 'enrichment', storeId: 'contractors.json',
      covered: 72, denominator: 2_768, basis: 'best contact field in the overlay',
    });
    const HARDCODED_CLAIM = 95;
    expect(measured.percent).not.toBeNull();
    expect(Math.abs(HARDCODED_CLAIM - measured.percent!)).toBeGreaterThan(15);
  });
});
