/**
 * Team monthly funding: Stripe subscription → explicit organization → pool grant.
 *
 * PR 4B. This is the seam that puts money INTO a pool; PR 3 proved money can come out
 * of one atomically. Nothing here provisions an organization — an org and its pool are
 * created explicitly (never inferred), and this function funds one that already exists.
 *
 * ── SUBSCRIPTION-KEYED, NEVER EMAIL-KEYED ────────────────────────────────────
 * The grant resolves Stripe subscription → `organizations.stripe_subscription_id` →
 * pool. It never looks up an org by email. Measured 2026-09-08: the one live Team
 * subscriber holds TWO Stripe customer records with TWO active subscriptions under a
 * single email (Team $499 + Pro $149). Email cannot distinguish those, so an
 * email-keyed grant would either double-grant or fund the wrong plan's amount.
 *
 * ── NO PERSONAL FALLBACK, NO MIGRATION ──────────────────────────────────────
 * A Team member's personal `mcp_credit_balance` is untouched by everything here. Pool
 * credits and personal credits are separate money; a member who had personal credits
 * before their org was provisioned still has exactly those credits afterwards.
 *
 * ⚠️ TEAM_MONTHLY_CREDITS IS STILL 1,000. The 6,000 target waits for the production
 * read-back (PR 5) that can prove a pool exists and holds what we say it holds.
 */
import Stripe from 'stripe';
import { getWriteClient, getReadClient } from '@/lib/supabase/server-clients';
import { TEAM_MONTHLY_CREDITS } from './packages';

/** Stripe unit_amount values that mean "Team plan". Cents. Mirrors payer.ts. */
const TEAM_AMOUNTS = new Set([49900, 499000]);

/** Ledger reason for a Team pool grant — distinct from personal `pro_monthly`. */
export const TEAM_GRANT_REASON = 'team_monthly';

/**
 * The idempotency key. Subscription + calendar month.
 *
 * Exported so tests and the cron use the SAME construction — a key built two ways is
 * a key that eventually differs, and a differing key double-grants.
 */
export function teamGrantKey(subscriptionId: string, yyyyMm: string): string {
  return `team:${subscriptionId}:${yyyyMm}`;
}

export interface TeamGrantOutcome {
  subscriptionId: string;
  orgId?: string;
  poolId?: string;
  applied: boolean;
  amount: number;
  newBalance?: number;
  /** Why nothing was granted, when applied === false. */
  skipped?: 'no_org_linked' | 'no_pool' | 'already_granted' | 'not_team_price';
  error?: string;
}

/**
 * Fund the pool for ONE active Team subscription.
 *
 * Every skip reason is NAMED rather than collapsed into a silent no-op: "we did not
 * grant" and "we granted 0" are different facts, and an operator needs to know which
 * happened. A missing org or pool is a PROVISIONING GAP that should be visible, not
 * an outcome to swallow.
 */
export async function grantTeamPool(
  subscriptionId: string,
  planAmount: number,
  yyyyMm: string,
  actor = 'system:team-monthly',
): Promise<TeamGrantOutcome> {
  const amount = TEAM_MONTHLY_CREDITS;
  const base: TeamGrantOutcome = { subscriptionId, applied: false, amount };

  // Guard: only Team-priced subscriptions fund a Team pool. A Pro subscription that
  // somehow reached here must not silently fund an org.
  if (!TEAM_AMOUNTS.has(planAmount)) return { ...base, skipped: 'not_team_price' };
  if (amount <= 0) return { ...base, skipped: 'already_granted' };

  const read = getReadClient();

  // Subscription → organization. The ONLY resolution path.
  const { data: org, error: oErr } = await read
    .from('organizations')
    .select('id, name')
    .eq('stripe_subscription_id', subscriptionId)
    .maybeSingle();
  if (oErr) return { ...base, error: `organizations lookup failed: ${oErr.message}` };
  if (!org) return { ...base, skipped: 'no_org_linked' };

  // Organization → pool. Not auto-created: a pool is provisioned explicitly, so its
  // absence is a gap an operator should see rather than something this path papers over.
  const { data: pool, error: pErr } = await read
    .from('mcp_credit_pool')
    .select('pool_id')
    .eq('org_id', org.id)
    .maybeSingle();
  if (pErr) return { ...base, orgId: org.id, error: `pool lookup failed: ${pErr.message}` };
  if (!pool) return { ...base, orgId: org.id, skipped: 'no_pool' };

  const { data, error } = await getWriteClient().rpc('mcp_grant_pool_once', {
    p_key: teamGrantKey(subscriptionId, yyyyMm),
    p_pool_id: pool.pool_id,
    p_amount: amount,
    p_reason: TEAM_GRANT_REASON,
    p_actor: actor,
  });
  if (error) return { ...base, orgId: org.id, poolId: pool.pool_id, error: `grant failed: ${error.message}` };

  const row = Array.isArray(data) ? data[0] : data;
  const applied = Boolean(row?.applied);
  return {
    ...base,
    orgId: org.id,
    poolId: pool.pool_id,
    applied,
    newBalance: Number(row?.new_balance ?? 0),
    skipped: applied ? undefined : 'already_granted',
  };
}

/**
 * Enumerate ACTIVE Team subscriptions from Stripe and fund each linked pool.
 *
 * Surfaces (never swallows) a Stripe failure: a month where we could not read
 * subscriptions must be visibly broken, not quietly a zero-grant run.
 */
export async function grantAllTeamPools(yyyyMm: string): Promise<{
  outcomes: TeamGrantOutcome[];
  stripeError: string | null;
}> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return { outcomes: [], stripeError: 'STRIPE_SECRET_KEY missing' };

  const stripe = new Stripe(key);
  const outcomes: TeamGrantOutcome[] = [];
  try {
    for await (const s of stripe.subscriptions.list({ status: 'active', limit: 100 })) {
      const amt = s.items.data[0]?.price?.unit_amount ?? 0;
      if (!TEAM_AMOUNTS.has(amt)) continue;
      outcomes.push(await grantTeamPool(s.id, amt, yyyyMm));
    }
  } catch (e) {
    return { outcomes, stripeError: (e as Error).message || 'stripe enumeration failed' };
  }
  return { outcomes, stripeError: null };
}
