import { NextRequest, NextResponse } from 'next/server';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { sendEmail } from '@/lib/send-email';
import {
  ensureMIBetaWorkspaceSchema,
  ensureWorkspaceMember,
  getMIBetaSupabase,
  getWorkspaceId,
  normalizeEmail,
  recordMIBetaActivity,
} from '@/lib/mi-beta/workspace';

export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email')?.toLowerCase().trim();
  if (!email) return NextResponse.json({ success: false, error: 'Email is required' }, { status: 400 });

  const authSession = requireMIAuthSession(request, email);
  if (!authSession.ok) return authSession.response;

  const schema = await ensureMIBetaWorkspaceSchema();
  if (!schema.ready) return NextResponse.json({ success: false, error: schema.error }, { status: 500 });

  const { workspaceId, member } = await ensureWorkspaceMember(email);
  const supabase = getMIBetaSupabase();
  const normalizedEmail = normalizeEmail(email);

  const [{ data: members }, { data: settings }, { data: notificationProfile }, { data: briefingProfile }, { data: activity }, { data: pipeline }] = await Promise.all([
    supabase.from('mi_beta_team_members').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: true }),
    supabase.from('mi_beta_user_settings').select('*').eq('user_email', normalizedEmail).maybeSingle(),
    supabase
      .from('user_notification_settings')
      .select('user_email, naics_codes, agencies, keywords, business_type, company_name, aggregated_profile, zip_codes')
      .eq('user_email', normalizedEmail)
      .maybeSingle(),
    supabase
      .from('user_briefing_profile')
      .select('user_email, naics_codes, agencies, keywords, company_name, zip_code, certifications, set_aside_preferences, aggregated_profile')
      .eq('user_email', normalizedEmail)
      .maybeSingle(),
    supabase.from('mi_beta_activity').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: false }).limit(20),
    supabase
      .from('user_pipeline')
      .select('id,title,agency,stage,priority,next_action,next_action_date,owner_email,response_deadline,teaming_partners')
      .or(`workspace_id.eq.${workspaceId},user_email.eq.${normalizedEmail}`)
      .order('next_action_date', { ascending: true, nullsFirst: false })
      .limit(100),
  ]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const inSeven = new Date(today);
  inSeven.setDate(inSeven.getDate() + 7);

  const reminders = (pipeline || [])
    .filter((item: { next_action_date?: string | null }) => item.next_action_date)
    .map((item: { next_action_date?: string | null }) => ({ ...item, due: new Date(item.next_action_date || '') }))
    .filter((item: { due: Date }) => item.due <= inSeven)
    .map((item: { due: Date; next_action_date?: string | null }) => {
      const due = item.due;
      return {
        ...item,
        due,
        isOverdue: due < today,
        daysUntilDue: Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)),
      };
    });

  return NextResponse.json({
    success: true,
    workspace: {
      id: workspaceId,
      name: workspaceId.includes('@') ? 'Personal Workspace' : workspaceId,
    },
    currentMember: member,
    members: members || [],
    settings,
    profile: {
      notification: notificationProfile || null,
      briefing: briefingProfile || null,
    },
    activity: activity || [],
    reminders,
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const email = normalizeEmail(String(body.email || ''));
  const invitedEmail = normalizeEmail(String(body.invited_email || ''));
  const role = String(body.role || 'member');

  if (!email || !invitedEmail) {
    return NextResponse.json({ success: false, error: 'email and invited_email are required' }, { status: 400 });
  }

  const authSession = requireMIAuthSession(request, email);
  if (!authSession.ok) return authSession.response;

  const schema = await ensureMIBetaWorkspaceSchema();
  if (!schema.ready) return NextResponse.json({ success: false, error: schema.error }, { status: 500 });

  const { workspaceId, member } = await ensureWorkspaceMember(email);
  if (!['owner', 'admin'].includes(member?.role)) {
    return NextResponse.json({ success: false, error: 'Only owners and admins can invite teammates' }, { status: 403 });
  }

  const { data, error } = await getMIBetaSupabase()
    .from('mi_beta_team_members')
    .upsert({
      workspace_id: workspaceId,
      user_email: invitedEmail,
      invited_email: invitedEmail,
      role: ['admin', 'member', 'viewer'].includes(role) ? role : 'member',
      status: 'invited',
      invited_by: email,
      invited_at: new Date().toISOString(),
    }, { onConflict: 'workspace_id,user_email' })
    .select()
    .single();

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  await recordMIBetaActivity({
    workspaceId,
    userEmail: email,
    actorEmail: email,
    entityType: 'team_member',
    entityId: data.id,
    action: 'invited',
    summary: `Invited ${invitedEmail} as ${data.role}`,
  });

  // Send invite email to the invited user
  const workspaceName = workspaceId.includes('@') ? 'a personal workspace' : formatWorkspaceName(workspaceId);
  const inviteUrl = `${process.env.NEXT_PUBLIC_BASE_URL || 'https://tools.govcongiants.org'}/mi-beta`;

  await sendEmail({
    to: invitedEmail,
    subject: `You've been invited to join ${workspaceName} on Market Intelligence`,
    html: generateTeamInviteEmail({
      invitedEmail,
      inviterEmail: email,
      workspaceName,
      role: data.role,
      inviteUrl,
    }),
    emailType: 'team_invite',
    eventSource: 'mi_beta_workspace',
    tags: {
      workspace_id: workspaceId,
      inviter: email,
      role: data.role,
    },
  });

  return NextResponse.json({ success: true, member: data, emailSent: true });
}

/**
 * Format workspace ID into a display name
 */
function formatWorkspaceName(workspaceId: string): string {
  const name = workspaceId.replace(/\.(com|org|net|gov|edu|io|co)$/i, '');
  return name
    .split(/[-_]/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Generate team invite email HTML
 */
function generateTeamInviteEmail({
  invitedEmail,
  inviterEmail,
  workspaceName,
  role,
  inviteUrl,
}: {
  invitedEmail: string;
  inviterEmail: string;
  workspaceName: string;
  role: string;
  inviteUrl: string;
}): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Team Invitation</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0f172a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #0f172a;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 560px;">

          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #059669 0%, #10b981 100%); border-radius: 12px 12px 0 0; padding: 32px 24px; text-align: center;">
              <div style="width: 48px; height: 48px; margin: 0 auto 16px; background-color: rgba(255,255,255,0.2); border-radius: 12px; line-height: 48px;">
                <span style="color: white; font-weight: bold; font-size: 18px;">MI</span>
              </div>
              <h1 style="margin: 0 0 8px; color: white; font-size: 24px; font-weight: 700;">
                You're Invited to Join a Team
              </h1>
              <p style="margin: 0; color: rgba(255,255,255,0.9); font-size: 14px;">
                Market Intelligence • GovCon Giants
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="background-color: #1e293b; padding: 32px 24px;">
              <p style="margin: 0 0 20px; color: #e2e8f0; font-size: 16px; line-height: 1.6;">
                <strong style="color: white;">${inviterEmail}</strong> has invited you to join
                <strong style="color: #10b981;">${workspaceName}</strong> as a <strong style="color: white;">${role}</strong>.
              </p>

              <div style="background-color: #334155; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
                <p style="margin: 0 0 8px; color: #94a3b8; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em;">
                  What you'll get access to:
                </p>
                <ul style="margin: 0; padding: 0 0 0 16px; color: #e2e8f0; font-size: 14px; line-height: 1.8;">
                  <li>Shared pipeline and opportunity tracking</li>
                  <li>Team activity feed and reminders</li>
                  <li>Collaborative pursuit management</li>
                  <li>Shared contacts and teaming partners</li>
                </ul>
              </div>

              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                <tr>
                  <td align="center">
                    <a href="${inviteUrl}" style="display: inline-block; background: linear-gradient(135deg, #059669 0%, #10b981 100%); color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">
                      Accept Invitation
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 24px 0 0; color: #64748b; font-size: 13px; text-align: center;">
                Simply sign in with <strong style="color: #94a3b8;">${invitedEmail}</strong> to join the team.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #0f172a; border-top: 1px solid #334155; padding: 24px; text-align: center;">
              <p style="margin: 0 0 8px; color: #64748b; font-size: 12px;">
                GovCon Giants AI • Market Intelligence
              </p>
              <p style="margin: 0; color: #475569; font-size: 11px;">
                Helping federal contractors win government business
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const email = normalizeEmail(String(body.email || ''));
  if (!email) return NextResponse.json({ success: false, error: 'email is required' }, { status: 400 });

  const authSession = requireMIAuthSession(request, email);
  if (!authSession.ok) return authSession.response;

  const schema = await ensureMIBetaWorkspaceSchema();
  if (!schema.ready) return NextResponse.json({ success: false, error: schema.error }, { status: 500 });

  const workspaceId = getWorkspaceId(email);
  const updates = {
    workspace_id: workspaceId,
    user_email: email,
    company_name: body.company_name || null,
    display_name: body.display_name || null,
    role_title: body.role_title || null,
    naics_codes: Array.isArray(body.naics_codes) ? body.naics_codes : [],
    target_agencies: Array.isArray(body.target_agencies) ? body.target_agencies : [],
    email_frequency: body.email_frequency || 'daily',
    onboarding_completed: Boolean(body.onboarding_completed),
    two_factor_required: body.two_factor_required !== false,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await getMIBetaSupabase()
    .from('mi_beta_user_settings')
    .upsert(updates, { onConflict: 'user_email' })
    .select()
    .single();

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  await recordMIBetaActivity({
    workspaceId,
    userEmail: email,
    actorEmail: email,
    entityType: 'settings',
    action: 'updated',
    summary: body.onboarding_completed ? 'Completed onboarding' : 'Updated unified settings',
  });

  return NextResponse.json({ success: true, settings: data });
}
