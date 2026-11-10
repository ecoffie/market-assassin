/**
 * SAM opportunity sync — bounded writes and a truthful stale-cleanup rule (R1, 2026-11-09).
 *
 * WHY CHUNKS. PostgREST connects as `authenticator` with statement_timeout=8s and lock_timeout=8s.
 * A 1,000-row upsert into sam_opportunities rewrites every row (synced_at is indexed, so no HOT
 * update), touches 26 indexes including a 354 MB description trigram GIN and the search_tsv GIN,
 * and regenerates search_tsv. Measured: 64 of 80 full syncs since 2026-10-01 ended
 * "completed_with_errors" with "canceling statement due to statement timeout" on pages 0–3 — the
 * newest notices, the same rows backfill-descriptions is filling. No full sync has succeeded since
 * 2026-10-25, so the newest pages were never re-synced and stale cleanup never ran.
 *
 * WHY THE CLEANUP RULE CHANGED. Cleanup deactivated every row not re-synced for 7 days. The sync only
 * re-fetches notices POSTED in the last 30 days, so every still-open notice older than that went
 * stale by construction: 1,143 rows are already inactive while SAM said active and their response
 * deadline is in the future, and 706 more would have been deactivated on the next successful run.
 * A stale row is now deactivated only when SAM's own dates say it is over: neither the response
 * deadline nor the archive date is in the future.
 */

export const UPSERT_CHUNK = 100;
export const UPSERT_MIN_CHUNK = 10;

export function isStatementTimeout(message: string | null | undefined): boolean {
  return /statement timeout|lock timeout|canceling statement due to/i.test(message || '');
}

export type ChunkUpsert<T> = (rows: T[]) => PromiseLike<{ error: { message: string } | null }>;

export interface ChunkedUpsertResult {
  ok: boolean;
  written: number;
  statements: number;
  /** Times a timed-out chunk was split and retried. */
  splits: number;
  error: string | null;
}

/**
 * Write `rows` in chunks of `chunk`. A chunk that hits a statement/lock timeout is split in half
 * and retried, down to `minChunk`; any other error, or a timeout at `minChunk`, stops the page
 * (`ok:false`). Rows already written stay written — the upsert is idempotent, and a failed page is
 * still reported as failed, so isFullSuccess stays false and stale cleanup does not run.
 */
export async function upsertInChunks<T>(
  rows: T[],
  upsert: ChunkUpsert<T>,
  opts: { chunk?: number; minChunk?: number } = {},
): Promise<ChunkedUpsertResult> {
  const chunk = Math.max(1, opts.chunk ?? UPSERT_CHUNK);
  const minChunk = Math.max(1, Math.min(opts.minChunk ?? UPSERT_MIN_CHUNK, chunk));
  const queue: T[][] = [];
  for (let i = 0; i < rows.length; i += chunk) queue.push(rows.slice(i, i + chunk));
  let written = 0, statements = 0, splits = 0;
  while (queue.length) {
    const part = queue.shift()!;
    statements++;
    const { error } = await upsert(part);
    if (!error) { written += part.length; continue; }
    if (isStatementTimeout(error.message) && part.length > minChunk) {
      const half = Math.ceil(part.length / 2);
      queue.unshift(part.slice(0, half), part.slice(half));
      splits++;
      continue;
    }
    return { ok: false, written, statements, splits, error: error.message };
  }
  return { ok: true, written, statements, splits, error: null };
}

/** True when SAM's own dates say the notice is still live, so cleanup must not deactivate it. */
export function staleRowStillLive(row: { response_deadline: string | null; archive_date: string | null }, now: Date): boolean {
  const t = now.getTime();
  const future = (v: string | null) => v != null && new Date(v).getTime() >= t;
  return future(row.response_deadline) || future(row.archive_date);
}

/**
 * PostgREST `.or()` filters selecting stale rows whose deadline AND archive date are both absent or
 * past — the exact complement of staleRowStillLive. Apply BOTH (two `.or()` calls AND together).
 */
export function staleCleanupOrFilters(now: Date): [string, string] {
  const iso = now.toISOString();
  return [
    `response_deadline.is.null,response_deadline.lt."${iso}"`,
    `archive_date.is.null,archive_date.lt."${iso}"`,
  ];
}

export type StaleCleanupMode = 'report' | 'apply' | 'off';

/** SAM_STALE_CLEANUP: 'apply' deactivates, 'off' skips; anything else (incl. unset) only reports. */
export function staleCleanupMode(raw: string | undefined): StaleCleanupMode {
  const v = (raw || '').trim().toLowerCase();
  return v === 'apply' || v === 'off' ? v : 'report';
}
