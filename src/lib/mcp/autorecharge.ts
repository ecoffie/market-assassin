/**
 * Mindy MCP auto-recharge — "card on file, refill when low" (OpenAI/Anthropic-API style).
 *
 * A user turns it on and sets a rule: when my balance drops below THRESHOLD, charge my
 * saved card for a REFILL PACK. Charges are OFF-SESSION Stripe PaymentIntents against a
 * card the user saved earlier (customer-present, via a setup Checkout — Stripe requires
 * that consent before we can charge off-session).
 *
 * Safety rails:
 *   - Atomic CLAIM (mcp_autorecharge_claim) so concurrent low-balance tool calls fire
 *     ONE charge, not ten — plus a debounce window and a per-day attempt cap.
 *   - Grant is idempotent by the PaymentIntent id (applyCreditOnce) — a charge can never
 *     double-grant, even under Stripe webhook re-delivery + this inline path both firing.
 *   - Decline handling: consecutive_failures++ → PAUSE after MAX_FAILURES + email the user.
 *
 * We store ONLY Stripe ids (customer, payment_method) — never card data (PCI = Stripe).
 */
import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';
import { getWriteClient } from '@/lib/supabase/server-clients';
import { getBalance, applyCreditOnce } from './credits';
import { CREDIT_PACKAGES, creditsForPackage, type CreditPackage } from './packages';
import { sendCreditReceiptEmail } from './credit-emails';
import { sendEmail } from '@/lib/send-email';

// Inline fast-path fires only when a debit leaves the balance under this floor; the
// engine then reads the user's real (lower) threshold. Threshold is clamped at/below
// this floor (see THRESHOLD_MAX) so the inline after()-path always catches a low
// balance; anything set higher would still be caught by the cron backstop.
export const AUTORECHARGE_SIGNAL_FLOOR = Math.max(
  50,
  Number(process.env.MCP_AUTORECHARGE_FLOOR ?? '500') || 500,
);
const DEBOUNCE_SECONDS = 90; // one charge per user per 90s, max
const DAILY_CAP = Math.max(1, Number(process.env.MCP_AUTORECHARGE_DAILY_CAP ?? '3') || 3);
const MAX_FAILURES = 2; // consecutive declines before we pause + email
export const THRESHOLD_MIN = 10;
export const THRESHOLD_MAX = AUTORECHARGE_SIGNAL_FLOOR;

export interface AutoRechargeSettings {
  userEmail: string;
  enabled: boolean;
  thresholdCredits: number;
  refillPackage: string;
  hasCard: boolean;
  cardBrand: string | null;
  cardLast4: string | null;
  paused: boolean;
  consecutiveFailures: number;
  lastRechargeAt: string | null;
  // present only server-side (not returned to the client UI)
  stripeCustomerId?: string | null;
  stripePaymentMethodId?: string | null;
}

interface Row {
  user_email: string;
  enabled: boolean;
  threshold_credits: number;
  refill_package: string;
  stripe_customer_id: string | null;
  stripe_payment_method_id: string | null;
  card_brand: string | null;
  card_last4: string | null;
  paused: boolean;
  consecutive_failures: number;
  last_recharge_at: string | null;
}

function toSettings(r: Row): AutoRechargeSettings {
  return {
    userEmail: r.user_email,
    enabled: r.enabled,
    thresholdCredits: r.threshold_credits,
    refillPackage: r.refill_package,
    hasCard: Boolean(r.stripe_customer_id && r.stripe_payment_method_id),
    cardBrand: r.card_brand,
    cardLast4: r.card_last4,
    paused: r.paused,
    consecutiveFailures: r.consecutive_failures,
    lastRechargeAt: r.last_recharge_at,
    stripeCustomerId: r.stripe_customer_id,
    stripePaymentMethodId: r.stripe_payment_method_id,
  };
}

/** Current settings for a user, or a disabled default if they've never touched it. */
export async function getAutoRecharge(email: string): Promise<AutoRechargeSettings> {
  const user = email.toLowerCase();
  const { data } = await getWriteClient()
    .from('mcp_autorecharge')
    .select('*')
    .eq('user_email', user)
    .maybeSingle();
  if (data) return toSettings(data as Row);
  return {
    userEmail: user,
    enabled: false,
    thresholdCredits: 100,
    refillPackage: 'plus',
    hasCard: false,
    cardBrand: null,
    cardLast4: null,
    paused: false,
    consecutiveFailures: 0,
    lastRechargeAt: null,
    stripeCustomerId: null,
    stripePaymentMethodId: null,
  };
}

/** Upsert the user-editable settings (enable/disable, threshold, pack). */
export async function setAutoRecharge(
  email: string,
  patch: { enabled?: boolean; thresholdCredits?: number; refillPackage?: string },
): Promise<AutoRechargeSettings> {
  const user = email.toLowerCase();
  const update: Record<string, unknown> = { user_email: user, updated_at: new Date().toISOString() };
  if (patch.enabled !== undefined) update.enabled = patch.enabled;
  if (patch.thresholdCredits !== undefined) {
    update.threshold_credits = Math.min(THRESHOLD_MAX, Math.max(THRESHOLD_MIN, Math.floor(patch.thresholdCredits)));
  }
  if (patch.refillPackage !== undefined && creditsForPackage(patch.refillPackage) !== null) {
    update.refill_package = patch.refillPackage;
  }
  await getWriteClient().from('mcp_autorecharge').upsert(update, { onConflict: 'user_email' });
  return getAutoRecharge(user);
}

/**
 * Persist a newly-saved card (from the setup Checkout webhook). A fresh card clears the
 * paused/failure state — the user fixed the payment problem — and enables auto-recharge.
 */
export async function saveAutoRechargeCard(
  email: string,
  card: { customerId: string; paymentMethodId: string; brand: string | null; last4: string | null },
): Promise<void> {
  const user = email.toLowerCase();
  await getWriteClient().from('mcp_autorecharge').upsert(
    {
      user_email: user,
      enabled: true,
      paused: false,
      consecutive_failures: 0,
      stripe_customer_id: card.customerId,
      stripe_payment_method_id: card.paymentMethodId,
      card_brand: card.brand,
      card_last4: card.last4,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_email' },
  );
}

/**
 * Start a Stripe setup Checkout to save a card off-session. Reuses the user's existing
 * Stripe customer if we already have one; otherwise Checkout creates one. Returns the
 * hosted URL the client redirects to.
 */
export async function createSetupCheckout(email: string, baseUrl: string): Promise<string> {
  const user = email.toLowerCase();
  const stripe = getStripe();
  const existing = await getAutoRecharge(user);
  // Setup-mode Checkout wants a concrete Customer. Reuse ours if we already have one;
  // otherwise create one now so the customer id is deterministic (not left to Checkout).
  const customerId = existing.stripeCustomerId
    || (await stripe.customers.create({ email: user, metadata: { user_email: user, source: 'mcp_autorecharge' } })).id;
  const session = await stripe.checkout.sessions.create({
    mode: 'setup',
    currency: 'usd',
    payment_method_types: ['card'],
    customer: customerId,
    metadata: { type: MCP_AUTORECHARGE_SETUP_TYPE, user_email: user },
    success_url: `${baseUrl}/mcp/account?autorecharge=saved`,
    cancel_url: `${baseUrl}/mcp/account?autorecharge=cancelled`,
  });
  if (!session.url) throw new Error('Stripe returned no Checkout URL');
  return session.url;
}

export const MCP_AUTORECHARGE_SETUP_TYPE = 'mcp_autorecharge_setup';
export const MCP_AUTORECHARGE_PI_TYPE = 'mcp_autorecharge';

/**
 * Resolve a completed setup Checkout session → the saved customer + payment method +
 * card display fields, and persist them. Called from the Stripe webhook. Also sets the
 * PM as the customer's default so future charges use it.
 */
export async function handleAutoRechargeSetup(session: Stripe.Checkout.Session): Promise<boolean> {
  const meta = (session.metadata || {}) as Record<string, unknown>;
  if (meta.type !== MCP_AUTORECHARGE_SETUP_TYPE) return false;
  const email = (typeof meta.user_email === 'string' && meta.user_email) || session.customer_details?.email || null;
  if (!email) { console.error('[mcp:autorecharge] setup: no email', session.id); return true; }

  const stripe = getStripe();
  const siId = typeof session.setup_intent === 'string' ? session.setup_intent : session.setup_intent?.id;
  if (!siId) { console.error('[mcp:autorecharge] setup: no setup_intent', session.id); return true; }
  const si = await stripe.setupIntents.retrieve(siId);
  const pmId = typeof si.payment_method === 'string' ? si.payment_method : si.payment_method?.id;
  const customerId = (typeof session.customer === 'string' ? session.customer : session.customer?.id)
    || (typeof si.customer === 'string' ? si.customer : si.customer?.id);
  if (!pmId || !customerId) { console.error('[mcp:autorecharge] setup: missing pm/customer', session.id); return true; }

  const pm = await stripe.paymentMethods.retrieve(pmId);
  // Make it the customer's default so off-session PaymentIntents pick it up cleanly.
  await stripe.customers.update(customerId, { invoice_settings: { default_payment_method: pmId } }).catch(() => {});

  await saveAutoRechargeCard(email, {
    customerId,
    paymentMethodId: pmId,
    brand: pm.card?.brand ?? null,
    last4: pm.card?.last4 ?? null,
  });
  console.log(`[mcp:autorecharge] card saved for ${email} (${pm.card?.brand} ****${pm.card?.last4})`);
  return true;
}

function packFor(id: string): CreditPackage {
  return CREDIT_PACKAGES.find((p) => p.id === id) ?? CREDIT_PACKAGES[0];
}

export interface RechargeOutcome {
  charged: boolean;
  credits?: number;
  newBalance?: number;
  reason?: string; // when not charged: 'disabled' | 'sufficient' | 'debounced' | 'daily_cap' | 'declined' | ...
}

async function markSuccess(email: string): Promise<void> {
  await getWriteClient()
    .from('mcp_autorecharge')
    .update({ last_recharge_at: new Date().toISOString(), consecutive_failures: 0, updated_at: new Date().toISOString() })
    .eq('user_email', email.toLowerCase());
}

async function markFailure(email: string, settings: AutoRechargeSettings, detail: string): Promise<void> {
  const failures = settings.consecutiveFailures + 1;
  const paused = failures >= MAX_FAILURES;
  await getWriteClient()
    .from('mcp_autorecharge')
    .update({ consecutive_failures: failures, paused, updated_at: new Date().toISOString() })
    .eq('user_email', email.toLowerCase());
  console.error(`[mcp:autorecharge] charge failed for ${email} (${detail}); failures=${failures} paused=${paused}`);
  if (paused) {
    await sendEmail({
      to: email,
      subject: 'Mindy auto-recharge paused — update your card',
      emailType: 'mcp_autorecharge',
      transactional: true,
      html: `<div style="font-family:sans-serif;color:#222;max-width:520px">
        <p>Hi,</p>
        <p>We tried to top up your Mindy MCP credits automatically, but your card was declined
        ${settings.cardBrand ? `(${settings.cardBrand} ····${settings.cardLast4})` : ''}.
        Auto-recharge is now <strong>paused</strong> so we don't keep retrying.</p>
        <p>Update your card to turn it back on: <a href="https://getmindy.ai/mcp">getmindy.ai/mcp</a></p>
        <p>Your existing credits are unaffected.</p>
        <p>— The Mindy team</p></div>`,
      text: `We couldn't auto-recharge your Mindy MCP credits (card declined). Auto-recharge is paused. Update your card at https://getmindy.ai/mcp`,
    }).catch(() => {});
  }
}

/**
 * The engine. Reads settings → verifies the balance is actually low → atomically CLAIMS
 * a recharge slot → charges the saved card off-session → grants credits (idempotent by
 * PaymentIntent id). No-ops safely if disabled, funded, debounced, capped, or paused.
 * Never throws — returns a RechargeOutcome; callers (after()/cron) just log it.
 */
export async function maybeAutoRecharge(email: string): Promise<RechargeOutcome> {
  const user = email.toLowerCase();
  try {
    const settings = await getAutoRecharge(user);
    if (!settings.enabled || settings.paused) return { charged: false, reason: settings.paused ? 'paused' : 'disabled' };
    if (!settings.hasCard || !settings.stripeCustomerId || !settings.stripePaymentMethodId) {
      return { charged: false, reason: 'no_card' };
    }
    const balance = await getBalance(user);
    if (balance >= settings.thresholdCredits) return { charged: false, reason: 'sufficient' };

    // Atomic claim — the concurrency + debounce + daily-cap guard.
    const { data: claimRows } = await getWriteClient().rpc('mcp_autorecharge_claim', {
      p_user: user,
      p_debounce_seconds: DEBOUNCE_SECONDS,
      p_daily_cap: DAILY_CAP,
    });
    const claim = Array.isArray(claimRows) ? claimRows[0] : claimRows;
    if (!claim?.claimed) return { charged: false, reason: claim?.reason ?? 'not_claimed' };

    const pack = packFor(settings.refillPackage);
    try {
      const pi = await getStripe().paymentIntents.create({
        amount: Math.round(pack.usd * 100),
        currency: 'usd',
        customer: settings.stripeCustomerId,
        payment_method: settings.stripePaymentMethodId,
        off_session: true,
        confirm: true,
        metadata: {
          type: MCP_AUTORECHARGE_PI_TYPE,
          user_email: user,
          package: pack.id,
          credits: String(pack.credits),
        },
        description: `Mindy MCP auto-recharge — ${pack.credits} credits`,
      });
      if (pi.status !== 'succeeded') {
        await markFailure(user, settings, `status=${pi.status}`);
        return { charged: false, reason: pi.status };
      }
      const { applied, newBalance } = await applyCreditOnce(pi.id, user, pack.credits, 'auto_recharge');
      await markSuccess(user);
      console.log(`[mcp:autorecharge] ${user} +${pack.credits} → ${newBalance} (pi ${pi.id})`);
      // Receipt only on the real grant (the webhook backstop grants the SAME pi.id →
      // applied=false there, so exactly one receipt fires). Never blocks the grant.
      if (applied) {
        await sendCreditReceiptEmail({
          email: user,
          kind: 'auto_recharge',
          credits: pack.credits,
          newBalance,
          amountUsd: pack.usd,
          reference: pi.id,
        });
      }
      return { charged: true, credits: pack.credits, newBalance };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      await markFailure(user, settings, detail);
      return { charged: false, reason: 'declined' };
    }
  } catch (err) {
    console.error('[mcp:autorecharge] maybeAutoRecharge error', user, err);
    return { charged: false, reason: 'error' };
  }
}

/** Emails of users who are enabled, not paused, have a card, and are BELOW threshold. */
export async function listRechargeCandidates(limit = 200): Promise<string[]> {
  const { data: settings } = await getWriteClient()
    .from('mcp_autorecharge')
    .select('user_email, threshold_credits')
    .eq('enabled', true)
    .eq('paused', false)
    .not('stripe_payment_method_id', 'is', null)
    .limit(limit);
  if (!settings?.length) return [];
  const emails = (settings as { user_email: string; threshold_credits: number }[]).map((s) => s.user_email);
  const { data: balances } = await getWriteClient()
    .from('mcp_credit_balance')
    .select('user_email, balance')
    .in('user_email', emails);
  const balByEmail = new Map((balances as { user_email: string; balance: number }[] | null ?? []).map((b) => [b.user_email, b.balance]));
  return (settings as { user_email: string; threshold_credits: number }[])
    .filter((s) => (balByEmail.get(s.user_email) ?? 0) < s.threshold_credits)
    .map((s) => s.user_email);
}
