/**
 * Pooled team credits — provisioning, monthly replenishment, explicit membership.
 * PRD: tasks/PRD-pooled-team-credits.md (approved by Eric 2026-09-29).
 *
 * THE RULES THIS FILE ENFORCES
 *   · A pool belongs to an ORGANIZATION linked to a Stripe subscription whose configured
 *     `seat_limit` is > 1. Any plan can be multi-seat; Team is just the first default.
 *   · Billing membership is EXPLICIT: an `org_members` row with a TEAM role, created only
 *     when the invited person accepts while signed in as the invited address. Never
 *     inferred from an email domain (the app workspace groups by domain — never use it
 *     for billing; see payer.ts).
 *   · Team roles are distinct from coach-mode roles (`coach`, `org_admin`). Coach lookups
 *     do `.in('role', ['coach','org_admin']).maybeSingle()` with no org filter, so reusing
 *     those roles here would break coach access for anyone in both kinds of org.
 *   · Replenishment is a top-up to the monthly allowance (mcp_replenish_pool): never
 *     stacked, never refilled by spending. Annual subscriptions replenish monthly.
 *
 * Every read binds its error and throws: an unknown answer is never rendered as "no org"
 * or "0 seats" (Bug Prevention Rule #11).
 */
import { readAllPages } from '@/lib/paged-read';
import { createHash, randomBytes } from 'crypto';
import { getReadClient, getWriteClient } from '@/lib/supabase/server-clients';
import { POOLED_PLAN_DEFAULTS } from './packages';

export const TEAM_OWNER_ROLE = 'team_owner';
export const TEAM_MEMBER_ROLE = 'team_member';
export const TEAM_ROLES = [TEAM_OWNER_ROLE, TEAM_MEMBER_ROLE] as const;
export const INVITE_TTL_DAYS = 7;
export const POOL_REPLENISH_REASON = 'pool_monthly';

export const normalizeEmail = (e: string) => (e || '').toLowerCase().trim();

/** UTC calendar month, e.g. 2026-10. */
export function monthKey(d: Date = new Date()): string {
  return d.toISOString().slice(0, 7);
}

/** Base idempotency key for a pool's monthly replenishment (the SQL appends :c<ceiling>). */
export function poolReplenishKey(orgId: string, month: string): string {
  return `pool:${orgId}:${month}`;
}

/** sha256 of an invite token. Only the hash is stored. */
export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface PooledOrg {
  orgId: string;
  name: string;
  poolId: string;
  seatLimit: number;
  monthlyCredits: number;
  planKey: string | null;
  subscriptionId: string;
}

/** True when an org row is configured for pooled billing. */
export function isPoolEligibleConfig(seatLimit: number | null | undefined): boolean {
  return typeof seatLimit === 'number' && seatLimit > 1;
}

interface OrgRow {
  id: string;
  name: string;
  seat_limit: number | null;
  pool_monthly_credits: number | null;
  pool_plan_key: string | null;
  stripe_subscription_id: string | null;
}

async function poolsFor(orgIds: string[]): Promise<Map<string, string>> {
  if (!orgIds.length) return new Map();
  const { data, error } = await getReadClient()
    .from('mcp_credit_pool')
    .select('pool_id, org_id')
    .in('org_id', orgIds);
  if (error) throw new Error(`team-pools: pool lookup failed: ${error.message}`);
  return new Map((data ?? []).map((p) => [p.org_id as string, p.pool_id as string]));
}

function toPooledOrg(o: OrgRow, poolId: string): PooledOrg {
  return {
    orgId: o.id,
    name: o.name,
    poolId,
    seatLimit: o.seat_limit as number,
    monthlyCredits: o.pool_monthly_credits ?? 0,
    planKey: o.pool_plan_key,
    subscriptionId: o.stripe_subscription_id as string,
  };
}

/**
 * The pooled org for a Stripe subscription, or null when that subscription is not
 * configured for pooling (no org, seat_limit <= 1, or no pool yet). Throws on a failed read.
 */
export async function findPooledOrgBySubscription(subscriptionId: string): Promise<PooledOrg | null> {
  if (!subscriptionId) return null;
  const { data, error } = await getReadClient()
    .from('organizations')
    .select('id, name, seat_limit, pool_monthly_credits, pool_plan_key, stripe_subscription_id')
    .eq('stripe_subscription_id', subscriptionId)
    .maybeSingle();
  if (error) throw new Error(`team-pools: org lookup failed: ${error.message}`);
  if (!data || !isPoolEligibleConfig((data as OrgRow).seat_limit)) return null;
  const pools = await poolsFor([(data as OrgRow).id]);
  const poolId = pools.get((data as OrgRow).id);
  return poolId ? toPooledOrg(data as OrgRow, poolId) : null;
}

/** Every pool-eligible org, keyed by Stripe subscription id (the monthly cron's input). */
export async function listPooledOrgsBySubscription(): Promise<Map<string, PooledOrg>> {
  const { data, error } = await getReadClient()
    .from('organizations')
    .select('id, name, seat_limit, pool_monthly_credits, pool_plan_key, stripe_subscription_id')
    .not('stripe_subscription_id', 'is', null)
    .gt('seat_limit', 1);
  if (error) throw new Error(`team-pools: pooled org list failed: ${error.message}`);
  const rows = (data ?? []) as OrgRow[];
  const pools = await poolsFor(rows.map((r) => r.id));
  const out = new Map<string, PooledOrg>();
  for (const r of rows) {
    const poolId = pools.get(r.id);
    if (poolId && r.stripe_subscription_id) out.set(r.stripe_subscription_id, toPooledOrg(r, poolId));
  }
  return out;
}

export interface ReplenishResult {
  applied: boolean;
  granted: number;
  newBalance: number;
}

/** Top a pool up to its monthly allowance for `month` (idempotent per month + ceiling). */
export async function replenishPool(org: PooledOrg, month: string = monthKey()): Promise<ReplenishResult> {
  const { data, error } = await getWriteClient().rpc('mcp_replenish_pool', {
    p_key: poolReplenishKey(org.orgId, month),
    p_pool_id: org.poolId,
    p_ceiling: Math.floor(org.monthlyCredits),
    p_reason: POOL_REPLENISH_REASON,
  });
  if (error) throw new Error(`replenishPool failed: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  return {
    applied: Boolean(row?.applied),
    granted: Number(row?.granted ?? 0),
    newBalance: Number(row?.new_balance ?? 0),
  };
}

export interface ProvisionInput {
  subscriptionId: string;
  customerId?: string | null;
  ownerEmail: string;
  name?: string;
  /** Plan configuration key (team, growth, agency, custom). */
  planKey: string;
  /** Overrides for a negotiated deal; otherwise POOLED_PLAN_DEFAULTS[planKey]. */
  seatLimit?: number;
  monthlyCredits?: number;
}

export interface ProvisionResult {
  orgId: string;
  poolId: string;
  created: boolean;
  seatLimit: number;
  monthlyCredits: number;
}

/**
 * Create (or re-affirm) the pooled organization for a subscription: org + team_owner
 * membership + pool. Idempotent on `stripe_subscription_id`. An existing org's seat and
 * allowance configuration is only changed when explicit overrides are passed.
 */
export async function provisionPooledOrg(input: ProvisionInput): Promise<ProvisionResult> {
  const owner = normalizeEmail(input.ownerEmail);
  if (!input.subscriptionId) throw new Error('provisionPooledOrg: subscriptionId required');
  if (!owner) throw new Error('provisionPooledOrg: ownerEmail required');
  const defaults = POOLED_PLAN_DEFAULTS[input.planKey];
  const seatLimit = input.seatLimit ?? defaults?.seats;
  const monthlyCredits = input.monthlyCredits ?? defaults?.monthlyCredits;
  if (!isPoolEligibleConfig(seatLimit)) {
    throw new Error(`provisionPooledOrg: plan "${input.planKey}" has no multi-seat configuration (seats=${seatLimit ?? 'unset'})`);
  }
  if (typeof monthlyCredits !== 'number' || monthlyCredits < 0) {
    throw new Error(`provisionPooledOrg: plan "${input.planKey}" has no monthly credit allowance configured`);
  }

  const db = getWriteClient();
  const { data: existing, error: eErr } = await db
    .from('organizations')
    .select('id, seat_limit, pool_monthly_credits')
    .eq('stripe_subscription_id', input.subscriptionId)
    .maybeSingle();
  if (eErr) throw new Error(`provisionPooledOrg: lookup failed: ${eErr.message}`);

  let orgId: string;
  let created = false;
  let finalSeats = seatLimit as number;
  let finalCredits = monthlyCredits;
  if (existing) {
    orgId = existing.id as string;
    const overriding = input.seatLimit !== undefined || input.monthlyCredits !== undefined;
    if (overriding) {
      const { error: uErr } = await db
        .from('organizations')
        .update({ seat_limit: finalSeats, pool_monthly_credits: finalCredits, pool_plan_key: input.planKey })
        .eq('id', orgId);
      if (uErr) throw new Error(`provisionPooledOrg: config update failed: ${uErr.message}`);
    } else if (!isPoolEligibleConfig(existing.seat_limit as number | null)) {
      // Linked but never configured for pooling: apply the plan defaults once.
      const { error: uErr } = await db
        .from('organizations')
        .update({ seat_limit: finalSeats, pool_monthly_credits: finalCredits, pool_plan_key: input.planKey })
        .eq('id', orgId);
      if (uErr) throw new Error(`provisionPooledOrg: config update failed: ${uErr.message}`);
    } else {
      finalSeats = existing.seat_limit as number;
      finalCredits = (existing.pool_monthly_credits as number | null) ?? finalCredits;
    }
  } else {
    const slug = `team-${input.subscriptionId.replace(/[^a-zA-Z0-9]/g, '').slice(-16).toLowerCase()}`;
    const { data: ins, error: iErr } = await db
      .from('organizations')
      .insert({
        name: input.name?.trim() || `${owner.split('@')[0]}'s team`,
        slug,
        org_type: 'team',
        tab_label: 'Team',
        tier: 'team',
        stripe_subscription_id: input.subscriptionId,
        stripe_customer_id: input.customerId ?? null,
        billing_email: owner,
        seat_limit: finalSeats,
        pool_monthly_credits: finalCredits,
        pool_plan_key: input.planKey,
      })
      .select('id')
      .single();
    if (iErr || !ins) throw new Error(`provisionPooledOrg: org insert failed: ${iErr?.message ?? 'no row'}`);
    orgId = ins.id as string;
    created = true;
  }

  const { error: mErr } = await db
    .from('org_members')
    .upsert(
      { org_id: orgId, user_email: owner, role: TEAM_OWNER_ROLE, status: 'active' },
      { onConflict: 'org_id,user_email' },
    );
  if (mErr) throw new Error(`provisionPooledOrg: owner membership failed: ${mErr.message}`);

  const { error: pErr } = await db
    .from('mcp_credit_pool')
    .upsert({ org_id: orgId }, { onConflict: 'org_id', ignoreDuplicates: true });
  if (pErr) throw new Error(`provisionPooledOrg: pool create failed: ${pErr.message}`);
  const pools = await poolsFor([orgId]);
  const poolId = pools.get(orgId);
  if (!poolId) throw new Error('provisionPooledOrg: pool missing after create');

  return { orgId, poolId, created, seatLimit: finalSeats, monthlyCredits: finalCredits };
}

// ── Membership ──────────────────────────────────────────────────────────────────

export interface Membership {
  orgId: string;
  role: string;
}

/** Active TEAM memberships for a person (never coach roles, never domain inference). */
export async function teamMembershipsFor(email: string): Promise<Membership[]> {
  const { data, error } = await getReadClient()
    .from('org_members')
    .select('org_id, role')
    .eq('user_email', normalizeEmail(email))
    .eq('status', 'active')
    .in('role', [...TEAM_ROLES]);
  if (error) throw new Error(`team-pools: membership lookup failed: ${error.message}`);
  return (data ?? []).map((m) => ({ orgId: m.org_id as string, role: m.role as string }));
}

async function orgSeatConfig(orgId: string): Promise<{ seatLimit: number | null; name: string }> {
  const { data, error } = await getReadClient()
    .from('organizations')
    .select('seat_limit, name')
    .eq('id', orgId)
    .maybeSingle();
  if (error) throw new Error(`team-pools: org read failed: ${error.message}`);
  if (!data) throw new Error('team-pools: organization not found');
  return { seatLimit: data.seat_limit as number | null, name: data.name as string };
}

export interface SeatUsage {
  active: number;
  pending: number;
  used: number;
}

/** Seats in use = active team members + unexpired pending invites. */
export async function seatUsage(orgId: string): Promise<SeatUsage> {
  const db = getReadClient();
  const { count: active, error: aErr } = await db
    .from('org_members')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .eq('status', 'active')
    .in('role', [...TEAM_ROLES]);
  if (aErr) throw new Error(`team-pools: seat count failed: ${aErr.message}`);
  const { count: pending, error: pErr } = await db
    .from('org_member_invites')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString());
  if (pErr) throw new Error(`team-pools: invite count failed: ${pErr.message}`);
  if (active === null || pending === null) throw new Error('team-pools: seat count unknown');
  return { active, pending, used: active + pending };
}

async function assertOwner(orgId: string, email: string): Promise<void> {
  const { data, error } = await getReadClient()
    .from('org_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_email', normalizeEmail(email))
    .eq('status', 'active')
    .maybeSingle();
  if (error) throw new Error(`team-pools: owner check failed: ${error.message}`);
  if (!data || data.role !== TEAM_OWNER_ROLE) throw new TeamPoolError('not_owner', 'Only the team owner can manage members.');
}

export class TeamPoolError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export interface InviteResult {
  inviteId: string;
  token: string;
  expiresAt: string;
  orgName: string;
}

/** Owner invites an address. Enforces the seat cap. Re-inviting rotates the token. */
export async function createInvite(orgId: string, ownerEmail: string, inviteeEmail: string): Promise<InviteResult> {
  const invitee = normalizeEmail(inviteeEmail);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(invitee)) throw new TeamPoolError('invalid_email', 'Enter a valid email address.');
  await assertOwner(orgId, ownerEmail);

  const { data: member, error: memErr } = await getReadClient()
    .from('org_members')
    .select('status, role')
    .eq('org_id', orgId)
    .eq('user_email', invitee)
    .maybeSingle();
  if (memErr) throw new Error(`team-pools: member check failed: ${memErr.message}`);
  if (member && member.status === 'active' && TEAM_ROLES.includes(member.role as never)) {
    throw new TeamPoolError('already_member', 'That person is already on this team.');
  }

  const { seatLimit, name } = await orgSeatConfig(orgId);
  if (!isPoolEligibleConfig(seatLimit)) throw new TeamPoolError('not_pooled', 'This subscription is not configured for multiple seats.');

  const db = getWriteClient();
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000).toISOString();

  const { data: pending, error: pendErr } = await db
    .from('org_member_invites')
    .select('id')
    .eq('org_id', orgId)
    .eq('invited_email', invitee)
    .eq('status', 'pending')
    .maybeSingle();
  if (pendErr) throw new Error(`team-pools: pending invite read failed: ${pendErr.message}`);

  if (pending) {
    // Re-invite: rotate the token (old link stops working) — does not take another seat.
    const { error } = await db
      .from('org_member_invites')
      .update({ token_hash: hashInviteToken(token), expires_at: expiresAt, invited_by: normalizeEmail(ownerEmail) })
      .eq('id', pending.id);
    if (error) throw new Error(`team-pools: invite rotate failed: ${error.message}`);
    return { inviteId: pending.id as string, token, expiresAt, orgName: name };
  }

  const usage = await seatUsage(orgId);
  if (usage.used >= (seatLimit as number)) {
    throw new TeamPoolError('seat_cap', `All ${seatLimit} seats are in use. Remove a member or revoke an invite first.`);
  }

  const { data: ins, error: insErr } = await db
    .from('org_member_invites')
    .insert({
      org_id: orgId,
      invited_email: invitee,
      invited_by: normalizeEmail(ownerEmail),
      token_hash: hashInviteToken(token),
      expires_at: expiresAt,
    })
    .select('id')
    .single();
  if (insErr || !ins) throw new Error(`team-pools: invite insert failed: ${insErr?.message ?? 'no row'}`);
  return { inviteId: ins.id as string, token, expiresAt, orgName: name };
}

/**
 * Accept an invite. The signed-in (server-verified) email MUST equal the invited
 * address — that is the proof of ownership. Seat cap re-checked at accept time.
 */
export async function acceptInvite(token: string, sessionEmail: string): Promise<{ orgId: string; orgName: string }> {
  const email = normalizeEmail(sessionEmail);
  if (!token || !email) throw new TeamPoolError('invalid', 'This invite link is not valid.');
  const db = getWriteClient();
  const { data: inv, error } = await db
    .from('org_member_invites')
    .select('id, org_id, invited_email, status, expires_at')
    .eq('token_hash', hashInviteToken(token))
    .maybeSingle();
  if (error) throw new Error(`team-pools: invite read failed: ${error.message}`);
  if (!inv || inv.status !== 'pending') throw new TeamPoolError('invalid', 'This invite link is not valid or was already used.');
  if (new Date(inv.expires_at as string).getTime() < Date.now()) {
    await db.from('org_member_invites').update({ status: 'expired' }).eq('id', inv.id);
    throw new TeamPoolError('expired', 'This invite has expired. Ask the team owner to send a new one.');
  }
  if (normalizeEmail(inv.invited_email as string) !== email) {
    throw new TeamPoolError('email_mismatch', `This invite was sent to ${inv.invited_email}. Sign in with that address to accept it.`);
  }

  const { seatLimit, name } = await orgSeatConfig(inv.org_id as string);
  if (!isPoolEligibleConfig(seatLimit)) throw new TeamPoolError('not_pooled', 'This subscription is no longer configured for multiple seats.');
  const usage = await seatUsage(inv.org_id as string);
  // This invite is counted in `pending`, so accepting it does not change `used`.
  if (usage.active >= (seatLimit as number)) {
    throw new TeamPoolError('seat_cap', 'All seats on this team are in use.');
  }

  const { error: mErr } = await db
    .from('org_members')
    .upsert(
      { org_id: inv.org_id, user_email: email, role: TEAM_MEMBER_ROLE, status: 'active' },
      { onConflict: 'org_id,user_email' },
    );
  if (mErr) throw new Error(`team-pools: membership create failed: ${mErr.message}`);
  const { error: aErr } = await db
    .from('org_member_invites')
    .update({ status: 'accepted', accepted_at: new Date().toISOString() })
    .eq('id', inv.id);
  if (aErr) throw new Error(`team-pools: invite close failed: ${aErr.message}`);
  return { orgId: inv.org_id as string, orgName: name };
}

/** Owner removes a member or revokes a pending invite. The owner cannot remove themselves. */
export async function removeMember(orgId: string, ownerEmail: string, memberEmail: string): Promise<{ removed: boolean; revokedInvites: boolean }> {
  const member = normalizeEmail(memberEmail);
  await assertOwner(orgId, ownerEmail);
  if (member === normalizeEmail(ownerEmail)) throw new TeamPoolError('owner', 'The team owner cannot be removed.');
  const db = getWriteClient();
  const { data: rows, error } = await db
    .from('org_members')
    .update({ status: 'removed' }) // truncation-ok: one member of one org, at most one row
    .eq('org_id', orgId)
    .eq('user_email', member)
    .eq('role', TEAM_MEMBER_ROLE)
    .select('id');
  if (error) throw new Error(`team-pools: remove failed: ${error.message}`);
  const { data: inv, error: iErr } = await db
    .from('org_member_invites')
    .update({ status: 'revoked' }) // truncation-ok: unique index = one pending invite per org + email
    .eq('org_id', orgId)
    .eq('invited_email', member)
    .eq('status', 'pending')
    .select('id');
  if (iErr) throw new Error(`team-pools: invite revoke failed: ${iErr.message}`);
  return { removed: (rows ?? []).length > 0, revokedInvites: (inv ?? []).length > 0 };
}

// ── Read model for the account console ────────────────────────────────────────────

export interface TeamView {
  orgId: string;
  name: string;
  role: string;
  isOwner: boolean;
  seatLimit: number;
  seats: SeatUsage;
  /** null = no pool exists yet (a provisioning gap) — never rendered as 0. */
  poolBalance: number | null;
  monthlyCredits: number;
  /** credits30d/calls30d null = usage could not be established — render as unknown, never 0. */
  members: { email: string; role: string; credits30d: number | null; calls30d: number | null }[];
  pendingInvites: { email: string; expiresAt: string }[];
}

/** Everything the /mcp/account Team section shows, for each team the person belongs to. */
export async function teamViewFor(email: string): Promise<TeamView[]> {
  const me = normalizeEmail(email);
  const memberships = await teamMembershipsFor(me);
  if (!memberships.length) return [];
  const db = getReadClient();
  const out: TeamView[] = [];
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();

  for (const m of memberships) {
    const { data: org, error: oErr } = await db
      .from('organizations')
      .select('id, name, seat_limit, pool_monthly_credits')
      .eq('id', m.orgId)
      .maybeSingle();
    if (oErr) throw new Error(`team-pools: org read failed: ${oErr.message}`);
    if (!org) continue;
    const { data: pool, error: pErr } = await db
      .from('mcp_credit_pool')
      .select('pool_id, balance')
      .eq('org_id', m.orgId)
      .maybeSingle();
    if (pErr) throw new Error(`team-pools: pool read failed: ${pErr.message}`);
    const isOwner = m.role === TEAM_OWNER_ROLE;

    const { data: memberRows, error: mErr } = await db
      .from('org_members')
      .select('user_email, role')
      .eq('org_id', m.orgId)
      .eq('status', 'active')
      .in('role', [...TEAM_ROLES]);
    if (mErr) throw new Error(`team-pools: member list failed: ${mErr.message}`);

    // null = usage not established (read failed or never proved complete) — the console
    // shows "unknown", never a fabricated 0 (Bug Prevention Rule #11).
    let usageByActor: Map<string, { credits: number; calls: number }> | null = new Map();
    if (pool?.pool_id) {
      const spend = await readAllPages<{ actor_email: string | null; delta: number }>(() =>
        db
          .from('mcp_credit_ledger')
          .select('actor_email, delta')
          .eq('charged_pool_id', pool.pool_id)
          .eq('reason', 'tool_call')
          .gte('created_at', since)
          .order('id'),
        { maxRows: 100_000 },
      );
      if (spend.error || !spend.exhausted) {
        console.error(`[team-pools] usage read incomplete for pool ${pool.pool_id}: ${spend.error ?? 'not exhausted'}`);
        usageByActor = null;
      }
      for (const r of usageByActor ? spend.rows : []) {
        const k = normalizeEmail((r.actor_email as string) ?? '');
        const cur = usageByActor!.get(k) ?? { credits: 0, calls: 0 };
        cur.credits += -Number(r.delta ?? 0);
        cur.calls += 1;
        usageByActor!.set(k, cur);
      }
    }

    let pendingInvites: TeamView['pendingInvites'] = [];
    if (isOwner) {
      const { data: inv, error: iErr } = await db
        .from('org_member_invites')
        .select('invited_email, expires_at')
        .eq('org_id', m.orgId)
        .eq('status', 'pending')
        .gt('expires_at', new Date().toISOString());
      if (iErr) throw new Error(`team-pools: invite list failed: ${iErr.message}`);
      pendingInvites = (inv ?? []).map((i) => ({ email: i.invited_email as string, expiresAt: i.expires_at as string }));
    }

    const members = (memberRows ?? [])
      .filter((r) => isOwner || normalizeEmail(r.user_email as string) === me)
      .map((r) => {
        if (!usageByActor) return { email: r.user_email as string, role: r.role as string, credits30d: null, calls30d: null };
        // A complete read with no rows for this member is a real zero.
        const u = usageByActor.get(normalizeEmail(r.user_email as string)) ?? { credits: 0, calls: 0 };
        return { email: r.user_email as string, role: r.role as string, credits30d: u.credits, calls30d: u.calls };
      });

    out.push({
      orgId: m.orgId,
      name: org.name as string,
      role: m.role,
      isOwner,
      seatLimit: (org.seat_limit as number | null) ?? 1,
      seats: await seatUsage(m.orgId),
      poolBalance: pool ? Number(pool.balance) : null,
      monthlyCredits: Number(org.pool_monthly_credits ?? 0),
      members,
      pendingInvites,
    });
  }
  return out;
}

// ── Monthly grant routing (used by the grant-mcp-pro-credits cron) ─────────────────

export interface SubscriptionGrantCandidate {
  email: string;
  amount: number;
  group: string;
  subscriptionId: string;
}

/**
 * Split active subscriptions into PERSONAL grants and POOL replenishments.
 *
 *   · A subscription whose organization is configured for pooling replenishes its POOL
 *     and never also grants the buyer personally (no double allowance).
 *   · Any ACTIVE subscription with a pooled org is replenished, whatever its price — a
 *     pool is a multi-seat capability, not a Team-price capability. So an MCP plan
 *     (e.g. a 2-seat Growth deal) is covered here too, and replenished MONTHLY even when
 *     billed annually.
 *   · Everything else keeps its existing personal grant, unchanged.
 */
export function routeSubscriptionGrants(
  candidates: SubscriptionGrantCandidate[],
  pooledBySub: Map<string, PooledOrg>,
  activeSubscriptionIds: Set<string>,
): { personal: SubscriptionGrantCandidate[]; pools: PooledOrg[] } {
  const personal = candidates.filter((c) => !pooledBySub.has(c.subscriptionId));
  const pools = [...pooledBySub.entries()]
    .filter(([subId]) => activeSubscriptionIds.has(subId))
    .map(([, org]) => org);
  return { personal, pools };
}

/** True when an error means the pooled-credits migration has not been applied yet. */
export function isPoolSchemaMissing(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /seat_limit|pool_monthly_credits|mcp_pool_grants|mcp_replenish_pool/.test(msg)
    && /(does not exist|could not find|not find the|schema cache)/i.test(msg);
}

/**
 * The subscription id an invoice belongs to, across Stripe API shapes: the legacy
 * top-level `invoice.subscription`, and the 2025+ `invoice.parent.subscription_details`.
 * Returns null when the invoice is not for a subscription.
 */
export function subscriptionIdFromInvoice(invoice: unknown): string | null {
  const inv = invoice as {
    subscription?: string | { id?: string } | null;
    parent?: { subscription_details?: { subscription?: string | { id?: string } | null } | null } | null;
    lines?: { data?: Array<{ subscription?: string | { id?: string } | null; parent?: { subscription_item_details?: { subscription?: string | null } | null } | null }> };
  };
  const pick = (v: string | { id?: string } | null | undefined) =>
    typeof v === 'string' ? v : v && typeof v === 'object' && typeof v.id === 'string' ? v.id : null;
  return (
    pick(inv?.parent?.subscription_details?.subscription) ??
    pick(inv?.subscription) ??
    pick(inv?.lines?.data?.[0]?.subscription) ??
    (inv?.lines?.data?.[0]?.parent?.subscription_item_details?.subscription ?? null)
  );
}
