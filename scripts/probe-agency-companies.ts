/**
 * Throwaway verification probe for searchRecipients({ agency, state }) — the new
 * "sells-to-agency" scope. Run with: npx tsx scripts/probe-agency-companies.ts
 *
 * Asserts:
 *  (a) returns real FL firms
 *  (b) each returned firm genuinely has VA awards (spot-check the top firm's awards)
 *  (c) does NOT return firms with zero VA awards
 *  (d) prints bytes billed so the cap can be confirmed
 */
import { BigQuery } from '@google-cloud/bigquery';
import { searchRecipients } from '../src/lib/bigquery/recipients';
import { BQ_TABLES } from '../src/lib/bigquery/client';

// Lightweight local client (same ADC auth path as src/lib/bigquery/client.ts,
// which doesn't export its client instance) — just for this probe's direct
// spot-check queries.
const client = new BigQuery({ projectId: 'market-assasin' });

async function main() {
  console.log('--- searchRecipients({ state: FL, agency: "Veterans Affairs", sortBy: total_obligated, limit: 10, liveBq: true }) ---');
  const { rows, total } = await searchRecipients({
    state: 'FL',
    agency: 'Veterans Affairs',
    sortBy: 'total_obligated',
    limit: 10,
    liveBq: true,
  });

  console.log(`total (all matching, pre-limit): ${total}`);
  console.log(`rows returned: ${rows.length}`);
  for (const r of rows) {
    console.log(`  ${r.recipient_name} | ${r.state} | $${(r.total_obligated / 1e6).toFixed(1)}M | ${r.award_count} awards | ${r.distinct_agency_count} agencies`);
  }

  if (rows.length === 0) {
    console.error('FAIL: 0 rows returned — a 200 with 0 rows is a FAIL per the task spec.');
    process.exit(1);
  }

  // (a) real FL firms
  const allFl = rows.every((r) => r.state === 'FL');
  console.log(`\n(a) all rows are FL: ${allFl}`);
  if (!allFl) { console.error('FAIL: a non-FL firm leaked into the FL-scoped result.'); process.exit(1); }

  // (b) spot-check the TOP firm's awards genuinely include a VA (Veterans Affairs) award
  const top = rows[0];
  console.log(`\n(b) spot-checking top firm's awards: ${top.recipient_name} (${top.recipient_uei})`);
  const [job] = await client.createQueryJob({
    query: `
      SELECT awarding_agency, awarding_sub_agency, obligation_amount, fiscal_year
      FROM ${BQ_TABLES.awards}
      WHERE recipient_uei = @uei
        AND fiscal_year BETWEEN @minYear AND @maxYear
        AND (LOWER(awarding_agency) LIKE '%veterans%affairs%' OR LOWER(awarding_sub_agency) LIKE '%veterans%affairs%')
      ORDER BY obligation_amount DESC
      LIMIT 5
    `,
    params: { uei: top.recipient_uei, minYear: new Date().getFullYear() - 2, maxYear: new Date().getFullYear() },
    maximumBytesBilled: String(20 * 1024 * 1024 * 1024),
  });
  const [vaAwards] = await job.getQueryResults();
  console.log(`  VA awards found for top firm: ${vaAwards.length}`);
  for (const a of vaAwards as Array<{ awarding_agency: string; awarding_sub_agency: string; obligation_amount: number; fiscal_year: number }>) {
    console.log(`    FY${a.fiscal_year} ${a.awarding_agency} / ${a.awarding_sub_agency} — $${a.obligation_amount.toLocaleString()}`);
  }
  if (vaAwards.length === 0) {
    console.error('FAIL: top firm has NO real VA awards in the scan window — off-agency leak.');
    process.exit(1);
  }

  // (c) does NOT return firms with zero VA awards — spot-check ALL returned rows have ≥1 VA award
  console.log('\n(c) spot-checking ALL returned rows have ≥1 real VA award...');
  let anyZero = false;
  for (const r of rows) {
    const [j2] = await client.createQueryJob({
      query: `
        SELECT COUNT(*) AS n
        FROM ${BQ_TABLES.awards}
        WHERE recipient_uei = @uei
          AND fiscal_year BETWEEN @minYear AND @maxYear
          AND (LOWER(awarding_agency) LIKE '%veterans%affairs%' OR LOWER(awarding_sub_agency) LIKE '%veterans%affairs%')
      `,
      params: { uei: r.recipient_uei, minYear: new Date().getFullYear() - 2, maxYear: new Date().getFullYear() },
      maximumBytesBilled: String(20 * 1024 * 1024 * 1024),
    });
    const [res] = await j2.getQueryResults();
    const n = Number((res[0] as { n: number }).n || 0);
    console.log(`  ${r.recipient_name}: ${n} VA awards`);
    if (n === 0) { anyZero = true; console.error(`  FAIL: ${r.recipient_name} has ZERO VA awards but was returned.`); }
  }
  if (anyZero) process.exit(1);

  console.log('\n(d) BYTES BILLED for the main searchRecipients call:');
  // Re-run once more to read job stats (searchRecipients itself doesn't expose bytesBilled, so
  // reproduce the same query shape directly to report the metric honestly).
  const [job2] = await client.createQueryJob({
    query: `
      WITH matched AS (
        SELECT
          recipient_uei,
          ANY_VALUE(recipient_name) AS recipient_name,
          SUM(obligation_amount) AS total_obligated,
          COUNT(DISTINCT award_id) AS award_count,
          COUNT(DISTINCT awarding_agency) AS distinct_agency_count
        FROM ${BQ_TABLES.awards}
        WHERE obligation_amount > 0
          AND recipient_uei IS NOT NULL
          AND fiscal_year BETWEEN @minYear AND @maxYear
          AND (LOWER(awarding_agency) LIKE '%veterans%affairs%' OR LOWER(awarding_sub_agency) LIKE '%veterans%affairs%')
          AND recipient_state = @state
        GROUP BY recipient_uei
      )
      SELECT m.recipient_uei, m.recipient_name, m.total_obligated, m.award_count, m.distinct_agency_count
      FROM matched m
      ORDER BY m.total_obligated DESC
      LIMIT 10
    `,
    params: { minYear: new Date().getFullYear() - 2, maxYear: new Date().getFullYear(), state: 'FL' },
    maximumBytesBilled: String(20 * 1024 * 1024 * 1024),
  });
  await job2.getQueryResults();
  const [metadata] = await job2.getMetadata();
  const bytesBilled = Number(metadata.statistics?.query?.totalBytesBilled || 0);
  const bytesProcessed = Number(metadata.statistics?.query?.totalBytesProcessed || 0);
  console.log(`  totalBytesProcessed: ${(bytesProcessed / 1e6).toFixed(1)} MB`);
  console.log(`  totalBytesBilled: ${(bytesBilled / 1e6).toFixed(1)} MB`);
  console.log(`  cap (maximumBytesBilled): 20,480 MB (20 GiB)`);
  console.log(`  within cap: ${bytesBilled < 20 * 1024 * 1024 * 1024}`);

  console.log('\nALL CHECKS PASSED.');
}

main().catch((e) => { console.error('ERROR:', e); process.exit(1); });
