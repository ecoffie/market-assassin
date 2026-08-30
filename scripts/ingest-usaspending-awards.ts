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
 *   4. `bq load` the CSV into a STAGING table, then MERGE on txn_id into `awards`.
 *   5. Rebuild recipients, recipients_rollup, and recipients_rollup_merged from awards.
 *   6. Stamp the source max and successful-run wall clocks.
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
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { bqQuery, BQ_TABLES } from '@/lib/bigquery/client';
import {
  buildPipelinePlan,
  buildAwardsMergeSql,
  classifyMembers,
  encodeAwardsIngestClocks,
  loadCsvsIntoStaging,
  pipelineOutcome,
  validateCsvFile,
  BQ_AWARDS_ACQUISITION_POLL_MINUTES_ENV,
  maxPollIterations,
  parseAcquisitionPollMinutes,
  pollBulkDownloadUntilReady,
  type AwardsIngestClocks,
} from '@/lib/awards-ingest';

// FPDS lets agencies correct records for ~90 days; re-pull that trailing window so a corrected
// transaction OVERWRITES its stale row (via the txn_id MERGE) instead of being missed.
const TRAILING_CORRECTION_DAYS = 100;
const USASPENDING_BULK = 'https://api.usaspending.gov/api/v2/bulk_download/awards/';
const STAGING_TABLE = 'awards_ingest_staging';
// The BQ project/dataset the awards table lives in (matches src/lib/bigquery/client.ts). Used to
// build the fully-qualified staging table name for the `bq load` CLI (bq needs plain fq, no backticks).
const PROJECT = 'market-assasin';
const DATASET = 'usaspending';

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

  // Request contract + IDV award TYPES (rows land in Contracts*.csv). A separate IDV-named ZIP
  // member is classified and fails closed before MERGE — we do not invent an IDV file mapping.
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

  // ── APPLY path — real download → bq load staging → MERGE on txn_id ──────────────────────────
  // 1. POST the bulk-download request → get { status_url, file_url }.
  log('requesting USASpending bulk-download…');
  const dlResp = await fetch(USASPENDING_BULK, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(downloadRequest),
  });
  if (!dlResp.ok) throw new Error(`bulk-download request failed: ${dlResp.status} ${await dlResp.text()}`);
  const dl = await dlResp.json() as { status_url: string; file_url: string; file_name: string };
  log(`job queued: ${dl.file_name}`);

  // 2. Poll status_url until status==='finished' (or 'failed'). USASpending generates the zip
  //    server-side; a 100-day correction window can exceed 20 minutes (measured ~51 min).
  const pollMinutes = parseAcquisitionPollMinutes(process.env[BQ_AWARDS_ACQUISITION_POLL_MINUTES_ENV]);
  const pollResult = await pollBulkDownloadUntilReady({
    statusUrl: dl.status_url,
    initialFileUrl: dl.file_url,
    maxIterations: maxPollIterations(pollMinutes),
    pollMinutesForTimeoutMessage: pollMinutes,
    fetchStatus: async (statusUrl) => {
      const resp = await fetch(statusUrl);
      if (!resp.ok) {
        throw new Error(`bulk-download status failed: ${resp.status}`);
      }
      return resp.json() as Promise<{ status: string; total_rows?: number; file_url?: string; message?: string }>;
    },
    log: (message) => log(message),
  });
  const fileUrl = pollResult.fileUrl;
  const totalRows = pollResult.totalRows;
  log(`download ready: ${totalRows} transactions`);

  // Classify the complete archive before staging so an unsupported sibling cannot disappear
  // behind a contracts-only filename filter.
  const work = mkdtempSync(join(tmpdir(), 'awards-ingest-'));
  try {
    const zipPath = join(work, 'awards.zip');
    const buf = Buffer.from(await (await fetch(fileUrl)).arrayBuffer());
    writeFileSync(zipPath, buf);
    const memberPaths = execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' })
      .split(/\r?\n/)
      .filter(Boolean);
    const members = classifyMembers(memberPaths);
    execFileSync('unzip', ['-o', '-q', zipPath, '-d', work]);
    const acquiredAt = new Date().toISOString();
    const contractPaths = members
      .filter((member) => member.kind === 'contracts')
      .map((member) => member.path);
    const csvValidations = await Promise.all(contractPaths.map(async (path) => ({
      path,
      ...await validateCsvFile(join(work, path)),
    })));
    const plan = buildPipelinePlan({ members, csvValidations });
    if (plan.status !== 'ready') {
      throw new Error(`${plan.status}: ${plan.reason}`);
    }
    const csvs = plan.loadablePaths.map((path) => join(work, path));
    log(`unzipped ${csvs.length} CSV file(s)`);

    // 4. bq load with a deterministic all-STRING schema (mirrors load-to-bq.sh raw landing).
    //    Typed casts happen only in the MERGE below. First CSV --replace's staging; siblings
    //    --noreplace append. Any load failure aborts before MERGE / rebuild / clock stamp.
    const schemaPath = join(work, 'staging-schema.json');
    try {
      loadCsvsIntoStaging({
        projectId: PROJECT,
        dataset: DATASET,
        stagingTable: STAGING_TABLE,
        csvPaths: csvs,
        schemaFilePath: schemaPath,
        readFirstLine: (path) => readFileSync(path, 'utf8').split(/\r?\n/, 1)[0],
        execLoad: (args) => {
          execFileSync('bq', args, { stdio: 'inherit' });
        },
        log: (message) => log(message),
      });
    } catch (error) {
      const outcome = pipelineOutcome({ lastCompleted: 'validate_contracts', failedAt: 'staging_load' });
      throw new Error(`${outcome.status}: staging load failed`, { cause: error });
    }

    const stagingFq = `${PROJECT}.${DATASET}.${STAGING_TABLE}`;

    // 5. MERGE staging → awards on txn_id (the measured-unique transaction key). Update-on-match
    //    (absorbs FPDS 90-day corrections in the trailing window), insert-on-miss (new txns). The
    //    SELECT is the explicit CSV→target mapping (USASpending long names → our 40 columns; the
    //    exec_* / detail cols the bulk export omits stay NULL, same as existing rows).
    // The MERGE scans the whole 63M-row target to find txn_id matches unless we BOUND it — the
    // table is date-partitioned on action_date, so restricting T to the pull window prunes to the
    // affected partitions (the full-table scan billed ~43GB and blew the bqQuery 5GB cap). We run
    // it via the `bq query` CLI (like the load) — the app's bqQuery helper is cost-capped for
    // READ safety and isn't the right tool for a bulk DDL MERGE.
    log('MERGE staging → awards on txn_id…');
    const mergeSql = buildAwardsMergeSql({
      awardsTable: BQ_TABLES.awards,
      stagingFq,
      startDate,
    });
    try {
      execFileSync('bq', ['--project_id=' + PROJECT, 'query', '--nouse_legacy_sql'],
        { input: mergeSql, stdio: ['pipe', 'inherit', 'inherit'] });
    } catch (error) {
      const outcome = pipelineOutcome({ lastCompleted: 'staging_load', failedAt: 'merge' });
      throw new Error(`${outcome.status}: MERGE failed`, { cause: error });
    }
    const mergedAt = new Date().toISOString();

    const after = await currentWatermark();
    log(`MERGE complete. Awards source max is now ${after} (was ${watermark}). Loaded ~${totalRows} transactions.`);

    const rebuildSql = readFileSync(
      resolve(process.cwd(), 'scripts/usaspending-ingest/rebuild-recipients-from-awards.sql'),
      'utf8',
    );
    log('rebuilding recipients, recipients_rollup, and recipients_rollup_merged...');
    try {
      execFileSync('bq', ['--project_id=' + PROJECT, 'query', '--nouse_legacy_sql'],
        { input: rebuildSql, stdio: ['pipe', 'inherit', 'inherit'] });
    } catch (error) {
      const outcome = pipelineOutcome({ lastCompleted: 'merge', failedAt: 'rebuild_recipients' });
      throw new Error(`${outcome.status}: MERGE succeeded but recipients rebuild failed`, { cause: error });
    }
    const recipientsRebuiltAt = new Date().toISOString();

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('failed_clock_stamp: Supabase env missing');
    const { createClient } = await import('@supabase/supabase-js');
    const sb = createClient(url, key);
    const { data: sourceRow, error: readError } = await sb
      .from('data_sources')
      .select('notes')
      .eq('key', 'bq_awards')
      .limit(1)
      .maybeSingle();
    if (readError || !sourceRow) {
      throw new Error(`failed_clock_stamp: ${readError?.message || 'data_sources[bq_awards] missing'}`);
    }
    const clocks: AwardsIngestClocks = {
      sourceActionMax: after,
      acquiredAt,
      mergedAt,
      recipientsRebuiltAt,
    };
    const lastBuilt = recipientsRebuiltAt.slice(0, 10);
    const { data: stamped, error: stampError } = await sb
      .from('data_sources')
      .update({
        last_built: lastBuilt,
        notes: encodeAwardsIngestClocks(sourceRow.notes, clocks),
      })
      .eq('key', 'bq_awards')
      .select('key')
      .limit(1)
      .maybeSingle();
    if (stampError || !stamped) {
      throw new Error(`failed_clock_stamp: ${stampError?.message || 'stamp updated no row'}`);
    }
    log(`data_sources[bq_awards] stamped successful full refresh at ${lastBuilt}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

main().catch((e) => { console.error('[ingest-awards] FAILED:', e?.message || e); process.exit(1); });
