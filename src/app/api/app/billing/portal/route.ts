/**
 * /api/app/billing/portal  (POST)
 *
 * Creates a Stripe Billing Portal session and returns its URL. The hosted
 * portal lets the user change plan, cancel, update their card, and download
 * invoices / view payment history — all PCI-handled by Stripe, no card data or
 * subscription-mutation code on our side.
 *
 * The Settings → Billing "Manage Billing" button POSTs here, then redirects the
 * browser to session.url. On exit Stripe returns the user to `return_url`.
 *
 * Requires the Billing Portal to be configured once in the Stripe dashboard
 * (Settings → Billing → Customer portal). If it isn't, Stripe throws and we
 * surface a clear error.
 *
 * Auth: standard /app verifyUserOwnsEmail gate.
 */
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { verifyUserOwnsEmail } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key, { apiVersion: '2025-01-27.acacia' as Stripe.LatestApiVersion });
}

export async function POST(request: NextRequest) {
  let body: { email?: string; returnUrl?: string } = {};
  try { body = await request.json(); } catch { /* empty body ok */ }

  const email = String(body.email || request.nextUrl.searchParams.get('email') || '')
    .trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ success: false, error: 'Email is required' }, { status: 400 });
  }

  const auth = await verifyUserOwnsEmail(request, email);
  if (!auth.authenticated) {
    return NextResponse.json({ success: false, error: auth.error || 'Unauthorized' }, { status: 401 });
  }
  const userEmail = auth.email!;

  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ success: false, error: 'Billing is not configured' }, { status: 503 });
  }

  // Where Stripe sends the user when they close the portal. Default to the
  // app's settings surface on the requesting origin.
  const origin = request.headers.get('origin') || request.nextUrl.origin;
  const returnUrl = body.returnUrl || `${origin}/app`;

  try {
    const customers = await stripe.customers.list({ email: userEmail, limit: 1 });
    const customer = customers.data[0] || null;
    if (!customer) {
      return NextResponse.json(
        { success: false, error: 'No billing account found for this email. If you just subscribed, give it a minute and retry.' },
        { status: 404 }
      );
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customer.id,
      return_url: returnUrl,
    });

    return NextResponse.json({ success: true, url: session.url });
  } catch (err) {
    // Most common cause: the Customer Portal hasn't been configured in the
    // Stripe dashboard yet. Surface that clearly.
    const message = err instanceof Error ? err.message : 'Could not open billing portal';
    console.error('[app/billing/portal] failed:', message);
    const isConfigError = /configuration|portal/i.test(message);
    return NextResponse.json(
      {
        success: false,
        error: isConfigError
          ? 'Billing portal is not configured yet. (Stripe → Settings → Billing → Customer portal.)'
          : 'Could not open billing portal',
      },
      { status: 500 }
    );
  }
}
