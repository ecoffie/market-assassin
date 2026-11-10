import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  STATUS_FLIP_CAP, coveredWindow, executeStatusReconcile, planStatusReconcile, restoreStatement, samActiveFlag,
  statusReconcileMode, summarizePlan, type ActiveRow, type ReconcileDeps, type ReturnedNotice, type RunCoverage,
} from './status-reconcile';

const NOW = new Date('2026-11-10T01:05:00Z');
const WINDOW = coveredWindow(new Date('2026-11-10T01:00:00Z'), 30);

const row = (id: string, o: Partial<ActiveRow> = {}): ActiveRow => ({
  id: `opp-${id}`, notice_id: id, solicitation_number: null, posted_date: '2026-10-20T00:00:00.000Z',
  archive_date: '2026-12-31T00:00:00.000Z', response_deadline: '2026-12-01T00:00:00.000Z', ...o,
});
const ret = (id: string, o: Partial<ReturnedNotice> = {}): ReturnedNotice => ({
  notice_id: id, solicitation_number: null, posted_date: '2026-10-20T00:00:00.000Z', active: true, ...o,
});
const cov = (returned: ReturnedNotice[], o: Partial<RunCoverage> = {}): RunCoverage => ({
  runId: 'run-1', syncType: 'full', complete: true, window: WINDOW,
  returned: new Map(returned.map((n) => [n.notice_id, n])), ...o,
});

describe('mode + window', () => {
  it('defaults to report; apply and off must be explicit', () => {
    expect(statusReconcileMode(undefined)).toBe('report');
    expect(statusReconcileMode('')).toBe('report');
    expect(statusReconcileMode('yes')).toBe('report');
    expect(statusReconcileMode(' APPLY ')).toBe('apply');
    expect(statusReconcileMode('off')).toBe('off');
  });
  it('covered window excludes both boundary days', () => {
    expect(WINDOW).toEqual({ from: '2026-10-12', to: '2026-11-09' });
  });
});

describe('R1: SAM active = No deactivates through the ordinary upsert', () => {
  it('maps SAM active values', () => {
    expect(samActiveFlag('Yes')).toBe(true);
    expect(samActiveFlag(true)).toBe(true);
    expect(samActiveFlag('No')).toBe(false);
    expect(samActiveFlag(undefined)).toBe(false);
  });
  it('the sync route uses it, and the plan counts returned-inactive notices', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/api/cron/sync-sam-opportunities/route.ts'), 'utf8');
    expect(src).toMatch(/active: samActiveFlag\(opp\.active\)/);
    const p = planStatusReconcile([], cov([ret('a', { active: false }), ret('b')]), NOW);
    expect(p.samInactiveReturned).toBe(1);
  });
});

describe('R2: absent from a complete covering run + archive passed', () => {
  it('deactivates', () => {
    const p = planStatusReconcile([row('x', { archive_date: '2026-11-01T00:00:00.000Z' })], cov([]), NOW);
    expect(p.deactivate.map((d) => [d.notice_id, d.rule])).toEqual([['x', 'R2_absent_archive_passed']]);
    expect(p.deactivate[0].evidence).toMatchObject({ run_id: 'run-1', window: WINDOW, archive_date: '2026-11-01T00:00:00.000Z' });
  });
  it('a returned notice is never a candidate, whatever its dates', () => {
    const p = planStatusReconcile([row('x', { archive_date: '2026-11-01T00:00:00.000Z' })], cov([ret('x')]), NOW);
    expect(p.deactivate).toEqual([]); expect(p.held).toEqual([]);
  });
  it('rows posted outside the covered window (incl. boundary days) are untouched', () => {
    const rows = [
      row('old', { posted_date: '2026-09-01T00:00:00.000Z', archive_date: '2026-10-01T00:00:00.000Z' }),
      row('edgeFrom', { posted_date: '2026-10-11T00:00:00.000Z', archive_date: '2026-10-30T00:00:00.000Z' }),
      row('edgeTo', { posted_date: '2026-11-10T00:00:00.000Z', archive_date: '2026-11-10T00:00:00.000Z' }),
      row('noPosted', { posted_date: null, archive_date: '2026-10-01T00:00:00.000Z' }),
    ];
    const p = planStatusReconcile(rows, cov([]), NOW);
    expect(p.deactivate).toEqual([]); expect(p.held).toEqual([]);
  });
});

describe('R3: absent + newer version of the same confirmed solicitation returned', () => {
  it('deactivates and records the newer notice', () => {
    const p = planStatusReconcile(
      [row('old', { solicitation_number: 'W912HV26BA019', posted_date: '2026-10-15T00:00:00.000Z' })],
      cov([ret('new', { solicitation_number: 'w912hv26ba019', posted_date: '2026-10-28T00:00:00.000Z' })]), NOW);
    expect(p.deactivate).toHaveLength(1);
    expect(p.deactivate[0]).toMatchObject({ rule: 'R3_absent_superseded', evidence: { newer_notice_id: 'new', newer_posted_date: '2026-10-28' } });
  });
  it('an OLDER returned sibling is not evidence → held', () => {
    const p = planStatusReconcile(
      [row('mine', { solicitation_number: 'W912HV26BA019', posted_date: '2026-10-28T00:00:00.000Z' })],
      cov([ret('older', { solicitation_number: 'W912HV26BA019', posted_date: '2026-10-15T00:00:00.000Z' })]), NOW);
    expect(p.deactivate).toEqual([]);
    expect(p.held[0].hold_reason).toBe('absent_open_no_newer_version');
  });
  it('a same-day sibling is not "newer" → held with its own reason', () => {
    const p = planStatusReconcile(
      [row('a', { solicitation_number: 'W912HV26BA019' })], cov([ret('b', { solicitation_number: 'W912HV26BA019' })]), NOW);
    expect(p.held[0].hold_reason).toBe('absent_same_day_sibling_only');
  });
  it('blank / non-identifier solicitation numbers are never linked', () => {
    const rows = [row('a', { solicitation_number: null }), row('b', { solicitation_number: '   ' }), row('c', { solicitation_number: 'N/A' })];
    const returned = [ret('z1', { solicitation_number: null, posted_date: '2026-11-05T00:00:00.000Z' }),
      ret('z2', { solicitation_number: 'N/A', posted_date: '2026-11-05T00:00:00.000Z' })];
    const p = planStatusReconcile(rows, cov(returned), NOW);
    expect(p.deactivate).toEqual([]);
    expect(p.held.map((h) => h.hold_reason)).toEqual(Array(3).fill('absent_no_confirmed_solicitation'));
  });
});

describe('hold path + run qualification', () => {
  it('absent, open, no newer version → held (the 34 class), never flipped', () => {
    const p = planStatusReconcile([row('x', { solicitation_number: 'FA860126R0001' })], cov([]), NOW);
    expect(p.deactivate).toEqual([]);
    expect(p.held).toMatchObject([{ notice_id: 'x', decision: 'held', hold_reason: 'absent_open_no_newer_version' }]);
  });
  it('an incomplete run (failed page / short fetch) yields no absence evidence at all', () => {
    const p = planStatusReconcile([row('x', { archive_date: '2026-11-01T00:00:00.000Z' })], cov([], { complete: false }), NOW);
    expect(p.skipped).toMatch(/incomplete/); expect(p.deactivate).toEqual([]); expect(p.held).toEqual([]);
  });
  it('non-full runs (delta/resume) are not covering runs', () => {
    expect(planStatusReconcile([row('x')], cov([], { syncType: 'delta' }), NOW).skipped).toMatch(/not a full/);
  });
  it('route only marks a run complete when nothing failed, nothing was limited, and fetched >= available', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/api/cron/sync-sam-opportunities/route.ts'), 'utf8');
    expect(src).toMatch(/const complete = isFullSuccess && !limitParam && totalAvailable > 0 && totalFetched >= totalAvailable;/);
    expect(src).toMatch(/\.eq\('active', true\)\.lt\('synced_at', since\)/);
    expect(src).toMatch(/statusReconcileMode\(process\.env\.SAM_STATUS_RECONCILE\)/);
  });
  it('cap: more than STATUS_FLIP_CAP eligible marks the plan capExceeded', () => {
    const rows = Array.from({ length: 5 }, (_, i) => row(`r${i}`, { archive_date: '2026-11-01T00:00:00.000Z' }));
    expect(planStatusReconcile(rows, cov([]), NOW, 4).capExceeded).toBe(true);
    expect(planStatusReconcile(rows, cov([]), NOW, 5).capExceeded).toBe(false);
    expect(STATUS_FLIP_CAP).toBe(2000);
  });
});

function fakeDeps(o: { auditError?: string; flipError?: string; flipNull?: boolean } = {}) {
  const calls = { audit: 0, auditRows: 0, flips: [] as string[][], marked: [] as string[] };
  const deps: ReconcileDeps = {
    writeAudit: async (rows) => { calls.audit++; calls.auditRows += rows.length; return { error: o.auditError ? { message: o.auditError } : null }; },
    flipChunk: async (ids) => { calls.flips.push(ids); if (o.flipError) return { flipped: null, error: { message: o.flipError } };
      return { flipped: o.flipNull ? null : ids.slice(0, ids.length - 1 >= 0 && ids.length > 1 ? ids.length - 1 : ids.length), error: null }; },
    markApplied: async (_run, ids) => { calls.marked.push(...ids); return { error: null }; },
  };
  return { deps, calls };
}
const mixedPlan = () => planStatusReconcile(
  [row('a', { archive_date: '2026-11-01T00:00:00.000Z' }), row('b', { archive_date: '2026-11-02T00:00:00.000Z' }), row('h', { solicitation_number: 'FA860126R0001' })],
  cov([]), NOW);

describe('execution', () => {
  it('report-only writes the audit but never flips', async () => {
    const { deps, calls } = fakeDeps();
    const out = await executeStatusReconcile(mixedPlan(), 'report', 'run-1', NOW.toISOString(), deps);
    expect(calls.flips).toEqual([]);
    expect(calls.auditRows).toBe(3);
    expect(out).toMatchObject({ deactivated: 0, auditWritten: 3, applyBlocked: null });
  });
  it('off does nothing', async () => {
    const { deps, calls } = fakeDeps();
    await executeStatusReconcile(mixedPlan(), 'off', 'run-1', NOW.toISOString(), deps);
    expect(calls.audit).toBe(0); expect(calls.flips).toEqual([]);
  });
  it('apply flips only R2/R3 rows, counts what the CAS actually changed, and marks the rollback record', async () => {
    const { deps, calls } = fakeDeps();
    const out = await executeStatusReconcile(mixedPlan(), 'apply', 'run-1', NOW.toISOString(), deps);
    expect(calls.flips).toEqual([['opp-a', 'opp-b']]);
    expect(out.deactivated).toBe(1); // CAS changed one of two (the other was re-synced / already inactive)
    expect(calls.marked).toEqual(['opp-a']);
  });
  it('cap exceeded applies nothing', async () => {
    const { deps, calls } = fakeDeps();
    const plan = { ...mixedPlan(), capExceeded: true };
    const out = await executeStatusReconcile(plan, 'apply', 'run-1', NOW.toISOString(), deps);
    expect(calls.flips).toEqual([]); expect(out.applyBlocked).toMatch(/cap exceeded/); expect(out.deactivated).toBe(0);
  });
  it('no audit, no flip', async () => {
    const { deps, calls } = fakeDeps({ auditError: 'relation "sam_status_decisions" does not exist' });
    const out = await executeStatusReconcile(mixedPlan(), 'apply', 'run-1', NOW.toISOString(), deps);
    expect(calls.flips).toEqual([]); expect(out.applyBlocked).toMatch(/no audit, no flip/); expect(out.auditWritten).toBeNull();
  });
  it('a failed or unknown flip result is reported as unknown, never 0', async () => {
    for (const o of [{ flipError: 'statement timeout' }, { flipNull: true }]) {
      const { deps } = fakeDeps(o);
      const out = await executeStatusReconcile(mixedPlan(), 'apply', 'run-1', NOW.toISOString(), deps);
      expect(out.deactivated).toBeNull(); expect(out.errors.join()).toMatch(/flip failed/);
    }
  });
  it('a skipped plan (incomplete run) writes nothing in any mode', async () => {
    const { deps, calls } = fakeDeps();
    const plan = planStatusReconcile([row('a', { archive_date: '2026-11-01T00:00:00.000Z' })], cov([], { complete: false }), NOW);
    await executeStatusReconcile(plan, 'apply', 'run-1', NOW.toISOString(), deps);
    expect(calls.audit).toBe(0); expect(calls.flips).toEqual([]);
  });
});

describe('report + rollback', () => {
  it('summarizes by rule and hold reason with samples', () => {
    const s = summarizePlan(mixedPlan(), 'report');
    expect(s).toMatchObject({ mode: 'report', wouldDeactivate: 2, held: 1, capExceeded: false,
      byRule: { R2_absent_archive_passed: { count: 2, sample: ['a', 'b'] } },
      byHoldReason: { absent_open_no_newer_version: { count: 1, sample: ['h'] } } });
  });
  it('restore statement only touches rows this run actually flipped', () => {
    expect(restoreStatement('run-9')).toBe("update sam_opportunities set active = true where id in (select opp_id from sam_status_decisions where run_id = 'run-9' and applied) and active = false;");
  });
});
