/**
 * Smoke test for the BigQuery client + query helpers.
 * Runs each helper against real data, prints results.
 * Expects ADC credentials (gcloud auth application-default login).
 */
import { BigQuery } from '@google-cloud/bigquery';

const PROJECT_ID = 'market-assasin';
const DATASET = 'usaspending';
const bq = new BigQuery({ projectId: PROJECT_ID });

const queries = [
  {
    name: 'Top 10 contractors by total obligated',
    sql: `
      SELECT recipient_uei, recipient_name, total_obligated, award_count, distinct_agency_count
      FROM \`${PROJECT_ID}.${DATASET}.recipients\`
      ORDER BY total_obligated DESC
      LIMIT 10
    `,
  },
  {
    name: 'Top 5 NAICS by total dollars',
    sql: `
      SELECT naics_code, naics_description, total_obligated, recipient_count
      FROM \`${PROJECT_ID}.${DATASET}.naics_summary\`
      ORDER BY total_obligated DESC
      LIMIT 5
    `,
  },
  {
    name: 'Top 5 agencies',
    sql: `
      SELECT awarding_agency, total_obligated, recipient_count
      FROM \`${PROJECT_ID}.${DATASET}.agency_summary\`
      ORDER BY total_obligated DESC
      LIMIT 5
    `,
  },
  {
    name: 'Sample executive disclosures (5 random)',
    sql: `
      SELECT recipient_uei, exec_name, exec_rank, exec_amount
      FROM \`${PROJECT_ID}.${DATASET}.recipient_executives\`
      WHERE exec_amount > 0
      ORDER BY exec_amount DESC
      LIMIT 5
    `,
  },
  {
    name: 'Booz Allen sample (recipient lookup by name)',
    sql: `
      SELECT recipient_uei, recipient_name, total_obligated, award_count
      FROM \`${PROJECT_ID}.${DATASET}.recipients\`
      WHERE LOWER(recipient_name) LIKE '%booz allen%'
      ORDER BY total_obligated DESC
      LIMIT 5
    `,
  },
];

for (const { name, sql } of queries) {
  console.log(`\n=== ${name} ===`);
  const t = Date.now();
  const [rows] = await bq.query({ query: sql, location: 'US', maximumBytesBilled: String(1024 * 1024 * 1024 * 10) });
  console.log(`(${Date.now() - t}ms, ${rows.length} rows)`);
  console.table(rows);
}
