/**
 * App-tier (Pro/Team) subscriptions — grant MCP credits when the invoice is paid.
 *
 * THE GAP THIS CLOSES
 * Pro ($149/mo) and Team ($499/mo) include a monthly MCP credit allowance, but the
 * ONLY thing that granted it was the `grant-mcp-pro-credits` cron, which fires
 * `0 9 1 * *` — once a month, on the 1st. Nothing granted at purchase. So a new
 * subscriber's wait was "days until the 1st": subscribe on the 2nd, wait ~30 days
 * for the credits you are already paying for.
 *
 * Measured 2026-07-30: 9 of 26 paying Pro subscribers had zero credits. Every one
 * of them subscribed Jul 21-30 — i.e. after the previous run. Not a bug in the
 * cron (it works, and no pre-Jul-20 subscriber was short); the cadence was simply
 * the wrong shape for onboarding.
 *
 * This mirrors handleMcpSubscriptionInvoice (the MCP-plan path) exactly: grant on
 * `invoice.paid` for both `subscription_create` and `subscription_cycle`.
 *
 * WHY THIS CANNOT DOUBLE-GRANT
 * The monthly cron keys its grant `pro:<email>:<YYYY-MM>` via applyCreditOnce. This
 * uses the SAME key. So whichever runs first wins and the other is a no-op:
 *   - subscribe Jul 28 -> webhook grants pro:x@y.com:2026-07 immediately
 *   - Aug 1 cron       -> different month key -> grants normally
 *   - Stripe redelivery-> same key -> skipped
 * Deliberately NOT keyed by invoice id (which is what the MCP path uses): the cron
 * has no invoice, so an invoice key would let both paths grant in the same month.
 *
 * Credits resolve SERVER-SIDE from the price amount, never from metadata.
 */
import type Stripe from 'stripe';
import { applyCreditOnce } from './credits';
import { PRO_MONTHLY_CREDITS, TEAM_MONTHLY_CREDITS } from './packages';
import { getStripe } from '@/lib/stripe';

/** App-tier price amounts (cents). Mirrors grant-mcp-pro-credits so the two agree. */
const PRO_AMOUNTS = new Set([14900, 149000, 4900]);   // Pro $149/mo · $1,490/yr · $49 grandfathered
const TEAM_AMOUNTS = new Set([49900, 499000]);        // Team $499/mo · $4,990/yr

export interface AppTierInvoiceOutcome {
  handled: boolean;   // false => not an app-tier subscription invoice
  applied?: boolean;  // true => granted; false => already granted this month
  credits?: number;
  email?: string;
  tier?: 'pro' | 'team';
  newBalance?: number;
  error?: string;
}

/** Resolve the payer email: invoice field first, then the customer record. */
async function resolveInvoiceEmail(invoice: Stripe.Invoice): Promise<string | null> {
  const direct = invoice.customer_email;
  if (direct) return direct.toLowerCase().trim();
  const cust = invoice.customer;
  if (!cust) return null;
  try {
    const stripe = getStripe();
    const id = typeof cust === 'string' ? cust : cust.id;
    const full = await stripe.customers.retrieve(id);
    if (full.deleted) return null;
    return (full.email || '').toLowerCase().trim() || null;
  } catch {
    return null;
  }
}

/**
 * Grant the app-tier monthly allowance for a paid subscription invoice.
 * Returns handled=false for anything that isn't a Pro/Team subscription invoice,
 * so the caller continues normally.
 */
export async function handleAppTierSubscriptionInvoice(
  invoice: Stripe.Invoice,
): Promise<AppTierInvoiceOutcome> {
  const reason = invoice.billing_reason;
  if (reason !== 'subscription_create' && reason !== 'subscription_cycle') return { handled: false };

  // The `price` field is present in API 2025-01-27 but isn't on the SDK's
  // InvoiceLineItem type; guard with an `unknown` cast the same way
  // stripe-subscription.ts does, so a future rename can't break the build.
  // Falls back to amount_paid, which is what the cron effectively matches on.
  const line = invoice.lines?.data?.[0] as unknown as
    { price?: { unit_amount?: number | null } } | undefined;
  const amount = line?.price?.unit_amount ?? invoice.amount_paid ?? 0;
  let tier: 'pro' | 'team' | null = null;
  let credits = 0;
  if (PRO_AMOUNTS.has(amount)) { tier = 'pro'; credits = PRO_MONTHLY_CREDITS; }
  else if (TEAM_AMOUNTS.has(amount)) { tier = 'team'; credits = TEAM_MONTHLY_CREDITS; }
  if (!tier || credits <= 0) return { handled: false };

  const email = await resolveInvoiceEmail(invoice);
  if (!email) {
    console.error('[app-tier:sub] no email on invoice', invoice.id);
    return { handled: true, tier, error: 'no_email' };
  }

  // SAME key shape as the monthly cron — this is what makes the two paths safe
  // together. See the header note.
  const month = new Date().toISOString().slice(0, 7); // YYYY-MM
  const key = `pro:${email}:${month}`;
  const { applied, newBalance } = await applyCreditOnce(key, email, credits, `app_tier_${tier}`);
  console.log(
    `[app-tier:sub] ${email} +${credits} (${tier}, ${reason}, applied=${applied}, balance=${newBalance}) invoice ${invoice.id}`,
  );
  return { handled: true, applied, credits, email, tier, newBalance };
}
