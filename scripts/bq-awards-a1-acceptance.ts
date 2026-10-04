/**
 * A1 acceptance runner — READ-ONLY. Decides whether the DoD-gap re-pull is accepted.
 *
 *   npx tsx scripts/bq-awards-a1-acceptance.ts --pre-clone=awards_clone_pre_idv_YYYYMMDD_HHMM [--json]
 *   npx tsx scripts/bq-awards-a1-acceptance.ts --dry-run --pre-clone=…    # plan + bytes only, no query runs
 *
 * `--pre-clone` is the clone taken immediately BEFORE the first re-pull window (A1 step 5). Run this
 * after step 9 and BEFORE any further write to `awards` (the Sunday 14:00 UTC scheduled ingest
 * included): content preservation compares every fiscal year outside the MERGE's reach between the
 * clone and live, so any other writer in between is reported as a failure, never absorbed.
 *
 * Every query is a single SELECT (asserted), dry-run first, and capped by maximumBytesBilled.
 * Source-of-record values come from the live USASpending API (counts by action_date).
 * Output: per-check status + one verdict. Exit 0 ACCEPTED · 2 ACCEPTED_PENDING_DERIVATIVES · 1 otherwise.
 */
import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });
import { BigQuery } from '@google-cloud/bigquery';
import {
  A1_HOLE_MONTHS,
  A1_MONTHS,
  assertCloneTableId,
  assertReadOnlySql,
  checkAmountWithin,
  checkDuplicatesNotIncreased,
  checkMechElec,
  checkMonthsWithinTolerance,
  checkNotNearZero,
  checkPreservation,
  checkRecipientsReconcile,
  checkRollupFreshness,
  checkZero,
  CIVILIAN_MONTH_TOLERANCE,
  DOD_MONTH_TOLERANCE,
  duplicateTxnSql,
  lockheedSql,
  LOCKHEED,
  lostTxnSql,
  malformedCodeSql,
  mechElecSql,
  monthlyCountsSql,
  overallVerdict,
  preservationSignatureSql,
  recipientsReconcileSql,
  verdictExitCode,
  type CheckResult,
  type FySignature,
  type MonthPair,
} from '../src/lib/awards-ingest/a1-acceptance';
import {
  buildCohortMonthlyCountsSql,
  classifyCohortCompleteness,
  describeCohortHoles,
} from '../src/lib/awards-ingest/cohort-completeness';

const PROJECT = 'market-assasin';
const DATASET = 'usaspending';
const fq = (t: string) => `\`${PROJECT}.${DATASET}.${t}\``;
const AWARDS = fq('awards');
const MAX_GIB_PER_QUERY = 60;
const USAS = 'https://api.usaspending.gov/api/v2/search';

const args = process.argv.slice(2);
const arg = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];
const DRY = args.includes('--dry-run');
const JSON_OUT = args.includes('--json');

function client(): BigQuery {
  const raw = (process.env.GCP_SA_JSON || '').trim();
  if (!raw) throw new Error('GCP_SA_JSON missing');
  const parse = (s: string) => { try { return JSON.parse(s); } catch { return JSON.parse(s.replace(/\\n/g, '\n')); } };
  let creds: unknown;
  try {
    creds = raw.startsWith('{') ? parse(raw) : JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
  } catch {
    throw new Error('GCP_SA_JSON is not parseable (value not printed)');
  }
  return new BigQuery({ projectId: PROJECT, credentials: creds as Record<string, string> });
}

let plannedBytes = 0;
async function q<T>(bq: BigQuery, label: string, sql: string): Promise<T[]> {
  assertReadOnlySql(sql);
  const [dry] = await bq.createQueryJob({ query: sql, location: 'US', dryRun: true });
  const bytes = Number(dry.metadata?.statistics?.totalBytesProcessed ?? 0);
  plannedBytes += bytes;
  if (bytes > MAX_GIB_PER_QUERY * 2 ** 30) throw new Error(`refused: ${label} would scan ${(bytes / 2 ** 30).toFixed(1)} GiB`);
  if (DRY) { console.error(`[dry-run] ${label}: ${(bytes / 2 ** 30).toFixed(2)} GiB`); return []; }
  const [rows] = await bq.query({
    query: sql, location: 'US',
    maximumBytesBilled: String(Math.ceil(bytes * 1.1) + 10 * 2 ** 20),
    labels: { feature: 'a1_acceptance', query_family: label.replace(/[^a-z0-9_]/g, '_') },
  });
  return (rows as Array<Record<string, unknown>>).map((r) =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v && typeof v === 'object' && 'value' in (v as object) ? (v as { value: unknown }).value : v]))) as T[];
}

async function usas<T>(path: string, body: unknown): Promise<T> {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(`${USAS}/${path}/`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (r.ok) return r.json() as Promise<T>;
    await new Promise((s) => setTimeout(s, 2000 * (i + 1)));
  }
  throw new Error(`USASpending ${path} failed`);
}

const monthEnd = (m: string) => { const [y, mm] = m.split('-').map(Number); return new Date(Date.UTC(y, mm, 0)).toISOString().slice(0, 10); };
const DOD = [{ type: 'awarding', tier: 'toptier', name: 'Department of Defense' }];

/** Contracts + IDV transactions by action_date month (the same grain the warehouse holds). */
async function sourceTxnCount(month: string, dodOnly: boolean): Promise<number> {
  const filters: Record<string, unknown> = { time_period: [{ start_date: `${month}-01`, end_date: monthEnd(month), date_type: 'action_date' }] };
  if (dodOnly) filters.agencies = DOD;
  const r = await usas<{ results: { contracts: number; idvs: number } }>('spending_by_transaction_count', { filters });
  return Number(r.results.contracts) + Number(r.results.idvs);
}

async function sourceLockheed(): Promise<number | null> {
  let total = 0; let found = false;
  for (const codes of [['A', 'B', 'C', 'D'], ['IDV_A', 'IDV_B', 'IDV_B_A', 'IDV_B_B', 'IDV_B_C', 'IDV_C', 'IDV_D', 'IDV_E']]) {
    const r = await usas<{ results: Array<{ uei?: string; code?: string; amount: number }> }>('spending_by_category/recipient', {
      limit: 100,
      filters: { time_period: [{ start_date: LOCKHEED.from, end_date: LOCKHEED.to, date_type: 'action_date' }], award_type_codes: codes, agencies: DOD },
    });
    const hit = r.results.find((x) => (x.uei ?? x.code) === LOCKHEED.uei);
    if (hit) { total += Number(hit.amount); found = true; }
  }
  return found ? total : null;
}

async function tableMeta(bq: BigQuery, tables: string[]): Promise<Map<string, { rows: number; lastModifiedMs: number; createdMs: number }>> {
  const list = tables.map((t) => `'${t}'`).join(',');
  const rows = await q<{ table_id: string; row_count: number; last_modified_time: number; creation_time: number }>(bq, 'table_meta',
    `SELECT table_id, row_count, last_modified_time, creation_time FROM \`${PROJECT}.${DATASET}.__TABLES__\` WHERE table_id IN (${list})`);
  return new Map(rows.map((r) => [r.table_id, { rows: Number(r.row_count), lastModifiedMs: Number(r.last_modified_time), createdMs: Number(r.creation_time) }]));
}

async function main(): Promise<void> {
  const cloneId = assertCloneTableId(arg('pre-clone') ?? '');
  const CLONE = fq(cloneId);
  const bq = client();
  const results: CheckResult[] = [];
  const safe = async (id: string, fn: () => Promise<CheckResult>) => {
    try { results.push(await fn()); } catch (e) { results.push({ id, status: 'unmeasured', detail: e instanceof Error ? e.message : 'error' }); }
  };

  const ROLLUPS = ['agency_top_recipients', 'agency_top_naics', 'top_contractors_by_dimension'];
  const meta = await tableMeta(bq, ['awards', 'recipients', 'recipients_rollup', 'recipients_rollup_merged', cloneId, ...ROLLUPS]);

  // 1–2, 11. Warehouse vs source, per month.
  const monthly = await q<{ month: string; dod: number; civilian: number; malformed_code: number }>(bq, 'monthly_counts', monthlyCountsSql(AWARDS));
  const wh = new Map(monthly.map((m) => [m.month, m]));
  if (!DRY) {
    const dodPairs: MonthPair[] = [];
    const civPairs: MonthPair[] = [];
    for (const m of A1_MONTHS) {
      const [dod, all] = await Promise.all([sourceTxnCount(m, true), sourceTxnCount(m, false)]);
      dodPairs.push({ month: m, warehouse: wh.has(m) ? Number(wh.get(m)!.dod) : 0, source: dod });
      civPairs.push({ month: m, warehouse: wh.has(m) ? Number(wh.get(m)!.civilian) : 0, source: all - dod });
    }
    results.push(checkMonthsWithinTolerance('dod_months_vs_source', dodPairs, DOD_MONTH_TOLERANCE));
    results.push(checkNotNearZero(dodPairs.filter((p) => (A1_HOLE_MONTHS as readonly string[]).includes(p.month))));
    results.push(checkMonthsWithinTolerance('civilian_control_vs_source', civPairs, CIVILIAN_MONTH_TOLERANCE));
  }

  // 3. Malformed agency codes inside the repaired range.
  await safe('malformed_agency_code_in_window', async () => {
    const [m] = await q<{ in_window: number; outside_window: number }>(bq, 'malformed_codes', malformedCodeSql(AWARDS));
    const r = checkZero('malformed_agency_code_in_window', m ? Number(m.in_window) : null, 'NULL or non-3/4-digit awarding_agency_code in 2026-01-18..2026-05-03');
    return { ...r, detail: `${r.detail} (outside the window, reported only: ${m?.outside_window ?? '?'})` };
  });

  // 4. Cohort completeness (the existing oracle's classifier).
  await safe('cohort_completeness', async () => {
    const asOf = new Date().toISOString().slice(0, 10);
    const rows = await q<{ cohort: 'dod' | 'civilian'; month: string; n: number }>(bq, 'cohort_months', buildCohortMonthlyCountsSql(AWARDS, asOf));
    if (DRY) return { id: 'cohort_completeness', status: 'unmeasured', detail: 'dry-run' };
    const c = classifyCohortCompleteness(rows.map((r) => ({ ...r, n: Number(r.n) })), asOf);
    return { id: 'cohort_completeness', status: c.status === 'complete' ? 'pass' : c.status === 'unmeasured' ? 'unmeasured' : 'fail', detail: describeCohortHoles(c) };
  });

  // 5. Robins Mech-Elec II.
  await safe('mech_elec_ii', async () => {
    const [m] = await q<{ orders: number; obligations: string }>(bq, 'mech_elec', mechElecSql(AWARDS));
    return checkMechElec(m ? Number(m.orders) : null, m ? Number(m.obligations) : null);
  });

  // 6. Lockheed XFJMYSYFJEK4, DoD, Feb 1 – Apr 22.
  await safe('lockheed_feb_apr22_vs_source', async () => {
    const [l] = await q<{ obligations: string | null }>(bq, 'lockheed', lockheedSql(AWARDS));
    if (DRY) return { id: 'lockheed_feb_apr22_vs_source', status: 'unmeasured', detail: 'dry-run' };
    return checkAmountWithin('lockheed_feb_apr22_vs_source', l?.obligations ? Number(l.obligations) : null, await sourceLockheed(), LOCKHEED.tolerance);
  });

  // 7. Content preservation outside the MERGE's reach (counts alone cannot prove this).
  await safe('preserved_outside_repair', async () => {
    const [c, l] = await Promise.all([
      q<FySignature>(bq, 'signature_clone', preservationSignatureSql(CLONE)),
      q<FySignature>(bq, 'signature_live', preservationSignatureSql(AWARDS)),
    ]);
    return DRY ? { id: 'preserved_outside_repair', status: 'unmeasured', detail: 'dry-run' } : checkPreservation(c, l);
  });

  // 8. No transaction inside the repaired range disappeared.
  await safe('no_lost_txns_in_window', async () => {
    const [r] = await q<{ lost: number }>(bq, 'lost_txns', lostTxnSql(AWARDS, CLONE));
    return checkZero('no_lost_txns_in_window', r ? Number(r.lost) : null, 'clone txn_ids in the repaired range missing from live');
  });

  // 9. Duplicate txn_ids did not increase.
  await safe('duplicate_txn_ids_not_increased', async () => {
    const [c] = await q<{ extra_rows: number }>(bq, 'dups_clone', duplicateTxnSql(CLONE));
    const [l] = await q<{ extra_rows: number }>(bq, 'dups_live', duplicateTxnSql(AWARDS));
    return checkDuplicatesNotIncreased(c ? Number(c.extra_rows) : null, l ? Number(l.extra_rows) : null);
  });

  // 10. Derivatives: recipients (rebuilt by each re-pull) reconcile; rollups reported stale until step D.
  await safe('recipients_rebuilt_and_reconciled', async () => {
    const rows = await q<{ uei: string; awards_total: string | null; recipients_total: string | null }>(bq, 'recipients_reconcile', recipientsReconcileSql(AWARDS, fq('recipients')));
    const a = meta.get('awards'); const r = meta.get('recipients');
    return checkRecipientsReconcile(rows, a && r ? r.lastModifiedMs >= a.lastModifiedMs : null);
  });
  const awardsMeta = meta.get('awards');
  if (awardsMeta) {
    results.push(checkRollupFreshness(ROLLUPS.map((t) => ({ table: t, lastModifiedMs: meta.get(t)?.lastModifiedMs ?? 0 })), awardsMeta.lastModifiedMs));
  }

  const cloneMeta = meta.get(cloneId);
  const verdict = DRY ? 'DRY_RUN' : overallVerdict(results);
  const summary = {
    verdict,
    preClone: cloneId,
    cloneCreated: cloneMeta ? new Date(cloneMeta.createdMs).toISOString() : null,
    awardsLastModified: awardsMeta ? new Date(awardsMeta.lastModifiedMs).toISOString() : null,
    plannedGiB: Number((plannedBytes / 2 ** 30).toFixed(2)),
    results,
  };
  if (JSON_OUT) console.log(JSON.stringify(summary, null, 2));
  else {
    console.log(`[a1-acceptance] pre-repair clone ${cloneId} (created ${summary.cloneCreated}); awards last modified ${summary.awardsLastModified}`);
    for (const r of results) console.log(`[a1-acceptance] ${r.status.toUpperCase().padEnd(10)} ${r.id}: ${r.detail}`);
    console.log(`[a1-acceptance] planned scan ${summary.plannedGiB} GiB — VERDICT ${verdict}`);
  }
  if (!DRY) process.exit(verdictExitCode(verdict as ReturnType<typeof overallVerdict>));
}

main().catch((e) => { console.error(`[a1-acceptance] FAILED: ${e instanceof Error ? e.message : 'unknown error'}`); process.exit(1); });
