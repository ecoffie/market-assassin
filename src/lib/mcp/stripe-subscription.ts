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
import { creditsForSubscriptionPlan, subscriptionPlanForPriceId } from './packages';
import { applyCreditOnce } from './credits';
import { getStripe } from '@/lib/stripe';

export const MCP_SUBSCRIPTION_TYPE = 'mcp_subscription';

export interface McpSubInvoiceOutcome {
  handled: boolean; // false => not an MCP subscription invoice (caller continues normally)
  applied?: boolean; // true => credits granted; false => duplicate (already applied)
  credits?: number;
  email?: string;
  plan?: string;
  error?: string;
}

/**
 * Resolve the MCP subscription plan id from an invoice's line items. Tries the
 * Stripe price id first (authoritative — matched against SUBSCRIPTION_PLANS), then
 * price/product/line `plan` metadata as a fallback. Returns null if no line maps.
 */
function planFromInvoice(invoice: Stripe.Invoice): string | null {
  const lines = invoice.lines?.data ?? [];
  for (const line of lines) {
    // The `price` field is present in API 2025-01-27; guard with `any` so a future
    // rename to `pricing` doesn't break the build (metadata fallback still catches it).
    const anyLine = line as unknown as {
      price?: { id?: string; metadata?: Record<string, unknown>; product?: unknown };
      metadata?: Record<string, unknown>;
    };
    const price = anyLine.price;
    const byId = price?.id ? subscriptionPlanForPriceId(price.id) : null;
    if (byId) return byId.id;

    for (const meta of [price?.metadata, anyLine.metadata]) {
      const plan = meta?.plan;
      if (typeof plan === 'string' && creditsForSubscriptionPlan(plan) != null) return plan;
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

  const planId = planFromInvoice(invoice);
  if (!planId) return { handled: false };

  const credits = creditsForSubscriptionPlan(planId);
  if (!credits) {
    console.error('[mcp:sub] unknown/forged plan on invoice', invoice.id, planId);
    return { handled: true, plan: planId, error: 'unknown_plan' };
  }

  const email = await resolveInvoiceEmail(invoice);
  if (!email) {
    console.error('[mcp:sub] no email on invoice', invoice.id);
    return { handled: true, plan: planId, error: 'no_email' };
  }

  const { applied, newBalance } = await applyCreditOnce(invoice.id as string, email, credits, 'mcp_sub_annual');
  console.log(
    `[mcp:sub] ${email} +${credits} (${planId}, ${reason}, applied=${applied}, balance=${newBalance}) invoice ${invoice.id}`,
  );
  return { handled: true, applied, credits, email, plan: planId };
}
