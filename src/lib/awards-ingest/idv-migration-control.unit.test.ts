import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  assertFreshCloneGate,
  expectedIdvMigrationConfirmation,
  IDV_DDL_FILE,
  IDV_DDL_SHA256,
  IDV_MIGRATION_STEPS,
  IDV_MIGRATION_WRITE_STEPS,
  idvMigrationCloneTableId,
  ingestArgsForStep,
  validateIdvMigrationDispatch,
} from './idv-migration-control';

const root = process.cwd();
const workflow = readFileSync(join(root, '.github/workflows/bq-awards-idv-migration.yml'), 'utf8');
const weekly = readFileSync(join(root, '.github/workflows/bq-awards-ingest.yml'), 'utf8');
const runner = readFileSync(join(root, 'scripts/bq-awards-idv-migration.ts'), 'utf8');

const ok = { eventName: 'workflow_dispatch', hasGcpSaJson: true, today: '2026-09-23' };
const H = 3_600_000;
const NOW = Date.parse('2026-09-23T12:00:00Z');

describe('bq-awards-idv-migration.yml — inert until dispatched', () => {
  it('triggers ONLY on workflow_dispatch (no schedule / push / pull_request / workflow_run)', () => {
    const onBlock = workflow.slice(workflow.indexOf('\non:'), workflow.indexOf('\npermissions:'));
    expect(onBlock).toMatch(/^\s{2}workflow_dispatch:/m);
    for (const trigger of ['schedule', 'push', 'pull_request', 'pull_request_target', 'workflow_run', 'repository_dispatch', 'workflow_call']) {
      expect(workflow).not.toMatch(new RegExp(`^\\s{2}${trigger}:`, 'm'));
    }
    expect(workflow).not.toMatch(/cron:/);
  });

  it('requires the bq-production environment and shares the weekly ingest concurrency group', () => {
    expect(workflow).toMatch(/^\s+environment: bq-production$/m);
    expect(workflow).toMatch(/concurrency:\s*\n\s+group: bq-awards-ingest\s*\n\s+cancel-in-progress: false/);
    expect(weekly).toMatch(/group: bq-awards-ingest/);
  });

  it('pins every action to the same SHAs as bq-awards-ingest.yml', () => {
    const uses = (y: string) => Array.from(y.matchAll(/uses: ([\w./-]+)@([0-9a-f]{40})/g)).map((m) => `${m[1]}@${m[2]}`);
    const mine = uses(workflow);
    expect(mine.length).toBeGreaterThanOrEqual(4);
    for (const u of mine) expect(uses(weekly)).toContain(u);
    expect(workflow).not.toMatch(/uses: [\w./-]+@v\d/);
  });

  it('runs the dispatch gate after npm ci and BEFORE GCP auth / the migration script', () => {
    const npmCi = workflow.indexOf('- run: npm ci');
    const gate = workflow.indexOf('Fail-closed dispatch gate');
    const auth = workflow.indexOf('google-github-actions/auth@');
    const run = workflow.indexOf('scripts/bq-awards-idv-migration.ts');
    expect(npmCi).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(npmCi);
    expect(auth).toBeGreaterThan(gate);
    expect(run).toBeGreaterThan(auth);
    const gateBlock = workflow.slice(gate, auth);
    expect(gateBlock).not.toContain('secrets.GCP_SA_JSON }}\n'); // only a presence boolean before auth
    expect(gateBlock).toContain("HAS_GCP_SA_JSON: ${{ secrets.GCP_SA_JSON != '' }}");
  });

  it('never echoes secrets and keeps shell tracing off', () => {
    expect(workflow).not.toMatch(/echo .*secrets\./);
    expect(workflow.match(/set \+x/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('offers exactly the six steps, defaulting to the read-only preflight', () => {
    for (const s of IDV_MIGRATION_STEPS) expect(workflow).toMatch(new RegExp(`^\\s+- ${s}$`, 'm'));
    expect(workflow).toMatch(/default: preflight/);
  });
});

describe('dispatch gate', () => {
  it('refuses any event other than workflow_dispatch (schedule, push, …)', () => {
    for (const eventName of ['schedule', 'push', 'pull_request', '']) {
      expect(() => validateIdvMigrationDispatch({ ...ok, eventName, step: 'preflight', confirmation: 'IDV-MIGRATION-preflight' })).toThrow(/workflow_dispatch/);
    }
  });

  it('refuses ddl without the exact typed confirmation', () => {
    for (const confirmation of [undefined, '', 'IDV-MIGRATION-preflight', 'idv-migration-ddl', 'IDV-MIGRATION-ddl ']) {
      expect(() => validateIdvMigrationDispatch({ ...ok, step: 'ddl', confirmation })).toThrow(/typed confirmation/);
    }
    expect(validateIdvMigrationDispatch({ ...ok, step: 'ddl', confirmation: expectedIdvMigrationConfirmation('ddl') }).step).toBe('ddl');
  });

  it('refuses when GCP_SA_JSON is absent, and unknown steps', () => {
    expect(() => validateIdvMigrationDispatch({ ...ok, hasGcpSaJson: false, step: 'ddl', confirmation: 'IDV-MIGRATION-ddl' })).toThrow(/GCP_SA_JSON/);
    expect(() => validateIdvMigrationDispatch({ ...ok, step: 'drop', confirmation: 'IDV-MIGRATION-drop' })).toThrow(/unsupported/);
  });

  it('idv_fy_backfill needs exactly one FY in 2016..2025; other steps reject a FY', () => {
    const c = 'IDV-MIGRATION-idv_fy_backfill';
    expect(validateIdvMigrationDispatch({ ...ok, step: 'idv_fy_backfill', confirmation: c, fiscalYear: '2024' }).fiscalYear).toBe(2024);
    for (const fiscalYear of ['', '2015', '2026', '2024,2025', 'x']) {
      expect(() => validateIdvMigrationDispatch({ ...ok, step: 'idv_fy_backfill', confirmation: c, fiscalYear })).toThrow(/fiscal_year/);
    }
    expect(() => validateIdvMigrationDispatch({ ...ok, step: 'ddl', confirmation: 'IDV-MIGRATION-ddl', fiscalYear: '2024' })).toThrow(/only valid/);
  });

  it('repull_window is bounded: from >= 2026-01-20, to <= today, span <= 62 days', () => {
    const c = 'IDV-MIGRATION-repull_window';
    expect(validateIdvMigrationDispatch({ ...ok, step: 'repull_window', confirmation: c, windowFrom: '2026-01-20', windowTo: '2026-03-20' }).window)
      .toEqual({ from: '2026-01-20', to: '2026-03-20' });
    expect(validateIdvMigrationDispatch({ ...ok, step: 'repull_window', confirmation: c, windowFrom: '2026-08-01' }).window)
      .toEqual({ from: '2026-08-01', to: null });
    for (const [windowFrom, windowTo] of [['2026-01-01', '2026-02-01'], ['2026-01-20', '2026-06-01'], ['2026-03-01', '2026-02-01'], ['2026-09-01', '2026-10-01'], ['bad', '']]) {
      expect(() => validateIdvMigrationDispatch({ ...ok, step: 'repull_window', confirmation: c, windowFrom, windowTo })).toThrow(/refused/);
    }
    // a blank window_to means "to today": from 2026-01-20 would be 246 days — refused.
    expect(() => validateIdvMigrationDispatch({ ...ok, step: 'repull_window', confirmation: c, windowFrom: '2026-01-20' })).toThrow(/split it/);
  });
});

describe('fresh-clone write gate', () => {
  const clone = (tableId: string, ageH: number, rowCount: number) => ({ tableId, createdAtMs: NOW - ageH * H, rowCount });

  it('ddl cannot run without a clone', () => {
    expect(() => assertFreshCloneGate({ clones: [], liveRowCount: 65_030_126, nowMs: NOW })).toThrow(/no awards_clone_pre_idv_/);
  });

  it('refuses a clone >= 24h old', () => {
    expect(() => assertFreshCloneGate({ clones: [clone('awards_clone_pre_idv_20260922_1100', 25, 65_030_126)], liveRowCount: 65_030_126, nowMs: NOW })).toThrow(/old/);
  });

  it('refuses a clone whose row count differs from live awards (awards changed since)', () => {
    expect(() => assertFreshCloneGate({ clones: [clone('awards_clone_pre_idv_20260923_1100', 1, 65_000_000)], liveRowCount: 65_030_126, nowMs: NOW })).toThrow(/changed since the clone/);
  });

  it('ignores tables without the clone prefix and uses the newest clone', () => {
    const got = assertFreshCloneGate({
      clones: [clone('awards_snap_other', 1, 65_030_126), clone('awards_clone_pre_idv_20260923_0900', 3, 1), clone('awards_clone_pre_idv_20260923_1100', 1, 65_030_126)],
      liveRowCount: 65_030_126, nowMs: NOW,
    });
    expect(got.tableId).toBe('awards_clone_pre_idv_20260923_1100');
  });

  it('the runner applies the gate to every write step BEFORE any write', () => {
    expect([...IDV_MIGRATION_WRITE_STEPS].sort()).toEqual(['ddl', 'idv_fy_backfill', 'repull_window']);
    const gateAt = runner.indexOf('assertFreshCloneGate({');
    const switchAt = runner.indexOf('switch (dispatch.step)');
    expect(gateAt).toBeGreaterThan(-1);
    expect(gateAt).toBeLessThan(switchAt);
    expect(runner).toContain('IDV_MIGRATION_WRITE_STEPS.includes(dispatch.step)');
    // and re-validates the dispatch itself, not only in the workflow gate
    expect(runner.indexOf('validateIdvMigrationDispatch(')).toBeLessThan(gateAt);
  });

  it('snapshot is a CLONE with a 30-day expiration — never a SNAPSHOT (needs deleteSnapshot)', () => {
    expect(runner).toMatch(/CREATE TABLE [^\n]* CLONE \$\{AWARDS\}/);
    expect(runner).not.toMatch(/CREATE SNAPSHOT TABLE/);
    expect(idvMigrationCloneTableId(new Date('2026-09-23T14:05:00Z'))).toBe('awards_clone_pre_idv_20260923_1405');
  });
});

describe('ddl runs only the validated bytes', () => {
  it('01-ddl-add-columns.sql still hashes to the value executed in validation', () => {
    const sql = readFileSync(join(root, IDV_DDL_FILE), 'utf8');
    expect(createHash('sha256').update(sql).digest('hex')).toBe(IDV_DDL_SHA256);
  });

  it('the runner refuses on hash drift and resolves the unqualified table via the usaspending default dataset', () => {
    expect(runner).toContain('sha !== IDV_DDL_SHA256');
    expect(runner).toMatch(/defaultDataset: true, label: 'ddl_01'/);
  });
});

describe('ingest arguments', () => {
  it('maps the two re-acquisition steps to the reviewed ingest flags', () => {
    expect(ingestArgsForStep({ step: 'repull_window', fiscalYear: null, window: { from: '2026-01-20', to: '2026-03-20' } }))
      .toEqual(['--from=2026-01-20', '--to=2026-03-20', '--apply']);
    expect(ingestArgsForStep({ step: 'repull_window', fiscalYear: null, window: { from: '2026-08-01', to: null } }))
      .toEqual(['--from=2026-08-01', '--apply']);
    expect(ingestArgsForStep({ step: 'idv_fy_backfill', fiscalYear: 2024, window: null }))
      .toEqual(['--idv-only', '--from=2023-10-01', '--to=2024-09-30', '--apply']);
    expect(() => ingestArgsForStep({ step: 'ddl', fiscalYear: null, window: null })).toThrow();
  });
});
