import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { kv } from '@vercel/kv';
import {
  grantOpportunityHunterProAccess,
  hasOpportunityHunterProAccess,
  grantMarketAssassinAccess,
  getMarketAssassinAccess,
  grantContentGeneratorAccess,
  getContentGeneratorAccess,
} from '@/lib/access-codes';
import { sendOpportunityHunterProEmail } from '@/lib/send-email';
import {
  productsFromLineItems,
  isLegacySessionProduct,
  type LegacySessionProduct,
} from '@/lib/billing/legacy-session-products';

/**
 * Purchase confirmation for the legacy tool success pages.
 *
 * The Stripe webhook is the source of truth for provisioning; this route only CONFIRMS a
 * purchase the customer just completed, and may grant the product the session actually paid for.
 *
 *   1. Only a COMPLETE and PAID session grants anything (these are one-time products, so
 *      `no_payment_required` does not grant).
 *   2. The product comes from the session's own line items (price id → product, single map in
 *      legacy-session-products.ts). `?product=` is a hint only: it selects which bought product
 *      the response describes and can never add one that was not paid for.
 *   3. Idempotent per session id: a KV marker makes a replay a no-op that returns the same result.
 *   4. Disclosure: email/name are returned only for a complete, paid, recent (≤ 48h) session that
 *      bought a listed product. Any other session id gets no customer data.
 *   5. Any failure before every grant completes returns 5xx and records nothing, so a retry can
 *      finish the job. There is no partial "success".
 */

export const CONFIRM_WINDOW_SECONDS = 48 * 60 * 60;
const MARKER_TTL_SECONDS = 90 * 24 * 60 * 60;
const PENDING_TTL_SECONDS = 300;
const SESSION_ID_RE = /^cs_(live|test)_[A-Za-z0-9]{10,200}$/;

const markerKey = (sessionId: string) => `stripe-session:confirmed:${sessionId}`;

interface Marker { state: 'pending' | 'done'; products?: LegacySessionProduct[] }

function getStripe() {
  return new Stripe(String(process.env.STRIPE_SECRET_KEY || '').replace(/\\n$/, '').trim());
}

const TIER_OF: Record<LegacySessionProduct, string> = {
  'opportunity-hunter-pro': 'opportunity-hunter-pro',
  'market-assassin-standard': 'standard',
  'market-assassin-premium': 'premium',
  'market-assassin-premium-upgrade': 'premium',
  'content-engine': 'content-engine',
  'full-fix': 'full-fix',
  'content-full-fix-upgrade': 'full-fix',
};

/** Grant one product. Throws on any failure (never swallows). Never downgrades. */
async function grantProduct(product: LegacySessionProduct, email: string, name?: string): Promise<void> {
  switch (product) {
    case 'opportunity-hunter-pro': {
      if (!(await hasOpportunityHunterProAccess(email))) {
        await grantOpportunityHunterProAccess(email, name);
        try {
          await sendOpportunityHunterProEmail({ to: email, customerName: name });
        } catch (e) {
          // The grant landed; the courtesy email must not turn it into a failure.
          console.error('[stripe-session] OH Pro email failed (grant kept):', (e as Error).message);
        }
      }
      return;
    }
    case 'market-assassin-standard': {
      if (!(await getMarketAssassinAccess(email))) await grantMarketAssassinAccess(email, 'standard', name);
      return;
    }
    case 'market-assassin-premium':
    case 'market-assassin-premium-upgrade': {
      const a = await getMarketAssassinAccess(email);
      if (!a || a.tier !== 'premium') await grantMarketAssassinAccess(email, 'premium', name);
      return;
    }
    case 'content-engine': {
      if (!(await getContentGeneratorAccess(email))) await grantContentGeneratorAccess(email, 'content-engine', name);
      return;
    }
    case 'full-fix':
    case 'content-full-fix-upgrade': {
      const a = await getContentGeneratorAccess(email);
      if (!a || a.tier !== 'full-fix') await grantContentGeneratorAccess(email, 'full-fix', name);
      return;
    }
  }
}

function successBody(product: LegacySessionProduct, products: LegacySessionProduct[], email: string, name: string | null) {
  const body: Record<string, unknown> = {
    success: true,
    email: email.toLowerCase(),
    product,
    products,
    tier: TIER_OF[product],
    hasAccess: true,
    customerName: name,
  };
  if (product.endsWith('-upgrade')) body.upgraded = true;
  if (product === 'content-engine' || product === 'full-fix' || product === 'content-full-fix-upgrade') {
    body.redirectUrl = '/content-generator';
  }
  return body;
}

const refuse = (status: number, error: string, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ success: false, error, ...extra }, { status });

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get('session_id') || '';
  const hint = searchParams.get('product');

  if (!sessionId) return refuse(400, 'Session ID required');
  if (!SESSION_ID_RE.test(sessionId)) return refuse(400, 'Invalid session ID');

  let session: Stripe.Checkout.Session;
  try {
    session = await getStripe().checkout.sessions.retrieve(sessionId, { expand: ['line_items.data.price'] });
  } catch (e) {
    console.error('[stripe-session] Stripe retrieve failed:', (e as Error).message);
    return refuse(502, 'Could not verify the purchase right now. Please check your email or try again.');
  }

  // 1. Complete AND paid, or nothing.
  if (session.status !== 'complete' || session.payment_status !== 'paid') {
    return refuse(402, 'Payment not confirmed for this checkout.');
  }

  // 4. Recent only — an old (possibly leaked) session id reveals nothing and grants nothing here.
  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof session.created !== 'number' || nowSec - session.created > CONFIRM_WINDOW_SECONDS) {
    return refuse(410, 'This confirmation link has expired. Your access email has the login link.');
  }

  // 2. What was actually bought.
  const items = session.line_items?.data;
  if (session.line_items?.has_more) {
    // Never decide on a partial view of the line items.
    console.error('[stripe-session] line items truncated for session', sessionId);
    return refuse(502, 'Could not verify the purchase right now. Please check your email or try again.');
  }
  const bought = productsFromLineItems(items);
  if (bought.length === 0) return refuse(422, 'Nothing to confirm for this checkout.');
  const product = isLegacySessionProduct(hint) && bought.includes(hint) ? hint : bought[0];
  if (hint && product !== hint) {
    console.warn(`[stripe-session] ?product=${hint} not bought in ${sessionId}; confirming ${bought.join(',')} only`);
  }

  const email = (session.customer_details?.email || session.customer_email || '').toLowerCase().trim();
  if (!email) return refuse(422, 'No email found in session');
  const name = session.customer_details?.name || null;

  // 3. Idempotent per session id. Claim first, so two concurrent confirmations cannot both grant.
  const key = markerKey(sessionId);
  let claimed: unknown;
  try {
    claimed = await kv.set(key, { state: 'pending' } satisfies Marker, { nx: true, ex: PENDING_TTL_SECONDS });
  } catch (e) {
    console.error('[stripe-session] KV claim failed (no grant):', (e as Error).message);
    return refuse(503, 'Could not verify the purchase right now. Please check your email or try again.');
  }
  if (!claimed) {
    let existing: Marker | null = null;
    try { existing = await kv.get<Marker>(key); } catch { existing = null; }
    if (existing?.state === 'done') return NextResponse.json(successBody(product, bought, email, name));
    return refuse(409, 'Confirmation already in progress. Please refresh in a moment.', { pending: true });
  }

  // 5. All grants or none recorded.
  try {
    for (const p of bought) await grantProduct(p, email, name || undefined);
  } catch (e) {
    console.error('[stripe-session] grant failed:', (e as Error).message);
    try { await kv.del(key); } catch { /* pending marker expires on its own */ }
    return refuse(500, 'Failed to confirm the purchase. Please check your email or try again.');
  }

  try {
    await kv.set(key, { state: 'done', products: bought } satisfies Marker, { ex: MARKER_TTL_SECONDS });
  } catch (e) {
    // Grants are complete and individually idempotent; a missing marker only means a later
    // replay re-checks access and grants nothing new.
    console.error('[stripe-session] KV marker write failed after grant:', (e as Error).message);
  }

  return NextResponse.json(successBody(product, bought, email, name));
}
