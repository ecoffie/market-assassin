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
export const CREDIT_PACKAGES: readonly CreditPackage[] = [
  { id: 'starter', credits: 250, usd: 5, label: 'Starter — 250 credits', checkoutUrl: 'https://buy.stripe.com/00weVe7MGerw6h7clafnO0L' },
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
