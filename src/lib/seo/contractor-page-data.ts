/**
 * Server wiring for the public contractor pages: real readers + in-process de-duplication.
 *
 * generateMetadata() and the page body must share ONE resolution per request, so a cold
 * render spends at most one unit of the daily budget and never reaches a different verdict in
 * the <head> than in the body (the "confident title over an empty body" mismatch that demoted
 * 11,772 contracts pages).
 *
 * React cache() was the first attempt and was MEASURED not to hold (2026-11-12, `next start`
 * against a command-logging KV mock): an unknown slug spent 2 budget units and queued 2 warm
 * misses per request. dedupeInFlight() shares by key across both renders in the same process,
 * whatever Next's render scoping or ordering, and re-uses a settled answer briefly.
 */
import { dedupeInFlight } from '@/lib/seo/dedupe-in-flight';
import {
  getRollupOrSingleBySlug,
  resolveCanonicalSlug,
  getPaginatedAwardsForRecipient,
  seoCacheKeys,
  type RecentAwardRow,
  type RollupProfile,
} from '@/lib/bigquery/recipients';
import { bqResultState } from '@/lib/bigquery/cache';
import { serveableCanonical } from '@/lib/seo/canonical-redirect';
import { recordWarmMiss } from '@/lib/seo/served-slugs';
import { takeSeoColdBudget } from '@/lib/seo/seo-unavailable';
import { resolveContractor, type ContractorResolution } from '@/lib/seo/contractor-resolve';

const KEY_FOR = {
  rollup: seoCacheKeys.rollupBySlug,
  recipient: seoCacheKeys.recipientBySlug,
  canonical: seoCacheKeys.canonicalOf,
} as const;

/** Resolve a public contractor slug. Memoized per request. */
export const resolveContractorForPage = dedupeInFlight(
  (slug: string) => `contractor:${slug}`,
  (slug: string): Promise<ContractorResolution> =>
    resolveContractor(slug, {
      rollupOrSingle: (s, live) => getRollupOrSingleBySlug(s, live),
      canonicalOf: (s, live) => resolveCanonicalSlug(s, live),
      serveable: (c) => serveableCanonical(c),
      // A miss on a key that was never read reports 'empty' (no mark). The resolver only
      // reads a key's state right after the call that queried it, so that cannot occur.
      state: (key, s) => bqResultState(KEY_FOR[key](s), 0),
      takeBudget: () => takeSeoColdBudget('contractor'),
      recordWarmMiss: (s) => recordWarmMiss(s),
    }),
);

export type ContractsPageData =
  | { kind: 'ok'; rows: RecentAwardRow[]; total: number }
  | { kind: 'unavailable'; reason: string };

/**
 * One page of a contractor's funded award actions.
 *   KV → durable serving table → (one unit of the daily budget) live BigQuery.
 * 'ok' with total 0 is a CONFIRMED empty answer from a data source, never a cold cache.
 */
export const loadContractsPage = dedupeInFlight(
  (recipient: RollupProfile, page: number, pageSize: number) => `contracts:${recipient.rollup_uei}:${page}:${pageSize}`,
  async (recipient: RollupProfile, page: number, pageSize: number): Promise<ContractsPageData> => {
    const first = await getPaginatedAwardsForRecipient(
      recipient.child_ueis, recipient.rollup_uei, page, pageSize,
    );
    if (first.state === 'ok') return { kind: 'ok', rows: first.rows, total: first.total };
    // A source ERRORED (quota, Supabase). Retrying live now would hit the same wall and
    // spend budget doing it.
    if (first.state === 'failed') return { kind: 'unavailable', reason: 'data-source-failed' };

    if (!(await takeSeoColdBudget('contracts'))) {
      await recordWarmMiss(recipient.canonical_slug);
      return { kind: 'unavailable', reason: 'cold-budget-exhausted' };
    }
    const live = await getPaginatedAwardsForRecipient(
      recipient.child_ueis, recipient.rollup_uei, page, pageSize, true,
    );
    if (live.state === 'ok') return { kind: 'ok', rows: live.rows, total: live.total };
    await recordWarmMiss(recipient.canonical_slug);
    return { kind: 'unavailable', reason: live.state === 'failed' ? 'bigquery-failed' : 'live-lookup-blocked' };
  },
);

/** Thin wrapper so pages can read the state of the core profile sections they just loaded. */
export function profileSectionState(rollupUei: string, recentCount: number, yearlyCount: number) {
  return {
    recent: bqResultState(seoCacheKeys.recentAwards(rollupUei, 25), recentCount),
    yearly: bqResultState(seoCacheKeys.yearlyTotals(rollupUei), yearlyCount),
  };
}
