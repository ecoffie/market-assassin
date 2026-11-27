/** Production data sources for the research-answer daily cap (research-caps.ts). Every read is bounded and fails soft. */
import { getStaffRole, INTERNAL_TEAM_EMAILS } from '@/lib/access/staff-role';
import { verifyMIAccess } from '@/lib/api-auth';
import { resolveAccess } from '@/lib/access/resolve-access';
import { getWriteClient } from '@/lib/supabase/server-clients';
import { tierAtLeast } from '@/lib/access/tier-rank';
import { mcpPlanFromLedger, type CapDeps, type PlanFacts } from './research-caps';

export const researchCapDeps: CapDeps = {
  async facts(email): Promise<PlanFacts> {
    const e = email.trim().toLowerCase();
    const staff = getStaffRole(e) !== 'none' || INTERNAL_TEAM_EMAILS.has(e);
    if (staff) return { staff, appTier: 'none', access: { level: 'free', source: 'free' }, mcpPlan: null };
    const [mi, access, ledger] = await Promise.all([
      verifyMIAccess(e, true).catch(() => ({ tier: 'none' as const })),
      resolveAccess(e).catch(() => ({ level: 'free' as const, source: 'free' as const, trialEndsAt: null })),
      Promise.resolve(getWriteClient()
        .from('mcp_credit_ledger')
        .select('reason, delta, created_at')
        .eq('user_email', e)
        .in('reason', ['mcp_sub_monthly', 'mcp_sub_annual'])
        .gt('delta', 0)
        .order('created_at', { ascending: false })
        .limit(5))
        .then((r) => (r.error ? [] : (r.data ?? []) as Array<{ reason: string; delta: number; created_at: string }>))
        .catch(() => []),
    ]);
    const tier = (mi as { tier?: string }).tier;
    return {
      staff: false,
      appTier: tierAtLeast(tier, 'enterprise') ? 'enterprise' : tierAtLeast(tier, 'team') ? 'team' : tierAtLeast(tier, 'pro') ? 'pro' : 'none',
      access: { level: access.level, source: access.source },
      mcpPlan: mcpPlanFromLedger(ledger, Date.now()),
    };
  },
  async todaysTraces(email, sinceIso) {
    const { data, error } = await getWriteClient()
      .from('mindy_chat_messages')
      .select('trace, mindy_chat_sessions!inner(user_email)')
      // Case-insensitive exact match (stored emails are not guaranteed lowercase); LIKE wildcards escaped.
      .ilike('mindy_chat_sessions.user_email', email.trim().toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`))
      .eq('role', 'assistant')
      .eq('trace->>engine', 'research_mode')
      .gte('created_at', sinceIso)
      .limit(500);
    if (error) return null;
    return (data ?? []).map((r) => (r as { trace?: unknown }).trace);
  },
};
