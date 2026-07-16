/**
 * Mindy MCP credit packages + Pro monthly allowance — the SERVER-TRUSTED source of
 * truth for how many credits a purchase grants.
 *
 * Phase 1 Slice 4. Stripe payment links carry only a `package` id in metadata; the
 * webhook maps that id → credits HERE. We deliberately do NOT trust a `credits` number
 * from client-settable metadata (tamper-safe). Amounts are low-entry on purpose — the
 * broad-audience on-ramp (à la Higgsfield's $15 start / $5 packs) that sits BELOW the
 * $149/mo app sub. Final dollar prices are set when the Stripe products are created;
 * these credit amounts are what the webhook grants.
 */

export interface CreditPackage {
  /** Stripe product-metadata `package` id — the webhook maps this → credits. */
  id: string;
  /** Credits granted on purchase. */
  credits: number;
  /** Display price (informational; the real charge is the Stripe product's price). */
  usd: number;
  label: string;
  /** Stripe payment-link URL — the dashboard Buy button appends ?client_reference_id=<email>. */
  checkoutUrl: string;
}

/**
 * Live top-up tiers. `checkoutUrl` = the Stripe payment link (created 2026-07-12; each
 * product carries metadata type=mcp_credit_topup + package=<id>). Credits here MUST
 * match each Stripe product's stated credit count.
 */
// $15 Plus is the entry pack — the $5 Starter was retired 2026-07-14 (too small to
// be worth the Stripe fee + anchors the product as cheap). Its Stripe product can be
// archived; leaving it unlisted here means it's no longer sold or granted.
// Repriced 2026-07-16 to the locked model: the small pack mirrors the Starter
// monthly rate (2,000 cr ≈ $49, ~$0.0245/cr) and the large pack adds a volume
// discount (5,000 cr = $99, ~$0.0198/cr). The old $15/800 + $40/2,400 packs were
// the consumer-priced entry we're moving off. ⚠️ Amounts changed → Stripe prices
// are IMMUTABLE: each `checkoutUrl` below STILL charges the OLD amount ($15/$40) —
// REPLACE with the new $49 / $99 payment links before deploy. `credits`/`usd`/
// `label` are safe to set now (usd is display; credits is what the webhook grants
// per the package id, so a buyer of the new $49 link correctly gets 2,000).
export const CREDIT_PACKAGES: readonly CreditPackage[] = [
  { id: 'plus', credits: 2000, usd: 49, label: 'Plus — 2,000 credits', checkoutUrl: 'https://buy.stripe.com/00w5kE9UO1EK9tjdpefnO0K' }, // TODO(pricing): swap → the $49 / 2,000-cr payment link
  { id: 'scale', credits: 5000, usd: 99, label: 'Scale — 5,000 credits (best value)', checkoutUrl: 'https://buy.stripe.com/14A7sMd703MS8pf4SIfnO0J' }, // TODO(pricing): swap → the $99 / 5,000-cr payment link
] as const;

const BY_ID = new Map(CREDIT_PACKAGES.map((p) => [p.id, p]));

/**
 * Credits for a package id, or null if unknown. Returning null (not a default) is the
 * tamper guard: an unrecognized/forged `package` grants NOTHING.
 */
export function creditsForPackage(packageId: string | null | undefined): number | null {
  const p = packageId ? BY_ID.get(packageId) : undefined;
  return p ? p.credits : null;
}

/** Credits included with an active Pro ($149/mo) subscription, granted monthly. */
export const PRO_MONTHLY_CREDITS = Math.max(
  0,
  Number(process.env.MCP_PRO_MONTHLY_CREDITS ?? '1000') || 0,
);

/**
 * Credit subscriptions — the acquisition-surface plans on /mcp/pricing.
 *
 * Each plan has a MONTHLY and an ANNUAL Stripe price. Following the Higgsfield
 * pattern, the credit allowance is expressed per-month and stays CONSTANT across
 * the billing toggle — only the price changes (annual discounts the effective
 * monthly rate). The annual invoice grants a full year of credits up front
 * (creditsPerMonth × 12); each monthly invoice grants creditsPerMonth.
 *
 * The webhook maps a paid invoice's line-item Stripe price id → its credit grant
 * HERE (never trusting a client-set credit count). creditsPerMonth is
 * env-overridable so the grant can be tuned without a Stripe change. Distinct
 * from CREDIT_PACKAGES (one-time dashboard top-ups) and PRO_MONTHLY_CREDITS
 * (the $149/mo app sub allowance). Prices/links created 2026-07-14; each price
 * carries metadata type=mcp_subscription + plan=<id> + interval=month|year.
 */
export interface PlanPrice {
  /** Stripe recurring price id. */
  priceId: string;
  /** Charge in USD for this interval (monthly = per month, annual = per year). */
  usd: number;
  /** Credits granted per paid invoice at this interval. */
  credits: number;
  /** Stripe payment-link URL — append ?client_reference_id=<email> at checkout. */
  checkoutUrl: string;
}

export interface SubscriptionPlan {
  /** Config key + Stripe product-metadata `plan` id. */
  id: string;
  label: string;
  /** Credit allowance shown on the card — constant across the toggle. */
  creditsPerMonth: number;
  monthly: PlanPrice;
  /** Annual price, plus the effective monthly rate to display ("$15/mo · billed annually"). */
  annual: PlanPrice & { usdPerMonth: number };
}

// Locked ladder (2026-07-16): the ONLY MCP-native credit sub is STARTER $59/mo
// (the repurposed 'scale' plan below). Pro $149 / Team $499 are the app tiers
// (their MCP allowance is PRO_MONTHLY_CREDITS + the app grant, not sold here). The
// old $19 'Plus' sub was RETIRED — verified 0 mcp_sub_* purchases ever, so nothing
// to grandfather. SCALE_CR_MO is the Starter allowance (2,400 cr ≈ $0.0246/cr @ $59).
const SCALE_CR_MO = Math.max(0, Number(process.env.MCP_SCALE_MONTHLY_CREDITS ?? '2400') || 0);

export const SUBSCRIPTION_PLANS: readonly SubscriptionPlan[] = [
  // ($19 'Plus' sub RETIRED 2026-07-16 — folded into Starter $59; 0 subs to migrate.
  //  Archive its Stripe products so the old $19/$180 links can't be hit.)
  {
    // Repurposed 2026-07-16: the old "Scale" credit sub is now the $59/mo STARTER —
    // the entry paid tier in the locked ladder (Free → Starter $59 → Pro $149 → Team
    // $499). id stays 'scale' so the Stripe metadata `plan=scale` mapping + any live
    // subs keep resolving; only the display + (pending) the $59 Stripe price change.
    // ⚠️ Stripe prices are IMMUTABLE: $50→$59 needs a NEW price + payment link. The
    // priceId/checkoutUrl below STILL transact $50/$480 — REPLACE them with the $59
    // (monthly) + annual versions before this deploys, or the page says $59 and
    // checkout charges $50. usd/label are display-only and safe to set now.
    id: 'scale',
    label: 'Starter',
    creditsPerMonth: SCALE_CR_MO,
    monthly: {
      priceId: 'price_1TtHbIK5zyiZ50PBhJ9MR9GE', // TODO(pricing): swap → the $59/mo Starter price id
      usd: 59,
      credits: SCALE_CR_MO,
      checkoutUrl: 'https://buy.stripe.com/3cIfZi8QK0AG8pfetifnO0P', // TODO(pricing): swap → the $59/mo Starter payment link
    },
    annual: {
      priceId: 'price_1TtHCJK5zyiZ50PB57BKa1OW', // TODO(pricing): swap → the $59-based annual price id
      usd: 590,
      usdPerMonth: 49, // ~2 months free vs $59/mo; adjust to taste
      credits: SCALE_CR_MO * 12,
      checkoutUrl: 'https://buy.stripe.com/6oU28s8QK5V048Zad2fnO0N', // TODO(pricing): swap → the $59-based annual payment link
    },
  },
] as const;

const SUB_BY_ID = new Map(SUBSCRIPTION_PLANS.map((p) => [p.id, p]));

/** The credit grant + interval for a paid subscription invoice. */
export interface SubscriptionGrant {
  planId: string;
  credits: number;
  interval: 'month' | 'year';
}

/** Plan by config/metadata id, or null if unknown. */
export function subscriptionPlan(planId: string | null | undefined): SubscriptionPlan | null {
  return planId ? SUB_BY_ID.get(planId) ?? null : null;
}

/**
 * Resolve the credit grant for a Stripe price id (the webhook's primary path).
 * Returns null for any unrecognized price — the tamper guard: an unknown/forged
 * price grants NOTHING.
 */
export function subscriptionGrantForPriceId(priceId: string | null | undefined): SubscriptionGrant | null {
  if (!priceId) return null;
  for (const p of SUBSCRIPTION_PLANS) {
    if (p.monthly.priceId === priceId) return { planId: p.id, credits: p.monthly.credits, interval: 'month' };
    if (p.annual.priceId === priceId) return { planId: p.id, credits: p.annual.credits, interval: 'year' };
  }
  return null;
}

/**
 * Resolve the credit grant from metadata `plan` + `interval` (the webhook's
 * fallback when a line item lacks a recognized price id). Null if plan unknown.
 */
export function subscriptionGrantForMeta(
  planId: string | null | undefined,
  interval: string | null | undefined,
): SubscriptionGrant | null {
  const p = subscriptionPlan(planId);
  if (!p) return null;
  return interval === 'year'
    ? { planId: p.id, credits: p.annual.credits, interval: 'year' }
    : { planId: p.id, credits: p.monthly.credits, interval: 'month' };
}
