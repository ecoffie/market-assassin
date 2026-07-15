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
 * Annual credit subscriptions — the acquisition-surface plans on /mcp/pricing.
 *
 * These are ANNUAL-ONLY (billed once/year, credits granted per invoice). The
 * per-month figures are the effective monthly rate WHEN billed annually — the
 * page shows "$15/mo · billed annually". Distinct from CREDIT_PACKAGES (one-time
 * dashboard top-ups) and from PRO_MONTHLY_CREDITS (the $149/mo app sub allowance).
 *
 * `priceId` is the Stripe recurring price; the webhook maps the paid invoice's
 * line-item price id → plan HERE (never trusting a client-set credit count).
 * `creditsPerYear` is env-overridable so the grant can be tuned without a Stripe
 * change. Products created 2026-07-14, each carrying metadata
 * type=mcp_subscription + plan=<id> + interval=year.
 */
export interface SubscriptionPlan {
  /** Config key + Stripe product-metadata `plan` id. */
  id: string;
  /** Stripe recurring price id (annual). */
  priceId: string;
  /** Total annual charge in USD (informational; real charge is the Stripe price). */
  usdPerYear: number;
  /** Effective monthly rate when billed annually (display only). */
  usdPerMonth: number;
  /** Month-to-month anchor price (display only — the struck-through "vs monthly" figure). */
  usdMonthlyAnchor: number;
  /** Credits granted per paid annual invoice (create + each renewal). */
  creditsPerYear: number;
  label: string;
  /** Stripe payment-link URL — append ?client_reference_id=<email> at checkout. */
  checkoutUrl: string;
}

export const SUBSCRIPTION_PLANS: readonly SubscriptionPlan[] = [
  {
    id: 'plus',
    priceId: 'price_1TtHCIK5zyiZ50PB6Lvi5NMo',
    usdPerYear: 180,
    usdPerMonth: 15,
    usdMonthlyAnchor: 19,
    creditsPerYear: Math.max(0, Number(process.env.MCP_PLUS_ANNUAL_CREDITS ?? '3600') || 0),
    label: 'Plus — annual',
    checkoutUrl: 'https://buy.stripe.com/00weVec2Wbfk20RclafnO0M',
  },
  {
    id: 'scale',
    priceId: 'price_1TtHCJK5zyiZ50PB57BKa1OW',
    usdPerYear: 480,
    usdPerMonth: 40,
    usdMonthlyAnchor: 50,
    creditsPerYear: Math.max(0, Number(process.env.MCP_SCALE_ANNUAL_CREDITS ?? '9600') || 0),
    label: 'Scale — annual',
    checkoutUrl: 'https://buy.stripe.com/6oU28s8QK5V048Zad2fnO0N',
  },
] as const;

const SUB_BY_ID = new Map(SUBSCRIPTION_PLANS.map((p) => [p.id, p]));
const SUB_BY_PRICE = new Map(SUBSCRIPTION_PLANS.map((p) => [p.priceId, p]));

/** Plan by config/metadata id, or null if unknown. */
export function subscriptionPlan(planId: string | null | undefined): SubscriptionPlan | null {
  return planId ? SUB_BY_ID.get(planId) ?? null : null;
}

/** Plan by Stripe price id (the webhook's primary resolver), or null if unknown. */
export function subscriptionPlanForPriceId(priceId: string | null | undefined): SubscriptionPlan | null {
  return priceId ? SUB_BY_PRICE.get(priceId) ?? null : null;
}

/**
 * Credits for a subscription plan id, or null if unknown. Null (not a default) is
 * the tamper guard: an unrecognized/forged `plan` grants NOTHING.
 */
export function creditsForSubscriptionPlan(planId: string | null | undefined): number | null {
  const p = subscriptionPlan(planId);
  return p ? p.creditsPerYear : null;
}
