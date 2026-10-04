/**
 * Gates for the controlled IDV-foundation migration workflow
 * (.github/workflows/bq-awards-idv-migration.yml → scripts/bq-awards-idv-migration.ts).
 *
 * Pure: no I/O. The workflow is dispatch-only; every step needs a typed confirmation
 * `IDV-MIGRATION-<step>`; the DDL (and every step that writes after it) refuses unless a
 * full-table CLONE of `awards` exists that is < 24h old AND has exactly the live row count
 * (a clone taken before later writes is not a rollback point for the current state).
 * Never logs confirmation or secret values.
 */

import {
  AWARDS_COLUMNS,
  classifyAwardsSchema,
  type AwardsSchemaState,
  type LiveAwardsColumn,
} from './awards-schema';

export const IDV_MIGRATION_STEPS = ['preflight', 'snapshot', 'ddl', 'verify', 'repull_window', 'idv_fy_backfill'] as const;
export type IdvMigrationStep = (typeof IDV_MIGRATION_STEPS)[number];

/** Steps that write to production `awards` (need the fresh-clone gate). */
export const IDV_MIGRATION_WRITE_STEPS: readonly IdvMigrationStep[] = ['ddl', 'repull_window', 'idv_fy_backfill'];

export const IDV_MIGRATION_CLONE_PREFIX = 'awards_clone_pre_idv_' as const;
export const IDV_MIGRATION_CLONE_MAX_AGE_HOURS = 24;
export const IDV_MIGRATION_CLONE_EXPIRATION_DAYS = 30;
export const IDV_MIGRATION_REPULL_FROM = '2026-01-20' as const;
export const IDV_MIGRATION_FY_MIN = 2016;
export const IDV_MIGRATION_FY_MAX = 2025;
export const IDV_DDL_FILE = 'tasks/idv-vehicle-foundation/01-ddl-add-columns.sql' as const;
/**
 * sha256 of the EXECUTABLE statement of 01-ddl-add-columns.sql (see `ddlStatementText`) — the
 * `ALTER TABLE awards ADD COLUMN …` bytes that were executed in the rollback-safe validation on
 * 2026-09-23 (file sha256 then: c163e9c4…). #1670 later edited only the file's `--` comment lines
 * (file sha256 now 4f9825c6…); the statement is byte-identical, so the pin is on the statement:
 * any change to what BigQuery would execute refuses the ddl step, comment edits do not.
 */
export const IDV_DDL_STATEMENT_SHA256 = '53c6849411d9887d2011e48aedd9eceb582a73662522ce22e5680015de5f17df' as const;

/** The executable text of a SQL file: every `--` comment line and blank line removed. */
export function ddlStatementText(sql: string): string {
  return sql.split('\n').filter((line) => !/^\s*--/.test(line) && line.trim() !== '').join('\n');
}

export function expectedIdvMigrationConfirmation(step: IdvMigrationStep): string {
  return `IDV-MIGRATION-${step}`;
}

export function isIdvMigrationStep(value: string): value is IdvMigrationStep {
  return (IDV_MIGRATION_STEPS as readonly string[]).includes(value);
}

/**
 * The DoD-gap re-pull is split into windows of at most this many days: USASpending's bulk
 * acquisition is capped at MAX_ACQUISITION_POLL_MINUTES (120) by the ingest script, and a
 * 106-day window took ~61 min on 2026-09-20 — an 8-month single request would time out.
 */
export const IDV_MIGRATION_REPULL_MAX_SPAN_DAYS = 62;

export interface IdvMigrationDispatch {
  eventName: string;
  step: string;
  confirmation: string | undefined;
  fiscalYear?: string;
  windowFrom?: string;
  windowTo?: string;
  hasGcpSaJson: boolean;
  /** 'YYYY-MM-DD' (UTC) — injected for tests; defaults to now. */
  today?: string;
}

export interface IdvMigrationDispatchResult {
  step: IdvMigrationStep;
  fiscalYear: number | null;
  /**
   * repull_window only. BOTH ends are explicit: a re-pull is a bounded repair of a reviewed window,
   * never an open-ended "up to today" refresh (that is the weekly ingest's job, and a run with
   * `--to` never stamps the freshness clocks).
   */
  window: { from: string; to: string } | null;
}

/**
 * The ONE mapping from workflow env → dispatch input, shared by the pre-auth gate
 * (scripts/validate-bq-awards-idv-migration-dispatch.ts) and the runner
 * (scripts/bq-awards-idv-migration.ts). The gate used to hand-map its own subset and silently
 * omitted window_from / window_to, so every repull_window dispatch was refused before auth even
 * with a valid window (found 2026-10-04, tasks/bq-awards-a1-preflight-2026-10-04.md X1).
 * `hasGcpSaJson` is passed in because the gate only sees a boolean flag, never the secret.
 */
export function idvMigrationDispatchFromEnv(
  env: Record<string, string | undefined>,
  hasGcpSaJson: boolean,
): IdvMigrationDispatch {
  return {
    eventName: env.GITHUB_EVENT_NAME ?? '',
    step: env.IDV_MIGRATION_STEP ?? '',
    confirmation: env.IDV_MIGRATION_CONFIRMATION,
    fiscalYear: env.IDV_MIGRATION_FISCAL_YEAR,
    windowFrom: env.IDV_MIGRATION_WINDOW_FROM,
    windowTo: env.IDV_MIGRATION_WINDOW_TO,
    hasGcpSaJson,
  };
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
/** YYYY-MM-DD AND a real calendar day (2026-02-30 is refused, not rolled over to March). */
function isIsoDay(d: string): boolean {
  if (!ISO_DAY.test(d)) return false;
  const ms = Date.parse(`${d}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === d;
}
function dayMs(d: string): number {
  return Date.parse(`${d}T00:00:00Z`);
}

export function validateIdvMigrationDispatch(input: IdvMigrationDispatch): IdvMigrationDispatchResult {
  if (input.eventName !== 'workflow_dispatch') {
    throw new Error(`refused: event ${input.eventName || '(none)'} — this workflow runs only on workflow_dispatch`);
  }
  if (!isIdvMigrationStep(input.step)) throw new Error(`refused: unsupported step ${input.step}`);
  if (input.confirmation !== expectedIdvMigrationConfirmation(input.step)) {
    throw new Error(`refused: step ${input.step} requires the exact typed confirmation for that step`);
  }
  if (!input.hasGcpSaJson) throw new Error('refused: secret GCP_SA_JSON is not configured');
  const blank = (v: string | undefined) => !v || v.trim() === '';
  let window: IdvMigrationDispatchResult['window'] = null;
  if (input.step === 'repull_window') {
    const today = input.today ?? new Date().toISOString().slice(0, 10);
    if (blank(input.windowFrom) || blank(input.windowTo)) {
      throw new Error('refused: repull_window needs BOTH window_from and window_to (YYYY-MM-DD)');
    }
    const from = (input.windowFrom as string).trim();
    const to = (input.windowTo as string).trim();
    if (!isIsoDay(from) || !isIsoDay(to)) {
      throw new Error('refused: window_from and window_to must be real calendar dates as YYYY-MM-DD');
    }
    if (from < IDV_MIGRATION_REPULL_FROM) {
      throw new Error(`refused: window_from must be >= ${IDV_MIGRATION_REPULL_FROM} (the reviewed DoD-gap start)`);
    }
    if (to < from) throw new Error('refused: window_to is before window_from');
    if (to > today) throw new Error('refused: window_to is after today');
    const span = (dayMs(to) - dayMs(from)) / 86_400_000;
    if (span > IDV_MIGRATION_REPULL_MAX_SPAN_DAYS) {
      throw new Error(`refused: window spans ${span} days (max ${IDV_MIGRATION_REPULL_MAX_SPAN_DAYS}) — split it`);
    }
    window = { from, to };
  } else if (!blank(input.windowFrom) || !blank(input.windowTo)) {
    throw new Error('refused: window_from/window_to are only valid for repull_window');
  }
  let fiscalYear: number | null = null;
  if (input.step === 'idv_fy_backfill') {
    const fy = Number(input.fiscalYear);
    if (!Number.isInteger(fy) || fy < IDV_MIGRATION_FY_MIN || fy > IDV_MIGRATION_FY_MAX) {
      throw new Error(`refused: idv_fy_backfill needs fiscal_year ${IDV_MIGRATION_FY_MIN}..${IDV_MIGRATION_FY_MAX} (one FY per run)`);
    }
    fiscalYear = fy;
  } else if (input.fiscalYear && input.fiscalYear.trim() !== '') {
    throw new Error(`refused: fiscal_year is only valid for idv_fy_backfill`);
  }
  return { step: input.step, fiscalYear, window };
}

export interface CloneCandidate {
  tableId: string;
  createdAtMs: number;
  rowCount: number;
}

/**
 * The write gate. Returns the clone that makes the write reversible, or throws.
 * Freshest matching clone wins. It must be < 24h old, row-count-identical to live `awards`, AND
 * `awards` must not have been modified since the clone was created.
 *
 * X4 (2026-10-04): row-count equality alone does not prove the clone is a rollback point for the
 * CURRENT state — an UPDATE-only MERGE (e.g. the weekly ingest's correction window) keeps the count.
 * `awards.last_modified_time` (from `__TABLES__`) moves on every DML, DDL and load, so
 * `awardsLastModifiedMs <= clone.createdAtMs` proves nothing wrote to `awards` after the clone.
 * An unreadable last-modified time is refused (fail closed), never assumed fresh.
 */
export function assertFreshCloneGate(input: {
  clones: CloneCandidate[];
  liveRowCount: number;
  /** `__TABLES__.last_modified_time` of `awards`, epoch ms. */
  awardsLastModifiedMs: number;
  nowMs: number;
  maxAgeHours?: number;
}): CloneCandidate {
  const maxAgeMs = (input.maxAgeHours ?? IDV_MIGRATION_CLONE_MAX_AGE_HOURS) * 3_600_000;
  const candidates = input.clones
    .filter((c) => c.tableId.startsWith(IDV_MIGRATION_CLONE_PREFIX))
    .sort((a, b) => b.createdAtMs - a.createdAtMs);
  const latest = candidates[0];
  if (!latest) throw new Error(`refused: no ${IDV_MIGRATION_CLONE_PREFIX}* clone exists — run the snapshot step first`);
  const ageMs = input.nowMs - latest.createdAtMs;
  if (!(ageMs >= 0 && ageMs < maxAgeMs)) {
    throw new Error(`refused: newest clone ${latest.tableId} is ${(ageMs / 3_600_000).toFixed(1)}h old (limit ${input.maxAgeHours ?? IDV_MIGRATION_CLONE_MAX_AGE_HOURS}h) — take a new snapshot`);
  }
  if (!(Number.isFinite(input.liveRowCount) && latest.rowCount === input.liveRowCount)) {
    throw new Error(`refused: clone ${latest.tableId} has ${latest.rowCount} rows but awards has ${input.liveRowCount} — awards changed since the clone; take a new snapshot`);
  }
  if (!Number.isFinite(input.awardsLastModifiedMs) || input.awardsLastModifiedMs <= 0) {
    throw new Error('refused: awards last_modified_time is unreadable — cannot prove the clone is current; take a new snapshot');
  }
  if (input.awardsLastModifiedMs > latest.createdAtMs) {
    throw new Error(`refused: awards was modified at ${new Date(input.awardsLastModifiedMs).toISOString()}, after clone ${latest.tableId} was created at ${new Date(latest.createdAtMs).toISOString()} — awards changed since the clone (row count alone cannot show an update); take a new snapshot`);
  }
  return latest;
}

/** Clone table id for a run date: awards_clone_pre_idv_YYYYMMDD_HHMM (UTC). */
export function idvMigrationCloneTableId(now: Date): string {
  const iso = now.toISOString();
  return `${IDV_MIGRATION_CLONE_PREFIX}${iso.slice(0, 10).replace(/-/g, '')}_${iso.slice(11, 16).replace(':', '')}`;
}

/** Ingest-script arguments for the two re-acquisition steps (the reviewed #1658 flags). */
export function ingestArgsForStep(result: IdvMigrationDispatchResult): string[] {
  const { step, fiscalYear, window } = result;
  if (step === 'repull_window') {
    if (!window) throw new Error('repull_window needs a validated window');
    return [`--from=${window.from}`, `--to=${window.to}`, '--apply'];
  }
  if (step === 'idv_fy_backfill') {
    if (fiscalYear === null) throw new Error('idv_fy_backfill needs a fiscal year');
    return ['--idv-only', `--from=${fiscalYear - 1}-10-01`, `--to=${fiscalYear}-09-30`, '--apply'];
  }
  throw new Error(`step ${step} does not run the ingest script`);
}

/**
 * The ddl post-check against the CANONICAL schema (awards-schema.ts): exactly the 58 columns of
 * AWARDS_COLUMNS — all 51 legacy + 7 IDV present with the expected BigQuery types (e.g.
 * ordering_period_end_date DATE), nothing unknown, nothing missing. Also the precondition for the
 * re-acquisition steps.
 */
export function ddlPostCheck(live: readonly LiveAwardsColumn[]): { ok: boolean; state: AwardsSchemaState } {
  const state = classifyAwardsSchema(live, { required: true });
  const ok = state.ok && state.idvMode === 'present' && state.unknownColumns.length === 0
    && state.columnCount === AWARDS_COLUMNS.length;
  return { ok, state };
}
