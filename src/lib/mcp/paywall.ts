/**
 * The paywall moment — what a user sees when a premium tool is refused, and the record
 * that lets them pick up exactly where they left off after paying.
 *
 * BEFORE THIS: the refusal was a price quote and a link ("This tool costs 100 credits;
 * your balance is 0. Top up at getmindy.ai/mcp."), and the request was thrown away. That
 * is the highest-intent moment in the whole product — someone just got a useful answer and
 * asked for another — answered with a "no" that sells nothing and loses their work.
 *
 * TWO JOBS, one record:
 *   1. The message names what they already got and what upgrading unlocks, in terms of the
 *      specific thing they were trying to do, and links straight into checkout.
 *   2. The attempt is persisted (tool + args) so after payment we can restore the request.
 *      That same row is the conversion funnel: rejected -> checkout -> purchase -> resume.
 *
 * Recording must never break a tool call, so every write here is best-effort.
 */
import { getWriteClient } from '@/lib/supabase/server-clients';
import { SUBSCRIPTION_PLANS, CREDIT_PACKAGES } from './packages';
import { insufficientCreditsLead } from './commercial-refusal';

/** Stripe payment links, mirroring src/app/mcp/pricing/page.tsx. */
const CHECKOUT_ENTRY = 'https://buy.stripe.com/bJe5kEff8erw20R0CsfnO0Y';

/** Where a refused user lands: the offer page, carrying the attempt so it can be resumed. */
export const RESUME_BASE = 'https://getmindy.ai/mcp/continue';

/**
 * Which wall the user saw. BUMP THIS on any change to the offer copy, the price
 * presentation, the CTA, or the checkout destination.
 *
 * Without it a funnel that spans a copy change reads as one number and means nothing —
 * and the answer is unrecoverable after the fact, because the row does not remember what
 * it showed. Stamped at write time on every attempt.
 */
// v4 (2026-09-15): the offer no longer carries Stripe links — it routes to /mcp/continue
// so checkout can be created server-side WITH attempt attribution. This is a STRUCTURAL
// change to the funnel (one more click), not just copy, so v3 rates are not comparable.
// v3 was the 1,000-credit repricing at the same $119.
// v5 (2026-09-15): lead with exact need/have credits + explicit "not a server error / do not
// retry" so agents stop inventing timeout language for commercial refusals.
export const PAYWALL_OFFER_VERSION = 'v5';

export type PaywallReason = 'insufficient_credits' | 'requires_pro';

export interface PaywallAttempt {
  userEmail: string;
  toolName: string;
  args: Record<string, unknown>;
  reason: PaywallReason;
  creditsRequired?: number;
  balanceAtAttempt?: number;
}

/**
 * Per-tool copy. A generic "you are out of credits" wastes the moment — the rejection
 * already knows which premium tool they reached for, so the offer speaks to that intent.
 * Keyed by tool; anything not listed falls back to the generic premium line.
 */
const TOOL_OFFERS: Record<string, { got: string; unlocks: string }> = {
  generate_market_report: {
    got: 'Your free Market Report covered one NAICS code and one geography.',
    unlocks:
      'Upgrade to research additional markets, compare where the best opportunities are, and rerun your analysis as federal spending changes.',
  },
  capability_market_match: {
    got: 'Your free capability match analyzed one set of capabilities against the market.',
    unlocks:
      'Upgrade to test other capabilities and geographies, and see which of your markets is actually worth pursuing.',
  },
  build_pursuit_dossier: {
    got: 'Your free pursuit dossier covered one opportunity end to end.',
    unlocks:
      'Upgrade to build dossiers for every pursuit you are chasing, and keep them current as the solicitation changes.',
  },
};

/** The human-readable name we use in the offer headline. */
const TOOL_LABEL: Record<string, string> = {
  generate_market_report: 'Market Report',
  capability_market_match: 'Capability Match',
  build_pursuit_dossier: 'Pursuit Dossier',
};

/**
 * Record the refused attempt. Returns the row id so the caller can put a resume link in
 * the message. Best-effort: a logging failure must never turn into a tool failure, so a
 * miss returns null and the user still gets the offer copy (minus the deep link).
 */
export async function recordPaywallAttempt(a: PaywallAttempt): Promise<string | null> {
  try {
    const { data, error } = await getWriteClient()
      .from('mcp_paywall_attempts')
      .insert({
        user_email: a.userEmail.trim().toLowerCase(),
        tool_name: a.toolName,
        args: a.args ?? {},
        reason: a.reason,
        credits_required: a.creditsRequired ?? null,
        balance_at_attempt: a.balanceAtAttempt ?? null,
        offer_version: PAYWALL_OFFER_VERSION,
      })
      .select('id')
      .single();
    if (error || !data) return null;
    return data.id as string;
  } catch {
    return null;
  }
}

/** The cheapest recurring plan — the default recommendation at the wall. */
const ENTRY_PLAN = SUBSCRIPTION_PLANS.find((p) => p.id === 'entry') ?? SUBSCRIPTION_PLANS[0];
/** The one-time valve, for buyers who will not take a recurring charge. */
const TOPUP = CREDIT_PACKAGES[0];

/**
 * A checkout URL the user can press FROM THE CHAT.
 *
 * `client_reference_id` carries the buyer's email into Stripe, which the topup/subscription
 * webhooks already read back (see stripe-topup.ts) to decide whose balance to credit. That
 * is what makes buying-from-chat safe: without it a purchase can land on whichever account
 * Stripe happens to match, which is exactly how a real user ended up paying on one identity
 * while spending credits on another.
 *
 * `attempt` is passed through so a completed purchase still ties back to the specific
 * refused request — the funnel stays intact even when the user never opens the resume page.
 */
function checkoutLink(base: string, email?: string | null, attemptId?: string | null): string {
  try {
    const url = new URL(base);
    if (email) url.searchParams.set('client_reference_id', email);
    if (attemptId) url.searchParams.set('attempt', attemptId);
    return url.toString();
  } catch {
    return base; // never break the message over a malformed link
  }
}

/**
 * The two purchase lines shown in-chat.
 *
 * WHY IN THE MESSAGE AND NOT JUST A PAGE LINK: measured over the first six days of launch,
 * 40 paywall refusals across 15 users produced ONE visit to the resume page. The drop-off
 * is the click out of the assistant, not the page it lands on. So the offer has to survive
 * inside the conversation: price, what it buys, and a pressable link.
 *
 * TWO options, deliberately — one subscription and one no-subscription. A third turns a
 * moment of intent into a comparison exercise, and the full ladder is one link away.
 * Prices are read from packages.ts so chat copy can never drift from what Stripe charges.
 */
function offerLines(email?: string | null, attemptId?: string | null): string {
  const perRun = Math.floor(ENTRY_PLAN.creditsPerMonth / 100);
  // ⚠️ THESE LINK TO /mcp/continue, NOT TO STRIPE (Eric, 2026-09-15).
  //
  // An MCP error payload is text: it cannot POST, so a direct Stripe link here would have
  // to be a static payment LINK — and payment links do not forward `?attempt=`, so the
  // purchase could never be tied to the blocked REQUEST. Routing through the resume page
  // keeps one path: the page POSTs /api/mcp/checkout, which sets client_reference_id AND
  // metadata.attempt server-side, so the saved request can resume after payment.
  //
  // Without an attempt id there is nothing to resume, so fall back to the plain entry
  // checkout rather than inventing a resume URL that cannot work.
  const page = attemptId ? `${RESUME_BASE}?attempt=${attemptId}` : CHECKOUT_ENTRY;
  return [
    `→ ${ENTRY_PLAN.label} · $${ENTRY_PLAN.monthly.usd}/mo — ${ENTRY_PLAN.creditsPerMonth.toLocaleString()} credits/month (about ${perRun} more runs)`,
    `→ One-time · $${TOPUP.usd} — ${TOPUP.credits.toLocaleString()} credits, no subscription`,
    // The closing line of the message already carries this URL, so don't repeat it here —
    // the same link twice in one chat turn reads like two different destinations.
    `Pick either on the page below and your saved request runs straight after.`,
  ].join('\n');
}

/**
 * "This costs N credits — you have M." Stated only when BOTH numbers are known.
 *
 * An unknown balance is not zero: claiming "you have 0" from a number we never read would
 * be fabricating the one figure the user checks against their own account.
 */
function priceLine(creditsRequired?: number, balance?: number): string | null {
  if (typeof creditsRequired !== 'number') return null;
  if (typeof balance !== 'number') return `This one costs ${creditsRequired} credits.`;
  return `This one costs ${creditsRequired} credits — you have ${balance}.`;
}

/**
 * The message the agent relays. Written to be read aloud by Claude or ChatGPT, so it is
 * prose with one clear next step — not a form. The user is mid-conversation; they should
 * be able to act without hunting for what credits are.
 */
export function paywallMessage(opts: {
  toolName: string;
  reason: PaywallReason;
  creditsRequired?: number;
  balance?: number;
  attemptId?: string | null;
  /** Buyer identity, threaded into Stripe so credits land on the RIGHT account. */
  userEmail?: string | null;
}): string {
  const label = TOOL_LABEL[opts.toolName] ?? 'this analysis';
  const offer = TOOL_OFFERS[opts.toolName];
  const link = opts.attemptId ? `${RESUME_BASE}?attempt=${opts.attemptId}` : CHECKOUT_ENTRY;

  const price = priceLine(opts.creditsRequired, opts.balance);
  const offers = offerLines(opts.userEmail, opts.attemptId);

  if (opts.reason === 'requires_pro') {
    return [
      `Ready to run another ${label}?`,
      offer ? offer.unlocks : `${opts.toolName} is part of Mindy Pro.`,
      'This is not a temporary server error — do not retry until the account is upgraded.',
      offers,
      `Already upgraded, or want to see the saved request first? ${link}`,
    ].join('\n\n');
  }

  // Insufficient credits: lead with exact need/have. Never "server unavailable" / "retry".
  const lead =
    typeof opts.creditsRequired === 'number'
      ? insufficientCreditsLead(opts.creditsRequired, opts.balance)
      : 'You do not have enough credits to run this analysis.';
  return [
    lead,
    'This is not a temporary server error — do not retry until credits are added.',
    offer
      ? `${offer.got} ${offer.unlocks}`
      : `You have used your free credits. Upgrade to keep researching your market.`,
    // priceLine is redundant when the lead already states both numbers; keep when
    // balance was unknown so the cost still appears once.
    typeof opts.balance === 'number' ? offers : [price, offers].filter(Boolean).join('\n'),
    `We saved exactly what you asked for — it runs the moment your credits land. ${link}`,
  ].join('\n\n');
}

/**
 * Mark that the OFFER PAGE was opened (/mcp/continue). This is NOT Stripe checkout.
 *
 * Renamed from markCheckoutStarted 2026-09-15: the old name said "checkout" while the
 * call site stamped a page view, and reading the column as its name misplaced the funnel
 * drop-off three separate times in one investigation. Use markCheckoutClicked for a real
 * buy-link click.
 */
export async function markOfferPageOpened(attemptId: string): Promise<void> {
  const now = new Date().toISOString();
  try {
    const { error } = await getWriteClient()
      .from('mcp_paywall_attempts')
      .update({ offer_page_opened_at: now, updated_at: now })
      .eq('id', attemptId)
      .is('offer_page_opened_at', null);
    if (!error) return;
    // ⚠️ SCHEMA/CODE SKEW FALLBACK. A column rename in the DB lands before the code that
    // uses it reaches production, so for the length of that window the deployed build
    // writes a column that no longer exists. The old call site swallowed the failure
    // entirely (bare try/catch) and the offer page still returned 200 — so the stamp was
    // lost SILENTLY and the funnel under-counted with no error anywhere. Measured live
    // 2026-09-15: an offer page opened and offer_page_opened_at stayed null.
    // Falling back to the legacy column keeps the event rather than dropping it.
    const fallback = await getWriteClient()
      .from('mcp_paywall_attempts')
      .update({ checkout_started_at: now, updated_at: now })
      .eq('id', attemptId)
      .is('checkout_started_at', null);
    if (fallback.error) {
      // BOTH writers failed — the event is genuinely lost. Say so loudly. A swallowed
      // write here is what made the 2026-09-15 outage invisible: the page returned 200
      // while the funnel silently under-counted. Never fatal to the user's page, but it
      // must never again be silent to us.
      console.error(
        `[paywall] offer-page stamp LOST for attempt ${attemptId}: ` +
        `new=${error.message} legacy=${fallback.error.message}`,
      );
    }
  } catch (e) {
    console.error(`[paywall] offer-page stamp threw for attempt ${attemptId}:`, e);
  }
}

/**
 * Compatibility alias for builds deployed BEFORE the funnel-stage rename. Keeping the old
 * exported name means a deployed bundle calling markCheckoutStarted still stamps the
 * event through the fallback above instead of throwing on a missing import.
 * @deprecated use markOfferPageOpened — this records a page view, never Stripe checkout.
 */
export const markCheckoutStarted = markOfferPageOpened;

/**
 * Stamp a purchase-intent stage. Each is a DIFFERENT fact and they must not be conflated:
 *   'checkout_clicked'  the customer clicked a buy link — deliberate intent
 *   'stripe_session'    a Checkout Session was created. NOT proof they saw Stripe's page
 *   'payment_confirmed' a SIGNED webhook confirmed payment
 *   'credits_applied'   credits actually landed (paying != receiving)
 */
export async function markFunnelStage(
  attemptId: string,
  stage: 'checkout_clicked' | 'stripe_session' | 'payment_confirmed' | 'credits_applied',
  extra?: { stripeSessionId?: string },
): Promise<void> {
  const col = `${stage}_at`;
  const patch: Record<string, string> = { [col]: new Date().toISOString(), updated_at: new Date().toISOString() };
  if (extra?.stripeSessionId) patch.stripe_session_id = extra.stripeSessionId;
  try {
    await getWriteClient()
      .from('mcp_paywall_attempts')
      .update(patch)
      .eq('id', attemptId)
      .is(col, null); // first observation wins; a retry must not move the timestamp
  } catch {
    /* best-effort */
  }
}

/**
 * The most recent unconsumed attempt for a user — what we offer to resume after payment.
 * Returns null when there is nothing pending, which is the common case.
 */
export async function pendingAttempt(userEmail: string): Promise<
  | { id: string; toolName: string; args: Record<string, unknown>; rejectedAt: string }
  | null
> {
  try {
    const { data, error } = await getWriteClient()
      .from('mcp_paywall_attempts')
      .select('id,tool_name,args,rejected_at')
      .eq('user_email', userEmail.trim().toLowerCase())
      .is('consumed_at', null)
      .order('rejected_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return {
      id: data.id as string,
      toolName: data.tool_name as string,
      args: (data.args ?? {}) as Record<string, unknown>,
      rejectedAt: data.rejected_at as string,
    };
  } catch {
    return null;
  }
}

/**
 * Stamp a funnel transition. `purchased` and `resumed` are separate on purpose: paying is
 * not the same as getting the thing, and the gap between them is where a "you're upgraded,
 * now go find it yourself" experience would show up in the data.
 */
export async function stampAttempt(
  attemptId: string,
  stage: 'purchased' | 'resumed' | 'completed',
): Promise<void> {
  const col =
    stage === 'purchased' ? 'purchased_at' : stage === 'resumed' ? 'resumed_at' : 'completed_at';
  const patch: Record<string, string> = { [col]: new Date().toISOString(), updated_at: new Date().toISOString() };
  // Completing consumes the attempt so one purchase cannot replay it.
  if (stage === 'completed') patch.consumed_at = new Date().toISOString();
  try {
    await getWriteClient().from('mcp_paywall_attempts').update(patch).eq('id', attemptId);
  } catch {
    /* best-effort */
  }
}

export const __testing = { TOOL_OFFERS, TOOL_LABEL, CHECKOUT_ENTRY, PAYWALL_OFFER_VERSION, checkoutLink, offerLines, priceLine };
