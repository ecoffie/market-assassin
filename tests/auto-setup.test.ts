/**
 * Unit test — "Set up my Mindy" (Auto) data transforms + branch decisions.
 *
 * Locks the three rules that have actually bitten this route:
 *   1. merge keeps the HIGHEST set-aside-spend duplicate, sorted spend-desc
 *      (so the most relevant buyer wins when the same office appears under two
 *      NAICS codes);
 *   2. the row clamps a billions spend + rounds it, so a bigint/int column
 *      can't reject the row and fail the whole batch silently;
 *   3. an empty scan distinguishes "every scan errored" (502) from "genuinely
 *      no buyers" (200) — the original silent-failure fix.
 *
 * Runs against the LOCAL source (no server, no auth, no network) via Node type
 * stripping. Run: node --experimental-strip-types tests/auto-setup.test.ts
 *
 * Named *.test.ts so the Next/tsc build excludes it (tsconfig exclude).
 */
import {
  MAX_AGENCIES,
  SET_ASIDE_SPEND_CLAMP,
  type ScanAgency,
  mergeScanAgencies,
  buildTargetRow,
  summarizeEmptyScan,
} from '../src/lib/app/auto-setup.ts';

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean) {
  if (cond) { console.log(`✅ PASS: ${name}`); passed++; }
  else { console.log(`❌ FAIL: ${name}`); failed++; }
}

function agency(name: string, spend: number, extra: Partial<ScanAgency> = {}): ScanAgency {
  return { name, setAsideSpending: spend, ...extra };
}

console.log('==========================================');
console.log('Auto-Setup ("Set up my Mindy") - Unit Test');
console.log('==========================================\n');

// ── mergeScanAgencies: dedup + keep-highest-spend + sort ──────────────────────
console.log('-- mergeScanAgencies --');

{
  // Same agency + same office under two codes → ONE row, the higher spend wins.
  const merged = mergeScanAgencies([
    [agency('Navy', 1_000, { contractingOffice: 'NAVSUP' })],
    [agency('Navy', 5_000, { contractingOffice: 'NAVSUP' })],
  ]);
  check('duplicate (same name+office) collapses to one', merged.length === 1);
  check('keeps the higher-spend duplicate', merged[0].setAsideSpending === 5_000);
}

{
  // Same name, DIFFERENT office → two distinct buyers (office is part of the key).
  const merged = mergeScanAgencies([
    [agency('Army', 100, { contractingOffice: 'ACC-APG' })],
    [agency('Army', 200, { contractingOffice: 'ACC-RSA' })],
  ]);
  check('same agency, different office stays separate', merged.length === 2);
}

{
  // Output is sorted highest-spend first regardless of input order.
  const merged = mergeScanAgencies([
    [agency('Low', 10), agency('High', 900), agency('Mid', 400)],
  ]);
  check('sorted highest set-aside spend first',
    merged.map((a) => a.name).join(',') === 'High,Mid,Low');
}

{
  // Defensive: missing spend treated as 0, junk rows (no name) dropped, non-array safe.
  const merged = mergeScanAgencies([
    // @ts-expect-error — intentionally malformed input the route can receive
    null,
    [agency('Real', 0), { name: '', setAsideSpending: 999 } as ScanAgency],
  ]);
  check('drops nameless rows, tolerates non-array list',
    merged.length === 1 && merged[0].name === 'Real');
}

{
  check('empty input → empty output', mergeScanAgencies([]).length === 0);
}

// ── buildTargetRow: clamp + round + field mapping ─────────────────────────────
console.log('\n-- buildTargetRow --');

const ctx = { rowEmail: 'u@example.com', asClient: false, workspaceId: null, sourceNaics: '541512,541330' };

{
  const row = buildTargetRow(
    agency('DISA', 12_500_000_000.7, {
      contractingOffice: 'DITCO',
      agencyCode: '97',
      subAgency: 'Defense Information Systems Agency',
      officeId: 'HC1013',
      location: 'Fort Meade, MD',
      contractCount: 42.4,
    }),
    ctx,
  );
  check('clamps billions spend to the column-safe ceiling',
    row.set_aside_spending === SET_ASIDE_SPEND_CLAMP);
  check('rounds contract_count to an integer', row.contract_count === 42);
  check('maps office_name from contractingOffice', row.office_name === 'DITCO');
  check('carries sourceNaics through', row.source_naics === '541512,541330');
  check('stamps added_from=auto_setup', row.added_from === 'auto_setup');
  check('defaults status/priority', row.status === 'targeting' && row.priority === 'medium');
}

{
  // No office → office_name falls back to the agency name; spend under the clamp
  // is preserved (just rounded).
  const row = buildTargetRow(agency('NASA', 250_000.9), ctx);
  check('office_name falls back to agency name when no office',
    row.office_name === 'NASA');
  check('sub-clamp spend is preserved (rounded)', row.set_aside_spending === 250_001);
  check('missing spend/count never produce NaN',
    Number.isInteger(buildTargetRow(agency('X', NaN), ctx).set_aside_spending));
}

{
  // Coach Mode: as a client, the row carries the workspace_id; otherwise null.
  const clientRow = buildTargetRow(agency('VA', 1), {
    rowEmail: 'client@ws', asClient: true, workspaceId: 'ws-123', sourceNaics: null,
  });
  check('asClient row carries workspace_id', clientRow.workspace_id === 'ws-123');
  check('non-client row workspace_id is null', buildTargetRow(agency('VA', 1), ctx).workspace_id === null);
}

// ── summarizeEmptyScan: 502 (all failed) vs 200 (genuinely empty) ─────────────
console.log('\n-- summarizeEmptyScan --');

{
  // Every code errored → real failure, surface the first error as 502.
  const r = summarizeEmptyScan(['find-agencies 500', 'find-agencies 500', 'timeout'], 3);
  check('all scans errored → 502', r.status === 502);
  check('all-failed surfaces the first error', r.error.includes('find-agencies 500'));
}

{
  // Scans ran clean but matched nothing → genuine empty, 200 (not an error code).
  const r = summarizeEmptyScan([], 3);
  check('clean-but-empty → 200', r.status === 200);
  check('clean-but-empty uses the "no matching buying agencies" copy',
    r.error.toLowerCase().includes('no matching buying agencies'));
}

{
  // PARTIAL failure (some codes errored, but the merge was still empty) is NOT
  // "all failed" → treated as genuine empty (200), errors still echoed.
  const r = summarizeEmptyScan(['find-agencies 500'], 3);
  check('partial failure is not "all failed" → 200', r.status === 200);
  check('scanErrors are echoed back (capped at 3)', r.scanErrors.length === 1);
}

{
  const r = summarizeEmptyScan(['a', 'b', 'c', 'd', 'e'], 5);
  check('scanErrors capped at 3 in the response', r.scanErrors.length === 3);
}

// ── sanity on the seed cap ────────────────────────────────────────────────────
console.log('\n-- constants --');
check('MAX_AGENCIES seed cap is a positive integer',
  Number.isInteger(MAX_AGENCIES) && MAX_AGENCIES > 0);

// ── summary (machine-readable lines for run-all-tests.sh) ─────────────────────
console.log('\n==========================================');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log('==========================================');

process.exit(failed === 0 ? 0 : 1);
