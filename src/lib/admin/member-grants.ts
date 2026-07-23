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
import type Stripe from 'stripe';
import { grantBriefingsAccess, revokeBriefingsAccess } from '@/lib/briefings/access';
import { provisionTeamWorkspace } from '@/lib/app/workspace';
import { isAdvocateAccount, getAdvocateName } from '@/lib/mindy/advocate-accounts';
import { COMP_TESTIMONIAL_EMAILS } from '@/lib/mindy/campaign-exclusions';
import { isPartnerContactEmail } from '@/lib/mindy/partner-referrals';

export type GrantTier = 'pro' | 'team';
export type GrantAction = 'grant' | 'revoke';

/** Where an off-link grant's payment was verified (when not a Stripe checkout). */
export type GrantSource = 'stripe' | 'invoice' | 'wire' | 'bootcamp' | 'comp' | 'bundle' | 'other';

export interface MemberStatus {
  email: string;
  found: boolean;
  accessBriefings: boolean; // Pro
  accessTeam: boolean; // Team
  tier: 'free' | 'pro' | 'team';
}

/** Stripe-side proof of purchase, used to verify off-link grants before flipping access. */
export interface StripeVerification {
  found: boolean;
  customerId?: string;
  name?: string | null;
  totalPaid?: number;        // sum of paid checkout sessions, USD
  activeSubscriptions?: number;
  hasRefunds?: boolean;
  lastPlan?: string | null;  // most recent subscription price id / product
  error?: string;
}

/** Reconciliation verdict shown before a grant — current access vs Stripe truth. */
export interface MemberVerdict {
  level: 'ok' | 'warn' | 'block' | 'info';
  headline: string;
  detail: string;
  /** True when there's no Stripe payment to point to → grant needs a reason. */
  requiresReason: boolean;
}

/**
 * Known non-customer account class (comp/testimonial, advocate, partner). These
 * intentionally have NO Stripe payment — complimentary Pro for marketing/creators/
 * partners — so the verdict treats "no payment" as expected, not a red flag, and
 * pre-fills the grant source. (Registries: campaign-exclusions, advocate-accounts,
 * partner-referrals.)
 */
export interface SpecialAccount {
  isSpecial: boolean;
  kind: 'comp' | 'advocate' | 'partner' | null;
  label: string | null;   // human label, e.g. "Advocate — Sue Kranes"
  name: string | null;
}

/** Classify an email against the comp / advocate / partner registries. */
export function classifySpecialAccount(email: string | null | undefined): SpecialAccount {
  const normalized = (email || '').toLowerCase().trim();
  if (!normalized) return { isSpecial: false, kind: null, label: null, name: null };
  if (COMP_TESTIMONIAL_EMAILS.has(normalized)) {
    return { isSpecial: true, kind: 'comp', label: 'Comp / testimonial', name: null };
  }
  if (isAdvocateAccount(normalized)) {
    const name = getAdvocateName(normalized) || null;
    return { isSpecial: true, kind: 'advocate', label: name ? `Advocate — ${name}` : 'Advocate', name };
  }
  if (isPartnerContactEmail(normalized)) {
    return { isSpecial: true, kind: 'partner', label: 'Partner contact', name: null };
  }
  return { isSpecial: false, kind: null, label: null, name: null };
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
  /** Non-fatal note (e.g. profile-flag row couldn't be created because the user
   *  hasn't signed up yet — KV still granted access). */
  warning?: string;
}

export interface GrantLogEntry {
  target_email: string;
  actor_email: string;
  action: GrantAction;
  tier: GrantTier;
  sent_welcome: boolean;
  created_at: string;
  grant_source?: GrantSource | null;
  note?: string | null;
}

export interface MemberListRow {
  email: string;
  name: string | null;
  tier: 'free' | 'pro' | 'team';
  created_at: string | null;
  accessSource: string | null; // how they got access (stripe webhook, manual grant, bundle…)
}

export interface TierCounts {
  all: number;
  pro: number;
  team: number;
  free: number;
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
        grant_source TEXT,
        note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_mi_admin_grants_created ON mi_admin_grants(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_mi_admin_grants_target ON mi_admin_grants(target_email);
    `,
  });
}

/**
 * Add the off-link provenance columns to an EXISTING audit table (the table may
 * predate them). Best-effort + idempotent — never blocks a grant.
 */
async function ensureGrantProvenanceColumns(): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  // Probe one of the new columns; only run DDL if it's missing.
  const { error } = await supabase.from('mi_admin_grants').select('grant_source').limit(1);
  if (!error || error.code !== '42703') return; // 42703 = undefined_column
  await supabase.rpc('exec_migration', {
    sql_query: `
      ALTER TABLE mi_admin_grants ADD COLUMN IF NOT EXISTS grant_source TEXT;
      ALTER TABLE mi_admin_grants ADD COLUMN IF NOT EXISTS note TEXT;
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
): Promise<{ error?: string; softSkip?: string }> {
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
    // user_profiles.user_id is NOT NULL (FK to auth.users). A user who hasn't
    // signed up yet has no auth account, so we CANNOT create their row — that's
    // expected, NOT an error: KV is the primary access gate, and the profile row
    // gets created at signup. Inserting without user_id throws the constraint
    // violation that surfaced as "access not working". So: resolve the auth id
    // and only insert when it exists; otherwise soft-skip.
    const userId = await resolveAuthUserId(supabase, email);
    if (!userId) {
      return { softSkip: 'user has not signed up yet — profile row deferred to signup (KV grants access now)' };
    }
    const { error } = await supabase.from('user_profiles').insert({ user_id: userId, email, ...updates });
    return { error: error?.message };
  }
  return {}; // nothing to revoke
}

/** Best-effort auth.users id lookup for an email (service-role only). Returns null
 *  when the user has no auth account yet — the caller treats that as a soft skip. */
async function resolveAuthUserId(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  email: string,
): Promise<string | null> {
  // 1) Fast path: a profiles row may already carry the user_id (covers the case
  //    where a row exists but the select-by-email above missed on casing).
  try {
    const { data } = await supabase
      .from('user_profiles')
      .select('user_id')
      .eq('email', email)
      .not('user_id', 'is', null)
      .maybeSingle();
    if (data?.user_id) return data.user_id;
  } catch { /* fall through */ }
  // 2) Auth admin lookup (paginated). Most grant targets are recent, so a couple
  //    of pages covers them; we stop as soon as we match.
  try {
    for (let page = 1; page <= 5; page++) {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
      if (error || !data?.users?.length) break;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const match = data.users.find((u: any) => (u.email || '').toLowerCase().trim() === email);
      if (match?.id) return match.id;
      if (data.users.length < 1000) break; // last page
    }
  } catch { /* no admin access / SDK shape mismatch — treat as not found */ }
  return null;
}

async function recordGrant(entry: {
  targetEmail: string;
  actorEmail: string;
  action: GrantAction;
  tier: GrantTier;
  sentWelcome: boolean;
  grantSource?: GrantSource | null;
  note?: string | null;
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
      grant_source: entry.grantSource ?? null,
      note: entry.note ?? null,
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
  grantSource?: GrantSource | null;
  note?: string | null;
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
  await ensureGrantProvenanceColumns();

  // 1) Flip the profile flags.
  const updates: Record<string, boolean> =
    opts.tier === 'team'
      // Team is a superset of Pro: granting sets both; revoking only drops the
      // team flag (they fall back to whatever Pro/underlying access they had).
      ? (granting ? { access_team: true, access_briefings: true } : { access_team: false })
      : { access_briefings: granting };

  // The profile-flag write is SECONDARY and best-effort. It can legitimately fail
  // (or soft-skip) when the user hasn't signed up — user_profiles.user_id is NOT
  // NULL, so there's no row to create yet. This must NEVER abort the grant: KV
  // (step 2) is the PRIMARY access gate, and aborting here was exactly why the
  // grant reported "access not working" while the user had paid (Eric, Jun 23).
  const { error: flagError, softSkip } = await applyProfileFlags(supabase, email, updates);
  let warning: string | undefined;
  if (flagError) {
    warning = `profile flags not written (${flagError}) — KV still gates access`;
    console.warn('[member-grants] profile flag write failed (non-fatal):', flagError);
  } else if (softSkip) {
    warning = softSkip;
  }

  // 2) KV briefings gate — the ACTUAL access check (what gates tools + what
  //    /activate reads). Grant SUCCESS hinges on this, not the profile flag.
  let kvError: string | null = null;
  try {
    if (opts.tier === 'pro') {
      if (granting) await grantBriefingsAccess(email);
      else await revokeBriefingsAccess(email);
    } else if (opts.tier === 'team' && granting) {
      await grantBriefingsAccess(email);
    }
    // Team revoke intentionally leaves the briefings KV alone (see updates above).
  } catch (err) {
    kvError = err instanceof Error ? err.message : String(err);
    console.error('[member-grants] KV briefings grant FAILED (fatal):', err);
  }

  if (kvError) {
    const status = await getMemberStatus(email);
    return {
      success: false, email, tier: opts.tier, action: opts.action, status,
      welcomeEmailSent: false, message: `Failed to grant access: ${kvError}`, error: kvError,
    };
  }

  // 3) Team grant also provisions the shared workspace + seats.
  if (opts.tier === 'team' && granting) {
    try {
      await provisionTeamWorkspace(email);
    } catch (err) {
      console.error('[member-grants] provisionTeamWorkspace failed (non-fatal):', err);
    }
  }

  // 3.5) Reflect paid state on the settings row so metrics/MRR see this grant as
  // paid (the Stripe webhook stamps this on real purchases; a manual/off-link grant
  // must too, or it re-creates the paid_status drift — see
  // tasks/paid-status-drift-notification-settings.md). Best-effort, UPDATE-only
  // (don't create a settings row here); never blocks the grant.
  if (granting) {
    try {
      await supabase
        .from('user_notification_settings')
        .update({ paid_status: true, updated_at: new Date().toISOString() })
        .eq('user_email', email);
    } catch (err) {
      console.error('[member-grants] paid_status stamp failed (non-fatal):', err);
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

  // 5) Audit (with off-link provenance when provided).
  await recordGrant({
    targetEmail: email,
    actorEmail: normalize(opts.actorEmail),
    action: opts.action,
    tier: opts.tier,
    sentWelcome: welcomeEmailSent,
    grantSource: opts.grantSource ?? null,
    note: opts.note ?? null,
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
    warning,
    message: granting
      ? `${tierLabel} access GRANTED to ${email}.${welcomeEmailSent ? ' Welcome email sent.' : ''}${warning ? ` (${warning})` : ''} They'll see it on next sign-in / refresh.`
      : `${tierLabel} access REVOKED for ${email}. Takes effect on their next page load.`,
  };
}

/** Recent grant/revoke activity for the audit panel. */
export async function getRecentGrants(limit = 25): Promise<GrantLogEntry[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  await ensureGrantsAuditSchema();
  // Try the richer select (with provenance); fall back to the base columns if the
  // table predates them, so an un-migrated table still shows recent activity.
  let { data, error } = await supabase
    .from('mi_admin_grants')
    .select('target_email, actor_email, action, tier, sent_welcome, grant_source, note, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error?.code === '42703') {
    ({ data, error } = await supabase
      .from('mi_admin_grants')
      .select('target_email, actor_email, action, tier, sent_welcome, created_at')
      .order('created_at', { ascending: false })
      .limit(limit));
  }
  if (error) return [];
  return (data || []) as GrantLogEntry[];
}

/**
 * Tier counts across all members — drives the tab badges (All / Pro / Team / Free).
 * "Pro" = access_briefings true & not Team; "Team" = access_team true.
 */
export async function getTierCounts(): Promise<TierCounts> {
  const supabase = getSupabase();
  if (!supabase) return { all: 0, pro: 0, team: 0, free: 0 };
  const head = async (filter?: (q: any) => any): Promise<number> => { // eslint-disable-line @typescript-eslint/no-explicit-any
    let q = supabase.from('user_profiles').select('email', { count: 'exact', head: true });
    if (filter) q = filter(q);
    const { count } = await q;
    return count || 0;
  };
  const [all, team, briefings] = await Promise.all([
    head(),
    head((q) => q.eq('access_team', true)),
    head((q) => q.eq('access_briefings', true)),
  ]);
  // Team is a superset of Pro (granting Team also sets access_briefings), so Pro =
  // briefings minus the team rows, and Free = everyone else.
  const pro = Math.max(0, briefings - team);
  const free = Math.max(0, all - team - pro);
  return { all, pro, team, free };
}

/**
 * Paged member list for the table. `tier` filters by segment; `q` is a case-
 * insensitive email/name substring search. Ordered newest-first.
 */
export async function listMembers(opts: {
  tier?: 'all' | 'pro' | 'team' | 'free';
  q?: string;
  limit?: number;
}): Promise<MemberListRow[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const limit = Math.min(opts.limit ?? 50, 200);
  let query = supabase
    .from('user_profiles')
    .select('email, company_name, access_source, access_briefings, access_team, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);

  const tier = opts.tier || 'all';
  if (tier === 'team') query = query.eq('access_team', true);
  else if (tier === 'pro') query = query.eq('access_briefings', true).eq('access_team', false);
  else if (tier === 'free') query = query.eq('access_briefings', false).eq('access_team', false);

  const search = (opts.q || '').trim();
  if (search) {
    const safe = search.replace(/[%,]/g, '');
    query = query.or(`email.ilike.%${safe}%,company_name.ilike.%${safe}%`);
  }

  const { data, error } = await query;
  if (error) return [];
  return (data || []).map((d: Record<string, unknown>) => ({
    email: String(d.email),
    name: (d.company_name as string) || null,
    tier: deriveTier(!!d.access_team, !!d.access_briefings),
    created_at: (d.created_at as string) || null,
    accessSource: (d.access_source as string) || null,
  }));
}

/**
 * Verify an email against Stripe — the proof of purchase for off-link grants.
 * Calls the same Stripe path /api/admin/stripe-lookup uses, server-side. Never
 * throws: a Stripe outage degrades to found:false with an error note so the
 * operator can still grant with an explicit reason.
 */
export async function getStripeVerification(email: string): Promise<StripeVerification> {
  const normalized = normalize(email);
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) return { found: false, error: 'Stripe not configured' };
  try {
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(secret, { apiVersion: '2025-01-27.acacia' as Stripe.LatestApiVersion });
    const customers = await stripe.customers.list({ email: normalized, limit: 1 });
    const customer = customers.data[0];
    if (!customer) return { found: false };

    const [sessions, subscriptions, charges] = await Promise.all([
      stripe.checkout.sessions.list({ customer: customer.id, limit: 20 }),
      stripe.subscriptions.list({ customer: customer.id, limit: 10 }),
      stripe.charges.list({ customer: customer.id, limit: 20 }),
    ]);
    const totalPaid = sessions.data
      .filter((s) => s.payment_status === 'paid')
      .reduce((sum, s) => sum + (s.amount_total ? s.amount_total / 100 : 0), 0);
    const activeSubs = subscriptions.data.filter((s) => s.status === 'active');
    return {
      found: true,
      customerId: customer.id,
      name: customer.name,
      totalPaid: Math.round(totalPaid * 100) / 100,
      activeSubscriptions: activeSubs.length,
      hasRefunds: charges.data.some((c) => c.refunded),
      lastPlan: (activeSubs[0]?.items.data[0]?.price?.product as string) || null,
    };
  } catch (err) {
    return { found: false, error: err instanceof Error ? err.message : 'Stripe lookup failed' };
  }
}

/**
 * Reconcile current access vs Stripe truth into a one-line verdict the operator
 * reads BEFORE granting. The whole point of this tool is off-link purchases, so a
 * no-Stripe-payment result is a "needs a reason" warning, never a hard block.
 */
export function computeVerdict(
  status: MemberStatus,
  stripe: StripeVerification,
  special?: SpecialAccount,
): MemberVerdict {
  // Known comp / advocate / partner → complimentary by design. A refund still
  // matters (don't hide a real problem), but otherwise "no Stripe payment" is
  // EXPECTED, not a warning. Clean label, no required reason (source pre-fills).
  if (special?.isSpecial && !stripe.hasRefunds) {
    return {
      level: 'ok',
      headline: `${special.label} — complimentary Pro`,
      detail: 'Known non-customer account (no Stripe payment expected). Safe to grant; logged as comp.',
      requiresReason: false,
    };
  }
  if (stripe.error) {
    return {
      level: 'info',
      headline: 'Stripe check unavailable',
      detail: `Could not verify against Stripe (${stripe.error}). Grant with an explicit source + note.`,
      requiresReason: true,
    };
  }
  if (stripe.hasRefunds) {
    return {
      level: 'block',
      headline: 'Has a refunded charge',
      detail: `This customer has at least one refund on file${status.tier !== 'free' ? ` but still holds ${status.tier.toUpperCase()} access` : ''}. Confirm before granting; consider revoking.`,
      requiresReason: true,
    };
  }
  if (stripe.found && (stripe.activeSubscriptions || 0) > 0) {
    return {
      level: 'ok',
      headline: `Active Stripe subscription · $${(stripe.totalPaid || 0).toLocaleString()} paid`,
      detail: status.tier === 'free'
        ? 'Paid in Stripe but has no access yet — safe to grant.'
        : `Already has ${status.tier.toUpperCase()} access, matching their Stripe subscription.`,
      requiresReason: false,
    };
  }
  if (stripe.found && (stripe.totalPaid || 0) > 0) {
    return {
      level: 'ok',
      headline: `One-time Stripe payment · $${(stripe.totalPaid || 0).toLocaleString()}`,
      detail: 'Paid in Stripe (no active subscription). Safe to grant the matching tier.',
      requiresReason: false,
    };
  }
  // No Stripe payment found — the off-link case. Allowed, but needs a reason.
  return {
    level: 'warn',
    headline: 'No Stripe payment on file',
    detail: status.tier !== 'free'
      ? `Holds ${status.tier.toUpperCase()} access with no Stripe payment — likely a manual/comp grant. Pick a source so it's traceable.`
      : 'No Stripe record — if this is an off-link sale (invoice, wire, bootcamp, comp), pick a source + note before granting.',
    requiresReason: true,
  };
}
