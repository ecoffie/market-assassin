import { describe, expect, it, vi } from 'vitest';
import {
  assertLiveBigQueryAllowed,
  isLiveBigQueryBlocked,
  liveBigQueryBlockReason,
  resolveDisposableBqTestTarget,
  uniqueTestTableName,
  LiveBigQueryBlockedError,
} from './guard';

describe('liveBigQueryBlockReason', () => {
  it('blocks during next build (NEXT_PHASE or MINDY_BUILD)', () => {
    expect(liveBigQueryBlockReason({ NEXT_PHASE: 'phase-production-build' })).toMatch(/cache-only/);
    expect(liveBigQueryBlockReason({ MINDY_BUILD: '1' })).toMatch(/cache-only/);
  });

  it('blocks the unit suite unless RUN_LIVE_BQ_TESTS=1, and credentials alone never enable it', () => {
    expect(liveBigQueryBlockReason({ VITEST: 'true' })).toMatch(/unit tests/);
    expect(liveBigQueryBlockReason({ VITEST: 'true', GOOGLE_APPLICATION_CREDENTIALS: '/k.json', GCP_SA_JSON: '{}' })).toMatch(/unit tests/);
    expect(liveBigQueryBlockReason({ VITEST: 'true', RUN_LIVE_BQ_TESTS: '1' })).toBeNull();
  });

  it('a build is blocked even if RUN_LIVE_BQ_TESTS is set', () => {
    expect(liveBigQueryBlockReason({ NEXT_PHASE: 'phase-production-build', RUN_LIVE_BQ_TESTS: '1' })).toMatch(/cache-only/);
  });

  it('honours the BQ_DISABLED kill switch', () => {
    expect(liveBigQueryBlockReason({ BQ_DISABLED: '1' })).toBe('BQ_DISABLED=1');
  });

  it('allows normal runtime (production server, scripts)', () => {
    expect(liveBigQueryBlockReason({ NEXT_PHASE: 'phase-production-server' })).toBeNull();
    expect(liveBigQueryBlockReason({})).toBeNull();
  });
});

describe('assertLiveBigQueryAllowed', () => {
  it('throws a recognisable error when blocked, and is silent when allowed', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let caught: unknown;
    try {
      assertLiveBigQueryAllowed('test op', { MINDY_BUILD: '1' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(LiveBigQueryBlockedError);
    expect(isLiveBigQueryBlocked(caught)).toBe(true);
    expect(() => assertLiveBigQueryAllowed('test op', {})).not.toThrow();
  });

  it('is active in this very suite: the shared client refuses before reading credentials', async () => {
    process.env.GCP_SA_JSON = 'not-json-and-never-parsed';
    const { bqQuery } = await import('./client');
    await expect(bqQuery({ query: 'SELECT 1' })).rejects.toSatisfy(isLiveBigQueryBlocked);
    delete process.env.GCP_SA_JSON;
  });
});

describe('resolveDisposableBqTestTarget', () => {
  const approved = [{ project: 'market-assasin', dataset: 'ci_disposable' }];

  it('skips (null) unless RUN_LIVE_BQ_TESTS=1, even with credentials present', () => {
    expect(resolveDisposableBqTestTarget({ GOOGLE_APPLICATION_CREDENTIALS: '/k.json' }, approved)).toBeNull();
  });

  it('refuses the production dataset by name, even if someone approves it', () => {
    expect(() => resolveDisposableBqTestTarget({ RUN_LIVE_BQ_TESTS: '1', BQ_TEST_PROJECT: 'market-assasin', BQ_TEST_DATASET: 'usaspending' }, [{ project: 'market-assasin', dataset: 'usaspending' }])).toThrow(/production dataset/);
  });

  it('refuses datasets not named as disposable, and unapproved ones', () => {
    expect(() => resolveDisposableBqTestTarget({ RUN_LIVE_BQ_TESTS: '1', BQ_TEST_PROJECT: 'market-assasin', BQ_TEST_DATASET: 'mindy_core' }, approved)).toThrow(/not named as disposable/);
    expect(() => resolveDisposableBqTestTarget({ RUN_LIVE_BQ_TESTS: '1', BQ_TEST_PROJECT: 'market-assasin', BQ_TEST_DATASET: 'ci_other' }, approved)).toThrow(/not an approved/);
    expect(() => resolveDisposableBqTestTarget({ RUN_LIVE_BQ_TESTS: '1' }, approved)).toThrow(/requires BQ_TEST_PROJECT/);
  });

  it('returns the target only for an approved disposable dataset', () => {
    expect(resolveDisposableBqTestTarget({ RUN_LIVE_BQ_TESTS: '1', BQ_TEST_PROJECT: 'market-assasin', BQ_TEST_DATASET: 'ci_disposable' }, approved)).toEqual(approved[0]);
  });

  it('ships with no approved targets, so the live test cannot run until one is provisioned', () => {
    expect(() => resolveDisposableBqTestTarget({ RUN_LIVE_BQ_TESTS: '1', BQ_TEST_PROJECT: 'market-assasin', BQ_TEST_DATASET: 'ci_disposable' })).toThrow(/not an approved/);
  });
});

describe('uniqueTestTableName', () => {
  it('is unique per run and a valid BigQuery table name', () => {
    const now = new Date('2026-09-29T03:04:05Z');
    const a = uniqueTestTableName('awards-ingest it', now, () => 0.123);
    const b = uniqueTestTableName('awards-ingest it', now, () => 0.456);
    expect(a).toMatch(/^awards_ingest_it_20260929030405_[0-9a-z]{6}$/);
    expect(a).not.toBe(b);
  });
});

describe('unit-suite tripwire (src/test/no-live-bigquery.setup.ts)', () => {
  it('blocks the bq CLI through every child_process entry point', async () => {
    const cp = await import('node:child_process');
    expect(() => cp.execFileSync('bq', ['version'])).toThrow(/Unit tests may not call BigQuery/);
    expect(() => cp.spawnSync('bq', ['ls'])).toThrow(/Unit tests may not call BigQuery/);
    expect(() => cp.execSync('bq query --nouse_legacy_sql "SELECT 1"')).toThrow(/Unit tests may not call BigQuery/);
    expect(() => cp.execFileSync('/opt/homebrew/bin/bq', ['version'])).toThrow(/Unit tests may not call BigQuery/);
  });

  it('blocks raw REST calls to BigQuery', async () => {
    await expect(fetch('https://bigquery.googleapis.com/bigquery/v2/projects/p/queries', { method: 'POST' })).rejects.toThrow(/Unit tests may not call BigQuery/);
  });

  it('leaves other commands and hosts alone', async () => {
    const cp = await import('node:child_process');
    expect(cp.execFileSync('node', ['-e', 'process.stdout.write("ok")'], { encoding: 'utf8' })).toBe('ok');
  });
});
