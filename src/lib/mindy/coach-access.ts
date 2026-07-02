/**
 * My Clients / Coach Mode access — who can manage client workspaces.
 *
 * Public tier naming (PRD-public-tier-naming.md):
 * - Solopreneur (pro) = one business, no My Clients
 * - Teams / Enterprise = multi-client Coach mode included
 *
 * Grandfather: users who already have org_membership keep access on Pro
 * until they upgrade (Eric's solo-consultant flow).
 */
import { createClient } from '@supabase/supabase-js';
import { verifyMIAccess, type MIAccessTier } from '@/lib/api-auth';

export type CoachAccessReason = 'team' | 'enterprise' | 'staff' | 'org_member' | 'denied';

export interface CoachAccessResult {
  allowed: boolean;
  reason: CoachAccessReason;
  canAddClients: boolean;
  /** null = no practical cap (staff / enterprise) */
  maxClients: number | null;
  existingClientCount?: number;
  upgradeRequired?: 'team';
}

/** Client workspace caps — seat model for solo consultants on Teams. */
export const COACH_CLIENT_LIMITS = {
  team: 10,
  /** Grandfathered Pro org members get the same cap as Teams solo consultants. */
  grandfather: 10,
} as const;

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

async function countActiveClients(orgId: string): Promise<number> {
  const supabase = getSupabase();
  const { count } = await supabase
    .from('org_clients')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .eq('status', 'active');
  return count ?? 0;
}

export async function resolveCoachAccess(email: string): Promise<CoachAccessResult> {
  const normalized = email.toLowerCase().trim();
  const access = await verifyMIAccess(normalized);
  const tier = access.tier as MIAccessTier;

  if (access.isStaff) {
    return {
      allowed: true,
      reason: 'staff',
      canAddClients: true,
      maxClients: null,
    };
  }

  if (tier === 'enterprise') {
    return {
      allowed: true,
      reason: 'enterprise',
      canAddClients: true,
      maxClients: null,
    };
  }

  if (tier === 'team') {
    return {
      allowed: true,
      reason: 'team',
      canAddClients: true,
      maxClients: COACH_CLIENT_LIMITS.team,
    };
  }

  // Org member (coach/org_admin). Access + cap follow the ORG's tier, not just the
  // user's personal MI tier — an NCMBC/SBDC counselor on an enterprise-tier org gets
  // unlimited clients even though their personal login isn't "enterprise". This is
  // what makes the organizations.tier column meaningful (the white-label enterprise
  // deal). A consultant's auto-created solo org stays on the grandfather cap.
  const supabase = getSupabase();
  const { data: membership } = await supabase
    .from('org_members')
    .select('org_id, role')
    .eq('user_email', normalized)
    .eq('status', 'active')
    .in('role', ['coach', 'org_admin'])
    .maybeSingle();

  if (membership) {
    const { data: org } = await supabase
      .from('organizations')
      .select('tier')
      .eq('id', membership.org_id)
      .maybeSingle();
    const orgTier = (org?.tier as string) || 'pro';
    const existingClientCount = await countActiveClients(membership.org_id);
    // Enterprise org → unlimited; anything else → the grandfather/team cap.
    const maxClients = orgTier === 'enterprise' ? null : COACH_CLIENT_LIMITS.grandfather;
    return {
      allowed: true,
      reason: orgTier === 'enterprise' ? 'enterprise' : 'org_member',
      canAddClients: true,
      maxClients,
      existingClientCount,
    };
  }

  return {
    allowed: false,
    reason: 'denied',
    canAddClients: false,
    maxClients: null,
    upgradeRequired: 'team',
  };
}

/** Returns the access result when allowed; null when denied (for route guards). */
export async function requireCoachAccess(email: string): Promise<CoachAccessResult | null> {
  const result = await resolveCoachAccess(email);
  return result.allowed ? result : null;
}

export function coachAtClientLimit(
  access: CoachAccessResult,
  currentCount: number,
): boolean {
  if (!access.canAddClients) return true;
  if (access.maxClients == null) return false;
  return currentCount >= access.maxClients;
}
