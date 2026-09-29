import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  authorizeBqCommand,
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

  it('blocks app code under Vitest unconditionally: not credentials, not RUN_LIVE_BQ_TESTS=1', () => {
    expect(liveBigQueryBlockReason({ VITEST: 'true' })).toMatch(/never calls BigQuery under Vitest/);
    expect(liveBigQueryBlockReason({ VITEST: 'true', GOOGLE_APPLICATION_CREDENTIALS: '/k.json', GCP_SA_JSON: '{}' })).toMatch(/under Vitest/);
    expect(liveBigQueryBlockReason({ VITEST: 'true', RUN_LIVE_BQ_TESTS: '1', BQ_TEST_PROJECT: 'p', BQ_TEST_DATASET: 'ci_x' })).toMatch(/under Vitest/);
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

describe('authorizeBqCommand (integration process only)', () => {
  const T = { project: 'market-assasin', dataset: 'ci_disposable' };
  const P = `--project_id=${T.project}`;
  const ok = (args: string[]) => authorizeBqCommand(args, T).ok;

  it("admits exactly the integration test's commands", () => {
    expect(ok([P, 'load', '--source_format=CSV', '--skip_leading_rows=1', '--allow_quoted_newlines', '--replace', 'ci_disposable.awards_it_1', '/tmp/a.csv', '/tmp/s.json'])).toBe(true);
    expect(ok([P, 'query', '--nouse_legacy_sql', '--format=csv', 'SELECT COUNT(*) AS n FROM `market-assasin.ci_disposable.awards_it_1`'])).toBe(true);
    expect(ok([P, 'rm', '-f', '-t', 'market-assasin:ci_disposable.awards_it_1'])).toBe(true);
    expect(ok(['version'])).toBe(true);
  });

  it('refuses the 2026-09-29 incident commands against production', () => {
    expect(ok([P, 'load', '--replace', 'usaspending.awards_ingest_staging_fixture_test', '/tmp/a.csv', '/tmp/s.json'])).toBe(false);
    expect(ok([P, 'query', '--nouse_legacy_sql', 'SELECT COUNT(*) AS n FROM `market-assasin.usaspending.awards_ingest_staging_fixture_test`'])).toBe(false);
  });

  it('refuses anything that escapes the dataset or writes outside it', () => {
    expect(ok(['--project_id=other', 'query', 'SELECT 1 FROM `other.ci_disposable.t`'])).toBe(false);
    expect(ok([P, '--project_id=other', 'show', 'ci_disposable.t'])).toBe(false);
    expect(ok([P, 'query', 'SELECT * FROM `market-assasin.ci_disposable.t` JOIN `market-assasin.usaspending.awards` USING (k)'])).toBe(false);
    expect(ok([P, 'query', 'SELECT * FROM usaspending.awards'])).toBe(false); // unqualified
    expect(ok([P, 'query', '--destination_table=usaspending.awards', 'SELECT 1 AS x FROM `market-assasin.ci_disposable.t`'])).toBe(false);
    expect(ok([P, 'query', 'DELETE FROM `market-assasin.ci_disposable.t` WHERE true'])).toBe(false);
    expect(ok([P, 'query', 'SELECT 1 FROM `market-assasin.ci_disposable.t`; DROP TABLE `market-assasin.usaspending.awards`'])).toBe(false);
    expect(ok([P, 'rm', '-r', '-f', '-d', 'market-assasin:ci_disposable'])).toBe(false);
    expect(ok([P, 'rm', '-f', 'market-assasin:ci_disposable.t'])).toBe(false); // -t required
    expect(ok([P, 'cp', 'ci_disposable.t', 'usaspending.awards'])).toBe(false);
    expect(ok([P, 'mk', '--dataset', 'market-assasin:ci_new'])).toBe(false);
    expect(ok([P, 'load', 'market-assasin:usaspending.x', '/tmp/a.csv', '/tmp/s.json'])).toBe(false);
  });
});

describe('platform-health reads no credentials before the guard', () => {
  it('checks liveBigQueryBlockReason() before importing the SDK or reading GCP_SA_JSON', () => {
    const src = readFileSync(new URL('../analytics/platform-health.ts', import.meta.url), 'utf8');
    const guard = src.indexOf('liveBigQueryBlockReason()');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(src.indexOf("import('@google-cloud/bigquery')"));
    expect(guard).toBeLessThan(src.indexOf('process.env.GCP_SA_JSON'));
  });
});

describe('unit-suite tripwire (src/test/no-live-bigquery.setup.ts)', () => {
  it('cannot be disabled by RUN_LIVE_BQ_TESTS=1 (the flag is not read by the unit setup at all)', async () => {
    const setup = readFileSync(new URL('../../test/no-live-bigquery.setup.ts', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//, '');
    expect(setup).not.toMatch(/RUN_LIVE_BQ_TESTS/);
    process.env.RUN_LIVE_BQ_TESTS = '1';
    const cp = await import('node:child_process');
    expect(() => cp.execFileSync('bq', ['version'])).toThrow(/Unit tests may not call BigQuery/);
    delete process.env.RUN_LIVE_BQ_TESTS;
  });

  it('the unit config excludes integration files, and only the integration config includes them', async () => {
    const unit = readFileSync(new URL('../../../vitest.config.ts', import.meta.url), 'utf8');
    const integ = readFileSync(new URL('../../../vitest.bq-integration.config.ts', import.meta.url), 'utf8');
    expect(unit).toMatch(/'\*\*\/\*\.bq-integration\.test\.ts'/);
    expect(unit).toMatch(/no-live-bigquery\.setup\.ts/);
    expect(integ).toMatch(/include: \['src\/\*\*\/\*\.bq-integration\.test\.ts'\]/);
    expect(integ).toMatch(/bq-integration\.setup\.ts/);
    expect(integ).not.toMatch(/no-live-bigquery|unit\.test/);
  });

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
