/**
 * Rollback-safe validation of 01-ddl-add-columns.sql + 02-backfill-from-current-staging.sql.
 *
 *   npx tsx tasks/idv-vehicle-foundation/validate-rollback-safe.ts
 *
 * The SQL files are read from disk and executed BYTE-FOR-BYTE. Their tables are unqualified
 * (`awards`, `awards_ingest_staging`); here they resolve to BigQuery SESSION TEMP tables copied
 * from production (fiscal_year >= 2024), because the jobs carry NO default dataset — an unqualified
 * name can only be a session temp table, so production is never a possible target (it is read,
 * once, as the copy source). In production the same bytes resolve via `--dataset_id=usaspending`.
 *   - 01 is first attempted inside BEGIN/ROLLBACK (BigQuery rejects DDL in a transaction; the
 *     error is recorded), then run exactly on the temp copy.
 *   - 02 runs inside BEGIN → exact file → probes → ROLLBACK.
 * The session is aborted at the end, which drops the temp tables. Every job is logged to
 * ./validate-rollback-safe.log.json (SQL text, sha256, bytes, per-statement results).
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { BigQuery } from '@google-cloud/bigquery';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const WT = process.cwd();
const PROJECT = 'market-assasin';
let SESSION: string | null = null;
const LOG = `${WT}/tasks/idv-vehicle-foundation/validate-rollback-safe.log.json`;
const MAX_BYTES = String(40 * 1024 ** 3);

function sa() {
  const raw = (process.env.GCP_SA_JSON || '').trim();
  if (raw.startsWith('{')) { try { return JSON.parse(raw); } catch { return JSON.parse(raw.replace(/\\n/g, '\n')); } }
  return JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
}
const creds = sa();
const bq = new BigQuery({ projectId: creds.project_id ?? PROJECT, credentials: creds });
const log: unknown[] = [];
type JobMeta = { statistics?: { totalBytesProcessed?: string; numChildJobs?: string; sessionInfo?: { sessionId?: string };
  query?: { statementType?: string; numDmlAffectedRows?: string } } };
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const plain = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && 'value' in x && Object.keys(x).length === 1 ? x.value : x)));

async function run(label: string, sql: string, _unused?: string, opts: { createSession?: boolean } = {}) {
  const entry: Record<string, unknown> = { label, defaultDataset: null, session: SESSION, sql_sha256: sha(sql), sql };
  try {
    // NO defaultDataset, ever: an unqualified `awards` can only resolve to this session's TEMP table;
    // if that table does not exist the statement fails ("must be qualified") — it can never reach production.
    const [job] = await bq.createQueryJob({
      query: sql, location: 'US', maximumBytesBilled: MAX_BYTES,
      labels: { feature: 'idv_foundation', tool: 'migration_validation', query_family: 'session_temp' },
      ...(opts.createSession ? { createSession: true } : {}),
      ...(SESSION ? { connectionProperties: [{ key: 'session_id', value: SESSION }] } : {}),
    } as never);
    const [rows] = await job.getQueryResults();
    const [metaRaw] = await job.getMetadata();
    const meta = metaRaw as JobMeta;
    entry.jobId = job.id;
    if (opts.createSession) { SESSION = meta.statistics?.sessionInfo?.sessionId ?? null; entry.session = SESSION; }
    entry.statementType = meta.statistics?.query?.statementType;
    entry.bytesProcessed = meta.statistics?.totalBytesProcessed;
    entry.lastResult = plain(rows);
    // Child jobs of a script: each statement's type, DML row count and SELECT rows.
    if (meta.statistics?.numChildJobs) {
      const [children] = await bq.getJobs({ parentJobId: job.id, allUsers: false, maxResults: 200 } as never);
      const kids = [];
      for (const c of (children as unknown as Array<{ id: string }>).reverse()) {
        const [cm] = await bq.job(c.id, { location: 'US' }).getMetadata();
        const st = (cm as JobMeta).statistics?.query;
        const k: Record<string, unknown> = { statementType: st?.statementType, dmlAffected: st?.numDmlAffectedRows ?? null, bytes: (cm as JobMeta).statistics?.totalBytesProcessed };
        if (st?.statementType === 'SELECT') {
          const [r] = await bq.job(c.id, { location: 'US' }).getQueryResults();
          k.rows = plain(r);
        }
        kids.push(k);
      }
      entry.children = kids;
    }
    entry.ok = true;
  } catch (e) {
    entry.ok = false;
    entry.error = (e as Error).message;
  }
  log.push(entry);
  writeFileSync(LOG, JSON.stringify(log, null, 1));
  console.log(`\n=== ${label} → ${entry.ok ? 'OK' : 'ERROR: ' + entry.error}`);
  return entry;
}

const NEW = 'solicitation_identifier, ordering_period_end_date, award_or_idv_flag, idv_type_code, multiple_or_single_award_idv_code, parent_award_agency_id, parent_award_single_or_multiple_code';
const HOLDER_UEIS = "('LAA3W2UCHL23','PZNLVGANJ3U3','RZ53PAJUCNF4','TR1AV9J17C93')";
const HOLDER_PIIDS = "('FA850124D0002','FA850124D0003','FA850124D0004','FA850124D0005')";

const probeBase = `
SELECT 'base' AS probe, COUNT(*) AS rows_total, ROUND(SUM(obligation_amount), 2) AS obligation_total,
  (SELECT ARRAY_LENGTH(JSON_KEYS(TO_JSON(t), 1)) FROM awards t LIMIT 1) AS awards_columns
FROM awards;`;
const probeWindowChecksum = `
SELECT 'window_checksum_legacy_cols' AS probe, COUNT(*) AS rows_in_window,
  CAST(BIT_XOR(FARM_FINGERPRINT(TO_JSON_STRING(x))) AS STRING) AS legacy_checksum
FROM (SELECT * EXCEPT (${NEW}) FROM awards WHERE action_date BETWEEN '2026-06-01' AND '2026-09-18') x;`;
const probeFill = `
SELECT 'fill_window' AS probe,
  COUNTIF(award_or_idv_flag IS NOT NULL) AS rows_with_flag,
  COUNTIF(award_or_idv_flag = 'IDV') AS idv_rows,
  COUNTIF(award_or_idv_flag = 'IDV' AND solicitation_identifier IS NOT NULL) AS idv_rows_with_sol,
  COUNTIF(award_or_idv_flag = 'IDV' AND ordering_period_end_date IS NOT NULL) AS idv_rows_with_ordering_end,
  COUNTIF(award_or_idv_flag = 'IDV' AND multiple_or_single_award_idv_code IS NOT NULL) AS idv_rows_with_ms,
  COUNT(DISTINCT IF(award_or_idv_flag = 'IDV' AND solicitation_identifier IS NOT NULL, award_id, NULL)) AS idv_awards_with_sol,
  COUNTIF(parent_award_agency_id IS NOT NULL) AS rows_with_parent_agency,
  COUNTIF(solicitation_identifier IS NOT NULL OR ordering_period_end_date IS NOT NULL OR award_or_idv_flag IS NOT NULL
    OR idv_type_code IS NOT NULL OR multiple_or_single_award_idv_code IS NOT NULL OR parent_award_agency_id IS NOT NULL
    OR parent_award_single_or_multiple_code IS NOT NULL) AS rows_with_any_new_col
FROM awards WHERE action_date BETWEEN '2026-06-01' AND '2026-09-18';`;
const probeFillOutside = `
SELECT 'fill_outside_window' AS probe, COUNTIF(award_or_idv_flag IS NOT NULL OR solicitation_identifier IS NOT NULL) AS rows_with_new_cols_outside_window
FROM awards WHERE action_date < '2026-06-01' OR action_date > '2026-09-18';`;
const probeMechElec = `
SELECT 'mech_elec' AS probe,
  COUNT(DISTINCT IF(STARTS_WITH(award_id, 'CONT_IDV_'), award_id, NULL)) AS holder_idvs_found_by_uei,
  COUNT(DISTINCT IF(STARTS_WITH(award_id, 'CONT_IDV_') AND solicitation_identifier = 'FA850124R0001', award_id, NULL)) AS holder_idvs_groupable_by_solicitation,
  COUNT(DISTINCT IF(STARTS_WITH(award_id, 'CONT_IDV_') AND ordering_period_end_date IS NOT NULL, award_id, NULL)) AS holder_idvs_with_ordering_end,
  COUNT(DISTINCT IF(parent_piid IN ${HOLDER_PIIDS}, award_id, NULL)) AS orders,
  ROUND(SUM(IF(parent_piid IN ${HOLDER_PIIDS}, obligation_amount, 0)), 2) AS order_obligations,
  COUNTIF(parent_piid IN ${HOLDER_PIIDS} AND parent_award_agency_id IS NOT NULL) AS order_txns_with_parent_agency,
  COUNTIF(parent_piid IN ${HOLDER_PIIDS}) AS order_txns
FROM awards
WHERE recipient_uei IN ${HOLDER_UEIS} AND (piid IN ${HOLDER_PIIDS} OR parent_piid IN ${HOLDER_PIIDS});`;

async function main() {
  const ddl = readFileSync(`${WT}/tasks/idv-vehicle-foundation/01-ddl-add-columns.sql`, 'utf8');
  const bf = readFileSync(`${WT}/tasks/idv-vehicle-foundation/02-backfill-from-current-staging.sql`, 'utf8');
  console.log('01 sha256', sha(ddl), '02 sha256', sha(bf));
  log.push({ files: { '01': sha(ddl), '02': sha(bf) } });

  // Session TEMP copies. The service account cannot create datasets, and the only writable dataset
  // (usaspending) already holds the real `awards`, so a same-named clone cannot exist there. A
  // session TEMP table named `awards` gives the exact file text a target that is NOT production.
  // Copy = fiscal_year >= 2024 (partition pruned): every row 02 can touch (FY2026 window) and every
  // Mech-Elec II transaction (FY2024+) is in it; same partitioning + clustering as production.
  const mk = await run('create session + TEMP copies', `
CREATE TEMP TABLE awards
PARTITION BY RANGE_BUCKET(fiscal_year, GENERATE_ARRAY(2015, 2030, 1))
CLUSTER BY recipient_uei, recipient_name
AS SELECT * FROM \`${PROJECT}.usaspending.awards\` WHERE fiscal_year >= 2024;
CREATE TEMP TABLE awards_ingest_staging AS SELECT * FROM \`${PROJECT}.usaspending.awards_ingest_staging\`;
SELECT 'copy_fidelity' AS probe,
  (SELECT COUNT(*) FROM \`${PROJECT}.usaspending.awards\` WHERE fiscal_year >= 2024) AS prod_rows_fy24plus,
  (SELECT COUNT(*) FROM awards) AS temp_rows,
  (SELECT ROUND(SUM(obligation_amount), 2) FROM \`${PROJECT}.usaspending.awards\` WHERE fiscal_year >= 2024) AS prod_obl_fy24plus,
  (SELECT ROUND(SUM(obligation_amount), 2) FROM awards) AS temp_obl,
  (SELECT COUNT(*) FROM \`${PROJECT}.usaspending.awards_ingest_staging\`) AS prod_staging_rows,
  (SELECT COUNT(*) FROM awards_ingest_staging) AS temp_staging_rows;`, undefined, { createSession: true });
  if (!mk.ok || !SESSION) throw new Error('session/temp copy failed — aborting before any DDL/DML');
  try {
    await run('BEFORE 01: base', probeBase);
    await run('BEFORE 01: window full-row checksum', `SELECT 'window_checksum_all_cols_pre_ddl' AS probe, COUNT(*) AS rows_in_window, CAST(BIT_XOR(FARM_FINGERPRINT(TO_JSON_STRING(x))) AS STRING) AS legacy_checksum FROM (SELECT * FROM awards WHERE action_date BETWEEN '2026-06-01' AND '2026-09-18') x;`);
    await run('BEFORE 01: mech-elec', `SELECT 'mech_elec_pre' AS probe, COUNT(DISTINCT IF(STARTS_WITH(award_id,'CONT_IDV_'), award_id, NULL)) AS holder_idvs_found_by_uei, COUNT(DISTINCT IF(parent_piid IN ${HOLDER_PIIDS}, award_id, NULL)) AS orders, ROUND(SUM(IF(parent_piid IN ${HOLDER_PIIDS}, obligation_amount, 0)), 2) AS order_obligations FROM awards WHERE recipient_uei IN ${HOLDER_UEIS} AND (piid IN ${HOLDER_PIIDS} OR parent_piid IN ${HOLDER_PIIDS});`);

    await run('01 in BEGIN/ROLLBACK (attempt A)', `BEGIN TRANSACTION;\n${ddl}\n${probeBase}\nROLLBACK TRANSACTION;`);
    // A failed script leaves the session's transaction open — close it before anything else.
    await run('close the transaction attempt A left open', 'ROLLBACK TRANSACTION;');
    await run('after attempt A: base', probeBase);

    await run('01 exact (attempt B, outside a transaction, on the TEMP copy)', ddl);
    await run('AFTER 01: base', probeBase);
    await run('AFTER 01: window checksum (legacy cols)', probeWindowChecksum);
    await run('AFTER 01: fill', probeFill);

    await run('02 in BEGIN/probes/ROLLBACK', `BEGIN TRANSACTION;\n${bf}\nSELECT 'dml_row_count' AS probe, @@row_count AS updated_rows;\n${probeBase}\n${probeWindowChecksum}\n${probeFill}\n${probeFillOutside}\n${probeMechElec}\nROLLBACK TRANSACTION;`);
    await run('AFTER ROLLBACK of 02: fill', probeFill);
    await run('AFTER ROLLBACK of 02: base', probeBase);
  } finally {
    await run('abort session (drops TEMP tables)', 'CALL BQ.ABORT_SESSION();');
  }
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
