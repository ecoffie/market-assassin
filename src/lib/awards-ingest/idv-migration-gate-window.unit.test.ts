/**
 * X1 regression (tasks/bq-awards-a1-preflight-2026-10-04.md): the pre-auth dispatch gate
 * `scripts/validate-bq-awards-idv-migration-dispatch.ts` hand-mapped its env and omitted
 * window_from / window_to, so EVERY repull_window dispatch was refused before GCP auth — even the
 * two reviewed A1 windows. The pure validator was tested; the gate script that feeds it was not.
 *
 * This file therefore tests three layers: the validator's window contract, the ONE shared
 * env → input mapping, and the real gate script executed as a subprocess (offline: it runs before
 * auth and touches no network). Plus pins that the bq-production protection is unchanged.
 */
import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  IDV_MIGRATION_REPULL_FROM,
  idvMigrationDispatchFromEnv,
  validateIdvMigrationDispatch,
} from './idv-migration-control';

const root = process.cwd();
const workflow = readFileSync(join(root, '.github/workflows/bq-awards-idv-migration.yml'), 'utf8');
const gateSrc = readFileSync(join(root, 'scripts/validate-bq-awards-idv-migration-dispatch.ts'), 'utf8');
const runnerSrc = readFileSync(join(root, 'scripts/bq-awards-idv-migration.ts'), 'utf8');

const TODAY = '2026-10-04';
const C = 'IDV-MIGRATION-repull_window';
const base = { eventName: 'workflow_dispatch', hasGcpSaJson: true, today: TODAY, step: 'repull_window', confirmation: C };
const v = (windowFrom?: string, windowTo?: string) => validateIdvMigrationDispatch({ ...base, windowFrom, windowTo });

/** The two windows Eric approved for A1 (2026-10-04). */
const A1_WINDOWS: Array<[string, string]> = [['2026-01-20', '2026-03-21'], ['2026-03-22', '2026-05-03']];

describe('repull_window — the explicit bounded window contract', () => {
  it('the approved A1 windows pass and are returned verbatim', () => {
    for (const [from, to] of A1_WINDOWS) expect(v(from, to).window).toEqual({ from, to });
  });

  it('boundary values pass: from == the reviewed start, to == today, a single day, exactly 62 days', () => {
    expect(v(IDV_MIGRATION_REPULL_FROM, '2026-01-20').window).toEqual({ from: '2026-01-20', to: '2026-01-20' });
    expect(v('2026-08-03', TODAY).window).toEqual({ from: '2026-08-03', to: TODAY }); // 62 days
  });

  it('missing start or end refuses (no implicit "to today")', () => {
    for (const [from, to] of [[undefined, '2026-03-21'], ['2026-01-20', undefined], ['', '2026-03-21'], ['2026-01-20', ''], ['  ', '  '], [undefined, undefined]] as const) {
      expect(() => v(from, to)).toThrow(/refused: repull_window needs BOTH window_from and window_to/);
    }
  });

  it('malformed dates refuse — wrong shape AND impossible calendar days', () => {
    for (const [from, to] of [
      ['2026-1-20', '2026-03-21'], ['2026-01-20', '03/21/2026'], ['20260120', '2026-03-21'],
      ['2026-02-30', '2026-03-21'], ['2026-01-20', '2026-02-29'], ['2026-13-01', '2026-03-21'],
      ['bad', '2026-03-21'], ['2026-01-20T00:00:00Z', '2026-03-21'],
    ]) {
      expect(() => v(from, to)).toThrow(/refused: window_from and window_to must be real calendar dates/);
    }
  });

  it('a reversed range refuses', () => {
    expect(() => v('2026-03-21', '2026-01-20')).toThrow(/refused: window_to is before window_from/);
    expect(() => v('2026-05-03', '2026-03-22')).toThrow(/refused: window_to is before window_from/);
  });

  it('a range outside the approved bounds refuses', () => {
    expect(() => v('2026-01-19', '2026-03-21')).toThrow(/refused: window_from must be >= 2026-01-20/);
    expect(() => v('2025-10-01', '2025-11-01')).toThrow(/refused: window_from must be >= 2026-01-20/);
    expect(() => v('2026-09-20', '2026-10-05')).toThrow(/refused: window_to is after today/);
    expect(v('2026-01-20', '2026-03-23').window).toEqual({ from: '2026-01-20', to: '2026-03-23' }); // exactly 62 days: allowed
    expect(() => v('2026-01-20', '2026-03-24')).toThrow(/refused: window spans 63 days \(max 62\)/);
    expect(() => v('2026-01-20', '2026-05-03')).toThrow(/split it/); // the whole A1 range in one go
  });
});

describe('other steps keep their existing validation', () => {
  const steps = ['preflight', 'snapshot', 'ddl', 'verify', 'idv_fy_backfill'] as const;

  it('every non-repull step still refuses window inputs', () => {
    for (const step of steps) {
      const d = { eventName: 'workflow_dispatch', hasGcpSaJson: true, today: TODAY, step, confirmation: `IDV-MIGRATION-${step}`, fiscalYear: step === 'idv_fy_backfill' ? '2024' : undefined };
      expect(() => validateIdvMigrationDispatch({ ...d, windowFrom: '2026-01-20' })).toThrow(/only valid for repull_window/);
      expect(() => validateIdvMigrationDispatch({ ...d, windowTo: '2026-03-21' })).toThrow(/only valid for repull_window/);
      expect(validateIdvMigrationDispatch(d).window).toBeNull();
    }
  });

  it('confirmation, trigger, secret and fiscal-year rules are unchanged', () => {
    const [from, to] = A1_WINDOWS[0];
    expect(() => validateIdvMigrationDispatch({ ...base, confirmation: 'IDV-MIGRATION-ddl', windowFrom: from, windowTo: to })).toThrow(/exact typed confirmation/);
    expect(() => validateIdvMigrationDispatch({ ...base, confirmation: undefined, windowFrom: from, windowTo: to })).toThrow(/exact typed confirmation/);
    for (const eventName of ['schedule', 'push', 'pull_request', '']) {
      expect(() => validateIdvMigrationDispatch({ ...base, eventName, windowFrom: from, windowTo: to })).toThrow(/only on workflow_dispatch/);
    }
    expect(() => validateIdvMigrationDispatch({ ...base, hasGcpSaJson: false, windowFrom: from, windowTo: to })).toThrow(/GCP_SA_JSON/);
    expect(() => validateIdvMigrationDispatch({ ...base, fiscalYear: '2024', windowFrom: from, windowTo: to })).toThrow(/fiscal_year is only valid/);
    const fy = { eventName: 'workflow_dispatch', hasGcpSaJson: true, today: TODAY, step: 'idv_fy_backfill', confirmation: 'IDV-MIGRATION-idv_fy_backfill' };
    expect(validateIdvMigrationDispatch({ ...fy, fiscalYear: '2024' }).fiscalYear).toBe(2024);
    expect(() => validateIdvMigrationDispatch({ ...fy, fiscalYear: '2026' })).toThrow(/fiscal_year/);
  });
});

describe('ONE env → input mapping, shared by the gate and the runner', () => {
  it('maps every workflow input, including both window ends', () => {
    expect(idvMigrationDispatchFromEnv({
      GITHUB_EVENT_NAME: 'workflow_dispatch', IDV_MIGRATION_STEP: 'repull_window', IDV_MIGRATION_CONFIRMATION: C,
      IDV_MIGRATION_FISCAL_YEAR: '', IDV_MIGRATION_WINDOW_FROM: '2026-01-20', IDV_MIGRATION_WINDOW_TO: '2026-03-21',
    }, true)).toEqual({
      eventName: 'workflow_dispatch', step: 'repull_window', confirmation: C, fiscalYear: '',
      windowFrom: '2026-01-20', windowTo: '2026-03-21', hasGcpSaJson: true,
    });
  });

  it('neither script hand-maps the env any more (the drift that caused X1)', () => {
    for (const src of [gateSrc, runnerSrc]) {
      expect(src).toContain('idvMigrationDispatchFromEnv(process.env,');
      expect(src).not.toMatch(/windowFrom:\s*process\.env/);
      expect(src).not.toMatch(/step:\s*process\.env\.IDV_MIGRATION_STEP/);
    }
  });
});

describe('the real gate script (subprocess, offline — runs before GCP auth)', () => {
  const run = (env: Record<string, string>) => new Promise<{ code: number | null; out: string }>((resolve, reject) => {
    const child = spawn(join(root, 'node_modules/.bin/tsx'), ['scripts/validate-bq-awards-idv-migration-dispatch.ts'], {
      cwd: root,
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', GITHUB_EVENT_NAME: 'workflow_dispatch', HAS_GCP_SA_JSON: 'true', ...env },
    });
    let out = '';
    child.stdout.on('data', (b) => { out += b; });
    child.stderr.on('data', (b) => { out += b; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, out }));
  });
  const repull = (from: string, to: string) => run({
    IDV_MIGRATION_STEP: 'repull_window', IDV_MIGRATION_CONFIRMATION: C, IDV_MIGRATION_WINDOW_FROM: from, IDV_MIGRATION_WINDOW_TO: to,
  });

  it('passes both approved A1 windows (this exited 1 before the fix)', async () => {
    for (const [from, to] of A1_WINDOWS) {
      const r = await repull(from, to);
      expect(r.out).toContain(`step=repull_window window=${from}..${to}`);
      expect(r.code).toBe(0);
    }
  }, 60_000);

  it('refuses a missing end, a malformed date, a reversed and an out-of-bounds window', async () => {
    const cases: Array<[string, string, RegExp]> = [
      ['2026-01-20', '', /needs BOTH window_from and window_to/],
      ['2026-02-30', '2026-03-21', /real calendar dates/],
      ['2026-03-21', '2026-01-20', /before window_from/],
      ['2026-01-19', '2026-03-21', /must be >= 2026-01-20/],
    ];
    for (const [from, to, why] of cases) {
      const r = await repull(from, to);
      expect(r.code).toBe(1);
      expect(r.out).toMatch(why);
    }
  }, 60_000);

  it('still refuses windows on another step, and never echoes the confirmation', async () => {
    const r = await run({ IDV_MIGRATION_STEP: 'ddl', IDV_MIGRATION_CONFIRMATION: 'IDV-MIGRATION-ddl', IDV_MIGRATION_WINDOW_FROM: '2026-01-20', IDV_MIGRATION_WINDOW_TO: '2026-03-21' });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/only valid for repull_window/);
    const ok = await repull(...A1_WINDOWS[0]);
    expect(ok.out).not.toContain(C);
  }, 60_000);
});

describe('bq-production protection is not weakened', () => {
  it('the job still runs in the bq-production environment, dispatch-only', () => {
    expect(workflow).toMatch(/^\s+environment: bq-production$/m);
    expect(workflow).not.toMatch(/^\s{2}(schedule|push|pull_request|pull_request_target|workflow_run|repository_dispatch|workflow_call):/m);
  });

  it('the gate step receives both window inputs and still runs before GCP auth', () => {
    const gateStep = workflow.slice(workflow.indexOf('Fail-closed dispatch gate'), workflow.indexOf('google-github-actions/auth@'));
    expect(gateStep).toContain('IDV_MIGRATION_WINDOW_FROM: ${{ inputs.window_from }}');
    expect(gateStep).toContain('IDV_MIGRATION_WINDOW_TO: ${{ inputs.window_to }}');
    expect(gateStep).toContain('scripts/validate-bq-awards-idv-migration-dispatch.ts');
    expect(gateStep).not.toContain('GCP_SA_JSON: ${{ secrets.GCP_SA_JSON }}'); // the gate never sees the secret
  });
});
