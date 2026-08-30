import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateCsvText } from './csv-validate';
import {
  classifyFreshness,
  decodeAwardsIngestClocks,
  encodeAwardsIngestClocks,
  resolveAwardsIngestClocks,
  synthesizeLegacyClocks,
  type AwardsIngestClocks,
} from './clocks';
import {
  assertLoadableAcquisition,
  buildPipelinePlan,
  classifyMembers,
  pipelineOutcome,
} from './pipeline';
import {
  buildBqLoadArgs,
  buildStagingLoadPlan,
  loadCsvsIntoStaging,
} from './staging-load';
import { readBoundedCsvFirstRecord, readBoundedCsvFirstRecordVia } from './csv-first-record';
import { buildStringStagingSchema } from './staging-schema';
import { formatStagingLoadFailure, StagingLoadError } from './staging-errors';
import {
  legacyPlannerHeaderMismatchReason,
  parseCsvHeaderColumns,
} from './split-member-lead';
import { buildAwardsMergeSql } from './merge-sql';
import { shouldFailWhenEmailFails } from './index';
import { staleDaysForCadence } from '../data-sources/freshness';
import {
  assertApplyConfirmation,
  BQ_AWARDS_APPLY_CONFIRMATION,
  BQ_AWARDS_MIN_POST_ACQUISITION_BUFFER_MINUTES,
  BQ_AWARDS_WEEKLY_SCHEDULE_CRON,
  BQ_AWARDS_WORKFLOW_ACQUISITION_POLL_MINUTES,
  BQ_AWARDS_WORKFLOW_JOB_TIMEOUT_MINUTES,
  isApplyIncrementalRun,
  npmScriptForMode,
  POST_APPLY_VERIFY_SCRIPT,
  requiredSecretNames,
  resolveConfirmationForEvent,
  resolveIngestModeForEvent,
  VALIDATE_DISPATCH_SCRIPT,
  LOCAL_TSX_BIN,
  validateWorkflowDispatch,
  parseSecretPresence,
} from './workflow-control';
import {
  acquisitionPollTimeoutMessage,
  assertWorkflowTimeoutCoversAcquisition,
  BQ_AWARDS_ACQUISITION_POLL_MINUTES_ENV,
  computeProductionPollBudgetMinutes,
  DEFAULT_LOCAL_ACQUISITION_POLL_MINUTES,
  MAX_ACQUISITION_POLL_MINUTES,
  maxPollIterations,
  MIN_CONFIGURED_ACQUISITION_POLL_MINUTES,
  parseAcquisitionPollMinutes,
  pollBulkDownloadUntilReady,
} from './acquisition-poll';

const fixture = (name: string) =>
  readFileSync(join(process.cwd(), 'scripts/fixtures/awards-ingest', name), 'utf8');

describe('CSV acquisition validation', () => {
  it('fails closed for a header-only contracts CSV and plans no writes', () => {
    const validation = validateCsvText(fixture('header-only-contracts.csv'));
    expect(validation).toEqual({ status: 'empty_acquisition', dataRows: 0 });

    const plan = buildPipelinePlan({
      members: classifyMembers(['Contracts_FY2026.csv']),
      csvValidations: [{ path: 'Contracts_FY2026.csv', ...validation }],
    });
    expect(plan.status).toBe('empty_acquisition');
    expect(plan.steps).not.toContain('merge');
    expect(plan.steps).not.toContain('stamp_clocks');
  });

  it('accepts a contracts CSV with one data row', () => {
    expect(validateCsvText(fixture('one-row-contracts.csv'))).toEqual({
      status: 'loadable',
      dataRows: 1,
    });
  });
});

describe('ZIP member classification', () => {
  it('accepts USASpending incremental PrimeTransactions CSV members', () => {
    const path = 'All_PrimeTransactions_2026-08-28.csv';
    expect(classifyMembers([path]).map((member) => member.kind)).toEqual(['contracts']);
    expect(assertLoadableAcquisition(classifyMembers([path]))).toEqual([path]);
  });

  it('loads PrimeTransactions fixture with one data row through the pipeline', () => {
    const path = 'All_PrimeTransactions_2026-08-28.csv';
    const validation = validateCsvText(fixture('All_PrimeTransactions_2026-08-28.csv'));
    expect(validation).toEqual({ status: 'loadable', dataRows: 1 });
    const plan = buildPipelinePlan({
      members: classifyMembers([path]),
      csvValidations: [{ path, ...validation }],
    });
    expect(plan.status).toBe('ready');
    expect(plan).toMatchObject({ loadablePaths: [path] });
  });

  it('rejects an IDV sibling instead of silently ignoring it', () => {
    const members = classifyMembers([
      'Contracts_FY2026.csv',
      'IDV_Contracts_FY2026.csv',
      'README.txt',
    ]);
    expect(members.map((member) => member.kind)).toEqual([
      'contracts',
      'idv',
      'irrelevant',
    ]);
    expect(() => assertLoadableAcquisition(members)).toThrow(/unsupported.*idv/i);
  });

  it('returns the loadable path when the ZIP contains only contracts', () => {
    const members = classifyMembers(['Contracts_FY2026.csv']);
    expect(assertLoadableAcquisition(members)).toEqual(['Contracts_FY2026.csv']);
  });

  it('rejects unknown CSV members', () => {
    expect(() => assertLoadableAcquisition(classifyMembers(['Mystery.csv']))).toThrow(/unknown/i);
  });

  it('rejects assistance CSV members', () => {
    expect(() => assertLoadableAcquisition(classifyMembers(['Assistance_Awards.csv']))).toThrow(/assistance/i);
  });
});

describe('pipeline state', () => {
  it('orders staging load before MERGE and recipients rebuild after MERGE', () => {
    const plan = buildPipelinePlan({
      members: classifyMembers(['Contracts_FY2026.csv']),
      csvValidations: [{ path: 'Contracts_FY2026.csv', status: 'loadable', dataRows: 1 }],
    });
    expect(plan).toEqual({
      status: 'ready',
      steps: ['classify_zip', 'validate_contracts', 'staging_load', 'merge', 'rebuild_recipients', 'stamp_clocks'],
      loadablePaths: ['Contracts_FY2026.csv'],
    });
  });

  it('reports a staging load failure without reaching MERGE', () => {
    expect(pipelineOutcome({ lastCompleted: 'validate_contracts', failedAt: 'staging_load' }))
      .toEqual({ status: 'failed_staging_load', exitCode: 1 });
  });

  it('reports a MERGE failure after staging load completes', () => {
    expect(pipelineOutcome({ lastCompleted: 'staging_load', failedAt: 'merge' }))
      .toEqual({ status: 'failed_merge', exitCode: 1 });
  });

  it('reports a recipients rebuild failure as overall failure after MERGE', () => {
    expect(pipelineOutcome({ lastCompleted: 'merge', failedAt: 'rebuild_recipients' }))
      .toEqual({ status: 'failed_recipients_rebuild', exitCode: 1 });
  });
});

describe('staging schema (deterministic STRING landing)', () => {
  const fixtureDir = join(process.cwd(), 'scripts/fixtures/awards-ingest');
  const part1 = join(fixtureDir, 'split-export-part1-with-header.csv');
  const part2Headerless = join(fixtureDir, 'split-export-part2-headerless.csv');
  const part2Conflicting = join(fixtureDir, 'split-export-part2-conflicting-header.csv');
  const part1Basename = 'All_Contracts_PrimeTransactions_2026-08-30_H00M28S19_1.csv';
  const part2Basename = 'All_Contracts_PrimeTransactions_2026-08-30_H00M28S19_2.csv';

  it('builds an all-STRING schema from file-1 header only', () => {
    const header = readBoundedCsvFirstRecord(part1, 'split-export-part1-with-header.csv');
    const schema = buildStringStagingSchema(header);
    expect(schema.length).toBeGreaterThan(40);
    expect(schema.every((field) => field.type === 'STRING' && field.mode === 'NULLABLE')).toBe(true);
    expect(schema.some((field) => field.name === 'recipient_fax_number')).toBe(true);
  });

  it('reads only a bounded prefix from a multi-MB CSV (never the whole file)', () => {
    const header = readFileSync(part1, 'utf8').split(/\r?\n/, 1)[0];
    const dir = mkdtempSync(join(tmpdir(), 'awards-ingest-large-'));
    const largePath = join(dir, 'large-member.csv');
    writeFileSync(largePath, `${header}\n${'x'.repeat(8 * 1024 * 1024)}`);
    let maxRequested = 0;
    const record = readBoundedCsvFirstRecordVia(
      (maxBytes) => {
        maxRequested = maxBytes;
        return readFileSync(largePath, 'utf8').slice(0, maxBytes);
      },
      'large-member.csv',
      65_536,
    );
    expect(record).toBe(header);
    expect(maxRequested).toBe(65_536);
    rmSync(dir, { recursive: true, force: true });
  });

  describe('run #6 reproduction (swallowed planner failure)', () => {
    it('legacy planner rejects headerless file-2 before bq load', () => {
      const auth = readBoundedCsvFirstRecord(part1, part1Basename);
      const authCols = parseCsvHeaderColumns(auth);
      const lead = readBoundedCsvFirstRecord(part2Headerless, part2Basename);
      expect(lead.startsWith('CONT_AWD_TXN_2')).toBe(true);
      expect(legacyPlannerHeaderMismatchReason(authCols, lead)).toMatch(/do not match/i);
    });

    it('new planner classifies production-like split export with headerless file-2', () => {
      const plan = buildStagingLoadPlan([part1, part2Headerless]);
      expect(plan.jobs[0]).toMatchObject({
        memberBasename: 'split-export-part1-with-header.csv',
        replace: true,
        skipLeadingRows: 1,
        leadKind: 'matching_header',
      });
      expect(plan.jobs[1]).toMatchObject({
        memberBasename: 'split-export-part2-headerless.csv',
        replace: false,
        skipLeadingRows: 0,
        leadKind: 'headerless_data',
      });
    });
  });

  it('plans duplicate header on file-2 with skip_leading_rows=1', () => {
    const paths = [
      join(fixtureDir, 'two-member-fax-part1.csv'),
      join(fixtureDir, 'two-member-fax-part2.csv'),
    ];
    const plan = buildStagingLoadPlan(paths);
    expect(plan.jobs[0].skipLeadingRows).toBe(1);
    expect(plan.jobs[1].skipLeadingRows).toBe(1);
    expect(plan.jobs[1].leadKind).toBe('matching_header');
  });

  it('fails closed on conflicting header on file-2', () => {
    expect(() => buildStagingLoadPlan([part1, part2Conflicting])).toThrow(StagingLoadError);
    try {
      buildStagingLoadPlan([part1, part2Conflicting]);
    } catch (error) {
      expect(formatStagingLoadFailure(error)).toMatch(
        /failed_staging_load: staging_conflicting_header member=split-export-part2-conflicting-header.csv/,
      );
    }
  });

  it('builds bq load args with explicit schema and per-member skip_leading_rows', () => {
    const job = {
      csvPath: '/tmp/part2.csv',
      memberBasename: 'All_Contracts_PrimeTransactions_2026-08-30_H00M28S19_2.csv',
      replace: false,
      skipLeadingRows: 0 as const,
      leadKind: 'headerless_data' as const,
    };
    const args = buildBqLoadArgs({
      projectId: 'market-assasin',
      stagingTarget: 'usaspending.awards_ingest_staging',
      schemaPath: '/tmp/staging-schema.json',
      job,
    });
    expect(args).not.toContain('--autodetect');
    expect(args).toContain('--skip_leading_rows=0');
    expect(args).toContain('--noreplace');
    expect(args).toContain('/tmp/staging-schema.json');
  });

  it('MERGE SQL uses SAFE_CAST for numeric and date fields from STRING staging', () => {
    const sql = buildAwardsMergeSql({
      awardsTable: '`market-assasin.usaspending.awards`',
      stagingFq: 'market-assasin.usaspending.awards_ingest_staging',
      startDate: '2026-05-03',
    });
    expect(sql).toMatch(/SAFE_CAST\(action_date AS DATE\)/);
    expect(sql).toMatch(/SAFE_CAST\(federal_action_obligation AS FLOAT64\)/);
    expect(sql).toMatch(/CAST\(recipient_uei AS STRING\)/);
    expect(sql).toMatch(/CAST\(naics_code AS STRING\)/);
  });
});

const gcpReady = Boolean(process.env.GCP_SA_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS);

describe.skipIf(!gcpReady)('staging load integration (two-member export)', () => {
  const fixtureDir = join(process.cwd(), 'scripts/fixtures/awards-ingest');
  const PROJECT = 'market-assasin';
  const TABLE = 'awards_ingest_staging_fixture_test';

  it('loads both CSV members into one complete staging table before MERGE', () => {
    const paths = [
      join(fixtureDir, 'two-member-fax-part1.csv'),
      join(fixtureDir, 'two-member-fax-part2.csv'),
    ];
    const schemaPath = join(fixtureDir, '.staging-schema-test.json');
    const loads: string[][] = [];

    loadCsvsIntoStaging({
      projectId: PROJECT,
      dataset: 'usaspending',
      stagingTable: TABLE,
      csvPaths: paths,
      schemaFilePath: schemaPath,
      execLoad: (args) => {
        loads.push(args);
        const { execFileSync } = require('node:child_process') as typeof import('node:child_process');
        execFileSync('bq', args, { stdio: 'inherit' });
      },
    });

    expect(loads).toHaveLength(2);
    expect(loads[0]).toContain('--replace');
    expect(loads[1]).toContain('--noreplace');
    expect(loads.every((args) => !args.includes('--autodetect'))).toBe(true);

    const { execFileSync } = require('node:child_process') as typeof import('node:child_process');
    const countRaw = execFileSync('bq', [
      '--project_id=' + PROJECT,
      'query',
      '--nouse_legacy_sql',
      '--format=csv',
      `SELECT COUNT(*) AS rows FROM \`${PROJECT}.usaspending.${TABLE}\``,
    ], { encoding: 'utf8' });
    expect(countRaw.trim().split('\n').pop()).toBe('2');

    const faxRaw = execFileSync('bq', [
      '--project_id=' + PROJECT,
      'query',
      '--nouse_legacy_sql',
      '--format=csv',
      `SELECT recipient_fax_number FROM \`${PROJECT}.usaspending.${TABLE}\` ORDER BY contract_transaction_unique_key`,
    ], { encoding: 'utf8' });
    const faxValues = faxRaw.trim().split('\n').slice(1);
    expect(faxValues).toEqual(['6264402724', '(626) 440-2724']);
  }, 120_000);
});

describe('recipients rebuild SQL', () => {
  it('matches the recipients sections in the gold-master build SQL exactly', () => {
    const source = readFileSync(
      join(process.cwd(), 'scripts/usaspending-ingest/build-derived.sql'),
      'utf8',
    );
    const rebuild = readFileSync(
      join(process.cwd(), 'scripts/usaspending-ingest/rebuild-recipients-from-awards.sql'),
      'utf8',
    );
    const excerpt = source.slice(
      source.indexOf('-- 2) Recipient rollup'),
      source.indexOf('-- 3) Top-5 executives'),
    ).trim();
    const copied = rebuild.slice(rebuild.indexOf('-- 2) Recipient rollup')).trim();
    expect(copied).toBe(excerpt);
  });
});

describe('four-clock freshness', () => {
  const now = '2026-08-27T12:00:00.000Z';
  const healthyClocks: AwardsIngestClocks = {
    sourceActionMax: '2026-08-26',
    acquiredAt: '2026-08-26T12:00:00.000Z',
    mergedAt: '2026-08-26T12:05:00.000Z',
    recipientsRebuiltAt: '2026-08-26T12:10:00.000Z',
  };

  it('round-trips the machine block while preserving human notes', () => {
    const notes = encodeAwardsIngestClocks('Warehouse source.', healthyClocks);
    expect(notes).toContain('Warehouse source.');
    expect(decodeAwardsIngestClocks(notes)).toEqual(healthyClocks);
  });

  it('classifies stale run clocks as ingest_broken', () => {
    expect(classifyFreshness({
      clocks: {
        sourceActionMax: '2026-08-26',
        acquiredAt: '2026-08-10T12:00:00.000Z',
        mergedAt: '2026-08-10T12:05:00.000Z',
        recipientsRebuiltAt: '2026-08-10T12:10:00.000Z',
      },
      now,
    }).status).toBe('ingest_broken');
  });

  it('classifies an old source behind fresh run clocks as upstream_stale', () => {
    expect(classifyFreshness({
      clocks: {
        sourceActionMax: '2026-08-01',
        acquiredAt: '2026-08-26T12:00:00.000Z',
        mergedAt: '2026-08-26T12:05:00.000Z',
        recipientsRebuiltAt: '2026-08-26T12:10:00.000Z',
      },
      now,
    }).status).toBe('upstream_stale');
  });

  it('classifies fresh source and run clocks as healthy', () => {
    expect(classifyFreshness({
      clocks: healthyClocks,
      now,
    }).status).toBe('healthy');
  });

  it('classifies an explicit pipeline failure as ingest_broken', () => {
    expect(classifyFreshness({
      clocks: healthyClocks,
      now,
      pipelineStatus: 'failed_recipients_rebuild',
    }).status).toBe('ingest_broken');
  });

  it('classifies missing clocks and last_built as unmeasured (fresh install)', () => {
    expect(classifyFreshness({ clocks: null, now })).toEqual({
      status: 'unmeasured',
      sourceAgeDays: null,
      runAgeDays: null,
    });
    expect(resolveAwardsIngestClocks({ notes: null, lastBuilt: null })).toBeNull();
  });

  it('classifies a legacy last_built older than 10 days as ingest_broken', () => {
    const legacy = synthesizeLegacyClocks('2026-08-11');
    expect(legacy).not.toBeNull();
    expect(classifyFreshness({ clocks: legacy, now: '2026-08-28T12:00:00.000Z' }).status)
      .toBe('ingest_broken');
    expect(resolveAwardsIngestClocks({ notes: 'Warehouse only.', lastBuilt: '2026-08-11' }))
      .toEqual(legacy);
  });
});

describe('freshness policy', () => {
  it('uses a 10-day threshold for weekly sources', () => {
    expect(staleDaysForCadence('weekly')).toBe(10);
    expect(staleDaysForCadence('quarterly')).toBe(100);
  });

  it('fails the cron response when a requested stale alert email fails', () => {
    expect(shouldFailWhenEmailFails({ staleCount: 1, notify: true, emailOk: false })).toBe(true);
    expect(shouldFailWhenEmailFails({ staleCount: 0, notify: true, emailOk: false })).toBe(false);
    expect(shouldFailWhenEmailFails({ staleCount: 1, notify: false, emailOk: false })).toBe(false);
  });
});

describe('workflow-control schedule resolution', () => {
  it('scheduled runs apply incrementally with the exact confirmation string', () => {
    expect(resolveIngestModeForEvent('schedule', undefined)).toBe('apply_incremental');
    expect(resolveConfirmationForEvent('schedule', undefined)).toBe(BQ_AWARDS_APPLY_CONFIRMATION);
    expect(isApplyIncrementalRun('schedule', undefined)).toBe(true);
  });

  it('manual dispatch keeps the typed mode and confirmation', () => {
    expect(resolveIngestModeForEvent('workflow_dispatch', 'plan')).toBe('plan');
    expect(resolveConfirmationForEvent('workflow_dispatch', 'wrong')).toBe('wrong');
    expect(isApplyIncrementalRun('workflow_dispatch', 'plan')).toBe(false);
  });

  it('does not read workflow_dispatch inputs on scheduled events', () => {
    expect(resolveIngestModeForEvent('schedule', 'plan')).toBe('apply_incremental');
    expect(resolveConfirmationForEvent('schedule', 'wrong')).toBe(BQ_AWARDS_APPLY_CONFIRMATION);
  });
});

describe('bq-awards-ingest workflow (B2 apply-control contract)', () => {
  const workflowPath = join(process.cwd(), '.github/workflows/bq-awards-ingest.yml');
  const workflow = readFileSync(workflowPath, 'utf8');

  it('allows workflow_dispatch and a guarded weekly schedule only', () => {
    expect(workflow).toMatch(/^on:\s*\n\s*workflow_dispatch:/m);
    expect(workflow).toMatch(/^\s*schedule:/m);
    expect(workflow).toContain(`cron: '${BQ_AWARDS_WEEKLY_SCHEDULE_CRON}'`);
    expect(workflow).not.toMatch(/^\s*push:/m);
    expect(workflow).not.toMatch(/^\s*pull_request:/m);
  });

  it('defaults mode to plan via typed choice input', () => {
    expect(workflow).toMatch(/^\s*mode:/m);
    expect(workflow).toMatch(/type: choice/m);
    expect(workflow).toMatch(/default: plan/m);
    expect(workflow).toMatch(/-\s*plan/m);
    expect(workflow).toMatch(/-\s*apply_incremental/m);
  });

  it('derives scheduled apply env from github.event_name, not workflow_dispatch inputs', () => {
    expect(workflow).toContain(
      "BQ_AWARDS_INGEST_MODE: ${{ github.event_name == 'schedule' && 'apply_incremental' || inputs.mode }}",
    );
    expect(workflow).toContain(
      "BQ_AWARDS_INGEST_CONFIRMATION: ${{ github.event_name == 'schedule' && 'APPLY_INCREMENTAL_100_DAY_CORRECTION' || inputs.apply_confirmation }}",
    );
    const gate = workflow.slice(
      workflow.indexOf('Fail-closed dispatch gate'),
      workflow.indexOf('google-github-actions/auth@'),
    );
    expect(gate).toContain('BQ_AWARDS_INGEST_MODE: ${{ env.BQ_AWARDS_INGEST_MODE }}');
    expect(gate).toContain('BQ_AWARDS_INGEST_CONFIRMATION: ${{ env.BQ_AWARDS_INGEST_CONFIRMATION }}');
    expect(gate).not.toContain('inputs.apply_confirmation');
    expect(gate).not.toContain('inputs.mode');
  });

  it('runs npm ci before the executable dispatch validator', () => {
    const npmCiIndex = workflow.indexOf('- run: npm ci');
    const gateIndex = workflow.indexOf('Fail-closed dispatch gate');
    expect(npmCiIndex).toBeGreaterThan(-1);
    expect(gateIndex).toBeGreaterThan(npmCiIndex);
  });

  it('runs the executable validator before GCP auth and every ingest command', () => {
    const gateIndex = workflow.indexOf('Fail-closed dispatch gate');
    const authIndex = workflow.indexOf('google-github-actions/auth@');
    const preflightIndex = workflow.indexOf('npm run ingest:awards');
    expect(gateIndex).toBeGreaterThan(-1);
    expect(authIndex).toBeGreaterThan(gateIndex);
    expect(preflightIndex).toBeGreaterThan(gateIndex);
  });

  it('uses the repository-installed tsx binary and never npx', () => {
    expect(workflow).toContain(`${LOCAL_TSX_BIN} ${VALIDATE_DISPATCH_SCRIPT}`);
    expect(workflow).toContain(`${LOCAL_TSX_BIN} ${POST_APPLY_VERIFY_SCRIPT}`);
    expect(workflow).not.toMatch(/\bnpx\b/);
  });

  it('invokes the executable dispatch validator with secret presence booleans', () => {
    const gate = workflow.slice(
      workflow.indexOf('Fail-closed dispatch gate'),
      workflow.indexOf('google-github-actions/auth@'),
    );
    expect(gate).toContain(VALIDATE_DISPATCH_SCRIPT);
    expect(gate).toMatch(/HAS_GCP_SA_JSON:/);
    expect(gate).toMatch(/HAS_SUPABASE_URL:/);
    expect(gate).toMatch(/HAS_SUPABASE_SERVICE_KEY:/);
    expect(gate).not.toMatch(/APPLY_CONFIRMATION.*!=/);
    expect(gate).not.toMatch(/unsupported mode:/);
  });

  it('requires apply confirmation via the executable validator, not shell string compare', () => {
    expect(workflow).toContain(VALIDATE_DISPATCH_SCRIPT);
    expect(workflow).not.toMatch(/if \[ "\$\{APPLY_CONFIRMATION\}" !=/);
  });

  it('runs executable post-apply verification after apply only', () => {
    expect(workflow).toMatch(/Post-apply verification/);
    expect(workflow).toContain(POST_APPLY_VERIFY_SCRIPT);
    expect(workflow).toMatch(/bq-awards-post-apply-verify\.ts capture/);
    expect(workflow).toMatch(/bq-awards-post-apply-verify\.ts verify/);
    expect(workflow).toMatch(/does NOT roll back a completed MERGE/);
    const verifyStep = workflow.slice(workflow.indexOf('Post-apply verification'));
    expect(verifyStep).toMatch(/if: env\.BQ_AWARDS_INGEST_MODE == 'apply_incremental'/);
  });

  it('cleans up baseline file in always() cleanup', () => {
    expect(workflow).toMatch(/if: always\(\)/);
    expect(workflow).toContain('rm -f /tmp/bq-awards-ingest-baseline.json');
  });

  it('invokes npm run ingest:awards:apply only in apply_incremental branch', () => {
    expect(workflow).toMatch(/if: env\.BQ_AWARDS_INGEST_MODE == 'apply_incremental'/);
    expect(workflow).toMatch(/npm run ingest:awards:apply/);
    const applyStep = workflow.slice(workflow.indexOf('Apply incremental'));
    expect(applyStep).not.toMatch(/--from/);
    expect(applyStep).not.toMatch(/ingest-usaspending-awards\.ts/);
  });

  it('runs plan dry-run only in plan mode without apply script', () => {
    expect(workflow).toMatch(/if: env\.BQ_AWARDS_INGEST_MODE == 'plan'/);
    const planStep = workflow.slice(
      workflow.indexOf('Plan mode'),
      workflow.indexOf('Apply incremental'),
    );
    expect(planStep).toMatch(/npm run ingest:awards/);
    expect(planStep).not.toMatch(/ingest:awards:apply/);
    expect(planStep).not.toMatch(/--apply/);
  });

  it('does not accept custom --from or arbitrary ingest arguments', () => {
    expect(workflow).not.toMatch(/--from/);
    expect(workflow).not.toMatch(/ingest-usaspending-awards\.ts/);
    expect(workflow).not.toMatch(/npm run ingest:awards[^\n]*\$\{/);
  });

  it('requires Supabase secret presence booleans only for apply_incremental gate', () => {
    const gate = workflow.slice(
      workflow.indexOf('Fail-closed dispatch gate'),
      workflow.indexOf('google-github-actions/auth@'),
    );
    expect(gate).toContain('HAS_GCP_SA_JSON');
    expect(gate).toContain('HAS_SUPABASE_URL');
    expect(gate).toContain('HAS_SUPABASE_SERVICE_KEY');
    expect(gate).toContain('BQ_AWARDS_INGEST_MODE');
    expect(gate).toContain('BQ_AWARDS_INGEST_CONFIRMATION');
    const planStep = workflow.slice(
      workflow.indexOf('Plan mode'),
      workflow.indexOf('Capture pre-apply baseline'),
    );
    expect(planStep).not.toContain('NEXT_PUBLIC_SUPABASE_URL');
    expect(planStep).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
  });

  it('uses bq-awards-ingest concurrency without cancel-in-progress', () => {
    expect(workflow).toContain('group: bq-awards-ingest');
    expect(workflow).toContain('cancel-in-progress: false');
  });

  it('pins third-party actions to immutable commit SHAs', () => {
    expect(workflow).toMatch(/actions\/checkout@[0-9a-f]{40}\s+# v/);
    expect(workflow).toMatch(/actions\/setup-node@[0-9a-f]{40}\s+# v/);
    expect(workflow).toMatch(/google-github-actions\/auth@[0-9a-f]{40}\s+# v/);
    expect(workflow).toMatch(/google-github-actions\/setup-gcloud@[0-9a-f]{40}\s+# v/);
    expect(workflow).toMatch(/actions\/upload-artifact@[0-9a-f]{40}\s+# v/);
    expect(workflow).not.toMatch(/@[vV]\d[^.]/);
  });

  it('uploads failure logs only — never ZIP or CSV artifacts', () => {
    expect(workflow).toContain('path: /tmp/bq-awards-ingest-run.log');
    expect(workflow).not.toMatch(/upload-artifact[\s\S]*path:.*\.(zip|csv)/i);
    expect(workflow).toContain('permissions:\n  contents: read');
    expect(workflow).toContain(`timeout-minutes: ${BQ_AWARDS_WORKFLOW_JOB_TIMEOUT_MINUTES}`);
    expect(workflow).toContain(VALIDATE_DISPATCH_SCRIPT);
  });

  it('sets the measured acquisition poll budget on apply_incremental only', () => {
    const applyStep = workflow.slice(
      workflow.indexOf('Apply incremental'),
      workflow.indexOf('Post-apply verification'),
    );
    expect(applyStep).toContain(`${BQ_AWARDS_ACQUISITION_POLL_MINUTES_ENV}: '${BQ_AWARDS_WORKFLOW_ACQUISITION_POLL_MINUTES}'`);
    const planStep = workflow.slice(
      workflow.indexOf('Plan mode'),
      workflow.indexOf('Capture pre-apply baseline'),
    );
    expect(planStep).not.toContain(BQ_AWARDS_ACQUISITION_POLL_MINUTES_ENV);
  });
});

/** Run 33277315965 — USASpending export finished ~51 min; workflow poll cap was ~20 min. */
describe('USASpending acquisition poll (bounded, fail-closed)', () => {
  it('derives the production poll budget from measured completion time', () => {
    expect(computeProductionPollBudgetMinutes(51.25486555)).toBe(90);
    expect(computeProductionPollBudgetMinutes(40)).toBe(60);
  });

  it('defaults local polling to 20 minutes when env is unset', () => {
    expect(parseAcquisitionPollMinutes(undefined)).toBe(DEFAULT_LOCAL_ACQUISITION_POLL_MINUTES);
    expect(parseAcquisitionPollMinutes('')).toBe(DEFAULT_LOCAL_ACQUISITION_POLL_MINUTES);
    expect(maxPollIterations(DEFAULT_LOCAL_ACQUISITION_POLL_MINUTES)).toBe(240);
  });

  it('accepts configured poll minutes within the hard bounds', () => {
    expect(parseAcquisitionPollMinutes('90')).toBe(90);
    expect(parseAcquisitionPollMinutes(String(MAX_ACQUISITION_POLL_MINUTES))).toBe(MAX_ACQUISITION_POLL_MINUTES);
  });

  it('fails closed on invalid configured poll minutes', () => {
    expect(() => parseAcquisitionPollMinutes('abc')).toThrow(/positive integer/);
    expect(() => parseAcquisitionPollMinutes('59')).toThrow(
      new RegExp(String(MIN_CONFIGURED_ACQUISITION_POLL_MINUTES)),
    );
    expect(() => parseAcquisitionPollMinutes('121')).toThrow(
      new RegExp(String(MAX_ACQUISITION_POLL_MINUTES)),
    );
  });

  it('succeeds when the export finishes on the last allowed poll', async () => {
    const maxIterations = 3;
    let calls = 0;
    const result = await pollBulkDownloadUntilReady({
      statusUrl: 'https://api.usaspending.gov/api/v2/download/status?file_name=test.zip',
      initialFileUrl: 'https://files.example/initial.zip',
      maxIterations,
      pollMinutesForTimeoutMessage: 1,
      fetchStatus: async () => {
        calls += 1;
        if (calls < maxIterations) {
          return { status: 'running', total_rows: 0 };
        }
        return { status: 'finished', total_rows: 42, file_url: 'https://files.example/final.zip' };
      },
      sleep: async () => {},
    });
    expect(result).toEqual({ fileUrl: 'https://files.example/final.zip', totalRows: 42 });
    expect(calls).toBe(maxIterations);
  });

  it('fails closed when the export is still running after the poll budget', async () => {
    await expect(pollBulkDownloadUntilReady({
      statusUrl: 'https://api.usaspending.gov/status',
      initialFileUrl: 'https://files.example/initial.zip',
      maxIterations: 2,
      pollMinutesForTimeoutMessage: 5,
      fetchStatus: async () => ({ status: 'running' }),
      sleep: async () => {},
    })).rejects.toThrow(acquisitionPollTimeoutMessage(5));
  });

  it('requires the workflow job timeout to exceed acquisition poll plus post buffer', () => {
    expect(() => assertWorkflowTimeoutCoversAcquisition(
      BQ_AWARDS_WORKFLOW_JOB_TIMEOUT_MINUTES,
      BQ_AWARDS_WORKFLOW_ACQUISITION_POLL_MINUTES,
      BQ_AWARDS_MIN_POST_ACQUISITION_BUFFER_MINUTES,
    )).not.toThrow();
    expect(
      BQ_AWARDS_WORKFLOW_JOB_TIMEOUT_MINUTES
      - BQ_AWARDS_WORKFLOW_ACQUISITION_POLL_MINUTES,
    ).toBeGreaterThanOrEqual(BQ_AWARDS_MIN_POST_ACQUISITION_BUFFER_MINUTES);
    expect(() => assertWorkflowTimeoutCoversAcquisition(120, 90)).toThrow(/must leave at least/);
  });
});

describe('bq-awards-ingest workflow-control (executable gate)', () => {
  it('defaults npm script to plan dry-run', () => {
    expect(npmScriptForMode('plan')).toBe('ingest:awards');
    expect(requiredSecretNames('plan')).toEqual(['GCP_SA_JSON']);
  });

  it('maps apply_incremental to ingest:awards:apply with Supabase secrets', () => {
    expect(npmScriptForMode('apply_incremental')).toBe('ingest:awards:apply');
    expect(requiredSecretNames('apply_incremental')).toEqual([
      'GCP_SA_JSON',
      'NEXT_PUBLIC_SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY',
    ]);
  });

  it('rejects missing or incorrect confirmation through validateWorkflowDispatch', () => {
    expect(() => validateWorkflowDispatch({
      mode: 'apply_incremental',
      confirmation: '',
      hasGcpSaJson: true,
      hasSupabaseUrl: true,
      hasSupabaseServiceKey: true,
    })).toThrow(/confirmation rejected/);
    expect(() => validateWorkflowDispatch({
      mode: 'apply_incremental',
      confirmation: 'wrong',
      hasGcpSaJson: true,
      hasSupabaseUrl: true,
      hasSupabaseServiceKey: true,
    })).toThrow(/confirmation rejected/);
    expect(() => validateWorkflowDispatch({
      mode: 'plan',
      confirmation: '',
      hasGcpSaJson: true,
      hasSupabaseUrl: false,
      hasSupabaseServiceKey: false,
    })).not.toThrow();
  });

  it('accepts the exact confirmation string for apply_incremental', () => {
    const result = validateWorkflowDispatch({
      mode: 'apply_incremental',
      confirmation: BQ_AWARDS_APPLY_CONFIRMATION,
      hasGcpSaJson: true,
      hasSupabaseUrl: true,
      hasSupabaseServiceKey: true,
    });
    expect(result.confirmationAccepted).toBe(true);
  });

  it('fails when apply mode lacks Supabase secret presence booleans', () => {
    expect(() => validateWorkflowDispatch({
      mode: 'apply_incremental',
      confirmation: BQ_AWARDS_APPLY_CONFIRMATION,
      hasGcpSaJson: true,
      hasSupabaseUrl: false,
      hasSupabaseServiceKey: true,
    })).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(() => validateWorkflowDispatch({
      mode: 'apply_incremental',
      confirmation: BQ_AWARDS_APPLY_CONFIRMATION,
      hasGcpSaJson: true,
      hasSupabaseUrl: true,
      hasSupabaseServiceKey: false,
    })).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('fails plan mode when GCP secret presence is false', () => {
    expect(() => validateWorkflowDispatch({
      mode: 'plan',
      hasGcpSaJson: false,
      hasSupabaseUrl: false,
      hasSupabaseServiceKey: false,
    })).toThrow(/GCP_SA_JSON/);
  });

  it('parses GitHub secret presence booleans', () => {
    expect(parseSecretPresence('true')).toBe(true);
    expect(parseSecretPresence('false')).toBe(false);
    expect(parseSecretPresence(undefined)).toBe(false);
  });

  it('assertApplyConfirmation remains the confirmation primitive', () => {
    expect(() => assertApplyConfirmation('apply_incremental', '')).toThrow(/rejected/);
    expect(() =>
      assertApplyConfirmation('apply_incremental', BQ_AWARDS_APPLY_CONFIRMATION),
    ).not.toThrow();
  });
});

/** Regression for run 33261020923 — validator exited 127 before npm ci installed tsx. */
describe('bq-awards-ingest tsx runner dependency (clean-runner regression)', () => {
  const TSX_VERSION = '4.23.12';
  const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const lock = JSON.parse(readFileSync(join(process.cwd(), 'package-lock.json'), 'utf8')) as {
    packages?: Record<string, { version?: string; dev?: boolean }>;
  };

  it('declares tsx as an exact top-level devDependency (not a runtime dependency)', () => {
    expect(pkg.devDependencies?.tsx).toBe(TSX_VERSION);
    expect(pkg.dependencies?.tsx).toBeUndefined();
  });

  it('locks tsx in package-lock.json for reproducible npm ci', () => {
    const locked = lock.packages?.['node_modules/tsx'];
    expect(locked?.version).toBe(TSX_VERSION);
    expect(locked?.dev).toBe(true);
  });

  it('installs the local tsx binary used by the workflow gate and post-apply verifier', () => {
    expect(LOCAL_TSX_BIN).toBe('./node_modules/.bin/tsx');
    expect(existsSync(join(process.cwd(), 'node_modules', '.bin', 'tsx'))).toBe(true);
  });
});
