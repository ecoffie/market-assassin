/**
 * Public contractor-page resolution: found / redirect / confirmed-not-found / unavailable.
 *
 * Replaces "cache miss → notFound()", which 404'd valid contractors whenever their KV entry
 * was cold. ISR then held each 404 for 7 days and Google dropped the URLs (the July 2026
 * collapse: 10,173 → 1,347 indexed). See src/lib/seo/seo-unavailable.ts for the contract.
 *
 * Decision order:
 *   1. Cached rollup hit                         → found
 *   2. Cached alias (canonical-of) hit           → redirect (308)
 *   3. Cached single-UEI recipient hit           → found
 *   4. All three keys hold a cached EMPTY answer → not_found (the source said so)
 *   5. Otherwise the answer is unknown. Take one unit of the fail-closed daily budget and ask
 *      BigQuery (bounded: rollup ~53 MB + recipient ~62 MB, then the alias resolver):
 *        found → found (liveBq, so its sections may read live too)
 *        BQ answered empty on every arm → not_found
 *        BQ failed / budget spent        → unavailable (5xx + warm queued)
 *
 * Pure decision logic over injected readers so every branch is unit-testable without KV/BQ.
 */
import type { RollupProfile } from '@/lib/bigquery/recipients';
import type { BqResultState } from '@/lib/bigquery/cache';

export type ContractorResolution =
  | { kind: 'found'; recipient: RollupProfile; liveBq: boolean }
  | { kind: 'redirect'; slug: string }
  | { kind: 'not_found' }
  | { kind: 'unavailable'; reason: string };

export interface ContractorResolveDeps {
  /** getRollupOrSingleBySlug(slug, liveBq) — rollup first, then single-UEI recipient. */
  rollupOrSingle(slug: string, liveBq: boolean): Promise<RollupProfile | null>;
  /** resolveCanonicalSlug(slug, liveBq) — alias → canonical slug, or null. */
  canonicalOf(slug: string, liveBq: boolean): Promise<string | null>;
  /** serveableCanonical(): only redirect to a target that itself serves. */
  serveable(canonical: string | null): Promise<string | null>;
  /** bqResultState for the named key of THIS slug, read right after the call that used it. */
  state(key: 'rollup' | 'recipient' | 'canonical', slug: string): BqResultState;
  takeBudget(): Promise<boolean>;
  recordWarmMiss(slug: string): Promise<void>;
}

const answered = (s: BqResultState) => s === 'hit' || s === 'empty';

export async function resolveContractor(
  slug: string,
  deps: ContractorResolveDeps,
): Promise<ContractorResolution> {
  // ── Cache-only pass (zero BigQuery) ────────────────────────────────────────
  // rollupOrSingle reads the rollup key and, only if that misses, the recipient key.
  let recipient = await deps.rollupOrSingle(slug, false);
  if (recipient) return { kind: 'found', recipient, liveBq: false };
  const rollupState = deps.state('rollup', slug);
  const recipientState = deps.state('recipient', slug);

  const cachedCanonical = await deps.canonicalOf(slug, false);
  const canonicalState = deps.state('canonical', slug);
  const cachedTarget = await deps.serveable(cachedCanonical);
  if (cachedTarget) return { kind: 'redirect', slug: cachedTarget };

  // Confirmed absent only when every arm holds a real answer AND none points anywhere.
  // An alias that exists but whose target is not serveable yet is UNKNOWN, not absent:
  // the parent page may simply be cold, and 404ing its alias was the caci-inc-federal bug.
  if (
    answered(rollupState) && answered(recipientState) && answered(canonicalState) &&
    cachedCanonical === null
  ) {
    return { kind: 'not_found' };
  }

  // ── Unknown: bounded authoritative lookup ─────────────────────────────────
  if (!(await deps.takeBudget())) {
    await deps.recordWarmMiss(slug);
    return { kind: 'unavailable', reason: 'cold-budget-exhausted' };
  }

  recipient = await deps.rollupOrSingle(slug, true);
  if (recipient) return { kind: 'found', recipient, liveBq: true };
  const liveRollup = deps.state('rollup', slug);
  const liveRecipient = deps.state('recipient', slug);

  let canonical = cachedCanonical;
  let liveCanonicalState = canonicalState;
  if (!answered(canonicalState)) {
    canonical = await deps.canonicalOf(slug, true);
    liveCanonicalState = deps.state('canonical', slug);
  }
  const target = await deps.serveable(canonical);
  if (target) return { kind: 'redirect', slug: target };

  if (
    answered(liveRollup) && answered(liveRecipient) && answered(liveCanonicalState) &&
    canonical === null
  ) {
    return { kind: 'not_found' };
  }
  // Alias known but its target is cold: warm the TARGET, which is what will serve.
  await deps.recordWarmMiss(canonical ?? slug);
  const failed = [liveRollup, liveRecipient, liveCanonicalState].some((s) => s === 'failed');
  return {
    kind: 'unavailable',
    reason: failed ? 'bigquery-failed' : canonical ? 'alias-target-cold' : 'live-lookup-blocked',
  };
}

/**
 * Does a resolved contractor have enough of its core sections to render as a real page?
 * Both core sections cold/failed means the page would be a header over empty panels —
 * exactly what Google classifies as a Soft 404.
 */
export function coreSectionsUnavailable(
  recentAwards: BqResultState,
  yearlyTotals: BqResultState,
): boolean {
  return !answered(recentAwards) && !answered(yearlyTotals);
}
