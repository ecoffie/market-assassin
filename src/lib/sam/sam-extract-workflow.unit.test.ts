/**
 * Monthly SAM entity extract workflow helpers (Agent 4 / Eric, 2026-11-25).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// @ts-expect-error — plain .mjs helper, no types
import { newestMonthlyExtractName } from '../../../scripts/sam-extract-file-name.mjs';
// @ts-expect-error — plain .mjs helper, no types
import { gateReconciliation } from '../../../scripts/sam-extract-dry-run-gate.mjs';

const day = (s: string) => new Date(`${s}T12:00:00Z`);

describe('newest monthly extract name (first Sunday of the month)', () => {
  it('matches the known file and November 2026', () => {
    expect(newestMonthlyExtractName(day('2026-05-10'))).toBe('SAM_PUBLIC_MONTHLY_V2_20260503.ZIP');
    expect(newestMonthlyExtractName(day('2026-11-25'))).toBe('SAM_PUBLIC_MONTHLY_V2_20261101.ZIP');
  });
  it('on or before the first Sunday, the newest is last month\'s (never races publication)', () => {
    expect(newestMonthlyExtractName(day('2026-11-01'))).toBe('SAM_PUBLIC_MONTHLY_V2_20261004.ZIP');
    expect(newestMonthlyExtractName(day('2027-01-02'))).toBe('SAM_PUBLIC_MONTHLY_V2_20261206.ZIP');
  });
});

const block = (o: { mismatch?: boolean; failed?: number; kept?: number; dry?: boolean } = {}) => `
=== IMPORT RECONCILIATION ===
lines read              900,010
  accounted             900,010  ${o.mismatch ? 'MISMATCH — investigate' : 'BALANCES'}
kept (matched filter)   ${(o.kept ?? 895_000).toLocaleString('en-US')}
  failed (dead-letter)  ${o.failed ?? 0}
  accounted             895,000  BALANCES
REGISTRY CHANGE${o.dry === false ? '' : ' (DRY RUN — nothing written; "upserted" = would upsert)'}
`;

describe('dry-run gate', () => {
  it('a balanced full-registry dry run passes', () => {
    expect(gateReconciliation(block())).toEqual([]);
  });
  it('MISMATCH, dead-lettered rows, a seed-NAICS-only run, or a missing block all abort', () => {
    expect(gateReconciliation(block({ mismatch: true })).join(' ')).toMatch(/MISMATCH/);
    expect(gateReconciliation(block({ failed: 500 })).join(' ')).toMatch(/dead-lettered/);
    expect(gateReconciliation(block({ kept: 12_000 })).join(' ')).toMatch(/--all-naics/);
    expect(gateReconciliation('FATAL download failed: HTTP 403')).not.toEqual([]);
  });
  it('a real-run log is checked with --real (no DRY RUN marker required)', () => {
    expect(gateReconciliation(block({ dry: false }), { real: true })).toEqual([]);
    expect(gateReconciliation(block({ dry: false }))).toContain('not a dry-run report');
  });
});

describe('workflow safety', () => {
  const wf = readFileSync(join(process.cwd(), '.github/workflows/sam-entity-extract.yml'), 'utf8');
  it('dry run first; the real import only on apply (dispatch, or schedule with SAM_EXTRACT_AUTO_APPLY=on)', () => {
    expect(wf.indexOf('Dry run (zero writes)')).toBeLessThan(wf.indexOf('Real import'));
    expect(wf).toMatch(/vars\.SAM_EXTRACT_AUTO_APPLY == 'on' && 'apply' \|\| 'plan'/);
    expect(wf).toMatch(/if: steps\.gate\.outputs\.run == 'yes' && env\.MODE == 'apply'/);
  });
  it('the key is masked and never echoed; --all-naics on both runs', () => {
    expect(wf.match(/::add-mask::\$SAM_API_KEY/g)?.length).toBe(2);
    expect(wf).not.toMatch(/echo[^\n]*\$SAM_API_KEY(?!")/);
    expect(wf.match(/--all-naics/g)?.length).toBeGreaterThanOrEqual(2);
  });
  it('the uploaded artifact is logs only, never the ZIP', () => {
    expect(wf).toMatch(/runner\.temp \}\}\/sam\/\*\.log/);
  });
});
