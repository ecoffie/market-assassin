/**
 * Daily cap on COLD BigQuery lookups for /awards/[id] (2026-11-12).
 *
 * With ENABLE_SEO_LIVE_BQ off, every award page that was not already in KV rendered
 * "Award Not Found" — a real contract shown as nonexistent. GA4 measured that page as the
 * site's #2 page: 25K people in 28 days, 99.8% bounce. The award lookup is the cheap one
 * (partition-pruned, ~10 MB billed, cached 90 days), so it can run cold under a hard daily
 * ceiling without re-creating the crawler quota storm that live-bq.ts guards against.
 *
 * Max cost/day ≈ limit × ~10 MB (default 4,000 → ~40 GB/day). SEO_AWARD_COLD_LOOKUPS_PER_DAY
 * overrides it; 0 turns cold award lookups off again.
 */
import { checkRateLimit } from '@/lib/rate-limit';
import { recordColdDecision } from '@/lib/seo/lookup-metrics';

export function awardColdDailyLimit(env: Record<string, string | undefined> = process.env): number {
  const raw = env.SEO_AWARD_COLD_LOOKUPS_PER_DAY;
  const n = raw === undefined || raw === '' ? 4000 : Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 4000;
}

/** One unit of today's global budget, or false when spent. */
export async function allowAwardColdLookup(awardId?: string): Promise<boolean> {
  const limit = awardColdDailyLimit();
  if (limit === 0) { await recordColdDecision('award', false, awardId); return false; }
  const day = new Date().toISOString().slice(0, 10);
  const rl = await checkRateLimit(`seo-award-cold:${day}`, limit, 26 * 60 * 60);
  await recordColdDecision('award', rl.allowed, awardId); // measurement only
  return rl.allowed;
}
