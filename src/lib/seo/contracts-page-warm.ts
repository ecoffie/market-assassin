/**
 * Warm page 1 of /contractors/[slug]/contracts from the contractor warm cron (2026-11-14).
 *
 * WHY
 * ---
 * The re-run of Search Console's 1,000 "Not found (404)" examples (docs/SEO-RECOVERY-2026-11.md)
 * left 77 /contracts pages answering 5xx although every one of those contractors resolves: the
 * page-1 data key was cold and the contracts cold budget (200/day) was spent within ~30 minutes
 * of the UTC reset. The warm cron warmed the profile sections only, so /contracts depended
 * entirely on that render-time budget.
 *
 * HOW
 * ---
 * Same reader, same keys, same cached format the page uses (getPaginatedAwardsForRecipient at
 * CONTRACTS_PAGE_SIZE), in the same order loadContractsPage() uses: cache first (KV, then the
 * durable serving table), live BigQuery only when both miss. So an already-served page costs no
 * scan, and the render-time contracts budget is never touched (the warmer has its own caps).
 * A contractor with no awards is not read at all.
 */
import { getPaginatedAwardsForRecipient } from '@/lib/bigquery/recipients';

/** Rows per /contracts page. The page and this warmer MUST agree: the size is part of the key. */
export const CONTRACTS_PAGE_SIZE = 50;

/**
 * cached    page 1 already served from KV or the durable table (no BigQuery)
 * warmed    page 1 was cold; one live read filled the keys
 * no-awards the contractor has no awards: nothing to list, nothing read
 * failed    a data source errored or the live read did not produce an answer
 */
export type ContractsWarmResult = 'cached' | 'warmed' | 'no-awards' | 'failed';

export interface ContractsWarmTarget {
  child_ueis: string[];
  rollup_uei: string;
  award_count?: number | null;
}

export async function warmContractsPage1(
  recipient: ContractsWarmTarget,
  read: typeof getPaginatedAwardsForRecipient = getPaginatedAwardsForRecipient,
): Promise<ContractsWarmResult> {
  if (!(Number(recipient.award_count || 0) > 0)) return 'no-awards';
  const { child_ueis: ueis, rollup_uei: rollupUei } = recipient;

  const cached = await read(ueis, rollupUei, 1, CONTRACTS_PAGE_SIZE, false);
  if (cached.state === 'ok') return 'cached';
  // A source ERRORED (KV / serving table). A live retry now would hit the same wall.
  if (cached.state === 'failed') return 'failed';

  const live = await read(ueis, rollupUei, 1, CONTRACTS_PAGE_SIZE, true);
  return live.state === 'ok' ? 'warmed' : 'failed';
}
