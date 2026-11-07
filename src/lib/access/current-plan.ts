/**
 * The signed-in user's plan + credit balance, for header chips and the pricing page.
 *
 * Tier logic mirrors /api/access/check (verifyMIAccess, promoted to 'pro' by resolveAccess trials).
 * Credits come from mcp_credit_balance. A failed read is `null` ("unknown"), never 0 — a missing row
 * is a real 0 (no credits yet).
 */
import { verifyMIAccess } from '@/lib/api-auth';
import { resolveAccess } from '@/lib/access/resolve-access';
import { tierAtLeast } from '@/lib/access/tier-rank';
import { getWriteClient } from '@/lib/supabase/server-clients';

export type PlanId = 'free' | 'pro' | 'team' | 'enterprise';

export const PLAN_LABEL: Record<PlanId, string> = {
  free: 'Free',
  pro: 'Pro',
  team: 'Team',
  enterprise: 'Enterprise',
};

export async function resolvePlan(email: string): Promise<PlanId> {
  const [access, resolved] = await Promise.all([verifyMIAccess(email, true), resolveAccess(email)]);
  let tier = access.tier;
  if (resolved.level === 'pro' && !tierAtLeast(tier, 'team')) tier = 'pro';
  return tier === 'none' ? 'free' : tier;
}

export async function readCreditBalance(email: string): Promise<number | null> {
  try {
    const { data, error } = await getWriteClient()
      .from('mcp_credit_balance')
      .select('balance')
      .eq('user_email', email.toLowerCase())
      .maybeSingle();
    if (error) return null;
    return typeof data?.balance === 'number' ? data.balance : 0;
  } catch {
    return null;
  }
}
