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
 * CONFIRMED ALIAS of a single registration (Eric, 2026-11-25). Steps 1/3 used to answer `found` for a slug that
 * names ONE subsidiary registration, before the alias resolver was ever asked, so a subsidiary's slug served a
 * one-UEI page whose contracts were never built (11-23/24 contracts 500s, class c). Now, when the hit is a
 * synthesized single-registration profile, the slug redirects to the parent family's page ONLY when identity is
 * confirmed by UEI, never by name:
 *   - the alias resolver's target family CONTAINS this exact UEI, and
 *   - that family's key is this registration's own SAM parent UEI (or the UEI itself).
 * A family that holds the UEI only through the same-NAME merge, or a target that does not hold it at all (two
 * different companies with one name), is a distinct entity: the page keeps serving the registration itself.
 * The section is preserved by each route (`/contracts/2` → `/contracts/2`). The request path never spends a
 * BigQuery unit on this check: it reads the alias cache only (inside an already-paid live pass it reads live),
 * and a cold alias key queues a warm for the slug.
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
  /** getRollupBySlug(canonical) cache-only: the target family, for the confirmed-alias membership check. */
  family(canonical: string): Promise<RollupProfile | null>;
  /** bqResultState for the named key of THIS slug, read right after the call that used it. */
  state(key: 'rollup' | 'recipient' | 'canonical', slug: string): BqResultState;
  takeBudget(): Promise<boolean>;
  recordWarmMiss(slug: string): Promise<void>;
}

const answered = (s: BqResultState) => s === 'hit' || s === 'empty';

/**
 * The family page a single-registration hit is a CONFIRMED alias of, or null. Identity by UEI only:
 * the family must contain this UEI and be keyed by its own SAM parent (or itself). See the header.
 */
export function confirmedFamilyOf(single: RollupProfile, family: RollupProfile | null): string | null {
  if (!single.single || !family) return null;
  const uei = single.rollup_uei;
  const parent = single.single.parent_uei || uei;
  if (!family.child_ueis.includes(uei)) return null; // the target is not this registration's family
  if (family.rollup_uei !== parent && family.rollup_uei !== uei) return null; // held only via a name merge
  if (family.canonical_slug === single.canonical_slug) return null;
  return family.canonical_slug;
}

async function singleAliasTarget(
  slug: string,
  single: RollupProfile,
  live: boolean,
  deps: ContractorResolveDeps,
): Promise<{ target: string | null; cold: boolean }> {
  if (!single.single) return { target: null, cold: false };
  const canonical = await deps.canonicalOf(slug, live);
  const cold = !answered(deps.state('canonical', slug));
  if (!canonical) return { target: null, cold };
  if (!(await deps.serveable(canonical))) return { target: null, cold: false };
  return { target: confirmedFamilyOf(single, await deps.family(canonical)), cold: false };
}

export async function resolveContractor(
  slug: string,
  deps: ContractorResolveDeps,
): Promise<ContractorResolution> {
  // ── Cache-only pass (zero BigQuery) ────────────────────────────────────────
  // rollupOrSingle reads the rollup key and, only if that misses, the recipient key.
  let recipient = await deps.rollupOrSingle(slug, false);
  if (recipient) {
    const { target: cachedTarget, cold } = await singleAliasTarget(slug, recipient, false, deps);
    if (cachedTarget) return { kind: 'redirect', slug: cachedTarget };
    // Unknown alias for a registration that HAS a separate parent: serve it now, warm the alias key for next time.
    if (cold && recipient.single?.parent_uei && recipient.single.parent_uei !== recipient.rollup_uei) {
      await deps.recordWarmMiss(slug);
    }
    return { kind: 'found', recipient, liveBq: false };
  }
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
  if (recipient) {
    // Inside the live pass this unit already paid for: ask the alias resolver live too.
    const { target } = await singleAliasTarget(slug, recipient, true, deps);
    if (target) return { kind: 'redirect', slug: target };
    return { kind: 'found', recipient, liveBq: true };
  }
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
