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
 * Live one-time top-up packs. `checkoutUrl` = the Stripe payment link. Each backing
 * product carries metadata `type=mcp_credit_topup` + `package=<id>`; the webhook grants
 * credits SERVER-SIDE from the package id (never a raw credits number), so these credit
 * counts must match what each package id is worth.
 *
 * Locked model (2026-07-16): the small pack mirrors the Starter monthly rate
 * (2,000 cr / $49, ~$0.0245/cr); the large pack adds a volume discount (5,000 cr / $99,
 * ~$0.0198/cr). Links point at FRESH products created 2026-07-16 with correct metadata
 * (the first dashboard attempt was mis-tagged `tier=briefings` → would have granted
 * briefings access + 0 credits; archived). The old $15/$40 links must stay archived.
 */
export const CREDIT_PACKAGES: readonly CreditPackage[] = [
  // Credits repriced 2026-07-18 (value-anchored model): the $ price is UNCHANGED (same
  // Stripe products) — we grant FEWER credits so top-ups are a PREMIUM "one more" valve
  // (priciest per credit) that never undercuts upgrading. Was 2,000/5,000.
  // Repriced 2026-07-19 (premium "one more" valve): $79/$149 on FRESH Stripe products
  // ("Mindy MCP — 300/700 credits", metadata type=mcp_credit_topup + package). Old $49/$99
  // links deactivated in Stripe so they can't be bought at the wrong price.
  { id: 'plus', credits: 300, usd: 79, label: 'Plus — 300 credits', checkoutUrl: 'https://buy.stripe.com/9B6dRad70bfk48Z98YfnO0W' },
  { id: 'scale', credits: 700, usd: 149, label: 'Scale — 700 credits (best value)', checkoutUrl: 'https://buy.stripe.com/4gMaEYaYScjo6h770QfnO0X' },
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
 * Set to 1,500 (2026-07-18 value-anchored model — see docs/strategy/PRICING-MODEL-2026-07-18.md).
 * Sized to a realistic 2-person Pro month (daily research + a few of the flagship deliverables;
 * a busy month overflows to a premium top-up, an agency overflows to Team). Was 6,000.
 * ⚠️ Env-overridable: if MCP_PRO_MONTHLY_CREDITS is set in Vercel it WINS over this default —
 * update it to 1500 (or unset it) or Pro silently keeps the old amount.
 */
export const PRO_MONTHLY_CREDITS = Math.max(
  0,
  Number(process.env.MCP_PRO_MONTHLY_CREDITS ?? '1500') || 0,
);

/**
 * Credits included with an active Team ($499/mo) subscription, granted monthly. Team is the
 * agency tier (5 seats + per-client rebilling) — the cheapest per-credit rate, the upgrade
 * an agency running multiple clients is forced into. Env-overridable like the others.
 */
export const TEAM_MONTHLY_CREDITS = Math.max(
  0,
  Number(process.env.MCP_TEAM_MONTHLY_CREDITS ?? '8000') || 0,
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
    // The $59/mo STARTER — entry paid tier in the locked ladder (Free → Starter $59 →
    // Pro $149 → Team $499). id stays 'scale' so the Stripe metadata `plan=scale`
    // mapping resolves; the webhook grants by priceId (subscriptionGrantForPriceId), so
    // these IDs are the source of truth. Prices/links created 2026-07-16 (product carries
    // plan=scale, type=mcp_subscription). Old $50/$480 Scale + $19/$180 Plus links archived.
    id: 'scale',
    label: 'Starter',
    creditsPerMonth: SCALE_CR_MO,
    monthly: {
      priceId: 'price_1TtpH5K5zyiZ50PBN6wo4IAs',
      usd: 59,
      credits: SCALE_CR_MO,
      checkoutUrl: 'https://buy.stripe.com/3cIaEY6IC1EKgVLetifnO0S',
    },
    annual: {
      priceId: 'price_1TtpHiK5zyiZ50PBcGOuLfnR',
      usd: 590,
      usdPerMonth: 49, // ~2 months free vs $59/mo
      credits: SCALE_CR_MO * 12,
      checkoutUrl: 'https://buy.stripe.com/9B628s8QKerwaxn0CsfnO0T',
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
