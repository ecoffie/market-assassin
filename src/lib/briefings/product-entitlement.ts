/**
 * Which PURCHASES earn briefing access — the single, product-based rule.
 *
 * WHY THIS EXISTS
 * Entitlement used to be inferred from hardcoded Stripe PRICE BANDS in the
 * webhook's classifyCustomer() ($1497 = Ultimate, $997 = Pro Giant, …). Those
 * bands describe the 2025 bundle catalog. The products we actually sell today
 * match none of them, so every recent buyer fell through to briefings_access
 * 'none' — or got no classification row at all — and silently received nothing.
 *
 * Audited 2026-08-15: 76 of 115 paying customers (66%, $32,694) held no
 * briefing entitlement. The single largest product — Mindy Ai, $23,096, still
 * selling — had NO rule at all. A price band cannot track a catalog; it goes
 * stale the moment pricing changes, and it fails SILENTLY.
 *
 * THE RULE (set by Eric, 2026-08-15)
 *  • Mindy line only — Mindy Ai / Mindy Teams / Market Intelligence.
 *    Legacy bundles do NOT earn briefings.
 *  • Mindy MCP does NOT earn it. It sells API credits, not intelligence.
 *  • Under $99 earns nothing — filters $1.49/$4.99 test charges and the
 *    $14.90 / $29.97 partial-or-trial Mindy charges.
 *  • Recurring must be currently active; one-time / lifetime is permanent.
 *  • An explicit 'excluded' classification ALWAYS wins (see callers).
 *
 * Adding a product? Add it HERE. This module is the one place that decides,
 * and it is unit-tested against the real catalog.
 */

/** Below this, a charge is a test, a trial, or a partial payment. */
export const MIN_BRIEFING_CENTS = 9900;

/** Recurring Mindy plans: access lasts only while the subscription is live. */
const RECURRING_HINTS = ['mindy ai', 'market intelligence', 'market assassin'];

/** One-time / lifetime Mindy purchases: access does not lapse. */
const LIFETIME_HINTS = ['mindy teams', 'mindy lifetime', 'founders'];

/**
 * MCP sells API credits and is explicitly NOT a briefings product, even though
 * its name contains "Mindy". Checked before everything else.
 */
function isExcludedProduct(name: string): boolean {
  return name.includes('mcp');
}

export type BriefingGrant =
  | { earns: false; reason: string }
  | { earns: true; access: 'lifetime' | 'subscription'; requiresActiveSub: boolean };

/**
 * Does a single purchase earn briefing access?
 *
 * `amountCents` is the amount actually paid for THIS charge — pass the largest
 * single charge, not a lifetime total, or a pile of small charges adds up past
 * the floor and grants access nobody bought.
 */
export function briefingGrantForPurchase(
  productName: string | null | undefined,
  amountCents: number,
): BriefingGrant {
  const name = (productName || '').toLowerCase().trim();
  if (!name) return { earns: false, reason: 'no product name' };
  if (isExcludedProduct(name)) return { earns: false, reason: 'MCP sells API credits, not briefings' };

  const isLifetime = LIFETIME_HINTS.some((h) => name.includes(h));
  const isRecurring = RECURRING_HINTS.some((h) => name.includes(h));
  if (!isLifetime && !isRecurring) return { earns: false, reason: 'not a Mindy-line product' };

  // The floor applies to Mindy products too — a $14.90 Mindy Ai charge is a
  // trial, not a subscription.
  if (amountCents < MIN_BRIEFING_CENTS) {
    return { earns: false, reason: `under $${MIN_BRIEFING_CENTS / 100} (paid $${(amountCents / 100).toFixed(2)})` };
  }

  return isLifetime
    ? { earns: true, access: 'lifetime', requiresActiveSub: false }
    : { earns: true, access: 'subscription', requiresActiveSub: true };
}

/**
 * Best grant across all of a customer's purchases. Lifetime beats subscription;
 * a customer who bought both keeps the one that does not lapse.
 */
export function briefingGrantForCustomer(
  purchases: Array<{ product_name?: string | null; amount_paid?: number | null }>,
): BriefingGrant {
  let best: BriefingGrant = { earns: false, reason: 'no qualifying purchase' };
  for (const p of purchases) {
    const g = briefingGrantForPurchase(p.product_name, Number(p.amount_paid) || 0);
    if (!g.earns) continue;
    if (g.access === 'lifetime') return g;
    best = g;
  }
  return best;
}
