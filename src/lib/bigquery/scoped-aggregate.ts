/**
 * Run one scoped aggregate against `usaspending.awards` with a FREE dry-run byte check first.
 *
 * A query whose scope is too broad (wide window, no state/NAICS) is REFUSED before it runs and
 * reported as `too_broad` with the measured size, so the caller can narrow it. That outcome is
 * not a zero and not a failure of the data: the tool must say "narrow the window", never "none".
 */
import { bqDryRun, bqJobOptions } from '@/lib/bigquery/client';
import { queryCached, bqResultState } from '@/lib/bigquery/cache';
import { TOOL_MAX_BYTES } from '@/lib/bigquery/award-scope';

export type ScopedAggregateOutcome<T> =
  | { status: 'ok'; rows: T[] }
  | { status: 'too_broad'; gib: number }
  | { status: 'failed'; reason: string };

export interface ScopedAggregateDeps {
  dryRun: (query: string, params: Record<string, unknown>) => Promise<{ bytesProcessed: number }>;
  run: <T>(opts: { cacheKey: string; query: string; params: Record<string, unknown>; tool: string; family: string }) => Promise<{ rows: T[]; state: 'hit' | 'empty' | 'unavailable' | 'failed' }>;
}

const TTL_SECONDS = 24 * 60 * 60;

export const defaultScopedAggregateDeps: ScopedAggregateDeps = {
  dryRun: (query, params) => bqDryRun({ query, params }),
  run: async <T,>(opts: { cacheKey: string; query: string; params: Record<string, unknown>; tool: string; family: string }) => {
    const rows = await queryCached<T>({
      cacheKey: opts.cacheKey,
      cacheOnly: false, // authed, metered chat path: a cold cache must run live, not read as zero
      ttlSeconds: TTL_SECONDS,
      maximumBytesBilled: String(TOOL_MAX_BYTES),
      ...bqJobOptions({ feature: 'ask_mindy', tool: opts.tool, queryFamily: opts.family, maximumBytesBilled: TOOL_MAX_BYTES }),
      query: opts.query,
      params: opts.params,
    });
    return { rows, state: bqResultState(opts.cacheKey, rows.length) };
  },
};

export async function runScopedAggregate<T>(
  opts: { cacheKey: string; query: string; params: Record<string, unknown>; tool: string; family: string },
  deps: ScopedAggregateDeps = defaultScopedAggregateDeps,
): Promise<ScopedAggregateOutcome<T>> {
  try {
    const { bytesProcessed } = await deps.dryRun(opts.query, opts.params);
    if (bytesProcessed > TOOL_MAX_BYTES) return { status: 'too_broad', gib: bytesProcessed / 1024 ** 3 };
  } catch (err) {
    return { status: 'failed', reason: `dry run failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  try {
    const { rows, state } = await deps.run<T>(opts);
    if (state === 'failed' || state === 'unavailable') return { status: 'failed', reason: `bigquery ${state}` };
    return { status: 'ok', rows };
  } catch (err) {
    return { status: 'failed', reason: err instanceof Error ? err.message : String(err) };
  }
}
