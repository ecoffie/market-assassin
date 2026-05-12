import { NextRequest, NextResponse } from 'next/server';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import {
  ensureMIBetaWorkspaceSchema,
  getMIBetaSupabase,
  normalizeEmail,
} from '@/lib/mi-beta/workspace';

/**
 * GET /api/mi-beta/workspaces
 * Returns all workspaces the user is a member of (for workspace switcher)
 */
export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email')?.toLowerCase().trim();
  if (!email) {
    return NextResponse.json({ success: false, error: 'Email is required' }, { status: 400 });
  }

  const authSession = requireMIAuthSession(request, email);
  if (!authSession.ok) return authSession.response;

  const schema = await ensureMIBetaWorkspaceSchema();
  if (!schema.ready) {
    return NextResponse.json({ success: false, error: schema.error }, { status: 500 });
  }

  const normalizedEmail = normalizeEmail(email);
  const supabase = getMIBetaSupabase();

  // Get all workspaces where user is a member
  const { data: memberships, error } = await supabase
    .from('mi_beta_team_members')
    .select('workspace_id, role, status, accepted_at')
    .eq('user_email', normalizedEmail)
    .order('accepted_at', { ascending: true });

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  // Enrich each workspace with member count and name
  interface WorkspaceMembership {
    workspace_id: string;
    role: 'owner' | 'admin' | 'member' | 'viewer';
    status: 'active' | 'invited';
    accepted_at: string | null;
  }

  const workspaces = await Promise.all(
    (memberships || []).map(async (membership: WorkspaceMembership) => {
      // Get member count for this workspace
      const { count } = await supabase
        .from('mi_beta_team_members')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', membership.workspace_id)
        .eq('status', 'active');

      // Determine workspace display name
      const isPersonal = membership.workspace_id.includes('@');
      const displayName = isPersonal
        ? 'Personal'
        : formatWorkspaceName(membership.workspace_id);

      return {
        id: membership.workspace_id,
        name: displayName,
        role: membership.role,
        status: membership.status,
        memberCount: count || 1,
        isPersonal,
        acceptedAt: membership.accepted_at,
      };
    })
  );

  // Sort: personal first, then by name
  workspaces.sort((a, b) => {
    if (a.isPersonal && !b.isPersonal) return -1;
    if (!a.isPersonal && b.isPersonal) return 1;
    return a.name.localeCompare(b.name);
  });

  return NextResponse.json({
    success: true,
    workspaces,
    count: workspaces.length,
  });
}

/**
 * Format workspace ID into a display name
 * "acme.com" -> "Acme"
 * "booz-allen.com" -> "Booz Allen"
 */
function formatWorkspaceName(workspaceId: string): string {
  // Remove .com, .org, etc.
  const name = workspaceId.replace(/\.(com|org|net|gov|edu|io|co)$/i, '');

  // Split on hyphens/underscores, capitalize each word
  return name
    .split(/[-_]/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}
