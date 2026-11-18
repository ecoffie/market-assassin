/**
 * Which contractor pages Google is ASKED to index (2026-11-18).
 *
 * Search Console, 12 Nov 2026: 401 pages indexed; 20,628 "Crawled — currently not indexed",
 * rising every week. 89% of a 1,000-URL sample were contractor profiles and their tabs. Live
 * pages carry 700–1,500 words but 46–69% of that is shared template, leaving ~100–250 words
 * about the company. Google reads ~12K near-identical pages on a young, lightly linked domain
 * and keeps a few hundred.
 *
 * So the indexable set is narrowed to the contractors most likely to earn it, and grows as the
 * indexed share rises — never the other way round:
 *  - profile + /contracts: indexed only at or above CONTRACTOR_INDEX_MIN_OBLIGATED;
 *  - /naics and /agencies tabs: never indexed (they restate the profile's own breakdowns).
 * Pages below the tier still render (noindex, follow) so links and visitors keep working.
 *
 * Threshold history (one constant, read by the pages and the sitemap alike, so the sitemap never
 * lists a page that noindexes itself):
 *  - $10M (first cut) removed nothing: on the PR #2154 preview, all 11,770 sitemap contractors
 *    were already >= $10M (priority tiers: 1,007 at $1B+, 5,533 at $100M–$1B, 5,230 at $10M–$100M).
 *  - $500M targets ~3,000: 1,007 at $1B+ plus an estimated ~1,700 of the $100M–$1B band
 *    (log-uniform assumption). Verify against the URL count of sitemap-contractors.xml after
 *    deploy and adjust here.
 */
import { isThinContractor } from '@/lib/seo/warm-priority';

export const CONTRACTOR_INDEX_MIN_OBLIGATED = 500_000_000;

/** Are profile and /contracts pages for this contractor offered to Google? */
export function contractorIndexable(
  totalObligated: number | null | undefined,
  awardCount: number | null | undefined,
): boolean {
  if (isThinContractor(totalObligated, awardCount)) return false;
  return Number(totalObligated || 0) >= CONTRACTOR_INDEX_MIN_OBLIGATED;
}

/** The /naics and /agencies tabs restate the profile; they are never offered to Google. */
export const CONTRACTOR_TABS_INDEXABLE = false;
