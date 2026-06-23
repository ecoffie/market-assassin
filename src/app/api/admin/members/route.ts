/**
 * Self-serve Members admin API.
 *
 * Lets the team grant or revoke Pro / Team access. Two auth paths, either works:
 *   1. STAFF SESSION TOKEN — the caller's own signed MI session token (the one
 *      /app stores), verified server-side + a staff-role check. Used by the
 *      standalone /admin/members page (no shared password).
 *   2. ADMIN PASSWORD — the Command Center authenticates with the admin password
 *      (sessionStorage), so its inline Member Access section passes that instead.
 *      Grants made this way are attributed to `admin@command-center` in the audit.
 *
 *   GET  ?email=<user>   → look up that user's current Pro/Team status
 *   GET  ?log=1          → recent grant/revoke activity (audit trail)
 *   POST { email, tier: 'pro'|'team', action: 'grant'|'revoke',
 *          sendWelcome?, customerName? } → apply it
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { getStaffRole } from '@/lib/api-auth';
import { verifyAdminPassword } from '@/lib/admin-auth';
import {
  getMemberStatus,
  applyMemberGrant,
  getRecentGrants,
  type GrantTier,
  type GrantAction,
} from '@/lib/admin/member-grants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Actor recorded in the audit when the call is authorized by the admin password. */
const ADMIN_PASSWORD_ACTOR = 'admin@command-center';

/**
 * Verify the caller is authorized — either a signed-in staff member (session
 * token) OR the admin password (Command Center). Returns the actor email to
 * attribute the action to, or an error response.
 */
function requireStaff(
  request: NextRequest,
  passwordFromBody?: string,
): { ok: true; email: string } | { ok: false; response: NextResponse } {
  // Path 1: staff session token (standalone /admin/members page).
  const auth = requireMIAuthSession(request);
  if (auth.ok) {
    const email = auth.session.email;
    if (email && getStaffRole(email) !== 'none') {
      return { ok: true, email };
    }
  }

  // Path 2: admin password (Command Center inline section).
  const password =
    passwordFromBody ||
    request.nextUrl.searchParams.get('password') ||
    request.headers.get('x-admin-password') ||
    undefined;
  if (password && verifyAdminPassword(password)) {
    return { ok: true, email: ADMIN_PASSWORD_ACTOR };
  }

  return {
    ok: false,
    response: NextResponse.json(
      { success: false, error: 'Staff access required. Sign in with a team account or provide the admin password.' },
      { status: 403 },
    ),
  };
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
  let body: {
    email?: string;
    tier?: GrantTier;
    action?: GrantAction;
    sendWelcome?: boolean;
    customerName?: string;
    password?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  // Auth runs after the body parse so the admin-password path can read
  // `password` from the JSON body (the Command Center posts it there).
  const staff = requireStaff(request, body.password);
  if (!staff.ok) return staff.response;

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
