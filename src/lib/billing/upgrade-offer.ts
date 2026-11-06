/**
 * Upgrade offer (Eric 2026-11-06): "if someone is upgrading to a new plan, give them a 25% discount
 * on just the upgrade for the first month."
 *
 * Shown only to SIGNED-IN users moving up a plan, never on the public price list.
 *
 * ⚠️ Needs Stripe set-up before it discounts anything (code cannot do this):
 *   1. Stripe → Coupons: 25% off, Duration "Once".
 *   2. Promotion code `UPGRADE25` on that coupon.
 *   3. On the MONTHLY Pro payment link, turn on "Allow promotion codes".
 * Until then Stripe ignores the prefilled code and charges the normal price. The offer is applied
 * to monthly checkout only: on an annual plan, a "once" coupon would take 25% off the whole year.
 * Teams upgrades go through sales (/contact-sales?offer=upgrade25), and the offer is in the Slack message.
 */
export const UPGRADE_PROMO_CODE = 'UPGRADE25';
export const UPGRADE_OFFER_LABEL = '25% off your first month';
export const UPGRADE_OFFER_PARAM = 'upgrade25';

/** Add the prefilled promo code to a Stripe payment link. */
export function withUpgradePromo(stripeUrl: string): string {
  const sep = stripeUrl.includes('?') ? '&' : '?';
  return `${stripeUrl}${sep}prefilled_promo_code=${UPGRADE_PROMO_CODE}`;
}
