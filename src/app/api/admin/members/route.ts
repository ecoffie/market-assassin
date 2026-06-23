/**
 * Self-serve Members admin API.
 *
 * Lets any logged-in STAFF member (govcongiants.com / getmindy.ai / internal
 * allowlist — see getStaffRole) grant or revoke Pro / Team access without a
 * shared admin password. Auth = the caller's own signed MI session token (the
 * one /app already stores), verified server-side, then a staff-role check.
 *
 *   GET  ?email=<user>   → look up that user's current Pro/Team status
 *   GET  ?log=1          → recent grant/revoke activity (audit trail)
 *   POST { email, tier: 'pro'|'team', action: 'grant'|'revoke',
 *          sendWelcome?, customerName? } → apply it
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { getStaffRole } from '@/lib/api-auth';
import {
  getMemberStatus,
  applyMemberGrant,
  getRecentGrants,
  type GrantTier,
  type GrantAction,
} from '@/lib/admin/member-grants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Verify the caller is a signed-in staff member. Returns their email or an error response. */
function requireStaff(request: NextRequest): { ok: true; email: string } | { ok: false; response: NextResponse } {
  const auth = requireMIAuthSession(request);
  if (!auth.ok) return { ok: false, response: auth.response };
  const email = auth.session.email;
  if (!email || getStaffRole(email) === 'none') {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: 'Staff access required. Sign in with a team account.' },
        { status: 403 },
      ),
    };
  }
  return { ok: true, email };
}

export async function GET(request: NextRequest) {
  const staff = requireStaff(request);
  if (!staff.ok) return staff.response;

  const { searchParams } = new URL(request.url);

  if (searchParams.get('log') === '1') {
    const log = await getRecentGrants(25);
    return NextResponse.json({ success: true, log }, { headers: { 'Cache-Control': 'no-store' } });
  }

  const email = searchParams.get('email')?.trim();
  if (!email) {
    return NextResponse.json({ success: false, error: 'email is required' }, { status: 400 });
  }
  const status = await getMemberStatus(email);
  return NextResponse.json({ success: true, status }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest) {
  const staff = requireStaff(request);
  if (!staff.ok) return staff.response;

  let body: {
    email?: string;
    tier?: GrantTier;
    action?: GrantAction;
    sendWelcome?: boolean;
    customerName?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const email = body.email?.trim();
  const tier = body.tier;
  const action = body.action;
  if (!email) return NextResponse.json({ success: false, error: 'email is required' }, { status: 400 });
  if (tier !== 'pro' && tier !== 'team') {
    return NextResponse.json({ success: false, error: "tier must be 'pro' or 'team'" }, { status: 400 });
  }
  if (action !== 'grant' && action !== 'revoke') {
    return NextResponse.json({ success: false, error: "action must be 'grant' or 'revoke'" }, { status: 400 });
  }

  const result = await applyMemberGrant({
    targetEmail: email,
    actorEmail: staff.email,
    tier,
    action,
    sendWelcome: body.sendWelcome !== false, // default ON for grants
    customerName: body.customerName,
  });

  return NextResponse.json(result, {
    status: result.success ? 200 : 500,
    headers: { 'Cache-Control': 'no-store' },
  });
}
