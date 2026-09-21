/**
 * MCP annual subscription — grant credits when a subscription invoice is paid.
 *
 * The acquisition-surface Plus/Scale plans (/mcp/pricing) are ANNUAL subscriptions.
 * Stripe fires `invoice.paid` for BOTH the first charge (`billing_reason ===
 * 'subscription_create'`) and each yearly renewal (`subscription_cycle`); we grant
 * the plan's `creditsPerYear` on each. Idempotent by invoice id (applyCreditOnce),
 * so Stripe re-delivery can't double-grant, and a renewal (new invoice id) grants
 * fresh credits.
 *
 * Credits are resolved SERVER-SIDE from the plan config (matched by the invoice
 * line-item's Stripe price id, falling back to price/product metadata `plan`) — a
 * forged/unknown plan grants nothing. Never trusts a raw credit count off metadata.
 *
 * NOTE: the initial subscription checkout arrives as `checkout.session.completed`
 * with metadata type=mcp_subscription; that path is NOT a credit top-up, so the
 * top-up handler ignores it. The credit grant happens HERE on the paid invoice.
 */
import type Stripe from 'stripe';
import { subscriptionGrantForPriceId, subscriptionGrantForMeta, subscriptionPlan, type SubscriptionGrant } from './packages';
import { applyCreditOnce } from './credits';
import { sendCreditReceiptEmail } from './credit-emails';
import { getStripe } from '@/lib/stripe';

export const MCP_SUBSCRIPTION_TYPE = 'mcp_subscription';

export interface McpSubInvoiceOutcome {
  handled: boolean; // false => not an MCP subscription invoice (caller continues normally)
  applied?: boolean; // true => credits granted; false => duplicate (already applied)
  credits?: number;
  email?: string;
  plan?: string;
  interval?: 'month' | 'year';
  error?: string;
}

/**
 * Resolve the credit grant from an invoice's line items. Tries the Stripe price id
 * first (authoritative — matched against SUBSCRIPTION_PLANS, which distinguishes
 * monthly vs annual credits), then price/line `plan`+`interval` metadata as a
 * fallback. Returns null if no line maps to an MCP subscription.
 */
function grantFromInvoice(invoice: Stripe.Invoice): SubscriptionGrant | null {
  const lines = invoice.lines?.data ?? [];
  for (const line of lines) {
    // The `price` field is present in API 2025-01-27; guard with `any` so a future
    // rename to `pricing` doesn't break the build (metadata fallback still catches it).
    const anyLine = line as unknown as {
      price?: { id?: string; metadata?: Record<string, unknown> };
      metadata?: Record<string, unknown>;
    };
    const price = anyLine.price;
    const byId = subscriptionGrantForPriceId(price?.id);
    if (byId) return byId;

    for (const meta of [price?.metadata, anyLine.metadata]) {
      const plan = meta?.plan;
      if (typeof plan === 'string') {
        const interval = typeof meta?.interval === 'string' ? meta.interval : undefined;
        const byMeta = subscriptionGrantForMeta(plan, interval);
        if (byMeta) return byMeta;
      }
    }
  }
  return null;
}

/** Buyer email: invoice.customer_email, else the retrieved customer's email. */
async function resolveInvoiceEmail(invoice: Stripe.Invoice): Promise<string | null> {
  let email = invoice.customer_email || null;
  if (!email && invoice.customer) {
    try {
      const id = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer.id;
      const c = await getStripe().customers.retrieve(id);
      if (!('deleted' in c && c.deleted)) email = (c as Stripe.Customer).email || null;
    } catch (err) {
      console.error('[mcp:sub] customer fetch failed', invoice.id, err);
    }
  }
  return email ? email.trim().toLowerCase() : null;
}

/**
 * Grant credits IF this paid invoice is for an MCP annual subscription. Returns
 * handled=false for any other invoice so the caller's normal flow is unaffected.
 * Grants on the initial charge and each renewal; idempotent by invoice id.
 */
export async function handleMcpSubscriptionInvoice(invoice: Stripe.Invoice): Promise<McpSubInvoiceOutcome> {
  const reason = invoice.billing_reason;
  if (reason !== 'subscription_create' && reason !== 'subscription_cycle') return { handled: false };

  const grant = grantFromInvoice(invoice);
  if (!grant) return { handled: false };

  const email = await resolveInvoiceEmail(invoice);
  if (!email) {
    console.error('[mcp:sub] no email on invoice', invoice.id);
    return { handled: true, plan: grant.planId, interval: grant.interval, error: 'no_email' };
  }

  // Ledger reason encodes the interval so monthly vs annual grants are distinguishable.
  const ledgerReason = grant.interval === 'year' ? 'mcp_sub_annual' : 'mcp_sub_monthly';
  const { applied, newBalance } = await applyCreditOnce(invoice.id as string, email, grant.credits, ledgerReason);
  console.log(
    `[mcp:sub] ${email} +${grant.credits} (${grant.planId}/${grant.interval}, ${reason}, applied=${applied}, balance=${newBalance}) invoice ${invoice.id}`,
  );
  // Receipt only on a real grant (not a Stripe re-delivery). Never blocks the grant.
  if (applied) {
    const amountPaid = (invoice as unknown as { amount_paid?: number }).amount_paid;
    await sendCreditReceiptEmail({
      email,
      kind: 'subscription',
      credits: grant.credits,
      newBalance,
      amountUsd: typeof amountPaid === 'number' ? amountPaid / 100 : null,
      reference: invoice.number || (invoice.id as string),
      planLabel: subscriptionPlan(grant.planId)?.label ?? null,
      interval: grant.interval,
    });
  }
  return { handled: true, applied, credits: grant.credits, email, plan: grant.planId, interval: grant.interval };
}
