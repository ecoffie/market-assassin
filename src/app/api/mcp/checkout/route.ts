/**
 * POST /api/mcp/checkout — create a Stripe Checkout Session for a blocked attempt.
 *
 * WHY THIS EXISTS: the paywall offered static Stripe PAYMENT LINKS with `?attempt=<id>`
 * appended. Stripe does not forward arbitrary query params from a payment link into the
 * session, so the attempt id never reached the webhook — a payment could be tied to the
 * ACCOUNT (client_reference_id) but never to the specific REQUEST the customer was
 * blocked on. Measured 2026-09-15: 0 of 20 recent sessions carried an `attempt`, and the
 * two completed MCP payments in the cohort window carried no client_reference_id at all.
 *
 * A server-created session fixes that at the source: we set metadata ourselves, so the
 * webhook can stamp the funnel AND resume the exact saved request.
 *
 * It also records checkout_clicked_at — the first stage that evidences deliberate
 * purchase intent, as distinct from merely opening the offer page.
 */
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getWriteClient } from '@/lib/supabase/server-clients';
import { markFunnelStage } from '@/lib/mcp/paywall';
import { CREDIT_PACKAGES, SUBSCRIPTION_PLANS } from '@/lib/mcp/packages';
import { resolveMcpEmail } from '@/lib/mcp/session-identity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SITE = 'https://getmindy.ai';

export async function POST(req: NextRequest) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return NextResponse.json({ error: 'stripe not configured' }, { status: 500 });

  let body: { attempt?: string; product?: string; interval?: string } = {};
  try { body = await req.json(); } catch { /* empty body is a validation error below */ }

  const attemptId = typeof body.attempt === 'string' ? body.attempt : null;
  const product = typeof body.product === 'string' ? body.product : 'entry';
  const interval = typeof body.interval === 'string' ? body.interval : 'month';
  if (!attemptId) return NextResponse.json({ error: 'attempt required' }, { status: 400 });

  // IDENTITY COMES FROM THE SESSION, NEVER THE REQUEST BODY. A caller must not be able to
  // name the account that gets credited.
  const authedEmail = await resolveMcpEmail(req).catch(() => null);

  const db = getWriteClient();
  const { data: attempt, error } = await db
    .from('mcp_paywall_attempts')
    .select('id,user_email,tool_name,consumed_at,stripe_session_id')
    .eq('id', attemptId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: 'lookup failed' }, { status: 500 });
  if (!attempt) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (attempt.consumed_at) return NextResponse.json({ error: 'already resumed' }, { status: 409 });

  // The attempt owns the identity. An authenticated caller must match it — otherwise a
  // known attempt id would let someone fund (or hijack) another account's request.
  const owner = String(attempt.user_email).toLowerCase();
  if (authedEmail && authedEmail.toLowerCase() !== owner) {
    return NextResponse.json({ error: 'attempt belongs to another account' }, { status: 403 });
  }

  const pkg = (CREDIT_PACKAGES as ReadonlyArray<{ id: string; priceId?: string; credits: number }>)
    .find((p) => p.id === product);
  const plan = SUBSCRIPTION_PLANS.find((p) => p.id === product);
  // `interval` selects the annual price where one exists; monthly stays the default so
  // existing callers are unaffected.
  const wantAnnual = interval === 'year' || interval === 'annual';
  const planPrice = plan ? (wantAnnual && plan.annual ? plan.annual : plan.monthly) : null;
  const priceId = pkg?.priceId ?? planPrice?.priceId;
  if (!priceId) return NextResponse.json({ error: `unknown product: ${product}` }, { status: 400 });

  /**
   * Checkout copy MUST be interval-specific and MUST NOT live on the Stripe product —
   * monthly and annual prices share one product, so a product-level description saying
   * "per month" is simply WRONG on an annual purchase (it was, on Growth, until fixed).
   * Deriving it from config here means the figures cannot drift from the allowances.
   */
  const submitMessage = pkg
    ? `${pkg.credits.toLocaleString()} additional credits. One-time payment. Credits never expire.`
    : wantAnnual && plan?.annual
      ? `${plan.annual.credits.toLocaleString()} credits delivered upfront each year. Every Mindy tool. Unused credits carry forward.`
      : `${(plan?.creditsPerMonth ?? 0).toLocaleString()} credits delivered each month. Every Mindy tool. Unused credits carry forward.`;

  const stripe = new Stripe(key);
  try {
    // IDEMPOTENT: a retry (the only recovery path now that the silent static-link
    // fallback is gone) must NOT mint a second session for the same attempt. Reuse the
    // existing one while it is still open; only a session that can no longer be paid
    // (expired/complete) is replaced.
    if (attempt.stripe_session_id) {
      try {
        const prior = await stripe.checkout.sessions.retrieve(String(attempt.stripe_session_id));
        if (prior.status === 'open' && prior.url) {
          return NextResponse.json({ url: prior.url, sessionId: prior.id, reused: true });
        }
      } catch {
        // Unretrievable (wrong mode/key/deleted) — fall through and create a fresh one.
      }
    }

    const session = await stripe.checkout.sessions.create({
      mode: plan ? 'subscription' : 'payment',
      line_items: [{ price: priceId, quantity: 1 }],
      custom_text: { submit: { message: submitMessage } },
      // BOTH attributions, set server-side so neither can be lost or spoofed:
      //   client_reference_id → the account (what the webhook already reads)
      //   metadata.attempt    → the specific blocked request, so resume can be exact
      client_reference_id: owner,
      metadata: { user_email: owner, attempt: attemptId, tool_name: String(attempt.tool_name) },
      ...(plan ? { subscription_data: { metadata: { user_email: owner, attempt: attemptId } } } : {}),
      success_url: `${SITE}/mcp/continue?attempt=${attemptId}&paid=1`,
      cancel_url: `${SITE}/mcp/continue?attempt=${attemptId}`,
    });

    // Deliberate intent — distinct from opening the offer page. Stamped before the
    // redirect because that is when the customer chose to buy.
    await markFunnelStage(attemptId, 'checkout_clicked');
    // A session was CREATED. ⚠️ Never report this as "the customer viewed Stripe".
    await markFunnelStage(attemptId, 'stripe_session', { stripeSessionId: session.id });

    return NextResponse.json({ url: session.url, sessionId: session.id });
  } catch (e) {
    console.error('[mcp:checkout] session create failed:', e);
    return NextResponse.json({ error: 'checkout unavailable' }, { status: 502 });
  }
}
