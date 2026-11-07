/**
 * Revoke Mindy Pro / Team access when the Stripe subscription that paid for it ends.
 *
 * THE GAP THIS CLOSES
 * Stripe delivers `customer.subscription.deleted` to ONE live endpoint:
 * getmindy.ai/api/stripe-webhook. That handler only acted on FHC and Alert Pro
 * products and returned `ignored` for everything else, MI Pro included. The
 * handler that DID revoke (/api/webhooks/stripe → handleSubscriptionDeleted) sits
 * behind a Stripe endpoint that is disabled, so it never ran.
 *
 * Net: every cancelled MI Pro subscriber kept Pro forever. Found 2026-11-02 when
 * a customer who asked to cancel still had access after the Stripe cancel;
 * measured 2026-11-07: 14 more cancelled $149/mo subscribers (ended 2026-08-17 →
 * 2026-11-06) still holding Pro, every one confirmed live in Stripe as having no
 * active subscription.
 *
 * WHAT IT REFUSES TO REVOKE (each is a real way Pro is held WITHOUT this sub)
 *   - another live Pro/Team subscription on the same email (upgrade, re-subscribe,
 *     second Stripe customer)
 *   - a lifetime Mindy purchase, or a legacy bundle (grandfathered — see
 *     product-entitlement.ts isGrandfathered: taking a working thing away is the
 *     worse error)
 *   - a live off-Stripe prepaid entitlement (mcp_prepaid_entitlements)
 *   - advocate (comp Pro by design) and staff accounts
 * A guard that cannot be ESTABLISHED (query error) also blocks: wrongly leaving
 * access on is the status quo; wrongly cutting off a payer is the incident.
 *
 * Only the briefings/Team entitlement is revoked. Other one-time tool purchases
 * (MA, Content Reaper, Contractor DB, …) are separate grants and untouched.
 */
import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import { revokeBriefingsAccess } from '@/lib/briefings/access';
import { briefingGrantForCustomer } from '@/lib/briefings/product-entitlement';
import { isAdvocateAccount } from '@/lib/mindy/advocate-accounts';
import { getStaffRole } from '@/lib/api-auth';
import { PRO_AMOUNTS, TEAM_AMOUNTS } from '@/lib/mcp/app-tier-subscription';

export type AppTier = 'pro' | 'team';

/** Statuses where a subscription is still paying for (or recovering) access. */
const LIVE_STATUSES = new Set(['active', 'trialing', 'past_due']);

/** Which app tier a subscription pays for, from its price amount (same rule as the credit grant). */
export function appTierOfSubscription(sub: Pick<Stripe.Subscription, 'items'>): AppTier | null {
  let tier: AppTier | null = null;
  for (const item of sub.items?.data ?? []) {
    const amount = item.price?.unit_amount ?? null;
    if (amount == null) continue;
    if (TEAM_AMOUNTS.has(amount)) return 'team';
    if (PRO_AMOUNTS.has(amount)) tier = 'pro';
  }
  return tier;
}

export interface RevokeGuardFacts {
  email: string;
  /** null = could not be established */
  otherLiveAppSub: boolean | null;
  prepaidLive: boolean | null;
  purchases: Array<{ product_name?: string | null; amount_paid?: number | null }> | null;
  /** null = no classification row; undefined = could not be established */
  classificationAccess: string | null | undefined;
}

/** Pure decision: returns why NOT to revoke, or null to proceed. */
export function revokeBlockReason(f: RevokeGuardFacts): string | null {
  if (getStaffRole(f.email) !== 'none') return 'staff_account';
  if (isAdvocateAccount(f.email)) return 'advocate_account';
  if (f.otherLiveAppSub === null) return 'guard_unknown:other_subscriptions';
  if (f.otherLiveAppSub) return 'other_live_app_subscription';
  if (f.prepaidLive === null) return 'guard_unknown:prepaid';
  if (f.prepaidLive) return 'live_prepaid_entitlement';
  if (f.purchases === null) return 'guard_unknown:purchases';
  if (f.classificationAccess === undefined) return 'guard_unknown:classification';
  if (String(f.classificationAccess || '') === 'lifetime') return 'lifetime_classification';
  const grant = briefingGrantForCustomer(f.purchases);
  if (grant.earns && grant.access === 'lifetime') return 'lifetime_purchase';
  if (f.purchases.some((p) => /bundle/i.test(p.product_name || ''))) return 'legacy_bundle_grandfathered';
  return null;
}

export type RevokeOutcome =
  | { handled: false }
  | { handled: true; email: string | null; tier: AppTier; revoked: false; reason: string }
  | { handled: true; email: string; tier: AppTier; revoked: true; failures: string[] };

async function resolveEmail(stripe: Stripe, sub: Stripe.Subscription): Promise<string | null> {
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
  if (!customerId) return null;
  const customer = await stripe.customers.retrieve(customerId);
  if ('deleted' in customer && customer.deleted) return null;
  return (customer.email || '').toLowerCase().trim() || null;
}

/** Any OTHER live Pro/Team subscription on any Stripe customer with this email. */
async function hasOtherLiveAppSub(stripe: Stripe, email: string, endedSubId: string | null): Promise<boolean | null> {
  try {
    // Search, not list: customers.list({ email }) is a case-SENSITIVE exact match and
    // would miss a customer created as "Name@Domain.com".
    const customers = await stripe.customers.search({ query: `email:'${email.replace(/'/g, "\\'")}'`, limit: 100 });
    for (const c of customers.data) {
      const subs = await stripe.subscriptions.list({ customer: c.id, status: 'all', limit: 100 });
      for (const s of subs.data) {
        if (s.id === endedSubId) continue;
        if (LIVE_STATUSES.has(s.status) && appTierOfSubscription(s)) return true;
      }
    }
    return false;
  } catch (e) {
    console.error(`[revoke-app-tier] could not list subscriptions for ${email}:`, e);
    return null;
  }
}

async function hasLivePrepaid(sb: SupabaseClient, email: string): Promise<boolean | null> {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await sb
    .from('mcp_prepaid_entitlements')
    .select('id')
    .eq('user_email', email)
    .eq('status', 'active')
    .gte('access_ends_on', today)
    .limit(1);
  if (error) {
    console.error(`[revoke-app-tier] prepaid lookup failed for ${email}:`, error.message);
    return null;
  }
  return (data ?? []).length > 0;
}

async function loadPurchases(sb: SupabaseClient, email: string) {
  const { data, error } = await sb
    .from('purchases')
    .select('product_name, amount_paid')
    // Case-insensitive exact match: escape LIKE wildcards so `_` in an address
    // can't match someone else's purchases.
    .ilike('user_email', email.replace(/[\\%_]/g, (c) => `\\${c}`));
  if (error) {
    console.error(`[revoke-app-tier] purchases lookup failed for ${email}:`, error.message);
    return null;
  }
  return data ?? [];
}

async function loadClassificationAccess(sb: SupabaseClient, email: string): Promise<string | null | undefined> {
  const { data, error } = await sb
    .from('customer_classifications')
    .select('briefings_access')
    .eq('email', email)
    .maybeSingle();
  if (error) {
    console.error(`[revoke-app-tier] classification lookup failed for ${email}:`, error.message);
    return undefined;
  }
  return (data as { briefings_access?: string | null } | null)?.briefings_access ?? null;
}

/**
 * Establish every alternative-entitlement fact for an email. `endedSubId` is the
 * subscription being revoked (excluded from the "other live sub" check); pass null
 * to count every live app-tier subscription.
 */
export async function gatherGuardFacts(
  sb: SupabaseClient,
  stripe: Stripe,
  email: string,
  endedSubId: string | null,
): Promise<RevokeGuardFacts> {
  const [otherLiveAppSub, prepaidLive, purchases, classificationAccess] = await Promise.all([
    hasOtherLiveAppSub(stripe, email, endedSubId),
    hasLivePrepaid(sb, email),
    loadPurchases(sb, email),
    loadClassificationAccess(sb, email),
  ]);
  return { email, otherLiveAppSub, prepaidLive, purchases, classificationAccess };
}

/**
 * Clear the Pro (and, for Team, the Team) entitlement from every store that grants
 * it. Fails soft: each store is independent, failures are returned, never thrown.
 */
export async function applyRevoke(sb: SupabaseClient, email: string, tier: AppTier): Promise<string[]> {
  const failures: string[] = [];
  const now = new Date().toISOString();
  // 1) KV: the gate hasBriefingsAccess checks FIRST. Cut entry before the Supabase writes.
  try {
    await revokeBriefingsAccess(email);
  } catch (e) {
    failures.push(`kv: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 2) Profile flags: the fallback hasBriefingsAccess falls through to (+ Team tier).
  try {
    const patch: Record<string, unknown> = { access_briefings: false, briefings_expires_at: null, updated_at: now };
    if (tier === 'team') patch.access_team = false;
    const { error } = await sb.from('user_profiles').update(patch).eq('email', email);
    if (error) failures.push(`user_profiles: ${error.message}`);
  } catch (e) {
    failures.push(`user_profiles: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 3) Notification settings: stops briefing SENDING, and clears the stale paid flag.
  try {
    const { error } = await sb
      .from('user_notification_settings')
      .update({ briefings_enabled: false, paid_status: false, updated_at: now })
      .eq('user_email', email);
    if (error) failures.push(`user_notification_settings: ${error.message}`);
  } catch (e) {
    failures.push(`user_notification_settings: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 4) customer_classifications: the briefing CRON's audience (fetchBriefingEntitlements).
  try {
    const { error } = await sb
      .from('customer_classifications')
      .update({ briefings_access: 'none', has_active_subscription: false, updated_at: now })
      .eq('email', email);
    if (error) failures.push(`customer_classifications: ${error.message}`);
  } catch (e) {
    failures.push(`customer_classifications: ${e instanceof Error ? e.message : String(e)}`);
  }
  return failures;
}

/**
 * Revoke the entitlement a just-ended subscription paid for. Call ONLY for a
 * subscription that has ended (`customer.subscription.deleted`), never for
 * past_due — that is dunning, and the customer may still pay.
 */
export async function revokeAppTierOnCancel(
  sb: SupabaseClient,
  stripe: Stripe,
  sub: Stripe.Subscription,
): Promise<RevokeOutcome> {
  const tier = appTierOfSubscription(sub);
  if (!tier) return { handled: false };

  let email: string | null = null;
  try {
    email = await resolveEmail(stripe, sub);
  } catch (e) {
    console.error(`[revoke-app-tier] could not resolve customer email for ${sub.id}:`, e);
  }
  if (!email) {
    console.error(`[revoke-app-tier] NO EMAIL for sub ${sub.id}: entitlement NOT revoked, revoke by hand`);
    return { handled: true, email: null, tier, revoked: false, reason: 'no_email' };
  }

  const facts = await gatherGuardFacts(sb, stripe, email, sub.id);
  const block = revokeBlockReason(facts);
  if (block) {
    console.warn(`[revoke-app-tier] NOT revoking ${email} (sub ${sub.id}, ${tier}): ${block}`);
    return { handled: true, email, tier, revoked: false, reason: block };
  }

  const failures = await applyRevoke(sb, email, tier);
  if (failures.length) console.error(`[revoke-app-tier] partial revoke for ${email}:`, failures);
  else console.log(`[revoke-app-tier] revoked ${tier} for ${email} (sub ${sub.id})`);
  return { handled: true, email, tier, revoked: true, failures };
}
