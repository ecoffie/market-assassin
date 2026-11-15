/**
 * Legacy one-time tool products confirmed by /api/stripe-session, keyed by Stripe PRICE id.
 *
 * This is the single source of truth for "which product did this checkout session buy". The
 * route derives the product ONLY from the session's own line items through this map; the
 * `?product=` query parameter is at most a hint and can never add a product that was not paid
 * for. A price that is not listed here grants nothing through that route (fail closed); the
 * Stripe webhook remains the source of truth for provisioning.
 *
 * Price ids read from the live Stripe account on 2026-11-15 (each product has exactly one
 * price; every payment link for them is inactive). "GovCon Full Fix" (price_1Spa7F…, product
 * inactive, link carries no tier metadata) is deliberately NOT mapped: it cannot be tied to a
 * Content Reaper tier from evidence, so it is left to the webhook.
 */
export type LegacySessionProduct =
  | 'opportunity-hunter-pro'
  | 'market-assassin-standard'
  | 'market-assassin-premium'
  | 'market-assassin-premium-upgrade'
  | 'content-engine'
  | 'full-fix'
  | 'content-full-fix-upgrade';

export const LEGACY_PRICE_PRODUCTS: Readonly<Record<string, LegacySessionProduct>> = Object.freeze({
  price_1SnyAmK5zyiZ50PBIPXfxUXc: 'opportunity-hunter-pro',          // $49
  price_1SnzosK5zyiZ50PBulNZPsy3: 'market-assassin-standard',        // $297
  price_1SkxvtK5zyiZ50PBKqkrzHoN: 'market-assassin-premium',         // $497
  price_1StANRK5zyiZ50PBkQFYdAp8: 'market-assassin-premium-upgrade', // $200
  price_1SedJZK5zyiZ50PBwJ4Sy4Qb: 'content-engine',                  // Content Reaper Standard $197
  price_1StA15K5zyiZ50PBxwotBD6H: 'full-fix',                        // Content Reaper Full Fix $397
  price_1St7NQK5zyiZ50PBb05Ulnx2: 'content-full-fix-upgrade',        // $200
});

export function isLegacySessionProduct(v: unknown): v is LegacySessionProduct {
  return typeof v === 'string' && Object.values(LEGACY_PRICE_PRODUCTS).includes(v as LegacySessionProduct);
}

type LineItemLike = { price?: { id?: string | null } | string | null; quantity?: number | null };

/** Products actually bought in a session, in line-item order, de-duplicated. */
export function productsFromLineItems(items: readonly LineItemLike[] | null | undefined): LegacySessionProduct[] {
  const out: LegacySessionProduct[] = [];
  for (const it of items ?? []) {
    if ((it.quantity ?? 1) <= 0) continue;
    const id = typeof it.price === 'string' ? it.price : it.price?.id;
    const p = id ? LEGACY_PRICE_PRODUCTS[id] : undefined;
    if (p && !out.includes(p)) out.push(p);
  }
  return out;
}
