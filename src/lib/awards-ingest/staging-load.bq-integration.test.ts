/**
 * LIVE BigQuery integration test: awards-ingest staging load (two-member export).
 *
 * Runs ONLY in its own process: `npm run test:bq-integration` (vitest.bq-integration.config.ts),
 * never in the unit suite (which excludes *.bq-integration.test.ts and blocks all BigQuery).
 * That process requires RUN_LIVE_BQ_TESTS=1 and BQ_TEST_PROJECT/BQ_TEST_DATASET naming an
 * approved disposable dataset, and admits only `bq` commands confined to it
 * (src/test/bq-integration.setup.ts -> authorizeBqCommand). Each run uses a unique table and
 * drops it afterwards, even when an assertion fails.
 *
 * History: on 2026-09-29 this test, then gated on GCP_SA_JSON || GOOGLE_APPLICATION_CREDENTIALS,
 * ran against the production `usaspending` dataset.
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveDisposableBqTestTarget, uniqueTestTableName } from '@/lib/bigquery/guard';
import { loadCsvsIntoStaging } from './staging-load';

const liveTarget = resolveDisposableBqTestTarget();

describe('staging load integration (two-member export) [LIVE BigQuery, disposable dataset]', () => {
  const fixtureDir = join(process.cwd(), 'scripts/fixtures/awards-ingest');

  it('loads both CSV members into one complete staging table before MERGE', () => {
    const { project: PROJECT, dataset: DATASET } = liveTarget!;
    const TABLE = uniqueTestTableName('awards_ingest_staging_it');
    const { execFileSync } = require('node:child_process') as typeof import('node:child_process');
    const paths = [
      join(fixtureDir, 'two-member-fax-part1.csv'),
      join(fixtureDir, 'two-member-fax-part2.csv'),
    ];
    const schemaPath = join(fixtureDir, '.staging-schema-test.json');
    const loads: string[][] = [];

    try {
      loadCsvsIntoStaging({
        projectId: PROJECT,
        dataset: DATASET,
        stagingTable: TABLE,
        csvPaths: paths,
        schemaFilePath: schemaPath,
        execLoad: (args) => {
          loads.push(args);
          execFileSync('bq', args, { stdio: 'inherit' });
        },
      });

      expect(loads).toHaveLength(2);
      expect(loads[0]).toContain('--replace');
      expect(loads[1]).toContain('--noreplace');
      expect(loads.every((args) => !args.includes('--autodetect'))).toBe(true);

      const countRaw = execFileSync('bq', [
        '--project_id=' + PROJECT,
        'query',
        '--nouse_legacy_sql',
        '--format=csv',
        // `rows` is a reserved word in BigQuery SQL; the old alias made this query always fail.
        `SELECT COUNT(*) AS n FROM \`${PROJECT}.${DATASET}.${TABLE}\``,
      ], { encoding: 'utf8' });
      expect(countRaw.trim().split('\n').pop()).toBe('2');

      const faxRaw = execFileSync('bq', [
        '--project_id=' + PROJECT,
        'query',
        '--nouse_legacy_sql',
        '--format=csv',
        `SELECT recipient_fax_number FROM \`${PROJECT}.${DATASET}.${TABLE}\` ORDER BY contract_transaction_unique_key`,
      ], { encoding: 'utf8' });
      const faxValues = faxRaw.trim().split('\n').slice(1);
      expect(faxValues).toEqual(['6264402724', '(626) 440-2724']);
    } finally {
      execFileSync('bq', ['--project_id=' + PROJECT, 'rm', '-f', '-t', `${PROJECT}:${DATASET}.${TABLE}`], { stdio: 'inherit' });
    }
  }, 120_000);
});
