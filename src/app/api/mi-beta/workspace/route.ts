import { NextRequest, NextResponse } from 'next/server';
import { requireMIAuthSession } from '@/lib/two-factor-session';
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

  return NextResponse.json({ success: true, member: data });
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
