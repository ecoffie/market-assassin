import { readFileSync } from 'node:fs';
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
import { shouldFailWhenEmailFails } from './index';
import { staleDaysForCadence } from '../data-sources/freshness';
import {
  assertApplyConfirmation,
  BQ_AWARDS_APPLY_CONFIRMATION,
  npmScriptForMode,
  POST_APPLY_VERIFY_SCRIPT,
  requiredSecretNames,
  VALIDATE_DISPATCH_SCRIPT,
  LOCAL_TSX_BIN,
  validateWorkflowDispatch,
  parseSecretPresence,
} from './workflow-control';

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
  it('orders recipients rebuild after MERGE', () => {
    const plan = buildPipelinePlan({
      members: classifyMembers(['Contracts_FY2026.csv']),
      csvValidations: [{ path: 'Contracts_FY2026.csv', status: 'loadable', dataRows: 1 }],
    });
    expect(plan).toEqual({
      status: 'ready',
      steps: ['classify_zip', 'validate_contracts', 'merge', 'rebuild_recipients', 'stamp_clocks'],
      loadablePaths: ['Contracts_FY2026.csv'],
    });
  });

  it('reports a recipients rebuild failure as overall failure after MERGE', () => {
    expect(pipelineOutcome({ lastCompleted: 'merge', failedAt: 'rebuild_recipients' }))
      .toEqual({ status: 'failed_recipients_rebuild', exitCode: 1 });
  });
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

describe('bq-awards-ingest workflow (B2 apply-control contract)', () => {
  const workflowPath = join(process.cwd(), '.github/workflows/bq-awards-ingest.yml');
  const workflow = readFileSync(workflowPath, 'utf8');

  it('is triggered only by workflow_dispatch with no schedule or push', () => {
    expect(workflow).toMatch(/^on:\s*\n\s*workflow_dispatch:/m);
    expect(workflow).not.toMatch(/^\s*schedule:/m);
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
    expect(verifyStep).toMatch(/if: inputs\.mode == 'apply_incremental'/);
  });

  it('cleans up baseline file in always() cleanup', () => {
    expect(workflow).toMatch(/if: always\(\)/);
    expect(workflow).toContain('rm -f /tmp/bq-awards-ingest-baseline.json');
  });

  it('invokes npm run ingest:awards:apply only in apply_incremental branch', () => {
    expect(workflow).toMatch(/if: inputs\.mode == 'apply_incremental'/);
    expect(workflow).toMatch(/npm run ingest:awards:apply/);
    const applyStep = workflow.slice(workflow.indexOf('Apply incremental'));
    expect(applyStep).not.toMatch(/--from/);
    expect(applyStep).not.toMatch(/ingest-usaspending-awards\.ts/);
  });

  it('runs plan dry-run only in plan mode without apply script', () => {
    expect(workflow).toMatch(/if: inputs\.mode == 'plan'/);
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
    expect(workflow).toContain('timeout-minutes: 180');
    expect(workflow).toContain(VALIDATE_DISPATCH_SCRIPT);
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
