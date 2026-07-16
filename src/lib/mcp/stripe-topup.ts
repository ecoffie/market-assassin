/**
 * MCP credit top-up — handle a completed Stripe checkout for a credit package.
 *
 * Phase 1 Slice 4. Webhook-agnostic: whichever webhook receives
 * `checkout.session.completed` calls this. Idempotent by session id (applyCreditOnce),
 * so it's safe even if more than one webhook fires it, or Stripe re-delivers.
 *
 * A credit-top-up payment link must carry metadata: `type=mcp_credit_topup` and a
 * `package` id matching src/lib/mcp/packages.ts. Credits are resolved SERVER-SIDE from
 * that package id — a forged/unknown package grants nothing (never trusts a raw credits
 * number from metadata).
 */
import type Stripe from 'stripe';
import { creditsForPackage } from './packages';
import { applyCreditOnce } from './credits';
import { sendCreditReceiptEmail } from './credit-emails';
import { getStripe } from '@/lib/stripe';

export const MCP_TOPUP_TYPE = 'mcp_credit_topup';

/** Pull the buyer email from the session (metadata > client_reference_id > customer). */
function resolveEmail(session: Stripe.Checkout.Session): string | null {
  const m = (session.metadata || {}) as Record<string, unknown>;
  const cand =
    (typeof m.user_email === 'string' && m.user_email) ||
    (typeof session.client_reference_id === 'string' && session.client_reference_id) ||
    session.customer_details?.email ||
    (session as unknown as { customer_email?: string }).customer_email ||
    null;
  return cand ? String(cand).trim().toLowerCase() : null;
}

export interface McpTopupOutcome {
  handled: boolean; // false => not an MCP top-up session (caller continues normally)
  applied?: boolean; // true => credits granted; false => duplicate (already applied)
  credits?: number;
  email?: string;
  error?: string;
}

/**
 * Process a checkout session IF it's an MCP credit top-up. Returns handled=false for
 * any other session so the caller's normal provisioning is unaffected.
 */
export async function handleMcpCreditTopup(session: Stripe.Checkout.Session): Promise<McpTopupOutcome> {
  // The `type`/`package` metadata can live on the SESSION (API-created links) OR, as
  // set in the Stripe Dashboard, on the PRODUCT. Prefer the session; fall back to the
  // purchased product's metadata (one extra API call, only when the session lacks it).
  let meta = (session.metadata || {}) as Record<string, unknown>;
  if (meta.type !== MCP_TOPUP_TYPE) {
    try {
      const items = await getStripe().checkout.sessions.listLineItems(session.id, {
        expand: ['data.price.product'],
        limit: 1,
      });
      const product = items.data[0]?.price?.product;
      if (product && typeof product === 'object' && 'metadata' in product && product.metadata) {
        meta = product.metadata as Record<string, unknown>;
      }
    } catch (err) {
      console.error('[mcp:topup] product-metadata fetch failed', session.id, err);
    }
  }
  if (meta.type !== MCP_TOPUP_TYPE) return { handled: false };

  const email = resolveEmail(session);
  if (!email) {
    console.error('[mcp:topup] no email on session', session.id);
    return { handled: true, error: 'no_email' };
  }

  const credits = creditsForPackage(typeof meta.package === 'string' ? meta.package : null);
  if (!credits) {
    console.error('[mcp:topup] unknown/forged package on session', session.id, meta.package);
    return { handled: true, email, error: 'unknown_package' };
  }

  const { applied, newBalance } = await applyCreditOnce(session.id, email, credits, 'stripe_topup');
  console.log(`[mcp:topup] ${email} +${credits} (applied=${applied}, balance=${newBalance}) session ${session.id}`);
  // Receipt only on a real grant (not a Stripe re-delivery). Never blocks the grant.
  if (applied) {
    await sendCreditReceiptEmail({
      email,
      kind: 'topup',
      credits,
      newBalance,
      amountUsd: typeof session.amount_total === 'number' ? session.amount_total / 100 : null,
      reference: session.id,
    });
  }
  return { handled: true, applied, credits, email };
}
