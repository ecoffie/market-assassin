/**
 * ONE answer to "is this account PAYING us?" — read-only.
 *
 * WHY THIS EXISTS. "Paid" was defined three different ways, and they disagreed:
 *   - the MCP extraction guard (Layer A) counted admin grants and comp allowances as paid
 *     standing, but NOT mcp_sub_monthly / mcp_sub_annual / auto_recharge, so a paying
 *     MCP-plan subscriber would read as free-only the day enforcement is switched on;
 *   - the activation dashboard counted pro_monthly (historically also written for comp and
 *     advocate accounts) but not app_tier_team or auto_recharge;
 *   - a $0 trial invoice writes app_tier_pro, so a trialist reads as paid in both.
 *
 * WHAT IT RETURNS. A structured status, never a bare boolean:
 *   kind          the single headline classification (precedence below)
 *   sources       EVERY signal the account holds, so nothing is collapsed away
 *   paidFunding   true only when money was received for what the account has now;
 *                 null when the answer is unknown
 *   complimentaryAccess  staff / advocate / comp: access yes, paid NO
 *
 * RULES (each is a test in paid-status.unit.test.ts):
 *   - A positive credit BALANCE is never evidence of payment. Only funding events are.
 *   - Admin grants, signup / referral / trial_promo / event / goodwill credits are
 *     PROMOTIONAL. Any ledger reason this file does not list as paid funding is NOT paid,
 *     including reasons added after this file was written (fail-closed on classification).
 *   - A trial is never paid, even when its $0 invoice wrote an app_tier_* row.
 *   - A failed read, or a capped read that could hide a paid row, is `unknown` — never
 *     `none`, never free. Callers decide what unknown means for them.
 *
 * Gated: consumers switch to this only when PAID_STATUS_RESOLVER=true (literal 'true',
 * like every repo flag). Default OFF = every consumer keeps its old definition.
 */
import { kv } from '@vercel/kv';
import { getWriteClient } from '@/lib/supabase/server-clients';
import { getStaffRole } from '@/lib/api-auth';
import { isAdvocateAccount } from '@/lib/mindy/advocate-accounts';
import { COMP_TESTIMONIAL_EMAILS } from '@/lib/mindy/campaign-exclusions';
import { resolvePayer } from '@/lib/mcp/payer';

import {
  CREDIT_PURCHASE_REASONS, COMPLIMENTARY_REASONS, DAY_MS, HISTORICALLY_AMBIGUOUS_REASONS,
  MCP_SUB_ANNUAL_WINDOW_DAYS, MCP_SUB_MONTHLY_WINDOW_DAYS, NEUTRAL_REASONS, PAID_FUNDING_REASONS,
  REQUIRES_PAID_INVOICE, PAID_STATUS_POLICY, CHARGE_WINDOW_MONTHLY_DAYS, CHARGE_WINDOW_ANNUAL_DAYS,
  CHARGE_LOOKBACK_DAYS, APP_TIER_NO_MIRROR_WINDOW_DAYS, APP_TIER_STALE_MIRROR_WINDOW_DAYS,
  type PaidStatusPolicy,
} from './paid-reasons';

export * from './paid-reasons';

// ---------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------

export type PaidStatusKind =
  | 'active_paid'      // live paid subscription, live MCP plan, or a funded team pool
  | 'prepaid'          // live off-Stripe prepaid term (invoice / wire / bundle), or a lifetime / bundle purchase
  | 'paid_credits'     // bought credits (top-up / auto-recharge), no live subscription
  | 'complimentary'    // staff / advocate / comp — access yes, paid no
  | 'trial'            // trialing; a $0 trial invoice is still a trial
  | 'expired'          // had a subscription; it has ended
  | 'promotional_only' // only signup / referral / admin / promo credits
  | 'none'             // nothing at all
  | 'unknown';         // a read failed or was capped — never treated as free here

export type PaidSource =
  | 'stripe_subscription_paid'
  | 'mcp_subscription_ledger'
  | 'app_tier_ledger_corroborated'
  | 'unverified_app_tier'
  | 'credit_purchase'
  | 'prepaid'
  | 'lifetime_purchase'
  | 'pro_giant_term'
  | 'pool'
  | 'trial'
  | 'staff'
  | 'advocate'
  | 'comp'
  | 'complimentary_ledger'
  | 'promotional_credits'
  | 'ambiguous_pro_monthly'
  | 'expired_subscription';

export interface PaidStatus {
  kind: PaidStatusKind;
  sources: PaidSource[];
  /** Money received for what the account holds now. null = unknown. */
  paidFunding: boolean | null;
  complimentaryAccess: boolean;
  /**
   * ACCESS fact, never a payment fact: a Pro grant is live right now (unexpired
   * user_profiles.access_briefings or KV briefings:{email}). Owner rule 2026-11-16: never
   * shorten anyone's access, so access gates admit a live grant whatever paidFunding says
   * (e.g. a Pro Giant buyer past day 365 whose grant runs longer). Never feeds paidFunding,
   * metrics or credit-health. Absent/false = no live grant or not read.
   */
  liveProGrant?: boolean;
  evidence: {
    liveSubscriptionStatus: string | null;
    /** Promotional / unrecognised ledger reasons seen (names only, never amounts). */
    promotionalReasons: string[];
    ledgerTruncated: boolean;
  };
  /** Store names that could not be read. Empty unless kind === 'unknown'. */
  failures: string[];
}

export interface LedgerGrant { reason: string; created_at: string }
export interface SubscriptionFact {
  status: string;
  plan_amount: number | null;
  plan_interval?: string | null;
  current_period_start?: string | null;
  trial_end: string | null;
  current_period_end: string | null;
  ended_at: string | null;
}
export interface ChargeFact {
  amount: number; amount_refunded: number | null; status: string; refunded: boolean | null;
  /** An invoice charge (subscription billing), not a one-off payment. */
  invoice_id?: string | null;
  created_at?: string | null;
}
export interface PrepaidFact { access_starts_on: string; access_ends_on: string }
export interface ProGiantFact { purchasedAt: string | null }

/** The Pro Giant bundle bought one year of Pro. */
export const PRO_GIANT_TERM_DAYS = 365;

/** All inputs; `null` for a store means the read FAILED (not "empty"). */
export interface PaidStatusFacts {
  now: number;
  ledgerGrants: LedgerGrant[] | null;
  ledgerTruncated?: boolean;
  subscriptions: SubscriptionFact[] | null;
  /** The subscription or charge read hit its row cap. */
  stripeTruncated?: boolean;
  charges: ChargeFact[] | null;
  prepaid: PrepaidFact[] | null;
  trialEndsAt: string | null | undefined;
  /** undefined when the trial read failed. */
  trialReadOk?: boolean;
  poolFunded: boolean | null;
  /**
   * A lifetime / bundle purchase that is live right now (owner 2026-11-15: lifetime bundle
   * members are paid). undefined = not read (treated as no); null = the read FAILED.
   */
  lifetimeMember?: boolean | null;
  /**
   * Pro Giant bundle (owner 2026-11-15: one year of Pro, not lifetime). Present only for a
   * Pro Giant buyer whose Pro grant is live; purchasedAt null = the purchase date could not
   * be found. undefined = not a Pro Giant member (or not read); null = the read FAILED.
   */
  proGiant?: ProGiantFact | null;
  /** Access-only fact (see PaidStatus.liveProGrant). A failed read is false, never a failure. */
  liveProGrant?: boolean | null;
  isStaff: boolean;
  isAdvocate: boolean;
  isComp: boolean;
}

// ---------------------------------------------------------------------------------------
// Pure classifier
// ---------------------------------------------------------------------------------------

const ts = (iso: string | null | undefined): number => (iso ? Date.parse(iso) : NaN);

function subIsTrialing(s: SubscriptionFact, now: number): boolean {
  return s.status === 'trialing' || (Number.isFinite(ts(s.trial_end)) && ts(s.trial_end) > now);
}

function subIsLive(s: SubscriptionFact): boolean {
  return s.status === 'active' || s.status === 'past_due';
}

/**
 * A charge counts as the paid invoice for subscription `s` only when it is a succeeded,
 * unrefunded INVOICE charge made inside the subscription's current period (or, when the
 * period start is not mirrored, within one billing interval). One old unrelated charge can
 * no longer make a coupon or stale subscription read as paid.
 */
function chargePaysFor(c: ChargeFact, s: SubscriptionFact, now: number): boolean {
  if (c.status !== 'succeeded' || c.refunded || c.amount - (c.amount_refunded ?? 0) <= 0) return false;
  if (!c.invoice_id) return false;
  const at = ts(c.created_at);
  if (!Number.isFinite(at)) return false;
  const windowDays = s.plan_interval === 'year' ? CHARGE_WINDOW_ANNUAL_DAYS : CHARGE_WINDOW_MONTHLY_DAYS;
  const start = Number.isFinite(ts(s.current_period_start)) ? ts(s.current_period_start) - 3 * DAY_MS : now - windowDays * DAY_MS;
  return at >= start && at <= now + DAY_MS;
}

export function classifyPaidStatus(f: PaidStatusFacts, policy: PaidStatusPolicy = PAID_STATUS_POLICY): PaidStatus {
  const now = f.now;
  const failures: string[] = [];
  if (f.ledgerGrants === null) failures.push('mcp_credit_ledger');
  if (f.subscriptions === null) failures.push('stripe_subscriptions');
  if (f.charges === null) failures.push('stripe_charges');
  if (f.prepaid === null) failures.push('mcp_prepaid_entitlements');
  if (f.trialReadOk === false) failures.push('trial_ends_at');
  if (f.poolFunded === null) failures.push('payer');
  if (f.lifetimeMember === null) failures.push('lifetime_purchase');
  if (f.proGiant === null) failures.push('pro_giant');

  const sources = new Set<PaidSource>();
  if (f.isStaff) sources.add('staff');
  if (f.isAdvocate) sources.add('advocate');
  if (f.isComp) sources.add('comp');
  const complimentaryRegistry = f.isStaff || f.isAdvocate || f.isComp;

  if (failures.length) {
    return {
      kind: 'unknown', sources: [...sources], paidFunding: null,
      complimentaryAccess: complimentaryRegistry,
      liveProGrant: f.liveProGrant === true,
      evidence: { liveSubscriptionStatus: null, promotionalReasons: [], ledgerTruncated: !!f.ledgerTruncated },
      failures,
    };
  }

  const ledger = f.ledgerGrants!;
  const subs = f.subscriptions!;
  const charges = f.charges!;

  // --- Stripe facts
  const liveNonTrial = subs.find((s) => subIsLive(s) && (s.plan_amount ?? 0) > 0 && !subIsTrialing(s, now));
  const paidCharge = !!liveNonTrial && charges.some((c) => chargePaysFor(c, liveNonTrial, now));
  const trialingSub = subs.find((s) => subIsTrialing(s, now) && !s.ended_at && s.status !== 'canceled');
  const anyLiveSub = subs.some((s) => subIsLive(s) || subIsTrialing(s, now));
  // A trial on some other plan must not keep an ended paid plan "live".
  const anyLivePaidSub = subs.some((s) => subIsLive(s) && (s.plan_amount ?? 0) > 0 && !subIsTrialing(s, now));
  const mirrorHasSubs = subs.length > 0;

  // --- Ledger facts
  const reasons = new Set(ledger.map((g) => g.reason));
  const latest = (r: string): number =>
    Math.max(-Infinity, ...ledger.filter((g) => g.reason === r).map((g) => ts(g.created_at)).filter(Number.isFinite));
  const mcpMonthlyLive = latest('mcp_sub_monthly') >= now - MCP_SUB_MONTHLY_WINDOW_DAYS * DAY_MS;
  const mcpAnnualLive = latest('mcp_sub_annual') >= now - MCP_SUB_ANNUAL_WINDOW_DAYS * DAY_MS;
  const hadMcpSub = reasons.has('mcp_sub_monthly') || reasons.has('mcp_sub_annual');
  const hadAppTier = REQUIRES_PAID_INVOICE.some((r) => reasons.has(r));

  // A ledger window only stands in for Stripe when the mirror has NO subscription for
  // this customer. If the mirror holds subscriptions and none is live, the plan ended —
  // e.g. an annual plan cancelled after its period, whose last grant is <370 days old.
  const mcpSubLive = (mcpMonthlyLive || mcpAnnualLive) && (!mirrorHasSubs || anyLivePaidSub);
  const latestAppTier = Math.max(latest('app_tier_pro'), latest('app_tier_team'));

  const activePaidSub = !!liveNonTrial && (paidCharge || hadMcpSub);
  if (activePaidSub) sources.add('stripe_subscription_paid');
  if (mcpSubLive) sources.add('mcp_subscription_ledger');
  if (hadAppTier) sources.add(activePaidSub || paidCharge ? 'app_tier_ledger_corroborated' : 'unverified_app_tier');

  const creditPurchase = ledger.some((g) =>
    CREDIT_PURCHASE_REASONS.has(g.reason) || (policy.adminGrantIsPaid && g.reason === 'admin_grant'));
  if (creditPurchase) sources.add('credit_purchase');

  const today = new Date(now).toISOString().slice(0, 10);
  const prepaidLive = f.prepaid!.some((p) => p.access_starts_on <= today && today <= p.access_ends_on);
  if (prepaidLive) sources.add('prepaid');

  // Lifetime / bundle buyers paid once for permanent access: paid, like a prepaid term.
  const lifetime = f.lifetimeMember === true;
  if (lifetime) sources.add('lifetime_purchase');

  // Pro Giant bought ONE year of Pro: paid only inside purchase + 365 days. After that it is
  // not paid (it never falls into the lifetime rule), and a missing date is unknown below.
  const proGiantAt = ts(f.proGiant?.purchasedAt ?? null);
  const proGiantDateMissing = !!f.proGiant && !Number.isFinite(proGiantAt);
  const proGiantLive = !!f.proGiant && Number.isFinite(proGiantAt)
    && proGiantAt <= now && now < proGiantAt + PRO_GIANT_TERM_DAYS * DAY_MS;
  if (proGiantLive) sources.add('pro_giant_term');

  if (f.poolFunded) sources.add('pool');

  const profileTrial = Number.isFinite(ts(f.trialEndsAt ?? null)) && ts(f.trialEndsAt ?? null) >= now;
  const trialing = !!trialingSub || profileTrial;
  if (trialing) sources.add('trial');

  const complimentaryLedger = ledger.some((g) => COMPLIMENTARY_REASONS.has(g.reason));
  if (complimentaryLedger) sources.add('complimentary_ledger');

  if (HISTORICALLY_AMBIGUOUS_REASONS.some((r) => reasons.has(r))) sources.add('ambiguous_pro_monthly');

  const known = new Set<string>([
    ...PAID_FUNDING_REASONS, ...HISTORICALLY_AMBIGUOUS_REASONS, ...COMPLIMENTARY_REASONS, ...NEUTRAL_REASONS,
    ...(policy.adminGrantIsPaid ? ['admin_grant'] : []),
  ]);
  const promotionalReasons = [...reasons].filter((r) => !known.has(r)).sort();
  if (promotionalReasons.length) sources.add('promotional_credits');

  const hadSubscription = mirrorHasSubs || hadMcpSub || hadAppTier;
  const expired = hadSubscription && !anyLiveSub && !mcpSubLive;
  if (expired) sources.add('expired_subscription');

  // --- Headline kind (precedence)
  let kind: PaidStatusKind;
  if (activePaidSub || mcpSubLive || f.poolFunded) kind = 'active_paid';
  else if (prepaidLive || lifetime || proGiantLive) kind = 'prepaid';
  else if (creditPurchase) kind = 'paid_credits';
  else if (complimentaryRegistry || complimentaryLedger) kind = 'complimentary';
  else if (trialing) kind = 'trial';
  else if (expired) kind = 'expired';
  else if (promotionalReasons.length || reasons.size) kind = 'promotional_only';
  else kind = 'none';

  const paidFunding = kind === 'active_paid' || kind === 'prepaid' || kind === 'paid_credits';

  // Negative answers that are NOT established, so they are unknown:
  //  - a capped ledger read can hide an older paid row (positive evidence still stands);
  //  - a live, non-trial, priced subscription whose paid invoice has not reached the
  //    mirror yet (stripe_charges syncs daily; a 100%-off coupon also lands here).
  //  - a pro_monthly row with nothing else: historically written for paying Pro, for
  //    lifetime/bundle buyers AND for comp, so it can be neither paid nor free here.
  const ambiguousOnly = sources.has('ambiguous_pro_monthly') && !complimentaryRegistry && !complimentaryLedger;
  //  - a recent app_tier_* grant the mirror cannot account for: the Stripe customer email
  //    can differ from the login email, and the mirror syncs daily (an old helper allowed
  //    these accounts, so calling them expired would block a paying customer).
  const appTierUnexplained = !trialing && !anyLivePaidSub && Number.isFinite(latestAppTier) && (
    !mirrorHasSubs
      ? latestAppTier >= now - APP_TIER_NO_MIRROR_WINDOW_DAYS * DAY_MS
      : latestAppTier >= now - APP_TIER_STALE_MIRROR_WINDOW_DAYS * DAY_MS);
  const unestablished = !paidFunding && (
    f.ledgerTruncated ? 'mcp_credit_ledger_truncated'
      : f.stripeTruncated ? 'stripe_mirror_truncated'
        : liveNonTrial && !paidCharge && !hadMcpSub ? 'paid_invoice_not_mirrored'
          : appTierUnexplained ? (mirrorHasSubs ? 'app_tier_mirror_stale' : 'app_tier_no_mirrored_subscription')
            : ambiguousOnly && !trialing ? 'ambiguous_pro_monthly'
              : proGiantDateMissing ? 'pro_giant_purchase_date_missing'
                : null);
  if (unestablished) {
    return {
      kind: 'unknown', sources: [...sources], paidFunding: null,
      complimentaryAccess: complimentaryRegistry || complimentaryLedger,
      liveProGrant: f.liveProGrant === true,
      evidence: { liveSubscriptionStatus: liveNonTrial?.status ?? null, promotionalReasons, ledgerTruncated: !!f.ledgerTruncated },
      failures: [unestablished],
    };
  }

  return {
    kind,
    sources: [...sources],
    paidFunding,
    complimentaryAccess: complimentaryRegistry || complimentaryLedger,
    liveProGrant: f.liveProGrant === true,
    evidence: {
      liveSubscriptionStatus: liveNonTrial?.status ?? trialingSub?.status ?? null,
      promotionalReasons,
      ledgerTruncated: !!f.ledgerTruncated,
    },
    failures: [],
  };
}

// ---------------------------------------------------------------------------------------
// Loader (read-only)
// ---------------------------------------------------------------------------------------

export type Read<T> = { ok: true; value: T } | { ok: false };

export interface PaidStatusReader {
  ledgerGrants(email: string, cap: number): Promise<Read<LedgerGrant[]>>;
  subscriptionsAndCharges(email: string): Promise<Read<{ subscriptions: SubscriptionFact[]; charges: ChargeFact[]; truncated?: boolean }>>;
  prepaid(email: string): Promise<Read<PrepaidFact[]>>;
  trialEndsAt(email: string): Promise<Read<string | null>>;
  poolFunded(email: string): Promise<Read<boolean>>;
  /** Optional so older readers keep working: absent = not read (counted as no). */
  lifetimeMember?(email: string): Promise<Read<boolean>>;
  /** Optional. ok+null = not a Pro Giant member with a live grant. */
  proGiant?(email: string): Promise<Read<ProGiantFact | null>>;
  /** Optional. A Pro grant live right now (access fact only). */
  liveProGrant?(email: string): Promise<Read<boolean>>;
}

export const LEDGER_CAP = 1000;
export const STRIPE_ROW_CAP = 200;

/** Escape PostgREST ILIKE wildcards so an email matches literally (case-insensitive). */
function ilikeLiteral(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

export const supabasePaidStatusReader: PaidStatusReader = {
  async ledgerGrants(email, cap) {
    const { data, error } = await getWriteClient()
      .from('mcp_credit_ledger')
      .select('reason, created_at')
      .eq('user_email', email)
      .gt('delta', 0)
      .order('created_at', { ascending: false })
      .limit(cap);
    if (error) return { ok: false };
    return { ok: true, value: (data ?? []) as LedgerGrant[] };
  },
  async subscriptionsAndCharges(email) {
    const db = getWriteClient();
    const { data: customers, error: cErr } = await db
      .from('stripe_customers').select('id').ilike('email', ilikeLiteral(email)).limit(50);
    if (cErr) return { ok: false };
    const ids = (customers ?? []).map((c) => (c as { id: string }).id);
    if (!ids.length) return { ok: true, value: { subscriptions: [], charges: [] } };
    const since = new Date(Date.now() - CHARGE_LOOKBACK_DAYS * DAY_MS).toISOString();
    const [subRes, chRes] = await Promise.all([
      db.from('stripe_subscriptions')
        .select('status, plan_amount, plan_interval, trial_end, current_period_start, current_period_end, ended_at')
        .in('customer_id', ids).limit(STRIPE_ROW_CAP),
      db.from('stripe_charges')
        .select('amount, amount_refunded, status, refunded, invoice_id, created_at')
        .in('customer_id', ids).eq('status', 'succeeded').gt('amount', 0).gte('created_at', since)
        .order('created_at', { ascending: false }).limit(STRIPE_ROW_CAP),
    ]);
    if (subRes.error || chRes.error) return { ok: false };
    const subscriptions = (subRes.data ?? []) as SubscriptionFact[];
    const charges = (chRes.data ?? []) as ChargeFact[];
    return {
      ok: true,
      value: { subscriptions, charges, truncated: subscriptions.length >= STRIPE_ROW_CAP || charges.length >= STRIPE_ROW_CAP },
    };
  },
  async prepaid(email) {
    const { data, error } = await getWriteClient()
      .from('mcp_prepaid_entitlements').select('access_starts_on, access_ends_on').eq('user_email', email).limit(50);
    if (error) return { ok: false };
    return { ok: true, value: (data ?? []) as PrepaidFact[] };
  },
  async trialEndsAt(email) {
    const db = getWriteClient();
    const [p, n] = await Promise.all([
      db.from('user_profiles').select('trial_ends_at').eq('email', email).maybeSingle(),
      db.from('user_notification_settings').select('trial_ends_at').eq('user_email', email).maybeSingle(),
    ]);
    if (p.error || n.error) return { ok: false };
    const pv = (p.data as { trial_ends_at?: string | null } | null)?.trial_ends_at ?? null;
    const nv = (n.data as { trial_ends_at?: string | null } | null)?.trial_ends_at ?? null;
    return { ok: true, value: pv || nv };
  },
  async poolFunded(email) {
    const payer = await resolvePayer(email);
    if (payer.kind === 'unavailable') return { ok: false };
    return { ok: true, value: payer.kind === 'pool' };
  },
  /**
   * Same attribution rule as R2 (entitlements/sources.ts): customer_classifications is a
   * point-in-time Stripe snapshot, so a 'lifetime' row counts only while a Pro grant is
   * live right now (KV briefings:{email} or an unexpired user_profiles.access_briefings).
   * A cancelled or churned row therefore never makes an account paid. A Pro Giant row is
   * never lifetime, whatever its briefings_access says.
   */
  async lifetimeMember(email) {
    const cls = await readClassification(email);
    if (!cls.ok) return { ok: false };
    const c = cls.value;
    if (!c || c.classification === 'pro_giant' || c.briefings_access !== 'lifetime' || !notExpiredIso(c.briefings_expiry)) {
      return { ok: true, value: false };
    }
    const grant = await liveProGrant(email);
    return grant.ok ? { ok: true, value: grant.value } : { ok: false };
  },
  /**
   * A Pro Giant buyer with a live Pro grant, and the date of the Pro Giant purchase from the
   * Stripe mirror: the earliest succeeded, unrefunded charge whose description names Pro
   * Giant. No such charge = purchasedAt null (unknown), never a guessed date.
   */
  async proGiant(email) {
    const cls = await readClassification(email);
    if (!cls.ok) return { ok: false };
    const c = cls.value;
    if (!c || (c.classification !== 'pro_giant' && c.bundle_tier !== 'Pro Giant Bundle')) return { ok: true, value: null };
    const grant = await liveProGrant(email);
    if (!grant.ok) return { ok: false };
    if (!grant.value) return { ok: true, value: null };
    const db = getWriteClient();
    const { data: customers, error: cErr } = await db
      .from('stripe_customers').select('id').ilike('email', ilikeLiteral(email)).limit(50);
    if (cErr) return { ok: false };
    const ids = (customers ?? []).map((x) => (x as { id: string }).id);
    if (!ids.length) return { ok: true, value: { purchasedAt: null } };
    const { data, error } = await db.from('stripe_charges')
      .select('created_at, refunded')
      .in('customer_id', ids).eq('status', 'succeeded').ilike('description', '%pro giant%')
      .order('created_at', { ascending: true }).limit(20);
    if (error) return { ok: false };
    const first = (data ?? []).find((r) => !(r as { refunded?: boolean | null }).refunded) as { created_at?: string } | undefined;
    return { ok: true, value: { purchasedAt: first?.created_at ?? null } };
  },
  liveProGrant: (email) => liveProGrant(email),
};

type ClassificationRow = {
  classification?: string | null; briefings_access?: string | null;
  briefings_expiry?: string | null; bundle_tier?: string | null;
};

function notExpiredIso(iso: string | null | undefined): boolean {
  return !iso || Date.parse(iso) >= Date.now();
}

async function readClassification(email: string): Promise<Read<ClassificationRow | null>> {
  const { data, error } = await getWriteClient().from('customer_classifications')
    .select('classification, briefings_access, briefings_expiry, bundle_tier').eq('email', email).maybeSingle();
  if (error) return { ok: false };
  return { ok: true, value: (data as ClassificationRow | null) ?? null };
}

/** A Pro grant live right now: unexpired user_profiles.access_briefings, else KV briefings:{email}. */
async function liveProGrant(email: string): Promise<Read<boolean>> {
  const { data, error } = await getWriteClient().from('user_profiles')
    .select('access_briefings, briefings_expires_at').eq('email', email).maybeSingle();
  if (error) return { ok: false };
  const p = data as { access_briefings?: boolean | null; briefings_expires_at?: string | null } | null;
  if (p?.access_briefings && notExpiredIso(p.briefings_expires_at)) return { ok: true, value: true };
  try { return { ok: true, value: !!(await kv.get(`briefings:${email}`)) }; } catch { return { ok: false }; }
}

/**
 * Access gates only: is a Pro grant live for this email right now? Throws when the grant
 * stores cannot be read, so a caller that fails open (the extraction guard) keeps doing so.
 */
export async function hasLiveProGrant(rawEmail: string): Promise<boolean> {
  const email = (rawEmail || '').toLowerCase().trim();
  if (!email) return false;
  const r = await liveProGrant(email);
  if (!r.ok) throw new Error('live Pro grant read failed');
  return r.value;
}

async function safe<T>(p: () => Promise<Read<T>>): Promise<Read<T>> {
  try { return await p(); } catch { return { ok: false }; }
}

/**
 * Resolve the paid status for a VERIFIED email. Never throws; a failed store read
 * yields kind 'unknown'.
 */
export async function resolvePaidStatus(
  rawEmail: string,
  opts: { now?: number; reader?: PaidStatusReader } = {},
): Promise<PaidStatus> {
  const email = (rawEmail || '').toLowerCase().trim();
  const now = opts.now ?? Date.now();
  const reader = opts.reader ?? supabasePaidStatusReader;
  const isStaff = !!email && getStaffRole(email) !== 'none';
  const isAdvocate = isAdvocateAccount(email);
  const isComp = COMP_TESTIMONIAL_EMAILS.has(email);
  if (!email) {
    return classifyPaidStatus({
      now, ledgerGrants: [], subscriptions: [], charges: [], prepaid: [], trialEndsAt: null,
      poolFunded: false, isStaff: false, isAdvocate: false, isComp: false,
    });
  }
  const [ledger, stripe, prepaid, trial, pool, lifetime, proGiant, grant] = await Promise.all([
    safe(() => reader.ledgerGrants(email, LEDGER_CAP)),
    safe(() => reader.subscriptionsAndCharges(email)),
    safe(() => reader.prepaid(email)),
    safe(() => reader.trialEndsAt(email)),
    safe(() => reader.poolFunded(email)),
    reader.lifetimeMember ? safe(() => reader.lifetimeMember!(email)) : Promise.resolve(undefined),
    reader.proGiant ? safe(() => reader.proGiant!(email)) : Promise.resolve(undefined),
    reader.liveProGrant ? safe(() => reader.liveProGrant!(email)) : Promise.resolve(undefined),
  ]);
  return classifyPaidStatus({
    now,
    ledgerGrants: ledger.ok ? ledger.value : null,
    ledgerTruncated: ledger.ok && ledger.value.length >= LEDGER_CAP,
    subscriptions: stripe.ok ? stripe.value.subscriptions : null,
    stripeTruncated: stripe.ok && !!stripe.value.truncated,
    charges: stripe.ok ? stripe.value.charges : null,
    prepaid: prepaid.ok ? prepaid.value : null,
    trialEndsAt: trial.ok ? trial.value : null,
    trialReadOk: trial.ok,
    poolFunded: pool.ok ? pool.value : null,
    lifetimeMember: lifetime === undefined ? undefined : lifetime.ok ? lifetime.value : null,
    proGiant: proGiant === undefined ? undefined : !proGiant.ok ? null : proGiant.value ?? undefined,
    liveProGrant: grant !== undefined && grant.ok && grant.value,
    isStaff, isAdvocate, isComp,
  });
}
