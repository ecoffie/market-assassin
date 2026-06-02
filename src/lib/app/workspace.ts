import { createClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _supabase: any = null;
export function getAppSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _supabase;
}

export function normalizeEmail(email: string) {
  return email.toLowerCase().trim();
}

export function getWorkspaceId(email: string) {
  const normalized = normalizeEmail(email);
  const domain = normalized.split('@')[1] || normalized;
  const personalDomains = new Set(['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'aol.com']);
  return personalDomains.has(domain) ? normalized : domain;
}

export async function ensureAppWorkspaceSchema() {
  const supabase = getAppSupabase();
  const { error } = await supabase.from('mi_beta_team_members').select('id').limit(1);
  if (!error || error.code !== '42P01') return { ready: true };

  const { error: migrationError } = await supabase.rpc('exec_migration', {
    sql_query: `
      CREATE TABLE IF NOT EXISTS mi_beta_team_members (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id TEXT NOT NULL,
        user_email TEXT NOT NULL,
        invited_email TEXT,
        role TEXT NOT NULL DEFAULT 'member',
        status TEXT NOT NULL DEFAULT 'active',
        invited_by TEXT,
        invited_at TIMESTAMPTZ DEFAULT NOW(),
        accepted_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        CONSTRAINT unique_mi_beta_team_member UNIQUE (workspace_id, user_email)
      );

      CREATE TABLE IF NOT EXISTS mi_beta_user_settings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id TEXT NOT NULL,
        user_email TEXT NOT NULL,
        company_name TEXT,
        display_name TEXT,
        role_title TEXT,
        naics_codes TEXT[],
        target_agencies TEXT[],
        email_frequency TEXT DEFAULT 'daily',
        onboarding_completed BOOLEAN DEFAULT false,
        two_factor_required BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        CONSTRAINT unique_mi_beta_user_settings UNIQUE (user_email)
      );

      CREATE TABLE IF NOT EXISTS mi_beta_workspace_settings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id TEXT NOT NULL,
        company_name TEXT,
        default_naics_codes TEXT[],
        default_agencies TEXT[],
        updated_by TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        CONSTRAINT unique_mi_beta_workspace_settings UNIQUE (workspace_id)
      );

      CREATE TABLE IF NOT EXISTS mi_beta_activity (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id TEXT NOT NULL,
        user_email TEXT NOT NULL,
        actor_email TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT,
        action TEXT NOT NULL,
        summary TEXT NOT NULL,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS mi_beta_market_focuses (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id TEXT NOT NULL,
        user_email TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        filters JSONB NOT NULL DEFAULT '{}'::jsonb,
        is_default BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      ALTER TABLE user_pipeline ADD COLUMN IF NOT EXISTS workspace_id TEXT;
      ALTER TABLE user_pipeline ADD COLUMN IF NOT EXISTS owner_email TEXT;
      ALTER TABLE user_pipeline ADD COLUMN IF NOT EXISTS created_by TEXT;
      ALTER TABLE user_pipeline ADD COLUMN IF NOT EXISTS updated_by TEXT;
      ALTER TABLE user_teaming_partners ADD COLUMN IF NOT EXISTS workspace_id TEXT;
      ALTER TABLE user_teaming_partners ADD COLUMN IF NOT EXISTS owner_email TEXT;
      ALTER TABLE user_teaming_partners ADD COLUMN IF NOT EXISTS created_by TEXT;
      ALTER TABLE user_teaming_partners ADD COLUMN IF NOT EXISTS updated_by TEXT;

      CREATE TABLE IF NOT EXISTS mi_beta_comments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id TEXT NOT NULL,
        pipeline_id UUID REFERENCES user_pipeline(id) ON DELETE CASCADE,
        user_email TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_mi_beta_team_workspace ON mi_beta_team_members(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_mi_beta_settings_workspace ON mi_beta_user_settings(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_mi_beta_activity_workspace ON mi_beta_activity(workspace_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_mi_beta_market_focuses_workspace ON mi_beta_market_focuses(workspace_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_mi_beta_market_focuses_user ON mi_beta_market_focuses(user_email, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_pipeline_workspace ON user_pipeline(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_teaming_workspace ON user_teaming_partners(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_mi_beta_comments_pipeline ON mi_beta_comments(pipeline_id, created_at DESC);
    `,
  });

  return { ready: !migrationError, error: migrationError?.message };
}

export async function ensureWorkspaceMember(email: string) {
  const normalized = normalizeEmail(email);
  const personalWorkspaceId = getWorkspaceId(normalized);
  await ensureAppWorkspaceSchema();

  const supabase = getAppSupabase();

  // Look at ALL of this user's memberships, not just their personal workspace.
  // A user invited to someone else's team has a row in THAT team's workspace
  // (keyed by the team's domain), which getWorkspaceId(theirEmail) would never
  // return. Without this, cross-domain invitees always landed in their own
  // personal workspace and the invite was never accepted.
  const { data: memberships } = await supabase
    .from('mi_beta_team_members')
    .select('*')
    .eq('user_email', normalized)
    .order('created_at', { ascending: true });

  const all = (memberships || []) as Array<{
    workspace_id: string;
    status: string;
    role: string;
    id: string;
  }>;

  // Pending invite to a TEAM workspace (i.e. not the user's own personal one).
  // Accept it: flip invited -> active, stamp accepted_at, and make that team
  // the user's active workspace.
  const pendingTeamInvite = all.find(
    (m) => m.status === 'invited' && m.workspace_id !== personalWorkspaceId
  );
  if (pendingTeamInvite) {
    const { data: accepted } = await supabase
      .from('mi_beta_team_members')
      .update({ status: 'active', accepted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', pendingTeamInvite.id)
      .select()
      .single();
    return { workspaceId: pendingTeamInvite.workspace_id, member: accepted || pendingTeamInvite };
  }

  // Already an ACTIVE member of a team workspace — prefer that over personal.
  const activeTeam = all.find(
    (m) => m.status === 'active' && m.workspace_id !== personalWorkspaceId
  );
  if (activeTeam) {
    return { workspaceId: activeTeam.workspace_id, member: activeTeam };
  }

  // Existing membership in the personal workspace — return it as-is.
  const personal = all.find((m) => m.workspace_id === personalWorkspaceId);
  if (personal) return { workspaceId: personalWorkspaceId, member: personal };

  // Brand-new user: create their personal workspace. First member of a fresh
  // workspace is the owner.
  const { data: teamMembers } = await supabase
    .from('mi_beta_team_members')
    .select('id')
    .eq('workspace_id', personalWorkspaceId)
    .limit(1);

  const role = teamMembers && teamMembers.length > 0 ? 'member' : 'owner';
  const { data: member } = await supabase
    .from('mi_beta_team_members')
    .upsert({
      workspace_id: personalWorkspaceId,
      user_email: normalized,
      role,
      status: 'active',
      accepted_at: new Date().toISOString(),
    }, { onConflict: 'workspace_id,user_email' })
    .select()
    .single();

  return { workspaceId: personalWorkspaceId, member };
}

export async function recordAppActivity({
  workspaceId,
  userEmail,
  actorEmail,
  entityType,
  entityId,
  action,
  summary,
  metadata,
}: {
  workspaceId: string;
  userEmail: string;
  actorEmail: string;
  entityType: string;
  entityId?: string;
  action: string;
  summary: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    await getAppSupabase().from('mi_beta_activity').insert({
      workspace_id: workspaceId,
      user_email: normalizeEmail(userEmail),
      actor_email: normalizeEmail(actorEmail),
      entity_type: entityType,
      entity_id: entityId,
      action,
      summary,
      metadata: metadata || {},
    });
  } catch (error) {
    console.error('[MI Beta Activity] Failed to record activity:', error);
  }
}
