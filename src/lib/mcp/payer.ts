/**
 * WHO PAYS for an MCP call — personal balance, or an organization pool?
 *
 * PR 3 of the Teams shared-MCP sequence. This module RESOLVES the payer and debits
 * it. It does not fund pools (PR 4), does not change the Team allowance, and does not
 * touch customer-facing copy.
 *
 * ── THE RESOLUTION RULE (exact, and deliberately refuses to guess) ───────────
 *   0 eligible orgs  → PERSONAL. Identical to today's behaviour, byte for byte.
 *   1 eligible org   → that organization's POOL.
 *   2+ eligible orgs → SELECTION REQUIRED. Refuse. Charge nothing.
 *
 * "Eligible" is a narrow, provable claim: the caller is an explicit `org_members` row
 * (status active) of an organization that is linked to an ACTIVE Team-priced Stripe
 * subscription AND already has a pool. Every one of those is a stored fact.
 *
 * ⚠️ MEMBERSHIP IS NEVER INFERRED FROM EMAIL DOMAIN. `getWorkspaceId()` derives a
 * workspace from the email domain, which is fine for content scoping and catastrophic
 * for billing: `proton.me` has 5 unrelated members and `xerox.com` has 3. Pooling a
 * paid allowance across strangers because they share a mail provider is the specific
 * failure this design exists to prevent. Only `org_members` rows count.
 *
 * ⚠️ MULTI-ORG NEVER PICKS THE FIRST ROW. Returning `organization_selection_required`
 * is the whole point: a silent first-row-wins would charge one company for another
 * company's work, and the ledger would look perfectly consistent while being wrong.
 * MCP carries no org context today (the OAuth token's `sub` is just an email), so
 * there is nothing to disambiguate with — and inventing a default would be a product
 * decision disguised as a resolver.
 *
 * ⚠️ NO CROSS-PAYER FALLBACK, EITHER DIRECTION. An empty pool does NOT fall through
 * to the actor's personal balance, and an empty personal balance does not reach into a
 * pool. Both would make provenance meaningless and spend someone's money without them
 * choosing it.
 */
import { getReadClient, getWriteClient } from '@/lib/supabase/server-clients';
import { debitCredits, type DebitResult } from './credits';

/** Stripe unit_amount values that mean "Team plan". Cents. */
const TEAM_AMOUNTS = new Set([49900, 499000]);

export type PayerKind = 'personal' | 'pool';

export interface PayerResolution {
  kind: PayerKind | 'selection_required';
  /** Set when kind === 'pool'. */
  poolId?: string;
  orgId?: string;
  orgName?: string;
  /** Set when kind === 'selection_required' — the orgs the user must choose between. */
  candidates?: { orgId: string; orgName: string }[];
}

/**
 * Resolve the payer for an authenticated MCP caller.
 *
 * Fails SAFE: any error resolving orgs returns `personal`, because the alternative —
 * blocking a paying user's call because an org lookup hiccuped — is strictly worse
 * than charging the balance they already had. The error is surfaced to logs, never
 * swallowed silently.
 */
export async function resolvePayer(userEmail: string): Promise<PayerResolution> {
  const email = userEmail.toLowerCase().trim();
  if (!email) return { kind: 'personal' };

  try {
    const db = getReadClient();

    // 1. EXPLICIT memberships only. No domain inference, ever.
    const { data: memberships, error: mErr } = await db
      .from('org_members')
      .select('org_id, status')
      .eq('user_email', email)
      .eq('status', 'active');
    if (mErr) throw new Error(`org_members: ${mErr.message}`);
    const orgIds = [...new Set((memberships ?? []).map((m) => m.org_id as string))];
    if (!orgIds.length) return { kind: 'personal' };

    // 2. Of those, which are linked to a Team subscription AND have a pool?
    const { data: orgs, error: oErr } = await db
      .from('organizations')
      .select('id, name, stripe_subscription_id')
      .in('id', orgIds)
      .not('stripe_subscription_id', 'is', null);
    if (oErr) throw new Error(`organizations: ${oErr.message}`);
    if (!orgs?.length) return { kind: 'personal' };

    // 3. The subscription must be ACTIVE and Team-priced *right now*. A cancelled
    //    Team plan must stop paying immediately — reading a stale org row would let a
    //    lapsed subscription keep spending.
    const subIds = orgs.map((o) => o.stripe_subscription_id as string);
    const { data: subs, error: sErr } = await db
      .from('stripe_subscriptions')
      .select('id, status, plan_amount')
      .in('id', subIds)
      .eq('status', 'active');
    if (sErr) throw new Error(`stripe_subscriptions: ${sErr.message}`);
    const activeTeamSubs = new Set(
      (subs ?? []).filter((s) => TEAM_AMOUNTS.has(Number(s.plan_amount))).map((s) => s.id as string),
    );
    const eligibleOrgs = orgs.filter((o) => activeTeamSubs.has(o.stripe_subscription_id as string));
    if (!eligibleOrgs.length) return { kind: 'personal' };

    // 4. A pool must already exist. No pool = personal path, which is what makes this
    //    PR inert until PR 4 funds one: eligibility alone changes nothing.
    const { data: pools, error: pErr } = await db
      .from('mcp_credit_pool')
      .select('pool_id, org_id')
      .in('org_id', eligibleOrgs.map((o) => o.id as string));
    if (pErr) throw new Error(`mcp_credit_pool: ${pErr.message}`);
    const withPool = (pools ?? []).map((p) => {
      const org = eligibleOrgs.find((o) => o.id === p.org_id)!;
      return { poolId: p.pool_id as string, orgId: org.id as string, orgName: (org.name as string) ?? '' };
    });

    if (withPool.length === 0) return { kind: 'personal' };
    if (withPool.length === 1) {
      const only = withPool[0];
      return { kind: 'pool', poolId: only.poolId, orgId: only.orgId, orgName: only.orgName };
    }

    // 2+ — refuse. Never first-row-wins.
    return {
      kind: 'selection_required',
      candidates: withPool.map((w) => ({ orgId: w.orgId, orgName: w.orgName })),
    };
  } catch (err) {
    // Fail safe to personal, but say so — a silent downgrade would hide a broken
    // pool from the team paying for it.
    console.error('[mcp:payer] resolution failed, falling back to personal:', err instanceof Error ? err.message : err);
    return { kind: 'personal' };
  }
}

export interface PayerDebitResult extends DebitResult {
  payer: PayerKind;
  poolId?: string;
  orgName?: string;
}

/**
 * Debit whichever payer `resolvePayer` selected. Both branches are atomic and neither
 * falls back to the other.
 *
 * THROWS on `selection_required` — the caller must surface it, not paper over it.
 */
export async function debitResolvedPayer(
  userEmail: string,
  amount: number,
  meta: { reason: string; toolName: string; apiKeyId?: string | null },
  resolution: PayerResolution,
): Promise<PayerDebitResult> {
  if (resolution.kind === 'selection_required') {
    throw new Error('organization_selection_required');
  }

  // PERSONAL — the existing path, entirely unchanged.
  if (resolution.kind === 'personal') {
    const r = await debitCredits(userEmail, amount, meta);
    return { ...r, payer: 'personal' };
  }

  // POOL — atomic, provenance-carrying, no personal fallback on insufficiency.
  const { data, error } = await getWriteClient().rpc('mcp_debit_pool', {
    p_pool_id: resolution.poolId,
    p_actor: userEmail.toLowerCase(),
    p_amount: Math.floor(amount),
    p_reason: meta.reason,
    p_tool: meta.toolName,
    p_api_key_id: meta.apiKeyId ?? null,
  });
  if (error) throw new Error(`debitResolvedPayer(pool) failed: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  return {
    ok: Boolean(row?.ok),
    newBalance: Number(row?.new_balance ?? 0),
    payer: 'pool',
    poolId: resolution.poolId,
    orgName: resolution.orgName,
  };
}
