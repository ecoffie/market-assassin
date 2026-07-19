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
 * Live one-time top-up pack (SINGLE, GOS Decision #015). The backing product carries
 * metadata `type=mcp_credit_topup` + `package=refill`; the webhook grants credits
 * SERVER-SIDE from the package id (never a raw credits number).
 *
 * Locked model (2026-07-19): ONE premium "ran out mid-month" valve — 500 cr / $119
 * (~$0.238/cr, the priciest per-credit in the whole ladder ON PURPOSE, so it never
 * undercuts subscribing). Also the SKU auto-recharge draws from. Product/link/price
 * created live 2026-07-19; the 4 legacy top-ups ($79/300, $149/700, $99/5,000, $49/2,000)
 * were ARCHIVED in Stripe the same pass (prices + payment links deactivated).
 */
export const CREDIT_PACKAGES: readonly CreditPackage[] = [
  { id: 'refill', credits: 500, usd: 119, label: 'Top-up — 500 credits', checkoutUrl: 'https://buy.stripe.com/cNiaEYff8bfk8pfetifnO11' },
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

/**
 * Credits included with an active Pro ($149/mo) subscription, granted monthly.
 * Set to 250 (GOS Decision #015, 2026-07-19). This is a TASTE, not a bundle: ≈2–3 flagship
 * runs (a proposal/report ≈100 cr), then the wall → the user buys the separate $99/500 MCP
 * product. Deliberately BELOW the $99/500 MCP entry so it can't substitute for it. Was 1,500.
 * ⚠️ Env-overridable: if MCP_PRO_MONTHLY_CREDITS is set in Vercel it WINS over this default —
 * update it to 250 (or unset it) or Pro silently keeps the old amount.
 */
export const PRO_MONTHLY_CREDITS = Math.max(
  0,
  Number(process.env.MCP_PRO_MONTHLY_CREDITS ?? '250') || 0,
);

/**
 * Credits included with an active Team ($499/mo) subscription, granted monthly. Set to 750
 * (GOS Decision #015, 2026-07-19) — a small agency sampling (≈7–8 flagship runs), still a
 * TASTE that pushes a real agency to a separate MCP sub ($249/$999), not the old bundle.
 * Was 8,000. Env-overridable — update MCP_TEAM_MONTHLY_CREDITS to 750 or unset it.
 */
export const TEAM_MONTHLY_CREDITS = Math.max(
  0,
  Number(process.env.MCP_TEAM_MONTHLY_CREDITS ?? '750') || 0,
);

/**
 * Internal team (Eric, Branden, the dev team) monthly comp allowance — deliberately HIGH so
 * internal never runs out while building/testing (Eric, 2026-07-19). Cost to us is ~$0 (the
 * $15/user/mo LLM cap governs real spend regardless of balance). Env-overridable.
 */
export const INTERNAL_MONTHLY_CREDITS = Math.max(
  0,
  Number(process.env.MCP_INTERNAL_MONTHLY_CREDITS ?? '25000') || 0,
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
  /**
   * Annual price + the effective monthly rate to display. OPTIONAL — annual MCP variants
   * are DEFERRED (GOS Decision #015: monthly-only first, add annual once the model proves).
   */
  annual?: PlanPrice & { usdPerMonth: number };
}

// The MCP metered ladder (GOS Decision #015, 2026-07-19): a SEPARATE product from the App
// ($149 Pro / $499 Team are app tiers — their MCP allowance is PRO/TEAM_MONTHLY_CREDITS, not
// sold here). Three self-serve tiers, monthly-only for now (annual deferred). The Enterprise/
// API tier (#016) is INQUIRY-ONLY — no Stripe product, so it's deliberately absent here.
// Products/prices/payment-links created live 2026-07-19; each price carries metadata
// type=mcp_subscription + plan=<id>. The webhook grants by priceId (subscriptionGrantForPriceId),
// so these IDs are the source of truth. The old $59 Starter + $19 Plus were archived same pass.
export const SUBSCRIPTION_PLANS: readonly SubscriptionPlan[] = [
  {
    id: 'entry',
    label: 'Entry',
    creditsPerMonth: 500,
    monthly: {
      priceId: 'price_1TuxApK5zyiZ50PB8iMg8WqG',
      usd: 99,
      credits: 500,
      checkoutUrl: 'https://buy.stripe.com/bJe5kEff8erw20R0CsfnO0Y',
    },
  },
  {
    id: 'mid',
    label: 'Mid',
    creditsPerMonth: 1500,
    monthly: {
      priceId: 'price_1TuxApK5zyiZ50PBPV40eCvG',
      usd: 249,
      credits: 1500,
      checkoutUrl: 'https://buy.stripe.com/8x29AUgjcfvA5d30CsfnO0Z',
    },
  },
  {
    id: 'agency',
    label: 'Agency',
    creditsPerMonth: 8000,
    monthly: {
      priceId: 'price_1TuxAqK5zyiZ50PBJUdzoobH',
      usd: 999,
      credits: 8000,
      checkoutUrl: 'https://buy.stripe.com/8x2eVe1oi6Z434VdpefnO10',
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
    if (p.annual && p.annual.priceId === priceId) return { planId: p.id, credits: p.annual.credits, interval: 'year' };
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
  return interval === 'year' && p.annual
    ? { planId: p.id, credits: p.annual.credits, interval: 'year' }
    : { planId: p.id, credits: p.monthly.credits, interval: 'month' };
}
