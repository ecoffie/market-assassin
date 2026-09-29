#!/usr/bin/env node
/**
 * CI gate: prove a `next build` made ZERO live BigQuery calls.
 *
 *   npm run build 2>&1 | tee build.log && node scripts/assert-no-live-bigquery.mjs build.log
 *
 * Fails when the log shows BigQuery was actually reached:
 *   [bq-client] created      a BigQuery client was constructed (client.ts)
 *   [bq-miss]                a query ran and returned rows (cache.ts)
 *   BQ query failed          a query was attempted and failed at BigQuery (cache.ts)
 * `[bq-guard] blocked` lines are expected on a cold cache: they are the guard refusing.
 * A build with no KV (CI) exercises that path on every prerender that misses the cache.
 */
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('usage: assert-no-live-bigquery.mjs <build.log>');
  process.exit(2);
}
const log = readFileSync(file, 'utf8');
if (!/Compiled successfully|Generating static pages|Route \(app\)/.test(log)) {
  console.error('✗ build log does not look like a completed next build; refusing to certify it');
  process.exit(1);
}
const count = (re) => (log.match(re) ?? []).length;
const reached = {
  'client created': count(/\[bq-client\] created/g),
  'queries run ([bq-miss])': count(/\[bq-miss\]/g),
  'queries failed at BigQuery': count(/\[bq-cache\] BQ query failed/g),
};
const blocked = count(/\[bq-guard\] blocked/g);
const total = Object.values(reached).reduce((a, b) => a + b, 0);
if (total > 0) {
  console.error(`✗ build reached live BigQuery: ${JSON.stringify(reached)}`);
  process.exit(1);
}
console.log(`✓ zero live BigQuery calls during build (${blocked} guard block line${blocked === 1 ? '' : 's'})`);
