/**
 * Prioritized contractor warming (2026-11-13).
 *
 * The warm-miss queue (a plain set) held 9,263 slugs, drained 25/hour in RANDOM order (SPOP), so
 * a contractor with search history waited behind thousands with none. Step 0 measured the backlog:
 * 107 of 9,263 had any Search Console impressions; of the 5,788 that resolved, 4,775 are above the
 * thin gate and 1,013 below it (those render noindex — warming their sections buys nothing).
 *
 * A sorted set now orders the work. Score, highest first:
 *   search clicks (16 mo)   → +1,000,000
 *   ≥10 impressions          →   +100,000
 *   any impressions          →    +10,000
 *   contract value           →   +100 × log10(total_obligated)   (≈ 400-1,100)
 *   requests (cache misses)  →   +1 each, accumulated live by recordWarmMiss()
 * Thin contractors are never added (score null). The plain set stays as the compatibility record.
 */
export const WARM_PRIORITY_KEY = 'seo:warm:priority:contractor-slugs';
/** Per-UTC-day ceiling on section warms from the priority queue (each ≈ 7 cached BigQuery reads). */
export const WARM_PRIORITY_DAILY_CAP = 2000;
export const WARM_PRIORITY_PER_RUN = 100;
export const warmDailyKey = (day = new Date().toISOString().slice(0, 10)) => `rl:seo-warm-priority:${day}`;

export interface WarmSignals {
  gscImpressions?: number;
  gscClicks?: number;
  totalObligated?: number | null;
  awardCount?: number | null;
  requests?: number;
}

export function isThinContractor(totalObligated: number | null | undefined, awardCount: number | null | undefined): boolean {
  return Number(totalObligated || 0) < 25000 || Number(awardCount || 0) < 2;
}

/** Priority score, or null when the contractor should not be section-warmed at all. */
export function warmScore(s: WarmSignals): number | null {
  const known = s.totalObligated != null && s.awardCount != null;
  if (known && isThinContractor(s.totalObligated, s.awardCount)) return null;
  let score = 0;
  if ((s.gscClicks || 0) > 0) score += 1_000_000;
  if ((s.gscImpressions || 0) >= 10) score += 100_000;
  if ((s.gscImpressions || 0) > 0) score += 10_000;
  if (s.totalObligated && s.totalObligated > 0) score += Math.round(100 * Math.log10(s.totalObligated));
  score += s.requests || 0;
  return score;
}
