/**
 * /api/app/billing/subscriptions  (GET)
 *
 * The signed-in user's plan (Free / Pro / Team / Enterprise, however it was granted) plus
 * every live Stripe subscription they hold across their linked emails: Mindy Pro/Team and
 * MCP credit plans alike. Read-only; cancel/change goes through ./portal (billedTo picks the
 * customer). Auth: standard /app verifyUserOwnsEmail gate.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyUserOwnsEmail } from '@/lib/api-auth';
import { getStripe } from '@/lib/stripe';
import { getLinkedEmails } from '@/lib/mindy/linked-emails';
import { listLiveSubscriptions } from '@/lib/billing/subscription-list';
import { resolvePlan, PLAN_LABEL } from '@/lib/access/current-plan';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const email = String(request.nextUrl.searchParams.get('email') || '').trim().toLowerCase();
  if (!email) return NextResponse.json({ success: false, error: 'Email is required' }, { status: 400 });

  const auth = await verifyUserOwnsEmail(request, email);
  if (!auth.authenticated) {
    return NextResponse.json({ success: false, error: auth.error || 'Unauthorized' }, { status: 401 });
  }
  const userEmail = auth.email!;

  // Plan and subscriptions are read independently: a Stripe outage must not hide the plan,
  // and an unknown subscription list is reported as unknown (null), never as "none".
  const [planResult, subsResult] = await Promise.allSettled([
    resolvePlan(userEmail),
    (async () => {
      if (!process.env.STRIPE_SECRET_KEY) return null;
      return listLiveSubscriptions(getStripe(), await getLinkedEmails(userEmail));
    })(),
  ]);

  if (planResult.status === 'rejected') console.error('[billing/subscriptions] plan lookup failed:', planResult.reason);
  if (subsResult.status === 'rejected') console.error('[billing/subscriptions] stripe lookup failed:', subsResult.reason);

  const plan = planResult.status === 'fulfilled' ? planResult.value : null;
  return NextResponse.json({
    success: true,
    email: userEmail,
    plan,
    planLabel: plan ? PLAN_LABEL[plan] : null,
    subscriptions: subsResult.status === 'fulfilled' ? subsResult.value : null,
  });
}
