/**
 * Temporary-unavailability contract for the public contractor SEO pages (2026-11-12).
 *
 * WHY THIS EXISTS
 * ---------------
 * Between July and September 2026 getmindy.ai went from ~10,173 indexed pages to 1,347.
 * The URL Inspection audit (577 URLs) traced Google's verdicts to crawls made while a
 * cold cache made VALID contractor pages answer as if the contractor did not exist:
 *   - profile:   cache miss → notFound() → a real 404, held by ISR for 7 days
 *   - contracts: cache miss → 200 with an empty table (Soft 404), later noindex
 * Google then dropped the URLs and largely stopped recrawling them.
 *
 * The rule now: a page only says "does not exist" (404) or "nothing here" when a data
 * source ANSWERED that. When the data source could not answer — cold cache with no
 * budget left, BigQuery quota exhausted, Supabase/KV error — the page throws
 * SeoTemporarilyUnavailableError, which Next renders as a 5xx:
 *   - not cached by ISR (the next request retries), and on a background revalidation the
 *     previously generated page keeps being served;
 *   - Google treats 5xx as temporary: it slows crawling and keeps indexed URLs unless the
 *     error PERSISTS (developers.google.com/crawling/docs/troubleshooting/http-status-codes,
 *     which treats 500 and 503 identically and does not mention Retry-After).
 *
 * BOUNDED, NEVER INDEFINITE
 * -------------------------
 * Every cause of a throw here resets on its own: the cold-lookup budget is per UTC day, the
 * BigQuery QueryUsagePerDay quota is per day, and every throw also queues the slug for the
 * hourly warm cron (recordWarmMiss), which materializes it into KV.
 */
import { kv } from '@vercel/kv';

export class SeoTemporarilyUnavailableError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`SEO_TEMPORARILY_UNAVAILABLE: ${reason}`);
    this.name = 'SeoTemporarilyUnavailableError';
    this.reason = reason;
  }
}

export function isSeoTemporarilyUnavailable(err: unknown): err is SeoTemporarilyUnavailableError {
  return err instanceof Error && err.message.startsWith('SEO_TEMPORARILY_UNAVAILABLE:');
}

export type SeoColdKind = 'contractor' | 'contracts';

const LIMIT_ENV: Record<SeoColdKind, string> = {
  contractor: 'SEO_CONTRACTOR_COLD_LOOKUPS_PER_DAY',
  contracts: 'SEO_CONTRACTS_COLD_LOOKUPS_PER_DAY',
};

/**
 * Daily ceiling on cold (live BigQuery) renders per page family.
 *
 * Sizing (dry-run measured 2026-11-12): a cold profile identity lookup bills ~53 MB
 * (rollup) + ~62 MB (single-UEI fallback); its 7 section reads are awards-table reads
 * capped by AWARDS_SCAN_MAX_BYTES. The hourly warm cron already performs 200 such
 * profile warms per run (4,800/day), so the default 200/day adds ~4% to an existing,
 * proven load. 0 turns cold renders off (every cold page then answers 5xx + queues a warm).
 */
const DEFAULT_LIMIT: Record<SeoColdKind, number> = { contractor: 200, contracts: 200 };

export function seoColdDailyLimit(
  kind: SeoColdKind,
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env[LIMIT_ENV[kind]];
  const fallback = DEFAULT_LIMIT[kind];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

/**
 * Take one unit of today's cold-render budget. FAILS CLOSED.
 *
 * Deliberately not checkRateLimit(): that limiter allows the request when KV is down. Here a
 * KV outage is exactly when every page reads cold at once, so failing open would turn one
 * outage into a BigQuery quota storm that also takes the authenticated product down.
 */
export async function takeSeoColdBudget(kind: SeoColdKind, now: Date = new Date()): Promise<boolean> {
  const limit = seoColdDailyLimit(kind);
  if (limit === 0) return false;
  const key = `rl:seo-cold:${kind}:${now.toISOString().slice(0, 10)}`;
  try {
    const count = await kv.incr(key);
    if (count === 1) await kv.expire(key, 26 * 60 * 60);
    return count <= limit;
  } catch (err) {
    console.warn(`[seo-cold] budget unreadable for ${kind}; refusing cold render`, err);
    return false;
  }
}
