import { NextRequest, NextResponse } from 'next/server';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { sendEmail } from '@/lib/send-email';
import {
  ensureAppWorkspaceSchema,
  ensureWorkspaceMember,
  getAppSupabase,
  getWorkspaceId,
  normalizeEmail,
  recordAppActivity,
} from '@/lib/app/workspace';

const TEAM_SEAT_LIMIT = 5;

export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email')?.toLowerCase().trim();
  if (!email) return NextResponse.json({ success: false, error: 'Email is required' }, { status: 400 });

  const authSession = requireMIAuthSession(request, email);
  if (!authSession.ok) return authSession.response;

  const schema = await ensureAppWorkspaceSchema();
  if (!schema.ready) return NextResponse.json({ success: false, error: schema.error }, { status: 500 });

  const { workspaceId, member } = await ensureWorkspaceMember(email);
  const supabase = getAppSupabase();
  const normalizedEmail = normalizeEmail(email);

  const [{ data: members }, { data: settings }, { data: workspaceSettings }, { data: notificationProfile }, { data: briefingProfile }, { data: activity }, { data: pipeline }] = await Promise.all([
    supabase.from('mi_beta_team_members').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: true }),
    supabase.from('mi_beta_user_settings').select('*').eq('user_email', normalizedEmail).maybeSingle(),
    // Workspace-level defaults (company, NAICS, agencies) shared by all members —
    // distinct from the per-user mi_beta_user_settings row above. Tolerate the
    // table not existing yet (migration 20260602_workspace_settings.sql) so the
    // rest of the workspace still loads — degrade to null.
    supabase.from('mi_beta_workspace_settings').select('*').eq('workspace_id', workspaceId).maybeSingle()
      .then((r: { data: unknown }) => r, () => ({ data: null })),
    supabase
      .from('user_notification_settings')
      // NOTE: select ONLY columns that exist. company_name + zip_codes do NOT exist
      // on user_notification_settings — including them made PostgREST reject the
      // WHOLE query → profile.notification came back null → the Settings card/form
      // showed "No codes / No keywords" despite the data being present (Eric QC
      // 2026-06-16). Never add a column here without confirming it exists.
      // psc_codes DOES exist (20260612 migration) — included so Settings can edit it.
      // location_states exists too — surfaced so the targeting card shows coverage area.
      // (Verified columns exist before adding — a missing column nulls the WHOLE query.)
      .select('user_email, naics_codes, psc_codes, agencies, keywords, business_type, location_states, aggregated_profile')
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
    // Workspace-level defaults for TeamPanel (company_name, naics_codes,
    // target_agencies), shared across all members. Mapped to the field names
    // TeamPanel's WorkspaceSettings expects.
    workspaceSettings: workspaceSettings
      ? {
          company_name: workspaceSettings.company_name,
          naics_codes: workspaceSettings.default_naics_codes,
          target_agencies: workspaceSettings.default_agencies,
        }
      : null,
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

  const schema = await ensureAppWorkspaceSchema();
  if (!schema.ready) return NextResponse.json({ success: false, error: schema.error }, { status: 500 });

  const { workspaceId, member } = await ensureWorkspaceMember(email);
  if (!['owner', 'admin'].includes(member?.role)) {
    return NextResponse.json({ success: false, error: 'Only owners and admins can invite teammates' }, { status: 403 });
  }

  const { count: seatCount, error: seatCountError } = await getAppSupabase()
    .from('mi_beta_team_members')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .in('status', ['active', 'invited']);

  if (seatCountError) {
    return NextResponse.json({ success: false, error: seatCountError.message }, { status: 500 });
  }

  if ((seatCount || 0) >= TEAM_SEAT_LIMIT) {
    return NextResponse.json(
      { success: false, error: `Mindy Team includes ${TEAM_SEAT_LIMIT} seats. Upgrade to Enterprise for more users.` },
      { status: 403 }
    );
  }

  const { data, error } = await getAppSupabase()
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

  await recordAppActivity({
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
      const inviteUrl = `${process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_BASE_URL || 'https://getmindy.ai'}/app`;

  await sendEmail({
    to: invitedEmail,
    subject: `You've been invited to join ${workspaceName} on Mindy`,
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
                <span style="color: white; font-weight: bold; font-size: 18px;">M</span>
              </div>
              <h1 style="margin: 0 0 8px; color: white; font-size: 24px; font-weight: 700;">
                You're Invited to Join a Team
              </h1>
              <p style="margin: 0; color: rgba(255,255,255,0.9); font-size: 14px;">
                Mindy • GovCon Giants
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="background-color: #1e293b; padding: 32px 24px;">
              <p style="margin: 0 0 20px; color: #e2e8f0; font-size: 16px; line-height: 1.6;">
                <a href="mailto:${inviterEmail}" style="color: #ffffff; font-weight: 700; text-decoration: none;">${inviterEmail}</a> has invited you to join
                <strong style="color: #34d399;">${workspaceName}</strong> as a <strong style="color: white;">${role}</strong>.
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

              <p style="margin: 24px 0 0; color: #94a3b8; font-size: 13px; text-align: center;">
                Simply sign in with <a href="mailto:${invitedEmail}" style="color: #34d399; font-weight: 600; text-decoration: none;">${invitedEmail}</a> to join the team.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #0f172a; border-top: 1px solid #334155; padding: 24px; text-align: center;">
              <p style="margin: 0 0 8px; color: #64748b; font-size: 12px;">
                Mindy • GovCon Giants
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

  const schema = await ensureAppWorkspaceSchema();
  if (!schema.ready) return NextResponse.json({ success: false, error: schema.error }, { status: 500 });

  // Member role change: { action: 'set_role', member_id, role }. Owner/admin
  // only; the active workspace is resolved from the caller's membership so a
  // user can only mutate members of their OWN team.
  if (body.action === 'set_role') {
    return setMemberRole(email, String(body.member_id || ''), String(body.role || ''));
  }

  // Workspace-level defaults (shared by all members), saved to
  // mi_beta_workspace_settings — NOT the caller's personal settings row.
  // Owner/admin only.
  if (body.action === 'workspace_defaults') {
    return saveWorkspaceDefaults(email, {
      company_name: body.company_name ?? null,
      naics_codes: Array.isArray(body.naics_codes) ? body.naics_codes : [],
      target_agencies: Array.isArray(body.target_agencies) ? body.target_agencies : [],
    });
  }

  const workspaceId = getWorkspaceId(email);
  // DISPLAY FIELDS ONLY. Targeting (naics_codes, target_agencies, psc, keywords,
  // states) is OWNED by user_notification_settings — the table alerts/feed/briefings
  // read. We deliberately do NOT write targeting here anymore: writing it to BOTH
  // tables created a stale second copy that could disagree with what alerts use, and
  // showed users a different profile than their alerts (Eric QC 2026-06-16, launch
  // consistency pass). mi_beta_user_settings now carries name/role/company + the
  // workspace-display flags only.
  const updates = {
    workspace_id: workspaceId,
    user_email: email,
    company_name: body.company_name || null,
    display_name: body.display_name || null,
    role_title: body.role_title || null,
    email_frequency: body.email_frequency || 'daily',
    onboarding_completed: Boolean(body.onboarding_completed),
    two_factor_required: body.two_factor_required !== false,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await getAppSupabase()
    .from('mi_beta_user_settings')
    .upsert(updates, { onConflict: 'user_email' })
    .select()
    .single();

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  await recordAppActivity({
    workspaceId,
    userEmail: email,
    actorEmail: email,
    entityType: 'settings',
    action: 'updated',
    summary: body.onboarding_completed ? 'Completed onboarding' : 'Updated unified settings',
  });

  return NextResponse.json({ success: true, settings: data });
}

// Save workspace-level defaults (one row per workspace, shared by all members).
// Owner/admin only. The active workspace is resolved from the caller's
// membership so they can only edit their own team's defaults.
async function saveWorkspaceDefaults(
  callerEmail: string,
  defaults: { company_name: string | null; naics_codes: string[]; target_agencies: string[] }
) {
  const { workspaceId, member: caller } = await ensureWorkspaceMember(callerEmail);
  if (!['owner', 'admin'].includes(caller?.role)) {
    return NextResponse.json({ success: false, error: 'Only owners and admins can edit workspace defaults' }, { status: 403 });
  }

  const { data, error } = await getAppSupabase()
    .from('mi_beta_workspace_settings')
    .upsert({
      workspace_id: workspaceId,
      company_name: defaults.company_name,
      default_naics_codes: defaults.naics_codes,
      default_agencies: defaults.target_agencies,
      updated_by: callerEmail,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'workspace_id' })
    .select()
    .single();

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  // SEED each member's REAL targeting (user_notification_settings) with the workspace
  // defaults — so the defaults actually affect alerts, not just the display (Eric, launch
  // pass). NO-CLOBBER: only seed members who have NO naics_codes of their own; never
  // overwrite a member who's tuned their own profile. Non-fatal on error.
  if (defaults.naics_codes.length > 0 || defaults.target_agencies.length > 0) {
    try {
      const sb = getAppSupabase();
      const { data: members } = await sb
        .from('mi_beta_team_members')
        .select('user_email')
        .eq('workspace_id', workspaceId)
        .eq('status', 'active');
      for (const m of (members || []) as Array<{ user_email: string }>) {
        const memberEmail = String(m.user_email || '').toLowerCase().trim();
        if (!memberEmail) continue;
        const { data: cur } = await sb
          .from('user_notification_settings')
          .select('user_email, naics_codes')
          .eq('user_email', memberEmail)
          .maybeSingle();
        const hasOwn = Array.isArray(cur?.naics_codes) && cur!.naics_codes.length > 0;
        if (hasOwn) continue; // never clobber a tuned profile
        const patch = {
          naics_codes: defaults.naics_codes,
          agencies: defaults.target_agencies,
          alerts_enabled: true,
          updated_at: new Date().toISOString(),
        };
        if (cur) {
          await sb.from('user_notification_settings').update(patch).eq('user_email', memberEmail);
        } else {
          await sb.from('user_notification_settings').insert({ user_email: memberEmail, ...patch });
        }
      }
    } catch (e) {
      console.warn('[workspace_defaults] member seed failed (non-fatal):', e instanceof Error ? e.message : e);
    }
  }

  await recordAppActivity({
    workspaceId,
    userEmail: callerEmail,
    actorEmail: callerEmail,
    entityType: 'settings',
    action: 'workspace_defaults_updated',
    summary: 'Updated workspace defaults',
  });

  return NextResponse.json({
    success: true,
    workspaceSettings: {
      company_name: data.company_name,
      naics_codes: data.default_naics_codes,
      target_agencies: data.default_agencies,
    },
  });
}

const ASSIGNABLE_ROLES = ['admin', 'member', 'viewer'];

// Promote / demote a teammate. Owner/admin only. Cannot change the workspace
// owner's role, and only an owner can grant 'admin'.
async function setMemberRole(callerEmail: string, memberId: string, role: string) {
  if (!memberId || !ASSIGNABLE_ROLES.includes(role)) {
    return NextResponse.json({ success: false, error: 'member_id and a valid role are required' }, { status: 400 });
  }

  const { workspaceId, member: caller } = await ensureWorkspaceMember(callerEmail);
  if (!['owner', 'admin'].includes(caller?.role)) {
    return NextResponse.json({ success: false, error: 'Only owners and admins can change roles' }, { status: 403 });
  }
  if (role === 'admin' && caller.role !== 'owner') {
    return NextResponse.json({ success: false, error: 'Only the owner can grant admin' }, { status: 403 });
  }

  const supabase = getAppSupabase();
  const { data: target } = await supabase
    .from('mi_beta_team_members')
    .select('*')
    .eq('id', memberId)
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  if (!target) return NextResponse.json({ success: false, error: 'Member not found in your workspace' }, { status: 404 });
  if (target.role === 'owner') {
    return NextResponse.json({ success: false, error: 'The workspace owner role cannot be changed' }, { status: 403 });
  }

  const { data, error } = await supabase
    .from('mi_beta_team_members')
    .update({ role, updated_at: new Date().toISOString() })
    .eq('id', memberId)
    .select()
    .single();

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  await recordAppActivity({
    workspaceId,
    userEmail: callerEmail,
    actorEmail: callerEmail,
    entityType: 'team_member',
    entityId: memberId,
    action: 'role_changed',
    summary: `Changed ${target.user_email}'s role to ${role}`,
  });

  return NextResponse.json({ success: true, member: data });
}

// Remove a teammate / cancel a pending invite. Owner/admin only. Cannot remove
// the workspace owner.
export async function DELETE(request: NextRequest) {
  const email = normalizeEmail(String(request.nextUrl.searchParams.get('email') || ''));
  const memberId = String(request.nextUrl.searchParams.get('member_id') || '');
  if (!email || !memberId) {
    return NextResponse.json({ success: false, error: 'email and member_id are required' }, { status: 400 });
  }

  const authSession = requireMIAuthSession(request, email);
  if (!authSession.ok) return authSession.response;

  const schema = await ensureAppWorkspaceSchema();
  if (!schema.ready) return NextResponse.json({ success: false, error: schema.error }, { status: 500 });

  const { workspaceId, member: caller } = await ensureWorkspaceMember(email);
  if (!['owner', 'admin'].includes(caller?.role)) {
    return NextResponse.json({ success: false, error: 'Only owners and admins can remove members' }, { status: 403 });
  }

  const supabase = getAppSupabase();
  const { data: target } = await supabase
    .from('mi_beta_team_members')
    .select('*')
    .eq('id', memberId)
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  if (!target) return NextResponse.json({ success: false, error: 'Member not found in your workspace' }, { status: 404 });
  if (target.role === 'owner') {
    return NextResponse.json({ success: false, error: 'The workspace owner cannot be removed' }, { status: 403 });
  }

  const { error } = await supabase
    .from('mi_beta_team_members')
    .delete()
    .eq('id', memberId)
    .eq('workspace_id', workspaceId);

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  await recordAppActivity({
    workspaceId,
    userEmail: email,
    actorEmail: email,
    entityType: 'team_member',
    entityId: memberId,
    action: target.status === 'invited' ? 'invite_revoked' : 'removed',
    summary: target.status === 'invited'
      ? `Revoked invite for ${target.user_email}`
      : `Removed ${target.user_email} from the workspace`,
  });

  return NextResponse.json({ success: true });
}
