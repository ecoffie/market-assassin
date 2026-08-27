/**
 * Shared cold BigQuery budget — same limits as Tier-2 chat tools.
 * Warm KV hits are free; only live BQ scans consume budget.
 */
import { checkRateLimit } from '@/lib/rate-limit';

/** Per-actor cold contractor lookups per window (matches Tier-2). */
export const COLD_BQ_LIMIT = 12;
export const COLD_BQ_WINDOW_SECONDS = 60 * 60; // 1 hour

/** Max cold BQ lookups in a single tool/turn invocation. */
export const MAX_COLD_PER_TURN = 2;

export type ColdBqTurnState = { count: number };

/**
 * Gate a cost-bearing (cold) BigQuery lookup.
 * Uses the same KV rate-limit key prefix as Tier-2 (`chat-bq:{actor}`) so chat and
 * MCP share one hourly budget per identity.
 */
export async function allowColdBqLookup(
  actor: string,
  turn: ColdBqTurnState = { count: 0 },
): Promise<boolean> {
  const email = (actor || '').trim().toLowerCase();
  if (!email) return false;
  if (turn.count >= MAX_COLD_PER_TURN) return false;
  const rl = await checkRateLimit(`chat-bq:${email}`, COLD_BQ_LIMIT, COLD_BQ_WINDOW_SECONDS);
  if (!rl.allowed) return false;
  turn.count += 1;
  return true;
}
