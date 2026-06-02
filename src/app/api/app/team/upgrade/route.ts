/**
 * /api/app/team/upgrade
 *
 * GET  — returns the Team checkout URL (Stripe payment link) the in-app
 *        "Upgrade to Team" CTA sends the user to, with their email prefilled.
 *        Also reports whether the user already has Team access.
 *
 * POST — provisions the team workspace for a user who ALREADY has Team access
 *        (access_team granted by the Stripe webhook). Creates the team
 *        workspace + migrates their personal pipeline / contacts / target list
 *        into it. Idempotent: safe to call repeatedly (acts as a self-heal if
 *        the webhook set the flag but the workspace wasn't provisioned).
 *
 * The actual entitlement grant happens in the Stripe webhook
 * (updateAccessFlags -> access_team). This route is the workspace side.
 *
 * Auth: standard /app verifyUserOwnsEmail gate.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyUserOwnsEmail, verifyMIAccess } from '@/lib/api-auth';
import { provisionTeamWorkspace } from '@/lib/app/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Stripe payment link for the Team plan. Set NEXT_PUBLIC_TEAM_CHECKOUT_URL to
// the Stripe-hosted checkout once the Team product/price exists. The metadata
// on that payment link should carry tier=team_monthly (or team_annual) so the
// webhook grants access_team.
function teamCheckoutUrl(email: string): string {
  const base = process.env.NEXT_PUBLIC_TEAM_CHECKOUT_URL || '';
  if (!base) return '';
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}prefilled_email=${encodeURIComponent(email)}`;
}

export async function GET(request: NextRequest) {
  const email = String(request.nextUrl.searchParams.get('email') || '').trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ success: false, error: 'Email is required' }, { status: 400 });
  }

  const auth = await verifyUserOwnsEmail(request, email);
  if (!auth.authenticated) {
    return NextResponse.json({ success: false, error: auth.error || 'Unauthorized' }, { status: 401 });
  }
  const userEmail = auth.email!;

  const access = await verifyMIAccess(userEmail);
  const hasTeam = access.tier === 'team' || access.tier === 'enterprise';

  return NextResponse.json({
    success: true,
    hasTeam,
    currentTier: access.tier,
    checkoutUrl: hasTeam ? null : teamCheckoutUrl(userEmail),
    configured: !!process.env.NEXT_PUBLIC_TEAM_CHECKOUT_URL,
  });
}

export async function POST(request: NextRequest) {
  let body: { email?: string } = {};
  try { body = await request.json(); } catch { /* empty ok */ }

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

  // Only provision once the user actually has Team entitlement (set by the
  // Stripe webhook on a successful Team purchase). This prevents a free user
  // from self-promoting to a team workspace without paying.
  const access = await verifyMIAccess(userEmail);
  if (access.tier !== 'team' && access.tier !== 'enterprise') {
    return NextResponse.json(
      { success: false, error: 'Team access is required first. Complete the Team checkout, then this finishes setup.' },
      { status: 403 }
    );
  }

  try {
    const { workspaceId, created } = await provisionTeamWorkspace(userEmail);
    return NextResponse.json({ success: true, workspaceId, created });
  } catch (err) {
    console.error('[team/upgrade] provisioning failed:', err);
    return NextResponse.json({ success: false, error: 'Could not set up the team workspace' }, { status: 500 });
  }
}
