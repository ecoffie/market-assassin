/**
 * Member grants — the shared logic behind the self-serve admin Members page.
 *
 * Lets any logged-in STAFF member (see getStaffRole) grant or revoke Pro / Team
 * access for a user without touching SQL or code. Mirrors what the Stripe webhook
 * does on a real purchase (updateAccessFlags / grantBriefingsAccess /
 * provisionTeamWorkspace) so a manual grant behaves identically to a paid one.
 *
 * Tiers:
 *   - 'pro'  → user_profiles.access_briefings = true  (+ KV briefings key)
 *   - 'team' → access_team = true (superset of Pro: also sets access_briefings)
 *              and provisions the shared team workspace + seats.
 *
 * Every grant/revoke is written to mi_admin_grants for an audit trail.
 */
import { createClient } from '@supabase/supabase-js';
import { grantBriefingsAccess, revokeBriefingsAccess } from '@/lib/briefings/access';
import { provisionTeamWorkspace } from '@/lib/app/workspace';

export type GrantTier = 'pro' | 'team';
export type GrantAction = 'grant' | 'revoke';

export interface MemberStatus {
  email: string;
  found: boolean;
  accessBriefings: boolean; // Pro
  accessTeam: boolean; // Team
  tier: 'free' | 'pro' | 'team';
}

export interface GrantResult {
  success: boolean;
  email: string;
  tier: GrantTier;
  action: GrantAction;
  status: MemberStatus;
  welcomeEmailSent: boolean;
  message: string;
  error?: string;
}

export interface GrantLogEntry {
  target_email: string;
  actor_email: string;
  action: GrantAction;
  tier: GrantTier;
  sent_welcome: boolean;
  created_at: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getSupabase(): any | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function normalize(email: string): string {
  return email.toLowerCase().trim();
}

function deriveTier(accessTeam: boolean, accessBriefings: boolean): MemberStatus['tier'] {
  if (accessTeam) return 'team';
  if (accessBriefings) return 'pro';
  return 'free';
}

/** Create the audit table on first use. Best-effort — a failure here never blocks a grant. */
export async function ensureGrantsAuditSchema(): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  // Fast path: table already there.
  const { error } = await supabase.from('mi_admin_grants').select('id').limit(1);
  if (!error || error.code !== '42P01') return;

  await supabase.rpc('exec_migration', {
    sql_query: `
      CREATE TABLE IF NOT EXISTS mi_admin_grants (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        target_email TEXT NOT NULL,
        actor_email TEXT NOT NULL,
        action TEXT NOT NULL,
        tier TEXT NOT NULL,
        sent_welcome BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_mi_admin_grants_created ON mi_admin_grants(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_mi_admin_grants_target ON mi_admin_grants(target_email);
    `,
  });
}

/** Read the current Pro/Team state for an email. */
export async function getMemberStatus(email: string): Promise<MemberStatus> {
  const normalized = normalize(email);
  const supabase = getSupabase();
  if (!supabase) {
    return { email: normalized, found: false, accessBriefings: false, accessTeam: false, tier: 'free' };
  }
  const { data } = await supabase
    .from('user_profiles')
    .select('email, access_briefings, access_team')
    .eq('email', normalized)
    .maybeSingle();

  const accessBriefings = !!data?.access_briefings;
  const accessTeam = !!data?.access_team;
  return {
    email: normalized,
    found: !!data,
    accessBriefings,
    accessTeam,
    tier: deriveTier(accessTeam, accessBriefings),
  };
}

/**
 * Apply a set of boolean access-flag updates to a user_profiles row.
 * user_profiles has no unique constraint on email, so we select-then-update,
 * inserting a fresh row only when we're turning something ON.
 */
async function applyProfileFlags(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  email: string,
  updates: Record<string, boolean>,
): Promise<{ error?: string }> {
  const { data: existing } = await supabase
    .from('user_profiles')
    .select('email')
    .eq('email', email)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from('user_profiles')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('email', email);
    return { error: error?.message };
  }

  // No row yet. Only worth creating one if we're granting (any flag true).
  if (Object.values(updates).some(Boolean)) {
    const { error } = await supabase.from('user_profiles').insert({ email, ...updates });
    return { error: error?.message };
  }
  return {}; // nothing to revoke
}

async function recordGrant(entry: {
  targetEmail: string;
  actorEmail: string;
  action: GrantAction;
  tier: GrantTier;
  sentWelcome: boolean;
}): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  try {
    await supabase.from('mi_admin_grants').insert({
      target_email: entry.targetEmail,
      actor_email: entry.actorEmail,
      action: entry.action,
      tier: entry.tier,
      sent_welcome: entry.sentWelcome,
    });
  } catch (err) {
    console.error('[member-grants] failed to record audit row:', err);
  }
}

/**
 * Grant or revoke Pro/Team for `targetEmail`, performed by `actorEmail` (staff).
 * Sends the welcome email on grant when sendWelcome is true. Always audited.
 */
export async function applyMemberGrant(opts: {
  targetEmail: string;
  actorEmail: string;
  tier: GrantTier;
  action: GrantAction;
  sendWelcome?: boolean;
  customerName?: string;
}): Promise<GrantResult> {
  const email = normalize(opts.targetEmail);
  const granting = opts.action === 'grant';
  const supabase = getSupabase();
  if (!supabase) {
    const status = await getMemberStatus(email);
    return {
      success: false, email, tier: opts.tier, action: opts.action, status,
      welcomeEmailSent: false, message: 'Supabase not configured', error: 'Supabase not configured',
    };
  }

  await ensureGrantsAuditSchema();

  // 1) Flip the profile flags.
  const updates: Record<string, boolean> =
    opts.tier === 'team'
      // Team is a superset of Pro: granting sets both; revoking only drops the
      // team flag (they fall back to whatever Pro/underlying access they had).
      ? (granting ? { access_team: true, access_briefings: true } : { access_team: false })
      : { access_briefings: granting };

  const { error: flagError } = await applyProfileFlags(supabase, email, updates);
  if (flagError) {
    const status = await getMemberStatus(email);
    return {
      success: false, email, tier: opts.tier, action: opts.action, status,
      welcomeEmailSent: false, message: `Failed to update access: ${flagError}`, error: flagError,
    };
  }

  // 2) Sync the KV briefings gate (the fast Pro check) to match the flag.
  try {
    if (opts.tier === 'pro') {
      if (granting) await grantBriefingsAccess(email);
      else await revokeBriefingsAccess(email);
    } else if (opts.tier === 'team' && granting) {
      await grantBriefingsAccess(email);
    }
    // Team revoke intentionally leaves the briefings KV alone (see updates above).
  } catch (err) {
    console.error('[member-grants] KV briefings sync failed (non-fatal):', err);
  }

  // 3) Team grant also provisions the shared workspace + seats.
  if (opts.tier === 'team' && granting) {
    try {
      await provisionTeamWorkspace(email);
    } catch (err) {
      console.error('[member-grants] provisionTeamWorkspace failed (non-fatal):', err);
    }
  }

  // 4) Welcome email on grant (best-effort).
  let welcomeEmailSent = false;
  if (granting && opts.sendWelcome) {
    try {
      const { sendMarketIntelligenceWelcomeEmail } = await import('@/lib/send-email');
      welcomeEmailSent = await sendMarketIntelligenceWelcomeEmail({ to: email, customerName: opts.customerName });
    } catch (err) {
      console.error('[member-grants] welcome email failed (non-fatal):', err);
    }
  }

  // 5) Audit.
  await recordGrant({
    targetEmail: email,
    actorEmail: normalize(opts.actorEmail),
    action: opts.action,
    tier: opts.tier,
    sentWelcome: welcomeEmailSent,
  });

  const status = await getMemberStatus(email);
  const tierLabel = opts.tier === 'team' ? 'Team' : 'Pro';
  return {
    success: true,
    email,
    tier: opts.tier,
    action: opts.action,
    status,
    welcomeEmailSent,
    message: granting
      ? `${tierLabel} access GRANTED to ${email}.${welcomeEmailSent ? ' Welcome email sent.' : ''} They'll see it on next sign-in / refresh.`
      : `${tierLabel} access REVOKED for ${email}. Takes effect on their next page load.`,
  };
}

/** Recent grant/revoke activity for the audit panel. */
export async function getRecentGrants(limit = 25): Promise<GrantLogEntry[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  await ensureGrantsAuditSchema();
  const { data, error } = await supabase
    .from('mi_admin_grants')
    .select('target_email, actor_email, action, tier, sent_welcome, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data || []) as GrantLogEntry[];
}
