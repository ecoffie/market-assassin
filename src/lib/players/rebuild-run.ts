/**
 * Run the Players rebuild / reconciliation. Shared by scripts/players-rebuild.ts and the awards
 * ingest (post-MERGE chain), so both go through the same gate and write the same record.
 *
 * Dry-run by default: prices the build (free BigQuery dry run) and reports the gate. Only
 * `go: true` creates the production table or writes `data_sources[bq_players]`.
 */
import { createClient } from '@supabase/supabase-js';
import { bqQuery, bqDryRun, BQ_TABLES } from '@/lib/bigquery/client';
import { buildCohortMonthlyCountsSql, classifyCohortCompleteness, describeCohortHoles } from '@/lib/awards-ingest/cohort-completeness';
import { buildPlayersDatasetSql, buildPlayersTruthSql } from './dataset';
import { buildPlayersCellCountsSql, datasetMismatchRate, evaluateCells, selectSampleCells, PLAYERS_BROAD_NAICS, PLAYERS_REGRESSION_FIXTURES, type TruthRow } from './reconcile';
import { buildPlayersQuery } from './query';
import {
  decidePlayersRebuild, decodePlayersBuildRecord, encodePlayersBuildRecord,
  PLAYERS_DATA_SOURCE_KEY, PLAYERS_DATA_SOURCE_ROW, type PlayersBuildRecord,
} from './rebuild';

type Log = (msg: string) => void;
const DDL_MAX_BYTES = String(50 * 1024 ** 3);

function supabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase env missing');
  return createClient(url, key);
}

async function writeRecord(rec: PlayersBuildRecord): Promise<void> {
  const sb = supabase();
  const { data: row, error: readErr } = await sb.from('data_sources').select('notes').eq('key', PLAYERS_DATA_SOURCE_KEY).maybeSingle();
  if (readErr) throw new Error(`data_sources read failed: ${readErr.message}`);
  const notes = encodePlayersBuildRecord(row?.notes ?? null, rec);
  const payload = {
    ...PLAYERS_DATA_SOURCE_ROW,
    notes,
    ...(rec.status === 'built_unreconciled' || rec.status === 'reconciled' ? { last_built: (rec.playersBuiltAt || rec.attemptedAt).slice(0, 10) } : {}),
  };
  const { data: written, error } = await sb.from('data_sources').upsert(payload, { onConflict: 'key' }).select('key').maybeSingle();
  if (error || !written) throw new Error(`data_sources[${PLAYERS_DATA_SOURCE_KEY}] write failed: ${error?.message || 'no row'}`);
}

export async function readPlayersBuildRecord(): Promise<PlayersBuildRecord | null> {
  const { data, error } = await supabase().from('data_sources').select('notes').eq('key', PLAYERS_DATA_SOURCE_KEY).maybeSingle();
  if (error) throw new Error(`data_sources read failed: ${error.message}`);
  return decodePlayersBuildRecord(data?.notes ?? null);
}

async function awardsWatermark(): Promise<string | null> {
  const rows = await bqQuery<{ m: string | null }>({
    query: `SELECT CAST(MAX(action_date) AS STRING) AS m FROM ${BQ_TABLES.awards} WHERE fiscal_year >= EXTRACT(YEAR FROM CURRENT_DATE()) - 1`,
  });
  return rows[0]?.m ?? null;
}

export async function runPlayersRebuild(opts: { go: boolean; log: Log }): Promise<PlayersBuildRecord> {
  const { go, log } = opts;
  const attemptedAt = new Date().toISOString();
  const asOf = attemptedAt.slice(0, 10);

  const monthly = await bqQuery<{ cohort: 'dod' | 'civilian'; month: string; n: number }>({ query: buildCohortMonthlyCountsSql(BQ_TABLES.awards, asOf) });
  const completeness = classifyCohortCompleteness(monthly.map((r) => ({ ...r, n: Number(r.n) })), asOf);
  const gate = decidePlayersRebuild(completeness);
  const sourceActionMax = await awardsWatermark();
  log(`awards watermark ${sourceActionMax ?? 'unknown'} · completeness ${completeness.status}: ${describeCohortHoles(completeness)}`);

  const createSql = buildPlayersDatasetSql({ awards: BQ_TABLES.awards, recipients: BQ_TABLES.recipients, target: BQ_TABLES.playersNaicsRecipients });
  const priced = await bqDryRun({ query: createSql });
  log(`build would scan ${priced.gib.toFixed(2)} GiB`);

  const base: PlayersBuildRecord = {
    status: 'refused_incomplete_warehouse', sourceActionMax, playersSourceActionMax: null,
    playersBuiltAt: null, rows: null, reconciledAt: null, detail: gate.reason, attemptedAt,
  };

  if (!gate.allowed) {
    log(`REFUSED: ${gate.reason}`);
    if (go) await writeRecord(base);
    return base;
  }
  if (!go) {
    log('dry run: gate open — re-run with --go to build the production table');
    return { ...base, status: 'built_unreconciled', detail: 'dry run only — nothing built' };
  }

  try {
    await bqQuery({ query: createSql, bulkJob: 'players-rebuild', maximumBytesBilled: DDL_MAX_BYTES });
    // Prove it landed: the table's own watermark, not the job's "ok".
    const [back] = await bqQuery<{ n: number; wm: string | null; built: string | null }>({
      query: `SELECT COUNT(*) AS n, CAST(MAX(source_action_max) AS STRING) AS wm, CAST(MAX(built_at) AS STRING) AS built FROM ${BQ_TABLES.playersNaicsRecipients}`,
    });
    const rec: PlayersBuildRecord = {
      ...base, status: 'built_unreconciled', rows: Number(back?.n ?? 0),
      playersSourceActionMax: back?.wm ?? null, playersBuiltAt: back?.built ?? null,
      detail: `built ${Number(back?.n ?? 0).toLocaleString()} rows; run players:rebuild -- --reconcile --go`,
    };
    if (!rec.rows || rec.playersSourceActionMax !== sourceActionMax) {
      rec.status = 'failed';
      rec.detail = `read-back mismatch: rows=${rec.rows}, table watermark=${rec.playersSourceActionMax}, awards=${sourceActionMax}`;
    }
    await writeRecord(rec);
    log(`${rec.status}: ${rec.detail}`);
    return rec;
  } catch (e) {
    const rec: PlayersBuildRecord = { ...base, status: 'failed', detail: `build failed: ${(e as Error).message}`.slice(0, 500) };
    await writeRecord(rec).catch(() => {});
    log(rec.detail);
    return rec;
  }
}

/** Reconcile the PRODUCTION table against truth. Stamps `reconciled` only on pass AND go. */
export async function runPlayersReconcile(opts: { go: boolean; log: Log }): Promise<{ pass: boolean; detail: string }> {
  const { go, log } = opts;
  const table = BQ_TABLES.playersNaicsRecipients;
  const t = { awards: BQ_TABLES.awards, recipients: BQ_TABLES.recipients };
  const num = (rows: Array<Record<string, unknown>>): TruthRow[] =>
    rows.map((r) => ({ naics_code: String(r.naics_code), state: (r.state as string | null) ?? null, proven_players: Number(r.proven_players) }));

  const allTruth = num(await bqQuery({ query: buildPlayersTruthSql(t, 'all'), maximumBytesBilled: DDL_MAX_BYTES }));
  const allPlayers = num(await bqQuery({ query: buildPlayersCellCountsSql(table) }));
  const d = datasetMismatchRate(allTruth, allPlayers);

  const naicsList = Array.from(new Set([...PLAYERS_BROAD_NAICS, ...PLAYERS_REGRESSION_FIXTURES.map((f) => f.naics)]));
  const cells = selectSampleCells(allTruth.filter((r) => naicsList.includes(r.naics_code)));
  const measured = new Map<string, { total: number | null; status: string }>();
  for (const c of cells) {
    const { sql, params } = buildPlayersQuery(table, { naicsCodes: [c.naics], state: c.state, sortBy: 'total_obligated', limit: 1, offset: 0 });
    const rows = await bqQuery<{ total_rows: number }>({ query: sql, params });
    const total = rows.length ? Number(rows[0].total_rows) : 0;
    measured.set(`${c.naics}|${c.state}`, { total, status: total > 0 ? 'success_nonzero' : 'success_zero' });
  }
  const { failed } = evaluateCells(cells, allTruth, measured);
  const pass = d.mismatched === 0 && failed.length === 0;
  const detail = `dataset ${d.cells} cells / ${d.mismatched} mismatched; query ${cells.length} cells / ${failed.length} off`
    + (d.examples.length ? `; e.g. ${d.examples.slice(0, 3).join(', ')}` : '');
  log(`${pass ? 'PASS' : 'FAIL'}: ${detail}`);

  if (pass && go) {
    const prev = await readPlayersBuildRecord();
    if (!prev || prev.status !== 'built_unreconciled') throw new Error(`refusing to stamp reconciled: last build record is ${prev?.status ?? 'missing'}`);
    await writeRecord({ ...prev, status: 'reconciled', reconciledAt: new Date().toISOString(), detail });
    log('data_sources[bq_players] stamped reconciled — PLAYERS_SOURCE=canonical may now be set');
  }
  return { pass, detail };
}
