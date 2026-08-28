import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateCsvText } from './csv-validate';
import {
  classifyFreshness,
  decodeAwardsIngestClocks,
  encodeAwardsIngestClocks,
  type AwardsIngestClocks,
} from './clocks';
import {
  assertLoadableAcquisition,
  buildPipelinePlan,
  classifyMembers,
  pipelineOutcome,
} from './pipeline';
import { staleDaysForCadence } from '../data-sources/freshness';
import { shouldFailWhenEmailFails } from './index';

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
