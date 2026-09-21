#!/usr/bin/env node
/**
 * Rebuild the agency-breakdown rollup tables (agency_top_recipients,
 * agency_top_naics) from the awards table.
 *
 * Run this ONCE after each monthly USASpending ingest. It does the
 * expensive full-table scan a single time and writes tiny clustered
 * rollups that the /agencies pages read cheaply — instead of every
 * page-load scanning the full awards table (the BQ-quota killer).
 *
 * Usage:
 *   GOOGLE_SERVICE_ACCOUNT_JSON='{...}' node scripts/bq-refresh-agency-rollups.js
 *   # or with a key file:
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/key.json node scripts/bq-refresh-agency-rollups.js
 *
 * Reads the SQL from scripts/bq-build-agency-rollups.sql and substitutes
 * PROJECT.DATASET. Prints bytes processed so you can confirm it's a
 * one-time cost, not a per-request one.
 */
const fs = require('fs');
const path = require('path');
const { BigQuery } = require('@google-cloud/bigquery');

const PROJECT_ID = process.env.BQ_PROJECT_ID || 'market-assasin';
const DATASET = process.env.BQ_DATASET || 'usaspending';

function getClient() {
  const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.GCP_SERVICE_ACCOUNT_JSON;
  if (saJson) {
    const creds = JSON.parse(saJson);
    return new BigQuery({ projectId: creds.project_id || PROJECT_ID, credentials: creds });
  }
  // Falls back to GOOGLE_APPLICATION_CREDENTIALS / ADC.
  return new BigQuery({ projectId: PROJECT_ID });
}

async function main() {
  const bq = getClient();
  const sqlPath = path.join(__dirname, 'bq-build-agency-rollups.sql');
  const raw = fs.readFileSync(sqlPath, 'utf8');
  const sql = raw.replace(/PROJECT\.DATASET/g, `${PROJECT_ID}.${DATASET}`);

  // The file has two CREATE OR REPLACE statements; run them in sequence.
  const statements = sql
    .split(/;\s*\n/)
    .map(s => s.trim())
    .filter(s => s && !s.startsWith('--') && /create or replace/i.test(s));

  let totalBytes = 0;
  for (const [i, stmt] of statements.entries()) {
    const label = /agency_top_recipients/i.test(stmt) ? 'agency_top_recipients'
      : /agency_top_naics/i.test(stmt) ? 'agency_top_naics' : `statement ${i + 1}`;
    process.stdout.write(`Building ${label}… `);
    const t = Date.now();
    const [job] = await bq.createQueryJob({ query: stmt, useLegacySql: false });
    await job.getQueryResults();
    const [meta] = await job.getMetadata();
    const bytes = Number(meta.statistics?.query?.totalBytesProcessed || 0);
    totalBytes += bytes;
    console.log(`done (${((Date.now() - t) / 1000).toFixed(1)}s, ${(bytes / 1e9).toFixed(2)} GB scanned)`);
  }

  console.log(`\n✅ Rollups rebuilt. Total scanned this run: ${(totalBytes / 1e9).toFixed(2)} GB`);
  console.log('   (This is the ONLY place that scans the full awards table for agency breakdowns now.)');
}

main().catch(err => {
  console.error('❌ Rollup refresh failed:', err.message || err);
  process.exit(1);
});
