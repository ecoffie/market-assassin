#!/usr/bin/env npx tsx
/**
 * Live BQ regression for keyword coverage. Read-only. Not a merge gate.
 *
 * Usage (from the feature worktree):
 *   npx tsx scripts/verify-keyword-coverage-bq.mts
 */
import { config } from 'dotenv';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const WORKTREE = dirname(SCRIPT_DIR);
const PRIMARY = '/Users/ericcoffie/Market Assasin/market-assassin';
config({ path: join(WORKTREE, '.env.local'), quiet: true });
config({ path: join(PRIMARY, '.env.local'), quiet: true });

const { queryKeywordCoverage } = await import('../src/lib/market/keyword-coverage.ts');
const { runKeywordCoverageBq, descriptionMatchPattern } = await import('../src/lib/market/keyword-coverage-bq.ts');
const { latestCompleteFiscalYear } = await import('../src/lib/utils/fiscal-year.ts');
const { bqQuery, BQ_TABLES, bqJobOptions } = await import('../src/lib/bigquery/client.ts');

const KEYWORDS = [
  'patrol',
  'patrol boat',
  'patrol vessel',
  'patrol cutter',
  'guard',
  'janitorial',
  'roofing',
  'cybersecurity',
  'catering',
  'trucking',
  'machining',
  'dredging',
  'hvac',
  'software',
  'drones',
  'demolition',
  'zxqvplm',
];

function usd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return 'null';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  return `${sign}$${Math.round(abs).toLocaleString()}`;
}

const fy = latestCompleteFiscalYear();
const out: Record<string, unknown> = {
  measured_at: new Date().toISOString(),
  fiscal_year: fy,
  source: 'bigquery_usaspending_awards',
  primary_sense: 'work_text',
  keywords: {},
};

async function grainProof() {
  const pattern = descriptionMatchPattern('patrol');
  const started = Date.now();
  const rows = await bqQuery({
    query: `
      WITH matched AS (
        SELECT txn_id, award_id, obligation_amount, total_obligated, current_award_value
        FROM ${BQ_TABLES.awards}
        WHERE fiscal_year = @fy
          AND REGEXP_CONTAINS(LOWER(IFNULL(description, '')), @pattern)
      )
      SELECT
        COUNT(*) AS txn_n,
        COUNT(DISTINCT award_id) AS award_n,
        SUM(IFNULL(obligation_amount, 0)) AS action_dollars,
        SUM(IFNULL(total_obligated, 0)) AS snapshot_total_obligated,
        SUM(IFNULL(current_award_value, 0)) AS snapshot_current_award_value
      FROM matched
    `,
    params: { fy, pattern },
    ...bqJobOptions({
      feature: 'keyword-coverage-audit',
      tool: 'get_keyword_coverage',
      queryFamily: 'grain-proof-patrol',
    }),
  });
  const row = rows[0] as Record<string, number>;
  const action = Number(row.action_dollars || 0);
  const snap = Number(row.snapshot_total_obligated || 0);
  return {
    ms: Date.now() - started,
    txn_n: Number(row.txn_n || 0),
    award_n: Number(row.award_n || 0),
    action_dollars: action,
    snapshot_total_obligated: snap,
    snapshot_current_award_value: Number(row.snapshot_current_award_value || 0),
    snapshot_over_action: action === 0 ? null : snap / action,
    grain_ok: snap > action * 10,
  };
}

async function measure(keyword: string) {
  const started = Date.now();
  const all = await queryKeywordCoverage(keyword);
  const allMs = Date.now() - started;
  const idvStarted = Date.now();
  let awardsOnly: Awaited<ReturnType<typeof runKeywordCoverageBq>> | { error: string };
  try {
    awardsOnly = await runKeywordCoverageBq({
      keyword,
      fiscalYear: fy,
      awardIdPrefix: 'CONT_AWD_',
    });
  } catch (err) {
    awardsOnly = { error: err instanceof Error ? err.message : String(err) };
  }
  const idvMs = Date.now() - idvStarted;
  const cov = all.coverage;
  const allTotal = cov?.totalMarket ?? (all.status === 'NO_MATCHES_MEASURED' ? 0 : null);
  const awdTotal = 'totalMarket' in awardsOnly ? awardsOnly.totalMarket : null;
  const delta = allTotal != null && awdTotal != null ? allTotal - awdTotal : null;
  const deltaPct = allTotal ? (delta ?? 0) / allTotal : null;
  return {
    status: all.status,
    degraded: all.degraded,
    ms: allMs,
    idv_ms: idvMs,
    grounded: all.status === 'MARKET_EVIDENCE_FOUND',
    total_market: cov?.totalMarket ?? null,
    transaction_count: cov?.transactionCount ?? (all.status === 'NO_MATCHES_MEASURED' ? 0 : null),
    unique_award_count: cov?.uniqueAwardCount ?? (all.status === 'NO_MATCHES_MEASURED' ? 0 : null),
    naics_count: cov?.naicsCount ?? null,
    psc_count: cov?.pscCount ?? null,
    lead_naics: cov?.allNaics[0] ?? null,
    lead_psc: cov?.topPsc ?? null,
    has_561612: cov?.allNaics.some((n) => n.code === '561612') ?? false,
    naics_561612_amount: cov?.allNaics.find((n) => n.code === '561612')?.amount ?? 0,
    has_336611: cov?.allNaics.some((n) => n.code === '336611') ?? false,
    has_336612: cov?.allNaics.some((n) => n.code === '336612') ?? false,
    psc_1905: cov?.topPscList.find((p) => p.code === '1905') ?? null,
    source: cov?.source ?? null,
    fiscal_year: cov?.fiscalYear ?? fy,
    max_action_date: cov?.sourceMaxActionDate ?? null,
    idv: 'error' in awardsOnly
      ? { error: awardsOnly.error }
      : {
          awards_only_total: awdTotal,
          all_minus_awards_only: delta,
          idv_share_of_matched: deltaPct,
        },
    reason: all.reason ?? null,
  };
}

console.log(`FY${fy} keyword coverage live BQ regression`);
out.grain_proof_patrol = await grainProof();
console.log('grain', out.grain_proof_patrol);

for (const keyword of KEYWORDS) {
  const row = await measure(keyword);
  (out.keywords as Record<string, unknown>)[keyword] = row;
  console.log(
    JSON.stringify({
      keyword,
      status: row.status,
      total: usd(row.total_market),
      txn: row.transaction_count,
      awards: row.unique_award_count,
      lead: row.lead_naics ? `${row.lead_naics.code} ${row.lead_naics.name}` : null,
      psc: row.lead_psc ? `${row.lead_psc.code} ${row.lead_psc.name}` : null,
      ms: row.ms,
      idv_share: row.idv && 'idv_share_of_matched' in row.idv
        ? row.idv.idv_share_of_matched
        : null,
    }),
  );
}

const dest = join(WORKTREE, '.tmp-keyword-coverage-bq-live.json');
writeFileSync(dest, JSON.stringify(out, null, 2));
console.log(`wrote ${dest}`);
