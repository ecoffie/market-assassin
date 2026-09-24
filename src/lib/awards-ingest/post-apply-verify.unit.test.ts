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

  describe('awards schema (IDV identity columns) — 2026-09-23 schema protection', () => {
    const healthy = (): AwardsIngestSanitizedSnapshot => ({
      ...baseline(),
      capturedAt: '2026-08-29T11:00:00.000Z',
      awardsMaxActionDate: '2026-08-15',
      awardsRowCount: 64_180_000,
      recipientsMaxLastActionDate: '2026-08-15',
      recipientsRollupMergedMaxLastActionDate: '2026-08-15',
      hasV1ClockBlock: true,
      mergedAt: '2026-08-29T10:30:00.000Z',
      recipientsRebuiltAt: '2026-08-29T10:35:00.000Z',
      freshnessStatus: 'healthy',
      freshnessLegacyUnmeasured: false,
    });

    it('not required + 51 columns (today): reported, not a failure', () => {
      const r = verifyPostApply(baseline(), { ...healthy(), awardsColumnCount: 51, awardsIdvIdentityMode: 'absent', awardsSchemaOk: true }, { idvRequired: false });
      expect(r.ok).toBe(true);
      expect(formatVerificationReport(r)).toMatch(/awards_column_count=51 idv_mode=absent/);
    });

    it('required + 51 columns → FAILS (column count and schema)', () => {
      const r = verifyPostApply(baseline(), { ...healthy(), awardsColumnCount: 51, awardsIdvIdentityMode: 'absent', awardsSchemaOk: true }, { idvRequired: true });
      expect(r.ok).toBe(false);
      expect(r.checks.awardsColumnCountOk).toBe(false);
      expect(r.failures.join(' ')).toMatch(/51 columns; ≥ 58 required/);
    });

    it('required + unmeasured schema → FAILS (unknown is not 58)', () => {
      const r = verifyPostApply(baseline(), healthy(), { idvRequired: true });
      expect(r.checks.awardsColumnCountOk).toBe(false);
      expect(r.ok).toBe(false);
    });

    it('present: ordering_period_end_date fill on recent IDV rows is enforced', () => {
      const present = { ...healthy(), awardsColumnCount: 58, awardsIdvIdentityMode: 'present' as const, awardsSchemaOk: true };
      expect(verifyPostApply(baseline(), { ...present, idvRecentRows: 1000, idvRecentOrderingEndFilled: 998 }, { idvRequired: true }).ok).toBe(true);
      const thin = verifyPostApply(baseline(), { ...present, idvRecentRows: 1000, idvRecentOrderingEndFilled: 400 }, { idvRequired: true });
      expect(thin.checks.idvOrderingEndFillOk).toBe(false);
      expect(thin.failures.join(' ')).toMatch(/ordering_period_end_date \(400\/1000/);
      // zero IDV rows flagged while the columns exist = the MERGE did not write them.
      expect(verifyPostApply(baseline(), { ...present, idvRecentRows: 0, idvRecentOrderingEndFilled: 0 }, { idvRequired: false }).checks.idvOrderingEndFillOk).toBe(false);
    });

    it('a refused schema (type mismatch / partial) fails even when not required', () => {
      const r = verifyPostApply(baseline(), { ...healthy(), awardsColumnCount: 54, awardsIdvIdentityMode: 'partial', awardsSchemaOk: false }, { idvRequired: false });
      expect(r.checks.awardsSchemaTypesOk).toBe(false);
      expect(r.ok).toBe(false);
    });
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
