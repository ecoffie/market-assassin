import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AUTHORITATIVE_RECIPIENTS_ROLLUP_TABLE,
  formatVerificationReport,
  recipientsRollupMergedQueryFrom,
  snapshotContainsNoRowLevelFields,
  verifyPostApply,
  type AwardsIngestSanitizedSnapshot,
} from './post-apply-verify';

const baseline = (): AwardsIngestSanitizedSnapshot => ({
  capturedAt: '2026-08-29T10:00:00.000Z',
  awardsMaxActionDate: '2026-08-11',
  awardsRowCount: 64_176_550,
  recipientsMaxLastActionDate: '2026-08-11',
  recipientsRollupMergedMaxLastActionDate: '2026-08-11',
  dataSourcesLastBuilt: '2026-08-11',
  hasV1ClockBlock: false,
  mergedAt: null,
  recipientsRebuiltAt: null,
  freshnessStatus: 'unmeasured',
  freshnessLegacyUnmeasured: true,
});

describe('post-apply verification', () => {
  it('queries recipients_rollup_merged gold master, not intermediate recipients_rollup', () => {
    const rebuildSql = readFileSync(
      join(process.cwd(), 'scripts/usaspending-ingest/rebuild-recipients-from-awards.sql'),
      'utf8',
    );
    expect(rebuildSql).toMatch(
      /CREATE OR REPLACE TABLE `market-assasin\.usaspending\.recipients_rollup_merged`/,
    );
    expect(AUTHORITATIVE_RECIPIENTS_ROLLUP_TABLE).toBe('recipients_rollup_merged');
    expect(recipientsRollupMergedQueryFrom()).toBe('`market-assasin.usaspending.recipients_rollup_merged`');
  });

  it('passes when counts and dates advance and v1 clocks are populated', () => {
    const current: AwardsIngestSanitizedSnapshot = {
      ...baseline(),
      capturedAt: '2026-08-29T11:00:00.000Z',
      awardsMaxActionDate: '2026-08-15',
      awardsRowCount: 64_180_000,
      recipientsMaxLastActionDate: '2026-08-15',
      recipientsRollupMergedMaxLastActionDate: '2026-08-15',
      dataSourcesLastBuilt: '2026-08-29',
      hasV1ClockBlock: true,
      mergedAt: '2026-08-29T10:30:00.000Z',
      recipientsRebuiltAt: '2026-08-29T10:35:00.000Z',
      freshnessStatus: 'upstream_stale',
      freshnessLegacyUnmeasured: false,
    };
    const result = verifyPostApply(baseline(), current);
    expect(result.ok).toBe(true);
    expect(result.checks.freshnessStatus).toBe('upstream_stale');
    expect(result.failures).toEqual([]);
  });

  it('exits nonzero semantics when awards MAX(action_date) regresses', () => {
    const current = {
      ...baseline(),
      awardsMaxActionDate: '2026-08-01',
      hasV1ClockBlock: true,
      mergedAt: '2026-08-29T10:30:00.000Z',
      recipientsRebuiltAt: '2026-08-29T10:35:00.000Z',
      freshnessLegacyUnmeasured: false,
      freshnessStatus: 'healthy',
    };
    const result = verifyPostApply(baseline(), current);
    expect(result.ok).toBe(false);
    expect(result.failures).toContain('awards MAX(action_date) regressed');
  });

  it('fails when row count decreases unexpectedly', () => {
    const current = {
      ...baseline(),
      awardsRowCount: 64_000_000,
      hasV1ClockBlock: true,
      mergedAt: '2026-08-29T10:30:00.000Z',
      recipientsRebuiltAt: '2026-08-29T10:35:00.000Z',
      freshnessLegacyUnmeasured: false,
      freshnessStatus: 'healthy',
    };
    const result = verifyPostApply(baseline(), current);
    expect(result.ok).toBe(false);
    expect(result.failures).toContain('awards row count decreased unexpectedly');
  });

  it('fails when recipients_rollup_merged last_action_date regresses', () => {
    const current = {
      ...baseline(),
      recipientsRollupMergedMaxLastActionDate: '2026-08-01',
      hasV1ClockBlock: true,
      mergedAt: '2026-08-29T10:30:00.000Z',
      recipientsRebuiltAt: '2026-08-29T10:35:00.000Z',
      freshnessLegacyUnmeasured: false,
      freshnessStatus: 'healthy',
    };
    const result = verifyPostApply(baseline(), current);
    expect(result.ok).toBe(false);
    expect(result.failures).toContain('recipients_rollup_merged MAX(last_action_date) regressed');
  });

  it('fails when v1 clock block or run timestamps remain missing', () => {
    const current = {
      ...baseline(),
      hasV1ClockBlock: false,
      mergedAt: null,
      recipientsRebuiltAt: null,
      freshnessLegacyUnmeasured: true,
    };
    const result = verifyPostApply(baseline(), current);
    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        'four-clock v1 block missing from data_sources[bq_awards].notes',
        'mergedAt not populated in v1 clock block',
        'recipientsRebuiltAt not populated in v1 clock block',
        'freshness remains legacy unmeasured',
      ]),
    );
  });

  it('sanitized baseline schema contains no row-level or credential fields', () => {
    const snap = baseline();
    expect(snapshotContainsNoRowLevelFields(snap)).toBe(true);
    expect(Object.keys(snap)).toEqual([
      'capturedAt',
      'awardsMaxActionDate',
      'awardsRowCount',
      'recipientsMaxLastActionDate',
      'recipientsRollupMergedMaxLastActionDate',
      'dataSourcesLastBuilt',
      'hasV1ClockBlock',
      'mergedAt',
      'recipientsRebuiltAt',
      'freshnessStatus',
      'freshnessLegacyUnmeasured',
    ]);
  });

  it('report mentions MERGE is not rolled back on verification failure', () => {
    const result = verifyPostApply(baseline(), {
      ...baseline(),
      awardsMaxActionDate: '2026-08-01',
    });
    const report = formatVerificationReport(result);
    expect(report).toMatch(/does not roll back a completed MERGE/);
    expect(report).not.toMatch(/recipient_uei/);
  });
});
