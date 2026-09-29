/**
 * /api/mcp/team — pooled team credits for the /mcp/account "Team" section.
 * PRD: tasks/PRD-pooled-team-credits.md.
 *
 *   GET                                   → the caller's teams (pool balance, seats, members,
 *                                           usage per member for owners, pending invites)
 *   POST { action:'invite', orgId, email } → owner invites an address (seat cap enforced)
 *   POST { action:'remove', orgId, email } → owner removes a member / revokes an invite
 *   POST { action:'accept', token }        → the invitee accepts. The signed-in email MUST
 *                                           equal the invited address — that is the proof.
 *
 * Identity is server-verified (resolveMcpEmail: signed 2FA token or Supabase session),
 * never a client-supplied email. Membership is never inferred from an email domain.
 */
import { NextRequest, NextResponse } from 'next/server';
import { resolveMcpEmail } from '@/lib/mcp/session-identity';
import {
  teamViewFor, createInvite, acceptInvite, removeMember, TeamPoolError,
} from '@/lib/mcp/team-pools';
import { sendEmail } from '@/lib/send-email';
import { renderTeamInviteEmail } from '@/lib/mcp/team-invite-email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_BASE_URL || 'https://getmindy.ai';

function errorResponse(e: unknown) {
  if (e instanceof TeamPoolError) {
    const status = e.code === 'not_owner' ? 403 : e.code === 'invalid' || e.code === 'expired' ? 404 : 409;
    return NextResponse.json({ success: false, code: e.code, error: e.message }, { status });
  }
  console.error('[api/mcp/team]', e);
  return NextResponse.json({ success: false, error: 'Something went wrong. Nothing was changed.' }, { status: 500 });
}

export async function GET(request: NextRequest) {
  const email = await resolveMcpEmail(request);
  if (!email) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  try {
    return NextResponse.json({ success: true, teams: await teamViewFor(email) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(request: NextRequest) {
  const email = await resolveMcpEmail(request);
  if (!email) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }
  const action = String(body.action || '');
  try {
    if (action === 'invite') {
      const orgId = String(body.orgId || '');
      const invitee = String(body.email || '');
      if (!orgId || !invitee) return NextResponse.json({ success: false, error: 'orgId and email required' }, { status: 400 });
      const inv = await createInvite(orgId, email, invitee);
      const acceptUrl = `${BASE_URL}/mcp/account?section=team&invite=${encodeURIComponent(inv.token)}`;
      const sent = await sendEmail({
        to: invitee.toLowerCase().trim(),
        subject: `You've been invited to ${inv.orgName} on Mindy`,
        html: renderTeamInviteEmail({ orgName: inv.orgName, inviterEmail: email, acceptUrl }),
        emailType: 'team_invite',
        eventSource: 'mcp_team_pool',
        transactional: true,
        tags: { org_id: orgId, inviter: email },
      });
      return NextResponse.json({ success: true, inviteId: inv.inviteId, expiresAt: inv.expiresAt, emailed: sent === true });
    }
    if (action === 'remove') {
      const orgId = String(body.orgId || '');
      const member = String(body.email || '');
      if (!orgId || !member) return NextResponse.json({ success: false, error: 'orgId and email required' }, { status: 400 });
      return NextResponse.json({ success: true, ...(await removeMember(orgId, email, member)) });
    }
    if (action === 'accept') {
      const token = String(body.token || '');
      if (!token) return NextResponse.json({ success: false, error: 'token required' }, { status: 400 });
      return NextResponse.json({ success: true, ...(await acceptInvite(token, email)) });
    }
    return NextResponse.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 });
  } catch (e) {
    return errorResponse(e);
  }
}
