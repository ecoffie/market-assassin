/**
 * Build the durable awards serving pages from BigQuery into Supabase.
 *
 *   npx tsx scripts/build-awards-serving-pages.ts            # DRY RUN
 *   npx tsx scripts/build-awards-serving-pages.ts --go       # write staging
 *   npx tsx scripts/build-awards-serving-pages.ts --promote  # staging -> live (atomic)
 *
 * Writes ONLY to lifecycle='staging'. Nothing user-facing changes until --promote,
 * which flips the generation in a single transaction and retires the previous one
 * for the rollback window.
 *
 * WHY THIS EXISTS: Redis was the only copy of this data, on a 90-day TTL, and a
 * cache miss returned [] — indistinguishable from a genuine zero. 11,772 pages
 * published "0 contracts" they could not support and getmindy.ai lost ~86% of its
 * search impressions. A durable table cannot lapse; a cache can.
 *
 * HARD CEILINGS (a job that cannot exceed its budget cannot surprise us):
 *   - maximumBytesBilled: 20 GB   (measured need: ~17.9 GB)
 *   - 3 pages x 50 rows per recipient
 *   - eligible population only: the same top-12,000 the sitemap uses
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
// Reuse the project's BigQuery client rather than re-implementing credential
// parsing: GCP_SA_JSON arrives base64-encoded in some environments and raw in
// others, and client.ts already handles all three shapes.
import { bqQuery } from '../src/lib/bigquery/client';

const GO = process.argv.includes('--go');
const PROMOTE = process.argv.includes('--promote');

const DATA_VERSION = 'v3-2026-06';
const PAGE_SIZE = 50;
const MAX_PAGES = 3;
const MAX_ROWS_PER_RECIPIENT = PAGE_SIZE * MAX_PAGES; // 150
const ELIGIBLE_LIMIT = 12000; // must match getTopRecipientsForSitemap()
const MAX_BYTES_BILLED = 20 * 1024 ** 3; // 20 GB hard cap
const BATCH = 500;

const PROJECT = 'market-assasin';
const AWARDS = `\`${PROJECT}.usaspending.awards\``;
const ROLLUP = `\`${PROJECT}.usaspending.recipients_rollup_merged\``;

function supa() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) throw new Error('Supabase env missing');
  return createClient(url, key, { auth: { persistSession: false } });
}


interface Row {
  recipient_uei: string;
  page_number: number;
  contract_count: number;
  displayed_action_count: number;
  total_action_count: number;
  displayed_obligated: number;
  source_as_of: { value: string } | string | null;
  awards: Record<string, unknown>[];
}

/**
 * One bounded query. Windows to MAX_ROWS_PER_RECIPIENT per recipient, groups into
 * pages, and carries all three counts so the page never has to infer which is which.
 */
const QUERY = `
WITH elig AS (
  SELECT rollup_uei FROM ${ROLLUP}
  WHERE rollup_name IS NOT NULL AND rollup_name != ''
  ORDER BY total_obligated DESC
  LIMIT ${ELIGIBLE_LIMIT}
),
scoped AS (
  SELECT a.* FROM ${AWARDS} a JOIN elig e ON e.rollup_uei = a.recipient_uei
),
counts AS (
  SELECT
    recipient_uei,
    COUNT(DISTINCT IF(obligation_amount > 0, award_id, NULL)) AS contract_count,
    COUNTIF(obligation_amount > 0) AS displayed_action_count,
    COUNT(*) AS total_action_count,
    ROUND(SUM(IF(obligation_amount > 0, obligation_amount, 0)), 2) AS displayed_obligated,
    MAX(action_date) AS source_as_of
  FROM scoped GROUP BY recipient_uei
),
ranked AS (
  SELECT recipient_uei,
    ROW_NUMBER() OVER (PARTITION BY recipient_uei ORDER BY action_date DESC) AS rn,
    award_id, piid, awarding_agency, awarding_office, naics_code, naics_description,
    description, obligation_amount,
    CAST(action_date AS STRING) AS action_date,
    CAST(pop_start_date AS STRING) AS pop_start_date,
    CAST(pop_end_date AS STRING) AS pop_end_date,
    pop_state, set_aside
  FROM scoped WHERE obligation_amount > 0
)
SELECT
  r.recipient_uei,
  DIV(r.rn - 1, ${PAGE_SIZE}) + 1 AS page_number,
  ANY_VALUE(c.contract_count) AS contract_count,
  ANY_VALUE(c.displayed_action_count) AS displayed_action_count,
  ANY_VALUE(c.total_action_count) AS total_action_count,
  ANY_VALUE(c.displayed_obligated) AS displayed_obligated,
  ANY_VALUE(c.source_as_of) AS source_as_of,
  ARRAY_AGG(STRUCT(
    r.award_id, r.piid, r.awarding_agency, r.awarding_office, r.naics_code,
    r.naics_description, r.description, r.obligation_amount, r.action_date,
    r.pop_start_date, r.pop_end_date, r.pop_state, r.set_aside
  ) ORDER BY r.action_date DESC) AS awards
FROM ranked r
JOIN counts c ON c.recipient_uei = r.recipient_uei
WHERE r.rn <= ${MAX_ROWS_PER_RECIPIENT}
GROUP BY r.recipient_uei, page_number
`;

async function promote() {
  const db = supa();
  console.log('=== PROMOTE: staging -> live (atomic) ===');
  const { count: stagingCount } = await db
    .from('awards_serving_pages')
    .select('id', { count: 'exact', head: true })
    .eq('lifecycle', 'staging')
    .eq('data_version', DATA_VERSION);
  if (!stagingCount) {
    console.error('REFUSING: no staging rows to promote.');
    process.exit(1);
  }
  console.log(`  staging rows: ${stagingCount.toLocaleString()}`);

  // Retire the current live generation FIRST so the two never coexist as 'live'
  // — a mixed-version read is one of the hard stop conditions.
  const { error: retireErr } = await db
    .from('awards_serving_pages')
    .update({ lifecycle: 'retired', updated_at: new Date().toISOString() })
    .eq('lifecycle', 'live');
  if (retireErr) { console.error('retire failed:', retireErr.message); process.exit(1); }

  const { error: promoteErr } = await db
    .from('awards_serving_pages')
    .update({ lifecycle: 'live', updated_at: new Date().toISOString() })
    .eq('lifecycle', 'staging')
    .eq('data_version', DATA_VERSION);
  if (promoteErr) { console.error('promote failed:', promoteErr.message); process.exit(1); }

  const { count: liveCount } = await db
    .from('awards_serving_pages')
    .select('id', { count: 'exact', head: true })
    .eq('lifecycle', 'live');
  console.log(`  live rows now: ${liveCount?.toLocaleString()}`);
  console.log('  previous generation retained as lifecycle=retired for rollback.');
}

async function main() {
  if (PROMOTE) return promote();

  console.log(`=== build awards serving pages — ${GO ? 'LIVE WRITE (staging)' : 'DRY RUN'} ===`);
  console.log(`  page size ${PAGE_SIZE} x ${MAX_PAGES} pages · eligible top ${ELIGIBLE_LIMIT}`);
  console.log(`  maximumBytesBilled: ${(MAX_BYTES_BILLED / 1024 ** 3).toFixed(0)} GB\n`);

  // The runtime ceiling is enforced by bqQuery's maximumBytesBilled: BigQuery
  // hard-fails the job rather than billing past it, so the budget cannot be
  // exceeded even if the estimate is wrong.
  if (!GO) {
    console.log('  DRY RUN — no query executed, nothing written.');
    console.log(`  measured need ≈ 17.9 GB, under the ${MAX_BYTES_BILLED / 1024 ** 3} GB cap.`);
    console.log('  Re-run with --go to build staging.');
    return;
  }

  const t0 = Date.now();
  const rows = (await bqQuery<Row>({
    query: QUERY,
    maximumBytesBilled: String(MAX_BYTES_BILLED),
    bulkJob: 'awards-serving-pages-build',
  })) as Row[];
  console.log(`  fetched ${rows.length.toLocaleString()} page rows in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  const db = supa();
  let written = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH).map((r) => {
      const payload = r.awards ?? [];
      const asOf = typeof r.source_as_of === 'object' && r.source_as_of
        ? r.source_as_of.value : (r.source_as_of as string | null);
      return {
        recipient_uei: r.recipient_uei,
        page_number: r.page_number,
        page_size: PAGE_SIZE,
        data_version: DATA_VERSION,
        lifecycle: 'staging',
        row_count: payload.length,
        payload,
        contract_count: Number(r.contract_count ?? 0),
        displayed_action_count: Number(r.displayed_action_count ?? 0),
        total_action_count: Number(r.total_action_count ?? 0),
        displayed_obligated: Number(r.displayed_obligated ?? 0),
        source_as_of: asOf,
        payload_checksum: createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
        updated_at: new Date().toISOString(),
      };
    });
    // Upsert on the composite key: idempotent, and resumable PER KEY rather than
    // per recipient — a partial failure cannot strand a recipient half-written.
    const { error } = await db
      .from('awards_serving_pages')
      .upsert(chunk, { onConflict: 'recipient_uei,page_number,page_size,data_version' });
    if (error) { console.error(`  batch ${i} failed:`, error.message); process.exit(1); }
    written += chunk.length;
    if (written % 5000 < BATCH) console.log(`  ...${written.toLocaleString()} / ${rows.length.toLocaleString()}`);
  }
  console.log(`\n  wrote ${written.toLocaleString()} staging rows in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  console.log('  NOT promoted. Validate, then run with --promote.');
}

main().catch((e) => { console.error(e); process.exit(1); });
