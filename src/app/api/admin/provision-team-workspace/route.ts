/**
 * Admin: provision ONE shared Mindy Team workspace — an owner + members — and
 * (optionally) send each a setup invite. The user-facing invite POST requires the
 * caller to already be owner/admin (chicken-and-egg for the first owner), so the
 * initial org is provisioned here via service role.
 *
 * Writes, per the Team-workspace model:
 *   - mi_beta_team_members: one row per person (owner role for owner, member for
 *     the rest), status=active, all pointing at the OWNER's workspace_id.
 *   - mi_beta_user_settings.workspace_id = owner's workspace_id (+ access_team via
 *     user_profiles below) so each member resolves into the shared workspace.
 *   - user_profiles.access_team = true → verifyMIAccess() returns tier 'team'.
 *
 * The workspace_id is the OWNER's email when the owner is on a personal domain
 * (getWorkspaceId), so members on DIFFERENT domains (yahoo/aol/gmail) still join
 * the SAME workspace — they can't auto-group by domain.
 *
 * GET  ?password=...&owner=...                         → preview the plan
 * POST ?password=...  body { owner, members: [...], invite?: true }
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getWorkspaceId } from '@/lib/app/workspace';
import { sendSetupInvite } from '@/lib/mindy/account-setup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

function sb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
const norm = (e: string) => String(e || '').toLowerCase().trim();

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get('password') !== ADMIN_PASSWORD) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const owner = norm(request.nextUrl.searchParams.get('owner') || '');
  if (!owner) return NextResponse.json({ success: false, error: 'owner required' }, { status: 400 });
  const workspaceId = getWorkspaceId(owner);
  const supabase = sb();
  // AUDIT: show the actual provisioned state — every member in this workspace,
  // their role/status, their settings.workspace_id, and access_team. Proves they're
  // really one team (not just that writes returned ok).
  const { data: teamRows } = await supabase
    .from('mi_beta_team_members')
    .select('user_email, role, status')
    .eq('workspace_id', workspaceId)
    .order('role', { ascending: true });
  const audit: Record<string, unknown> = {};
  for (const r of (teamRows || []) as Array<{ user_email: string; role: string; status: string }>) {
    const [{ data: settings }, { data: prof }] = await Promise.all([
      supabase.from('mi_beta_user_settings').select('workspace_id').eq('user_email', r.user_email).maybeSingle(),
      supabase.from('user_profiles').select('access_team').eq('email', r.user_email).maybeSingle(),
    ]);
    audit[r.user_email] = {
      role: r.role,
      status: r.status,
      settings_workspace_id: settings?.workspace_id ?? null,
      in_owner_workspace: settings?.workspace_id === workspaceId,
      access_team: !!prof?.access_team,
    };
  }
  return NextResponse.json({
    success: true,
    workspaceId,
    memberCount: (teamRows || []).length,
    audit,
    note: 'POST { owner, members:[...], invite:true } to provision. Each member should show in_owner_workspace:true + access_team:true.',
  });
}

export async function POST(request: NextRequest) {
  if (request.nextUrl.searchParams.get('password') !== ADMIN_PASSWORD) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  let body: { owner?: string; members?: string[]; invite?: boolean };
  try { body = await request.json(); } catch { return NextResponse.json({ success: false, error: 'Bad JSON' }, { status: 400 }); }

  const owner = norm(body.owner || '');
  const members = (Array.isArray(body.members) ? body.members : []).map(norm).filter((e) => e && e !== owner);
  if (!owner) return NextResponse.json({ success: false, error: 'owner required' }, { status: 400 });

  const supabase = sb();
  const workspaceId = getWorkspaceId(owner);
  const did: Record<string, string> = {};

  // Everyone in the workspace, with their role.
  const people: Array<{ email: string; role: 'owner' | 'member' }> = [
    { email: owner, role: 'owner' },
    ...members.map((email) => ({ email, role: 'member' as const })),
  ];

  for (const { email, role } of people) {
    // 1. membership row (idempotent on workspace_id + user_email)
    const m = await supabase.from('mi_beta_team_members').upsert({
      workspace_id: workspaceId,
      user_email: email,
      role,
      status: 'active',
      invited_by: owner,
      accepted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'workspace_id,user_email' });

    // 2. per-user settings point at the shared workspace
    const { data: existing } = await supabase
      .from('mi_beta_user_settings').select('user_email').eq('user_email', email).maybeSingle();
    const sPayload = { user_email: email, workspace_id: workspaceId, updated_at: new Date().toISOString() };
    const s = existing
      ? await supabase.from('mi_beta_user_settings').update(sPayload).eq('user_email', email)
      : await supabase.from('mi_beta_user_settings').insert(sPayload);

    // 3. grant Team tier
    const { data: prof } = await supabase
      .from('user_profiles').select('email').eq('email', email).maybeSingle();
    const pPayload = { email, access_team: true, updated_at: new Date().toISOString() };
    const p = prof
      ? await supabase.from('user_profiles').update(pPayload).eq('email', email)
      : await supabase.from('user_profiles').insert(pPayload);

    did[email] = `member:${m.error ? 'ERR ' + m.error.message : 'ok'} settings:${s.error ? 'ERR ' + s.error.message : 'ok'} access_team:${p.error ? 'ERR ' + p.error.message : 'ok'}`;
  }

  // 4. optional setup invites
  const invites: Record<string, string> = {};
  if (body.invite) {
    for (const { email } of people) {
      try {
        const r = await sendSetupInvite(email, { tier: 'team' });
        invites[email] = `invited (${r.linkType})`;
      } catch (e) {
        invites[email] = `invite failed: ${e instanceof Error ? e.message : 'error'}`;
      }
    }
  }

  return NextResponse.json({
    success: true,
    workspaceId,
    owner,
    members,
    provisioned: did,
    invites: body.invite ? invites : 'skipped (pass invite:true to send)',
  });
}
