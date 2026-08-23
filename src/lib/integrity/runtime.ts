/**
 * INTEGRITY OS — runtime controls for INT-003 and INT-006.
 *
 * These two classes cannot be caught statically. A table name is a string until it meets the
 * database, and "did this job do any work?" is only knowable after the job runs. So the control
 * has to execute.
 *
 * ⚠️ Every export here traces to a production incident (Eric's Phase 2 rule: a control only
 * counts if it reproduces and blocks the ORIGINAL failure shape).
 */

/* ────────────────────────────── INT-003 ──────────────────────────────
 * MISSING RELATION MASQUERADING AS EMPTY.
 *
 * THE INCIDENT: `/api/forecasts?mode=coverage` queried `forecast_coverage_dashboard`, a table
 * that DOES NOT EXIST, and reported `success: true` with **0 sources / 0.0% coverage / an 80%
 * gap** to an admin. The real table (`forecast_sources`) had 11 rows, 3 active, 94.5%.
 *
 * WHY NOTHING CAUGHT IT: PostgREST answers a missing relation with
 * `count = null, HTTP 204, error = null` — *no error at all*. A real EMPTY table answers
 * `count = 0, HTTP 200`. Those two are indistinguishable to `|| 0`, which is why the zero
 * looked like a measurement. Two more instances shipped the same day
 * (`forecasts_by_naics`, `user_plans`).
 */

export type RelationState = 'exists' | 'missing' | 'unreadable';

export interface RelationCheck {
  table: string;
  state: RelationState;
  /** Row count when the relation exists. `null` means we could not establish it. */
  rows: number | null;
  detail?: string;
}

/** Minimal shape we need from a Supabase-like client — keeps this testable without a live DB. */
export interface CountingClient {
  from(table: string): {
    select(cols: string, opts: { count: 'exact'; head: true }): PromiseLike<{
      count: number | null;
      error: { message: string } | null;
    }>;
  };
}

/**
 * Establish whether a relation exists BEFORE anything reads a number off it.
 *
 * The discriminator is the exact signature from the incident:
 *   count === null && error === null   →  the relation does not exist
 *   count === 0    && error === null   →  it exists and is genuinely empty
 */
export async function checkRelation(db: CountingClient, table: string): Promise<RelationCheck> {
  try {
    const { count, error } = await db.from(table).select('*', { count: 'exact', head: true });
    if (error) return { table, state: 'unreadable', rows: null, detail: error.message };
    if (count === null) {
      return {
        table,
        state: 'missing',
        rows: null,
        detail: 'count=null with no error — the relation does not exist (INT-003)',
      };
    }
    return { table, state: 'exists', rows: count };
  } catch (e) {
    return { table, state: 'unreadable', rows: null, detail: e instanceof Error ? e.message : String(e) };
  }
}

/** Check a set of relations a surface depends on. Returns only the ones that are NOT established. */
export async function checkRelations(db: CountingClient, tables: string[]): Promise<RelationCheck[]> {
  const results = await Promise.all(tables.map((t) => checkRelation(db, t)));
  return results.filter((r) => r.state !== 'exists');
}

/* ────────────────────────────── INT-006 ──────────────────────────────
 * NO WORK PERFORMED, BUT THE OPERATION REPORTS SUCCESS.
 *
 * THE INCIDENT: `planner/weekly-digest` read `user_plans` (a table that does not exist), so
 * every user's task list came back null, the loop `continue`d on all of them, and the job
 * returned `success: true`. A dead feature that looked healthy — for as long as nobody checked.
 *
 * THE RULE: an operation is successful only on EVIDENCE OF THE INTENDED EFFECT. "No exception
 * was thrown" is not evidence. Specifically: if there WAS an audience and NOTHING happened to
 * any of it, that is a `no_op` — a failure state, not a success.
 */

export type OperationOutcome = 'succeeded' | 'no_op' | 'partial' | 'blocked' | 'failed';

export interface OperationEvidence {
  /** How many candidates the job actually had to work with. */
  audience: number;
  /** How many were processed with the intended effect. */
  affected: number;
  /** Candidates deliberately skipped for a legitimate reason (already done, opted out…). */
  skipped?: number;
  /** Candidates whose data source could not be established at all (INT-003 feeding INT-006). */
  missingSource?: number;
}

/**
 * Classify an operation from its evidence — never from the absence of an exception.
 *
 * `weekly-digest` would have been classified `blocked` here (audience > 0, affected 0, every
 * candidate missing its source) instead of reporting success.
 */
export function classifyOperation(e: OperationEvidence): OperationOutcome {
  const missing = e.missingSource ?? 0;
  const skipped = e.skipped ?? 0;

  if (e.audience === 0) return 'succeeded';          // nothing to do is a legitimate success
  if (missing >= e.audience) return 'blocked';        // the source, not the work, is the problem
  if (e.affected === 0 && skipped >= e.audience) return 'succeeded'; // all legitimately skipped
  if (e.affected === 0) return 'no_op';               // had work to do, did none
  if (e.affected + skipped + missing < e.audience) return 'partial';
  return 'succeeded';
}

/** True only for `succeeded`. Exists so callers cannot accidentally treat `no_op` as success. */
export function isOperationalSuccess(outcome: OperationOutcome): boolean {
  return outcome === 'succeeded';
}

/**
 * The HTTP shape for a job result. A `no_op`/`blocked`/`failed` run must NOT return
 * `success: true` — that is the entire lesson of INT-006.
 */
export function operationResponse(e: OperationEvidence, extra: Record<string, unknown> = {}) {
  const outcome = classifyOperation(e);
  return {
    success: isOperationalSuccess(outcome),
    outcome,
    audience: e.audience,
    affected: e.affected,
    ...(e.skipped !== undefined ? { skipped: e.skipped } : {}),
    ...(e.missingSource ? { missingSource: e.missingSource } : {}),
    ...extra,
  };
}
