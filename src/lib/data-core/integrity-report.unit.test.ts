import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { classifyAdvancement, ADVANCEMENT_ORACLES } from './advancement';
import { classifyProducer, LINEAGE_CLAIMS } from './producer-lineage';
import { measureCoverage, describeCoverage } from './coverage';

const SRC = readFileSync('src/lib/data-core/integrity-report.ts', 'utf8');
const ROUTE = readFileSync('src/app/api/admin/platform-health/route.ts', 'utf8');

describe('Phase 3 — the controls have real callers', () => {
  it('C1 is called by the integrity report', () => {
    expect(SRC).toContain('classifyAdvancement');
    expect(SRC).toContain('ADVANCEMENT_ORACLES');
  });
  it('C4 is called by the integrity report', () => {
    expect(SRC).toContain('classifyProducer');
    expect(SRC).toContain('LINEAGE_CLAIMS');
  });
  it('C5 is called by the integrity report', () => {
    expect(SRC).toContain('measureCoverage');
  });
  it('C2 and C3 are CONSUMED, not reimplemented', () => {
    // The controls are IMPORTED from their own modules. (They used to be spawned as
    // CLI subprocesses; that dynamic scripts/ path broke the production Turbopack
    // build. The single-source-of-truth principle is unchanged — only the delivery.)
    expect(SRC).toContain('computeClaimFindings');
    expect(SRC).toContain('reconcileRegistries');
    // no duplicated classification logic
    expect(SRC).not.toContain('coveragePercent:\\s*(');
    expect(SRC).not.toContain('function classifyRegistryRow');
  });

  /**
   * THE BUILD BOUNDARY. A bundled server module must never reach into repo CLI
   * files: Turbopack cannot statically resolve it and FAILED the production build.
   * Pins the repair so the subprocess seam cannot return.
   */
  it('Platform Health does NOT spawn repo CLI scripts', () => {
    expect(SRC).not.toContain('execFileSync');
    expect(SRC).not.toContain('child_process');
    expect(SRC).not.toMatch(/join\([^)]*['"]scripts['"]/);
    expect(SRC).not.toContain('--json');   // no parsing of its own repo's stdout
  });

  /** ONE implementation, TWO consumers — the CLIs must use the same modules. */
  it('the CLI wrappers import the same shared classifiers', () => {
    const c2 = readFileSync(join(process.cwd(), 'scripts/audit-data-claims.mjs'), 'utf8');
    const c3 = readFileSync(join(process.cwd(), 'scripts/registry-reconciliation.mjs'), 'utf8');
    expect(c2).toContain('claims-audit.mjs');
    expect(c2).toContain('computeClaimFindings');
    expect(c3).toContain('registry-reconcile.mjs');
    expect(c3).toContain('reconcileRegistries');
  });
  it('Platform Health renders it', () => {
    expect(ROUTE).toContain('getDataCoreIntegrity');
    expect(ROUTE).toContain('dataCoreIntegrity');
  });
});

describe('Phase 3 — Platform Health is a READER, not a second source of truth', () => {
  it('no hand-entered status strings in the report module', () => {
    // statuses must come from the control enums, never typed as display literals
    for (const literal of ["'Healthy'", "'Manual'", "'Missing'", "'Proven'", "'Fresh'"]) {
      expect(SRC).not.toContain(literal);
    }
  });
  it('no hand-entered counts or dates', () => {
    // the census figures must not be transcribed into the reader
    for (const n of ['2,768', '296,445', '19 agencies', '34.3']) {
      expect(SRC).not.toContain(n);
    }
  });
  it('declares that nothing is hand-entered', () => {
    expect(SRC).toContain('no value here is hand-entered');
  });
});

describe('Phase 3 — semantics are never collapsed (verification #6-#10)', () => {
  it('#6 an unmeasured C1 result renders unmeasured, not stale', () => {
    const r = classifyAdvancement({ oracle: ADVANCEMENT_ORACLES[0], observed: null });
    expect(r.status).toBe('unmeasured');
    expect(r.status).not.toBe('upstream_stale');
  });

  it('#7 a manual producer renders manual, not broken', () => {
    const r = classifyProducer(LINEAGE_CLAIMS.find((c) => c.key === 'tier2_sblo')!);
    expect(r.status).toBe('producer_manual');
    expect(r.detail).not.toMatch(/broken/i);
  });

  it('#8 a missing producer renders missing, not stale', () => {
    const r = classifyProducer(LINEAGE_CLAIMS.find((c) => c.key === 'contractors.json')!);
    expect(r.status).toBe('producer_missing');
    expect(r.detail).not.toMatch(/stale/i);
  });

  it('#9 editorial uncovered renders uncovered, not 0%', () => {
    const r = measureCoverage({ kind: 'editorial', covered: 0, denominator: 307, basis: 'x' });
    expect(r.state).toBe('uncovered');
    expect(r.percent).toBeNull();
    expect(describeCoverage(r)).toContain('not 0%');
  });

  it('#10 an undefined denominator cannot render a percentage', () => {
    const r = measureCoverage({ kind: 'enrichment', covered: 40, denominator: null, basis: 'x' });
    expect(r.percent).toBeNull();
  });

  it('an unavailable source is unavailable, never 0%', () => {
    const r = measureCoverage({
      kind: 'population', storeId: 'recipients_rollup_merged',
      covered: null, denominator: null, basis: 'x', sourceUnavailable: true,
    });
    expect(r.state).toBe('unavailable');
    expect(r.percent).toBeNull();
  });
});

describe('Phase 3 — no all-clear while anything is unverified', () => {
  it('the report exposes anyUnmeasured so the UI cannot paint everything healthy', () => {
    expect(SRC).toContain('anyUnmeasured');
    expect(SRC).toContain('an all-clear');
  });
  it('there is no composite score anywhere', () => {
    expect(SRC).not.toMatch(/healthScore|overallScore|scorePercent/);
    expect(SRC).toContain('NOT a score');
  });
});

describe('Phase 3 — evidence travels with every status', () => {
  it('every advancement result names the watermark used', () => {
    const r = classifyAdvancement({
      oracle: ADVANCEMENT_ORACLES[0], observed: '2026-09-12', now: '2026-09-12T12:00:00Z',
    });
    expect(r.detail).toContain(ADVANCEMENT_ORACLES[0].column);
  });
  it('every producer result carries its evidence citation', () => {
    for (const c of LINEAGE_CLAIMS) {
      expect(classifyProducer(c).detail.length).toBeGreaterThan(20);
    }
  });
  it('every coverage result carries an explicit basis', () => {
    const r = measureCoverage({ kind: 'enrichment', covered: 40, denominator: 2768, basis: 'email in overlay' });
    expect(r.basis).toBeTruthy();
    expect(describeCoverage(r)).toContain('2,768');
  });
});
