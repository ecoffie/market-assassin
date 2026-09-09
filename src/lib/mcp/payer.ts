/**
 * WHO PAYS for an MCP call — personal balance, or an organization pool?
 *
 * Built in PR 3; WIRED into `runMeteredTool` in PR 4A. It does not fund pools
 * (PR 4B), does not change the Team allowance, and does not touch customer-facing copy.
 *
 * ⚠️ Production has ZERO pools, so `resolvePayer` returns `personal` for every real
 * caller today and the wiring is observable-behaviour-neutral by construction. That
 * ordering is the point: prove the resolver is genuinely in the call path while no
 * money can move, THEN fund a pool.
 *
 * ── THE BILLING INVARIANT ────────────────────────────────────────────────────
 * PERSONAL may be selected only when we POSITIVELY ESTABLISH that no eligible paid
 * Team context applies. A resolver failure is not that evidence.
 *
 * An earlier draft caught every error and returned `personal`. That converts
 * "the payer could not be established" into "the person should pay" — the same
 * failure class as `count ?? 0` (failed query → zero), unknown certification → false,
 * and unreachable evidence → nonexistence. It is worse here than a wrong number,
 * because the wrong answer silently spends a real person's money on what may be their
 * employer's work, and the ledger records it as a legitimate personal charge.
 *
 * So an unresolvable payer is its own state. Nothing is charged and the caller can
 * say "we couldn't determine the billing account for this request; nothing was
 * charged" — which is true, actionable, and cannot be mistaken for a purchase.
 *
 * ── THE RESOLUTION RULE ──────────────────────────────────────────────────────
 *   no membership / no active Team sub  → PERSONAL      (an ESTABLISHED personal case)
 *   exactly one eligible org + pool     → POOL
 *   2+ eligible orgs                    → SELECTION_REQUIRED  · charge nothing
 *   any query failure                   → UNAVAILABLE          · charge nothing
 *   eligible org but pool missing       → POOL_UNAVAILABLE     · charge nothing
 *
 * ⚠️ MEMBERSHIP IS NEVER INFERRED FROM EMAIL DOMAIN. `getWorkspaceId()` derives a
 * workspace from the email domain — fine for content scoping, catastrophic for
 * billing: `proton.me` has 5 unrelated members and `xerox.com` has 3. Pooling a paid
 * allowance across strangers because they share a mail provider is the specific
 * failure this design exists to prevent. Only explicit `org_members` rows count.
 *
 * ⚠️ MULTI-ORG NEVER PICKS THE FIRST ROW. A silent first-row-wins would charge one
 * company for another company's work, and the ledger would look perfectly consistent
 * while being wrong. MCP carries no org context today (the OAuth token's `sub` is just
 * an email), so there is nothing to disambiguate with — and inventing a default would
 * be a product decision disguised as a resolver.
 *
 * ⚠️ NO CROSS-PAYER FALLBACK, EITHER DIRECTION. An empty pool does NOT fall through to
 * the actor's personal balance, and an empty personal balance does not reach into a
 * pool. Both would spend someone's money without them choosing it.
 */
import { getReadClient, getWriteClient } from '@/lib/supabase/server-clients';
import { debitCredits, type DebitResult } from './credits';

/** Stripe unit_amount values that mean "Team plan". Cents. */
const TEAM_AMOUNTS = new Set([49900, 499000]);

export type PayerKind = 'personal' | 'pool';

/**
 * `personal` and `pool` are ESTABLISHED payers — something may be charged.
 * Every other value means the payer could NOT be established: charge nothing.
 */
export type PayerOutcome =
  | 'personal'
  | 'pool'
  | 'selection_required' // 2+ eligible orgs; the caller must disambiguate
  | 'unavailable'        // a resolver query failed — we do not know
  | 'pool_unavailable';  // eligible paid org exists, but its pool does not

export interface PayerResolution {
  kind: PayerOutcome;
  /** Set when kind === 'pool'. */
  poolId?: string;
  orgId?: string;
  orgName?: string;
  /** Set when kind === 'selection_required'. */
  candidates?: { orgId: string; orgName: string }[];
  /** Set on 'unavailable' / 'pool_unavailable' — which step could not be established. */
  reason?: string;
}

/** True only for outcomes where a charge may legitimately occur. */
export function isChargeable(r: PayerResolution): boolean {
  return r.kind === 'personal' || r.kind === 'pool';
}

/**
 * Resolve the payer for an authenticated MCP caller.
 *
 * FAILS UNRESOLVED, NEVER TO PERSONAL. Each step binds its error and returns
 * `unavailable` with the step name, so a broken lookup is visible as a broken lookup
 * rather than as a personal charge.
 */
export async function resolvePayer(userEmail: string): Promise<PayerResolution> {
  const email = userEmail.toLowerCase().trim();
  // No identity at all is not a failed lookup — there is genuinely no Team context.
  if (!email) return { kind: 'personal' };

  const db = getReadClient();

  // 1. EXPLICIT memberships only. No domain inference, ever.
  const { data: memberships, error: mErr } = await db
    .from('org_members')
    .select('org_id, status')
    .eq('user_email', email)
    .eq('status', 'active');
  if (mErr) {
    console.error('[mcp:payer] org_members lookup failed:', mErr.message);
    return { kind: 'unavailable', reason: 'org_members_query_failed' };
  }
  const orgIds = [...new Set((memberships ?? []).map((m) => m.org_id as string))];
  // ESTABLISHED: this user belongs to no organization. Personal is the right answer.
  if (!orgIds.length) return { kind: 'personal' };

  // 2. Of those, which are linked to a subscription at all?
  const { data: orgs, error: oErr } = await db
    .from('organizations')
    .select('id, name, stripe_subscription_id')
    .in('id', orgIds)
    .not('stripe_subscription_id', 'is', null);
  if (oErr) {
    console.error('[mcp:payer] organizations lookup failed:', oErr.message);
    return { kind: 'unavailable', reason: 'organizations_query_failed' };
  }
  // ESTABLISHED: member of orgs, none of which is billed. Personal.
  if (!orgs?.length) return { kind: 'personal' };

  // 3. The subscription must be ACTIVE and Team-priced *right now*. Re-read rather
  //    than trusting the org row, so a cancelled Team plan stops paying immediately.
  const subIds = orgs.map((o) => o.stripe_subscription_id as string);
  const { data: subs, error: sErr } = await db
    .from('stripe_subscriptions')
    .select('id, status, plan_amount')
    .in('id', subIds)
    .eq('status', 'active');
  if (sErr) {
    console.error('[mcp:payer] stripe_subscriptions lookup failed:', sErr.message);
    return { kind: 'unavailable', reason: 'subscriptions_query_failed' };
  }
  const activeTeamSubs = new Set(
    (subs ?? []).filter((s) => TEAM_AMOUNTS.has(Number(s.plan_amount))).map((s) => s.id as string),
  );
  const eligibleOrgs = orgs.filter((o) => activeTeamSubs.has(o.stripe_subscription_id as string));
  // ESTABLISHED: no ACTIVE paid Team context. Personal.
  if (!eligibleOrgs.length) return { kind: 'personal' };

  // 4. From here the user IS in a paid Team context, so personal is no longer a
  //    legitimate outcome — only a pool, an ambiguity, or an unresolved state.
  const { data: pools, error: pErr } = await db
    .from('mcp_credit_pool')
    .select('pool_id, org_id')
    .in('org_id', eligibleOrgs.map((o) => o.id as string));
  if (pErr) {
    console.error('[mcp:payer] mcp_credit_pool lookup failed:', pErr.message);
    return { kind: 'unavailable', reason: 'pool_query_failed' };
  }
  const withPool = (pools ?? []).map((p) => {
    const org = eligibleOrgs.find((o) => o.id === p.org_id)!;
    return { poolId: p.pool_id as string, orgId: org.id as string, orgName: (org.name as string) ?? '' };
  });

  if (withPool.length === 0) {
    // A paid Team org with no pool is a PROVISIONING GAP, not a personal user.
    // Charging their personal balance here would bill an individual for work their
    // employer has already paid for, because of an operational oversight on our side.
    console.error(`[mcp:payer] eligible Team org(s) have no pool: ${eligibleOrgs.map((o) => o.id).join(',')}`);
    return { kind: 'pool_unavailable', reason: 'eligible_org_has_no_pool' };
  }
  if (withPool.length === 1) {
    const only = withPool[0];
    return { kind: 'pool', poolId: only.poolId, orgId: only.orgId, orgName: only.orgName };
  }

  // 2+ — refuse. Never first-row-wins.
  return {
    kind: 'selection_required',
    candidates: withPool.map((w) => ({ orgId: w.orgId, orgName: w.orgName })),
  };
}

/**
 * Current balance of an organization pool.
 *
 * Mirrors `getBalance` for the personal path so the pre-check can gate on whichever
 * payer was resolved. Returns 0 for a missing pool — but note that case cannot reach
 * here through `resolvePayer`, which returns `pool_unavailable` rather than a poolId
 * when no pool exists. A read error is surfaced, never silently rendered as 0: a
 * fabricated zero here would reject a funded team's call as "out of credits".
 */
export async function getPoolBalance(poolId: string): Promise<number> {
  const { data, error } = await getReadClient()
    .from('mcp_credit_pool')
    .select('balance')
    .eq('pool_id', poolId)
    .maybeSingle();
  if (error) throw new Error(`getPoolBalance failed: ${error.message}`);
  return Number(data?.balance ?? 0);
}

export interface PayerDebitResult extends DebitResult {
  payer: PayerKind;
  poolId?: string;
  orgName?: string;
}

/**
 * Debit whichever payer `resolvePayer` established. Both branches are atomic and
 * neither falls back to the other.
 *
 * THROWS on every non-chargeable outcome — the caller must surface it, not paper over
 * it. The thrown message is the outcome name so the caller can branch on it.
 */
export async function debitResolvedPayer(
  userEmail: string,
  amount: number,
  meta: { reason: string; toolName: string; apiKeyId?: string | null },
  resolution: PayerResolution,
): Promise<PayerDebitResult> {
  if (!isChargeable(resolution)) {
    // selection_required | unavailable | pool_unavailable — all charge NOTHING.
    throw new Error(resolution.kind);
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
