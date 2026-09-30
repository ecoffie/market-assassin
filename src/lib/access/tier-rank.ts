/**
 * The product-capability hierarchy: enterprise ≥ team ≥ pro ≥ free ≥ none.
 *
 * A feature gate asks "does this account have AT LEAST tier X?", never "is it exactly
 * X?". An exact check silently drops every higher plan: `tier === 'pro'` returned 402
 * "Mindy Pro feature" to paying $499 Team customers on Mindy Analyst and market-report
 * generation, and `pro || team` shut Enterprise out of the market overview (found
 * 2026-09-30 by the pooled-credits canary review).
 *
 * This is PRODUCT capability only. Billing and credit entitlements (monthly MCP
 * allowances, who pays for a call, pooled vs personal credits) are separate and are
 * NOT derived from this ranking.
 *
 * Pure and dependency-free, so it is safe in client components.
 * Guarded by scripts/audit-exact-tier-gates.mjs (pre-push).
 */
export type ProductTier = 'none' | 'free' | 'pro' | 'team' | 'enterprise';

const RANK: Record<ProductTier, number> = { none: 0, free: 1, pro: 2, team: 3, enterprise: 4 };

/** True when `tier` grants every capability of `minimum`. Unknown tiers grant nothing. */
export function tierAtLeast(tier: string | null | undefined, minimum: ProductTier): boolean {
  const rank = RANK[(tier ?? '') as ProductTier];
  return rank !== undefined && rank >= RANK[minimum];
}

/** Paid product capability: Pro or anything above it. */
export function hasPaidProductTier(tier: string | null | undefined): boolean {
  return tierAtLeast(tier, 'pro');
}
