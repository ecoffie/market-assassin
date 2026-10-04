/**
 * Controlled IDV-foundation migration runner — invoked ONLY by
 * .github/workflows/bq-awards-idv-migration.yml (workflow_dispatch + environment approval).
 *
 *   ./node_modules/.bin/tsx scripts/bq-awards-idv-migration.ts
 *     env: IDV_MIGRATION_STEP, IDV_MIGRATION_CONFIRMATION, IDV_MIGRATION_FISCAL_YEAR,
 *          IDV_MIGRATION_WINDOW_FROM, IDV_MIGRATION_WINDOW_TO, GITHUB_EVENT_NAME, GCP_SA_JSON
 *
 * Steps (see tasks/idv-vehicle-foundation/README.md):
 *   preflight        read-only; prints counts only
 *   snapshot         CREATE TABLE awards_clone_pre_idv_<ts> CLONE awards (30-day expiration)
 *   ddl              the exact reviewed 01 file (sha256-pinned), only behind the fresh-clone gate
 *   verify           read-only probes (schema, fill, cohort completeness, Mech-Elec II)
 *   repull_window    ingest script --from/--to --apply (bounded window), behind the clone gate
 *   idv_fy_backfill  ingest script --idv-only for ONE fiscal year, behind the clone gate
 *
 * Re-validates the dispatch itself (defense in depth). Never prints secrets or the confirmation.
 */
import { BigQuery } from '@google-cloud/bigquery';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  assertFreshCloneGate,
  ddlPostCheck,
  IDV_DDL_FILE,
  IDV_DDL_STATEMENT_SHA256,
  ddlStatementText,
  IDV_MIGRATION_CLONE_EXPIRATION_DAYS,
  IDV_MIGRATION_CLONE_PREFIX,
  IDV_MIGRATION_WRITE_STEPS,
  RECIPIENTS_REBUILD_FILE,
  assertRecipientsRebuildOnly,
  idvMigrationCloneTableId,
  idvMigrationDispatchFromEnv,
  ingestArgsForStep,
  validateIdvMigrationDispatch,
  type CloneCandidate,
} from '../src/lib/awards-ingest/idv-migration-control';
import {
  AWARDS_COLUMNS,
  awardsColumnsQuery,
  classifyAwardsSchema,
  IDV_IDENTITY_COLUMNS,
  type AwardsSchemaState,
  type LiveAwardsColumn,
} from '../src/lib/awards-ingest/awards-schema';
import { resolveIdvIdentityColumnsMode } from '../src/lib/awards-ingest/merge-sql';
import { cleanupScript, selectionSql, verifySelection, type SelectedRow } from '../src/lib/awards-ingest/a1b-cleanup';
import {
  buildCohortMonthlyCountsSql,
  classifyCohortCompleteness,
  describeCohortHoles,
} from '../src/lib/awards-ingest/cohort-completeness';

const PROJECT = 'market-assasin';
const DATASET = 'usaspending';
const AWARDS = `\`${PROJECT}.${DATASET}.awards\``;

function log(message: string): void {
  console.log(`[idv-migration] ${message}`);
}

function client(): BigQuery {
  const raw = (process.env.GCP_SA_JSON || '').trim();
  if (!raw) throw new Error('GCP_SA_JSON missing');
  const parse = (s: string) => { try { return JSON.parse(s); } catch { return JSON.parse(s.replace(/\\n/g, '\n')); } };
  const creds = raw.startsWith('{') ? parse(raw) : JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
  return new BigQuery({ projectId: PROJECT, credentials: creds });
}

async function query<T>(bq: BigQuery, sql: string, opts: { defaultDataset?: boolean; label: string }): Promise<{ rows: T[]; jobId: string | undefined; bytes: string | undefined }> {
  const [job] = await bq.createQueryJob({
    query: sql,
    location: 'US',
    labels: { feature: 'idv_foundation', tool: 'idv_migration_workflow', query_family: opts.label },
    ...(opts.defaultDataset ? { defaultDataset: { projectId: PROJECT, datasetId: DATASET } } : {}),
  });
  const [rows] = await job.getQueryResults();
  const [meta] = await job.getMetadata();
  const bytes = (meta as { statistics?: { totalBytesProcessed?: string } }).statistics?.totalBytesProcessed;
  log(`job ${opts.label}: id=${job.id} bytes=${bytes ?? 'n/a'}`);
  return { rows: rows as T[], jobId: job.id, bytes };
}

async function tableState(bq: BigQuery): Promise<{ awardsRows: number; awardsLastModifiedMs: number; clones: CloneCandidate[] }> {
  const { rows } = await query<{ table_id: string; row_count: number; creation_time: number; last_modified_time: number }>(bq,
    `SELECT table_id, row_count, creation_time, last_modified_time FROM \`${PROJECT}.${DATASET}.__TABLES__\`
     WHERE table_id = 'awards' OR STARTS_WITH(table_id, '${IDV_MIGRATION_CLONE_PREFIX}')`, { label: 'table_state' });
  const awards = rows.find((r) => r.table_id === 'awards');
  if (!awards) throw new Error('awards table not found');
  return {
    awardsRows: Number(awards.row_count),
    awardsLastModifiedMs: Number(awards.last_modified_time),
    clones: rows.filter((r) => r.table_id !== 'awards').map((r) => ({
      tableId: r.table_id, rowCount: Number(r.row_count), createdAtMs: Number(r.creation_time),
    })),
  };
}

/** Live column names AND data types (#1670's canonical query) — never names only. */
async function awardsColumns(bq: BigQuery): Promise<LiveAwardsColumn[]> {
  const { rows } = await query<{ column_name: string; data_type: string }>(bq,
    awardsColumnsQuery(PROJECT, DATASET), { label: 'schema' });
  return rows.map((r) => ({ name: r.column_name, dataType: r.data_type }));
}

function describeSchema(state: AwardsSchemaState): string {
  return `columns=${state.columnCount} idv=${state.idvMode} ok=${state.ok}`
    + (state.unknownColumns.length ? ` unknown=[${state.unknownColumns.join(', ')}]` : '')
    + (state.problems.length ? ` problems=[${state.problems.join(' | ')}]` : '');
}

/** Exact (BIGNUMERIC) — a FLOAT64 SUM varies in the last cent with summation order. */
async function obligationTotal(bq: BigQuery, table: string): Promise<string> {
  const { rows } = await query<{ total: string }>(bq,
    `SELECT CAST(SUM(CAST(obligation_amount AS BIGNUMERIC)) AS STRING) AS total FROM ${table}`, { label: 'obligation_total' });
  return rows[0]?.total ?? 'unknown';
}

async function probes(bq: BigQuery): Promise<void> {
  const state = classifyAwardsSchema(await awardsColumns(bq), { required: false });
  log(`awards schema ${describeSchema(state)}`);
  if (state.ok && state.idvMode === 'present') {
    const { rows } = await query<Record<string, number>>(bq, `
      SELECT COUNTIF(award_or_idv_flag = 'IDV') AS idv_rows,
        COUNTIF(award_or_idv_flag = 'IDV' AND solicitation_identifier IS NOT NULL) AS idv_rows_with_solicitation,
        COUNTIF(award_or_idv_flag = 'IDV' AND ordering_period_end_date IS NOT NULL) AS idv_rows_with_ordering_end,
        COUNTIF(award_or_idv_flag = 'IDV' AND multiple_or_single_award_idv_code IS NOT NULL) AS idv_rows_with_ms_flag,
        COUNTIF(parent_award_agency_id IS NOT NULL) AS rows_with_parent_agency
      FROM ${AWARDS}`, { label: 'identity_fill' });
    log(`identity fill ${JSON.stringify(rows[0])}`);
  }
  const asOf = new Date().toISOString().slice(0, 10);
  const { rows: months } = await query<{ cohort: 'dod' | 'civilian'; month: string; n: number }>(bq,
    buildCohortMonthlyCountsSql(AWARDS, asOf), { label: 'cohort_months' });
  log(`cohort completeness: ${describeCohortHoles(classifyCohortCompleteness(months.map((m) => ({ ...m, n: Number(m.n) })), asOf))}`);
  const { rows: me } = await query<Record<string, number>>(bq, `
    SELECT COUNT(DISTINCT IF(STARTS_WITH(award_id, 'CONT_IDV_'), award_id, NULL)) AS mech_elec_holder_idvs,
      COUNT(DISTINCT IF(parent_piid IN ('FA850124D0002','FA850124D0003','FA850124D0004','FA850124D0005'), award_id, NULL)) AS mech_elec_orders,
      ROUND(SUM(IF(parent_piid IN ('FA850124D0002','FA850124D0003','FA850124D0004','FA850124D0005'), obligation_amount, 0)), 2) AS mech_elec_obligations
    FROM ${AWARDS}
    WHERE recipient_uei IN ('LAA3W2UCHL23','PZNLVGANJ3U3','RZ53PAJUCNF4','TR1AV9J17C93')`, { label: 'mech_elec' });
  log(`mech-elec II ${JSON.stringify(me[0])}`);
}

async function main(): Promise<void> {
  const dispatch = validateIdvMigrationDispatch(
    idvMigrationDispatchFromEnv(process.env, Boolean(process.env.GCP_SA_JSON)),
  );
  log(`step=${dispatch.step}`);
  const bq = client();
  const before = await tableState(bq);
  log(`awards rows=${before.awardsRows} last_modified=${new Date(before.awardsLastModifiedMs).toISOString()} clones=${before.clones.map((c) => `${c.tableId}(${c.rowCount})`).join(', ') || 'none'}`);

  if (IDV_MIGRATION_WRITE_STEPS.includes(dispatch.step)) {
    const clone = assertFreshCloneGate({ clones: before.clones, liveRowCount: before.awardsRows, awardsLastModifiedMs: before.awardsLastModifiedMs, nowMs: Date.now() });
    log(`clone gate passed: ${clone.tableId} (${clone.rowCount} rows, ${((Date.now() - clone.createdAtMs) / 3_600_000).toFixed(1)}h old)`);
  }

  switch (dispatch.step) {
    case 'preflight':
    case 'verify': {
      log(`awards obligation total=${await obligationTotal(bq, AWARDS)}`);
      await probes(bq);
      return;
    }
    case 'snapshot': {
      const id = idvMigrationCloneTableId(new Date());
      await query(bq, `CREATE TABLE \`${PROJECT}.${DATASET}.${id}\` CLONE ${AWARDS}
        OPTIONS (expiration_timestamp = TIMESTAMP_ADD(CURRENT_TIMESTAMP(), INTERVAL ${IDV_MIGRATION_CLONE_EXPIRATION_DAYS} DAY),
                 description = 'IDV foundation rollback point (PR #1658). Restore: tasks/idv-vehicle-foundation/99-rollback.sql §C.')`,
      { label: 'clone' });
      const after = await tableState(bq);
      const made = after.clones.find((c) => c.tableId === id);
      if (!made || made.rowCount !== after.awardsRows) throw new Error(`clone ${id} row count ${made?.rowCount} != awards ${after.awardsRows}`);
      log(`clone ${id} created: ${made.rowCount} rows (= awards); expires in ${IDV_MIGRATION_CLONE_EXPIRATION_DAYS} days`);
      return;
    }
    case 'ddl': {
      const sql = readFileSync(IDV_DDL_FILE, 'utf8');
      // Pin the EXECUTABLE statement (comments may change; what BigQuery runs may not).
      const sha = createHash('sha256').update(ddlStatementText(sql)).digest('hex');
      if (sha !== IDV_DDL_STATEMENT_SHA256) throw new Error(`refused: ${IDV_DDL_FILE} statement sha256 ${sha} != validated ${IDV_DDL_STATEMENT_SHA256}`);
      // Pre-check: the live table must be the healthy 51-column shape (typed) before ALTERing it;
      // resolveIdvIdentityColumnsMode throws on a partial / mistyped / legacy-missing schema.
      const mode = resolveIdvIdentityColumnsMode(await awardsColumns(bq), { required: false });
      if (mode === 'present') { log('identity columns already present — nothing to do'); return; }
      const oblBefore = await obligationTotal(bq, AWARDS);
      await query(bq, sql, { defaultDataset: true, label: 'ddl_01' });
      const post = ddlPostCheck(await awardsColumns(bq));
      const after = await tableState(bq);
      const oblAfter = await obligationTotal(bq, AWARDS);
      const ok = post.ok && after.awardsRows === before.awardsRows && oblAfter === oblBefore;
      log(`ddl verify: ${describeSchema(post.state)} (expected ${AWARDS_COLUMNS.length}, ${IDV_IDENTITY_COLUMNS.length} IDV typed) rows ${before.awardsRows}->${after.awardsRows} obligation ${oblBefore}->${oblAfter}`);
      if (!ok) throw new Error('STOP: unexpected change after DDL — see 99-rollback.sql §A');
      return;
    }
    case 'rebuild_recipients': {
      // Re-derive recipients* from awards with the SAME SQL the weekly ingest runs after every MERGE.
      // Needed after a1b_cleanup (which deletes awards rows but does not rebuild). Writes only the three
      // recipients tables — asserted on the statement text before it is sent.
      const sql = readFileSync(RECIPIENTS_REBUILD_FILE, 'utf8');
      assertRecipientsRebuildOnly(sql);
      await query(bq, sql, { label: 'rebuild_recipients' });
      const { rows } = await query<{ table_id: string; row_count: number; last_modified_time: number }>(bq,
        `SELECT table_id, row_count, last_modified_time FROM \`${PROJECT}.${DATASET}.__TABLES__\`
         WHERE table_id IN ('awards', 'recipients', 'recipients_rollup', 'recipients_rollup_merged')`, { label: 'rebuild_state' });
      const awardsMs = Number(rows.find((r) => r.table_id === 'awards')?.last_modified_time);
      for (const r of rows.filter((x) => x.table_id !== 'awards')) {
        const fresh = Number(r.last_modified_time) >= awardsMs;
        log(`${r.table_id}: ${Number(r.row_count)} rows, rebuilt ${new Date(Number(r.last_modified_time)).toISOString()} ${fresh ? '(after the last awards write)' : '(STALE)'}`);
        if (!fresh) throw new Error(`STOP: ${r.table_id} is older than the last awards write`);
      }
      return;
    }
    case 'a1b_cleanup': {
      // A1b (2026-10-04): remove ONLY the pinned double-count populations. Read-only selection first;
      // refuse unless it reproduces the pinned identities exactly; then one transaction with ASSERTs.
      if (!ddlPostCheck(await awardsColumns(bq)).ok) throw new Error('refused: identity columns absent — A1b runs only after A1');
      const { rows: selected } = await query<SelectedRow>(bq, selectionSql(AWARDS), { label: 'a1b_select' });
      const pre = verifySelection(selected);
      log(`a1b selection matches pinned populations: F3 ${pre.f3} rows / $${pre.f3Sum} · F1 ${pre.f1} rows / $${pre.f1Sum} · F1b ${pre.f1b} rows · ambiguous untouched 2`);
      const oblBefore = await obligationTotal(bq, AWARDS);
      await query(bq, cleanupScript(AWARDS), { label: 'a1b_cleanup' });
      const after = await tableState(bq);
      const oblAfter = await obligationTotal(bq, AWARDS);
      const { rows: post } = await query<SelectedRow>(bq, selectionSql(AWARDS), { label: 'a1b_select_after' });
      const left = (p: string) => post.filter((r) => r.pop === p).length;
      log(`a1b cleanup committed: awards rows ${before.awardsRows}->${after.awardsRows} (removed ${before.awardsRows - after.awardsRows}) obligation ${oblBefore}->${oblAfter}`);
      log(`a1b remaining: F3 ${left('f3')} · F1 ${left('f1')} · F1b ${left('f1b')} · short-code remainder ${left('short_remaining')} (expected 0/0/0/2)`);
      if (left('f3') || left('f1') || left('f1b') || left('short_remaining') !== 2) {
        throw new Error('STOP: post-cleanup selection is not 0/0/0/2 — investigate before acceptance');
      }
      await probes(bq);
      return;
    }
    case 'repull_window':
    case 'idv_fy_backfill': {
      if (!ddlPostCheck(await awardsColumns(bq)).ok) {
        throw new Error('refused: identity columns absent — run the ddl step first');
      }
      const args = ingestArgsForStep(dispatch);
      log(`running ingest: ${args.join(' ')}`);
      const run = spawnSync('./node_modules/.bin/tsx', ['scripts/ingest-usaspending-awards.ts', ...args], { stdio: 'inherit', env: process.env });
      if (run.status !== 0) throw new Error(`ingest exited ${run.status} — partial/failed; nothing is inferred as zero`);
      await probes(bq);
      return;
    }
  }
}

main().catch((error) => {
  console.error(`[idv-migration] FAILED: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exit(1);
});
