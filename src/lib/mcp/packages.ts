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
export const CREDIT_PACKAGES: readonly CreditPackage[] = [
  { id: 'plus', credits: 800, usd: 15, label: 'Plus — 800 credits (7% bonus)', checkoutUrl: 'https://buy.stripe.com/00w5kE9UO1EK9tjdpefnO0K' },
  { id: 'scale', credits: 2400, usd: 40, label: 'Scale — 2,400 credits (20% bonus)', checkoutUrl: 'https://buy.stripe.com/14A7sMd703MS8pf4SIfnO0J' },
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

// Credits/mo are anchored to the legacy one-time pack rate: Plus 800cr@$15 =
// $0.01875/cr, Scale 2,400cr@$40 = $0.01667/cr. The ANNUAL-billed effective price
// ($15/$40 per month) hits exactly that per-credit rate; monthly billing ($19/$50)
// is the ~20% pay-as-you-go premium. Annual invoices grant 12× these.
const PLUS_CR_MO = Math.max(0, Number(process.env.MCP_PLUS_MONTHLY_CREDITS ?? '800') || 0);
const SCALE_CR_MO = Math.max(0, Number(process.env.MCP_SCALE_MONTHLY_CREDITS ?? '2400') || 0);

export const SUBSCRIPTION_PLANS: readonly SubscriptionPlan[] = [
  {
    id: 'plus',
    label: 'Plus',
    creditsPerMonth: PLUS_CR_MO,
    monthly: {
      priceId: 'price_1TtHbHK5zyiZ50PBGbmTn9mJ',
      usd: 19,
      credits: PLUS_CR_MO,
      checkoutUrl: 'https://buy.stripe.com/3cIeVe2sm83848Z98YfnO0O',
    },
    annual: {
      priceId: 'price_1TtHCIK5zyiZ50PB6Lvi5NMo',
      usd: 180,
      usdPerMonth: 15,
      credits: PLUS_CR_MO * 12,
      checkoutUrl: 'https://buy.stripe.com/00weVec2Wbfk20RclafnO0M',
    },
  },
  {
    id: 'scale',
    label: 'Scale',
    creditsPerMonth: SCALE_CR_MO,
    monthly: {
      priceId: 'price_1TtHbIK5zyiZ50PBhJ9MR9GE',
      usd: 50,
      credits: SCALE_CR_MO,
      checkoutUrl: 'https://buy.stripe.com/3cIfZi8QK0AG8pfetifnO0P',
    },
    annual: {
      priceId: 'price_1TtHCJK5zyiZ50PB57BKa1OW',
      usd: 480,
      usdPerMonth: 40,
      credits: SCALE_CR_MO * 12,
      checkoutUrl: 'https://buy.stripe.com/6oU28s8QK5V048Zad2fnO0N',
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
