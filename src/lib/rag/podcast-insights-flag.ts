/**
 * Feature gate for podcast guest quotes on Today's Intel Mindy Insight.
 *
 * OFF by default until highlight quality is reviewed at
 * /admin/podcast-highlights. Enable with:
 *   ENABLE_PODCAST_INSIGHTS=true
 *   PODCAST_INSIGHTS_ROLLOUT_PERCENT=0   # start at 0, bump after QA
 */

import { userInRollout } from '@/lib/intelligence/feature-flag';

export function isPodcastInsightEnabled(userEmail?: string): boolean {
  if (process.env.ENABLE_PODCAST_INSIGHTS !== 'true') return false;
  const pct = parseInt(process.env.PODCAST_INSIGHTS_ROLLOUT_PERCENT || '0', 10);
  if (!userEmail) return pct >= 100;
  return userInRollout(userEmail, pct, 'podcast-insight-v1');
}
