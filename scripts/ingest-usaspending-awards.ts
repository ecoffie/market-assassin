/**
 * ingest-usaspending-awards — keep the BigQuery `market-assasin.usaspending.awards` table FRESH.
 *
 * WHY THIS EXISTS (Eric, 2026-08-02): the 63M-row BQ awards table (which backs /awards, the
 * contractor DB, and — soon — the Past Awards map horizon) is a MANUAL bulk snapshot that was
 * last loaded 2026-04-23. The government is daily-fresh (FPDS reports award actions within ~3
 * business days; USASpending ingests nightly), so the table was ~110 days stale. Serving a "Past
 * Awards by NAICS" feature off April data in August would show a bidder an incomplete market —
 * exactly the silent-staleness class our oracles guard against. This script keeps it current.
 *
 * GRAIN (measured, not guessed): the table is TRANSACTION-level. `txn_id` is unique (141,880
 * rows = 141,880 distinct txn_id for Apr-2026); `award_id` repeats (one award = many mods). So
 * the incremental key is `txn_id`, and the load MERGEs on it (append-only would duplicate mods,
 * and re-issued corrections within FPDS's 90-day window would double-count).
 *
 * MECHANISM (mirrors scripts/load-nsn-bigquery.sh's `bq load`, adapted for incremental):
 *   1. watermark = MAX(action_date) currently in BQ.
 *   2. Request USASpending's async bulk-download API for CONTRACT award transactions with
 *      action_date in [watermark - TRAILING_CORRECTION_DAYS, today]. The trailing re-pull absorbs
 *      FPDS's 90-day corrections (amounts/dates that shift after the fact) — that window is
 *      RE-LOADED so a correction overwrites the stale row via the MERGE, not stacks on it.
 *   3. Poll the download job → fetch the zip → unzip the CSV(s).
 *   4. `bq load` the CSV into a STAGING table (awards_ingest_staging), then MERGE on txn_id into
 *      `awards` (update-on-match, insert-on-miss). Staging is truncated each run.
 *
 * BULK vs API: the async bulk-download returns ALL matching transactions in one zip (the API's
 * paginated spending_by_award caps at 100/page and is meant for interactive search, not a
 * ~180K-rows/month drain — the bulk-job rule: >1000 rows once → a local runner, never an HTTP
 * cron loop). This is that local runner.
 *
 * SAFETY: DRY-RUN BY DEFAULT. With no --apply it reports the plan (watermark, date range, the
 * download request it WOULD make, the MERGE it WOULD run) and writes NOTHING. --apply performs
 * the real download + load + merge. A multi-million-row BACKFILL (the one-time Apr→now catch-up)
 * is --apply --from=2026-04-23 and must be run deliberately after eyeballing the dry-run scope.
 *
 * USAGE:
 *   npx tsx scripts/ingest-usaspending-awards.ts                     # weekly incremental, DRY-RUN
 *   npx tsx scripts/ingest-usaspending-awards.ts --apply             # weekly incremental, REAL
 *   npx tsx scripts/ingest-usaspending-awards.ts --from=2026-04-23   # backfill the gap, DRY-RUN
 *   npx tsx scripts/ingest-usaspending-awards.ts --from=2026-04-23 --apply   # backfill, REAL
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { bqQuery, BQ_TABLES } from '@/lib/bigquery/client';

// FPDS lets agencies correct records for ~90 days; re-pull that trailing window so a corrected
// transaction OVERWRITES its stale row (via the txn_id MERGE) instead of being missed.
const TRAILING_CORRECTION_DAYS = 100;
const USASPENDING_BULK = 'https://api.usaspending.gov/api/v2/bulk_download/awards/';
const STAGING_TABLE = 'awards_ingest_staging';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const fromArg = args.find((a) => a.startsWith('--from='))?.split('=')[1];

function log(...m: unknown[]) { console.log('[ingest-awards]', ...m); }
function isoDay(d: Date) { return d.toISOString().slice(0, 10); }

async function currentWatermark(): Promise<string> {
  const rows = await bqQuery<{ max_date?: string }>({
    query: `SELECT CAST(MAX(action_date) AS STRING) AS max_date FROM ${BQ_TABLES.awards} WHERE fiscal_year >= 2025`,
  });
  const max = rows?.[0]?.max_date;
  if (!max) throw new Error('could not read MAX(action_date) from awards — refusing to guess a start date');
  return max;
}

async function main() {
  log(APPLY ? 'MODE: APPLY (real load)' : 'MODE: DRY-RUN (no writes) — pass --apply to load for real');

  const watermark = await currentWatermark();
  const today = isoDay(new Date());

  // Start date = an explicit --from (backfill) OR the watermark minus the correction window.
  let startDate: string;
  if (fromArg) {
    startDate = fromArg;
  } else {
    const w = new Date(watermark + 'T00:00:00Z');
    w.setUTCDate(w.getUTCDate() - TRAILING_CORRECTION_DAYS);
    startDate = isoDay(w);
  }

  log(`BQ awards watermark (current MAX action_date): ${watermark}`);
  log(`today: ${today}`);
  log(`staleness: ${Math.round((Date.parse(today) - Date.parse(watermark)) / 86400000)} days behind`);
  log(`planned pull window: action_date ${startDate} → ${today}` +
    (fromArg ? ' (BACKFILL — explicit --from)' : ` (weekly incremental: watermark − ${TRAILING_CORRECTION_DAYS}d correction window)`));

  // The bulk-download request body we WOULD post. CONTRACT award types only (A/B/C/D + IDVs);
  // the awards table is contract transactions. Same filter shape as searchAwardsByLocation.
  const downloadRequest = {
    filters: {
      prime_award_types: ['A', 'B', 'C', 'D', 'IDV_A', 'IDV_B', 'IDV_B_A', 'IDV_B_B', 'IDV_B_C', 'IDV_C', 'IDV_D', 'IDV_E'],
      date_type: 'action_date',
      date_range: { start_date: startDate, end_date: today },
    },
    columns: [], // empty = USASpending's full standard award column set
    file_format: 'csv',
  };

  log('bulk-download request that WOULD be POSTed to USASpending:');
  log('  ' + USASPENDING_BULK);
  log('  ' + JSON.stringify(downloadRequest));
  log(`staging table: ${BQ_TABLES.awards.replace('awards`', STAGING_TABLE + '`')}`);
  log(`MERGE key: txn_id (transaction grain — measured unique)`);

  if (!APPLY) {
    log('DRY-RUN complete. No download requested, no BQ writes.');
    log('Next: eyeball the window above, then re-run with --apply (weekly) or --from=<date> --apply (backfill).');
    return;
  }

  // ── APPLY path (guarded — real download + load + merge) ─────────────────────────────────────
  // Intentionally left as the next increment: wire the bulk-download POST → poll status_url →
  // download zip → unzip → `bq load --source_format=CSV` into STAGING_TABLE → MERGE on txn_id.
  // Keeping the DRY-RUN scope reviewable FIRST (per the ask-before-bulk-write rule) — the real
  // load writes millions of rows into BQ and must be run only after the window is approved.
  throw new Error('--apply not yet wired — the DRY-RUN plan is ready for review first (see log above).');
}

main().catch((e) => { console.error('[ingest-awards] FAILED:', e?.message || e); process.exit(1); });
