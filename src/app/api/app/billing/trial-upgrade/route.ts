/**
 * /api/app/billing/trial-upgrade — "Upgrade now, get +500 credits" (owner, 2026-11-13).
 *
 *   GET  ?email=…                     → the caller's eligible Pro/Team trial offers (usually 0 or 1)
 *   POST { email, subscriptionId? }   → end that trial now and charge the first invoice today
 *
 * Auth: the standard /app verifyUserOwnsEmail gate (MI session token or Supabase session for
 * THAT email — a claimed email alone is refused). Ownership of the subscription is checked
 * against the Stripe customers behind the caller's verified + linked emails.
 *
 * The 500 bonus credits are NOT granted here. They are granted by the Stripe webhook when the
 * invoice that ends the trial is PAID (src/lib/mcp/trial-upgrade-bonus.ts). Logic and every
 * refusal live in src/lib/billing/trial-upgrade.ts.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyUserOwnsEmail } from '@/lib/api-auth';
import { getStripe } from '@/lib/stripe';
import { getLinkedEmails } from '@/lib/mindy/linked-emails';
import { listTrialUpgradeOffers, upgradeTrialNow } from '@/lib/billing/trial-upgrade';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const email = String(request.nextUrl.searchParams.get('email') || '').trim().toLowerCase();
  if (!email) return NextResponse.json({ success: false, error: 'Email is required' }, { status: 400 });

  const auth = await verifyUserOwnsEmail(request, email);
  if (!auth.authenticated) {
    return NextResponse.json({ success: false, error: auth.error || 'Unauthorized' }, { status: 401 });
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ success: false, error: 'Billing is not configured' }, { status: 503 });
  }

  try {
    const offers = await listTrialUpgradeOffers(getStripe(), await getLinkedEmails(auth.email!));
    return NextResponse.json({ success: true, offers }, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    // Unknown is not "no trial": the client shows nothing rather than a wrong state.
    console.error('[billing/trial-upgrade] offer lookup failed:', err);
    return NextResponse.json({ success: false, error: 'Could not check your trial right now' }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  let body: { email?: string; subscriptionId?: string } = {};
  try { body = await request.json(); } catch { /* empty body → email check below */ }

  const email = String(body.email || request.nextUrl.searchParams.get('email') || '').trim().toLowerCase();
  if (!email) return NextResponse.json({ success: false, error: 'Email is required' }, { status: 400 });

  const auth = await verifyUserOwnsEmail(request, email);
  if (!auth.authenticated) {
    return NextResponse.json({ success: false, error: auth.error || 'Unauthorized' }, { status: 401 });
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ success: false, error: 'Billing is not configured' }, { status: 503 });
  }

  const subscriptionId = typeof body.subscriptionId === 'string' ? body.subscriptionId : null;
  const result = await upgradeTrialNow(getStripe(), await getLinkedEmails(auth.email!), subscriptionId);
  if (!result.ok) {
    return NextResponse.json({ success: false, code: result.code, error: result.message }, { status: result.httpStatus });
  }
  return NextResponse.json({
    success: true,
    status: result.status,
    subscriptionId: result.subscriptionId,
    amountCharged: result.amountCharged,
    bonusCredits: result.bonusCredits,
  });
}
