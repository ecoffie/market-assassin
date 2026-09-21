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
import { markFunnelStage } from './paywall';
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

  // ⚠️ COMPLETION IS NOT PAYMENT (Eric, 2026-09-15). `checkout.session.completed` fires
  // when the SESSION finishes, which is not the same as money arriving:
  //   • delayed/asynchronous payment methods complete with payment_status 'unpaid' and
  //     settle (or FAIL) minutes-to-days later
  //   • mode:'setup' sessions complete with NO payment at all — they collect a payment
  //     method for future use, so granting on one hands out credits for nothing
  // Granting on completion alone hands out credits for an unpaid session.

  // mode:'setup' (and 'subscription', handled by the subscription path) must never reach
  // the top-up grant. Rejected explicitly rather than relying on payment_status, because
  // a setup session's status is not a payment signal at all.
  const mode = String(session.mode ?? '');
  if (mode && mode !== 'payment') {
    console.error(`[mcp:topup] session ${session.id} has mode='${mode}' — not a one-time payment, NOT granting.`);
    return { handled: true, error: `ineligible_mode:${mode}` };
  }

  const paymentStatus = String(session.payment_status ?? '');

  // 'no_payment_required' is NOT "paid". It is a verified ZERO-DOLLAR entitlement (a 100%
  // discount/coupon), so it is allowed only when the session is genuinely a zero-dollar
  // one for an eligible credit product — never as a synonym for payment. A session
  // claiming no_payment_required while carrying a non-zero total is a contradiction and
  // is refused.
  const amountTotal = typeof session.amount_total === 'number' ? session.amount_total : null;
  const zeroDollarEntitlement =
    paymentStatus === 'no_payment_required' && (amountTotal === 0 || amountTotal === null);
  if (paymentStatus === 'no_payment_required' && !zeroDollarEntitlement) {
    console.error(
      `[mcp:topup] session ${session.id} claims no_payment_required but amount_total=${amountTotal} — refusing.`,
    );
    return { handled: true, error: 'inconsistent_zero_dollar' };
  }

  if (paymentStatus !== 'paid' && !zeroDollarEntitlement) {
    // NOT a dead end. An async method settles later and Stripe sends
    // checkout.session.async_payment_succeeded, which routes back here; the grant is
    // keyed on session.id via applyCreditOnce, so the eventual success grants EXACTLY
    // ONCE no matter how many events arrive. Refusing here strands nobody — but only
    // because that follow-up event is wired. Do not remove one without the other.
    console.error(
      `[mcp:topup] session ${session.id} completed but payment_status='${paymentStatus || 'missing'}' — NOT granting yet. ` +
      `Credits are granted when the payment settles (checkout.session.async_payment_succeeded).`,
    );
    return { handled: true, error: `unpaid:${paymentStatus || 'missing'}` };
  }

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

  // Funnel: payment CONFIRMED. Reached only past the payment_status gate above, so this
  // stamp means a signature-verified event AND a confirmed-paid session — never mere
  // session completion. Stamped before the grant so a fulfilment failure below shows up
  // as "paid but not credited" rather than as nothing at all.
  const attemptId = typeof (session.metadata || {}).attempt === 'string'
    ? String((session.metadata as Record<string, unknown>).attempt)
    : null;
  if (attemptId) await markFunnelStage(attemptId, 'payment_confirmed');

  const { applied, newBalance } = await applyCreditOnce(session.id, email, credits, 'stripe_topup');
  console.log(`[mcp:topup] ${email} +${credits} (applied=${applied}, balance=${newBalance}) session ${session.id}`);
  // Credits actually landed. On a Stripe RE-DELIVERY applied=false and the stamp is
  // already set, so markFunnelStage's first-write-wins guard keeps the original time.
  if (attemptId) await markFunnelStage(attemptId, 'credits_applied');
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
