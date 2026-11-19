/**
 * Loads the facts behind /admin/customer-health. READ-ONLY.
 *
 * Sources (all already in our DB; no live Stripe call):
 *   stripe_subscriptions  paying states (active, trialing, past_due, unpaid) — the daily Stripe cache
 *   stripe_customers      customer_id → email (one email can have several customer ids: grouped by email)
 *   stripe_charges        failed charges in the last 30 days
 *   user_engagement       each customer's latest event (index user_email, created_at DESC)
 *
 * Rules:
 *  - every multi-row read pages past PostgREST's 1,000-row cap, and a failed read THROWS (a partial
 *    list would hide customers);
 *  - a failed per-customer activity read becomes `activity: { ok: false }` → shown as "unknown",
 *    never as "inactive";
 *  - comp / partner / advocate / test accounts are excluded (isExcludedFromMetrics), as in MRR.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { isExcludedFromMetrics } from '@/lib/mindy/campaign-exclusions';
import { monthlyRecurring } from '@/lib/stripe/recurring-normalize';
import { FAILED_CHARGE_WINDOW_DAYS, type ActivityFact, type CustomerFacts, type SubscriptionFact } from './health';

const PAGE = 1000;
const MAX_ROWS = 60_000;
export const PAYING_STATUSES = ['active', 'trialing', 'past_due', 'unpaid'];

async function readAll<T>(label: string, page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(`${label} read failed: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < PAGE) return out;
  }
  throw new Error(`${label} has more than ${MAX_ROWS} rows; refusing to show a partial list`);
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

interface SubRow {
  id: string;
  customer_id: string | null;
  status: string;
  cancel_at_period_end: boolean | null;
  current_period_end: string | null;
  created_at: string | null;
  plan_amount: number | null;
  plan_interval: string | null;
  plan_interval_count: number | null;
}

export interface LoadedHealthData {
  customers: CustomerFacts[];
  /** Subscriptions whose customer id has no email in stripe_customers: counted, not silently dropped. */
  subscriptionsWithoutEmail: number;
  excludedAccounts: number;
  stripeCacheUpdatedAt: string | null;
}

export async function loadCustomerHealthData(db: SupabaseClient, now: Date = new Date()): Promise<LoadedHealthData> {
  const subs = await readAll<SubRow>('stripe_subscriptions', (from, to) => db
    .from('stripe_subscriptions')
    .select('id, customer_id, status, cancel_at_period_end, current_period_end, created_at, plan_amount, plan_interval, plan_interval_count')
    .in('status', PAYING_STATUSES)
    .order('id')
    .range(from, to));

  const customerIds = [...new Set(subs.map((s) => s.customer_id).filter((x): x is string => !!x))];

  const customers: Array<{ id: string; email: string | null; name: string | null }> = [];
  for (let i = 0; i < customerIds.length; i += 200) {
    const chunk = customerIds.slice(i, i + 200);
    const { data, error } = await db.from('stripe_customers').select('id, email, name').in('id', chunk);
    if (error) throw new Error(`stripe_customers read failed: ${error.message}`);
    customers.push(...((data || []) as typeof customers));
  }
  const customerById = new Map(customers.map((c) => [c.id, c]));

  const since = new Date(now.getTime() - FAILED_CHARGE_WINDOW_DAYS * 86_400_000).toISOString();
  const failed = await readAll<{ customer_id: string | null; created_at: string }>('stripe_charges', (from, to) => db
    .from('stripe_charges')
    .select('customer_id, created_at')
    .eq('status', 'failed')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .range(from, to));

  // Group by email.
  const byEmail = new Map<string, { name: string | null; customerIds: Set<string>; subs: SubscriptionFact[] }>();
  let subscriptionsWithoutEmail = 0;
  const excluded = new Set<string>();
  for (const s of subs) {
    const c = s.customer_id ? customerById.get(s.customer_id) : undefined;
    const email = c?.email?.toLowerCase().trim();
    if (!email) { subscriptionsWithoutEmail++; continue; }
    if (isExcludedFromMetrics(email)) { excluded.add(email); continue; }
    const g = byEmail.get(email) || { name: c?.name || null, customerIds: new Set<string>(), subs: [] };
    g.customerIds.add(s.customer_id!);
    g.subs.push({
      subscriptionId: s.id,
      status: s.status,
      cancelAtPeriodEnd: !!s.cancel_at_period_end,
      currentPeriodEnd: s.current_period_end,
      createdAt: s.created_at,
      monthlyCents: (s.plan_amount || 0) <= 0 ? 0 : monthlyRecurring(s).monthlyCents,
    });
    byEmail.set(email, g);
  }

  const emails = [...byEmail.keys()];
  const activity = await mapLimit(emails, 10, async (email): Promise<ActivityFact> => {
    try {
      const { data, error } = await db
        .from('user_engagement')
        .select('created_at')
        .eq('user_email', email)
        .order('created_at', { ascending: false })
        .limit(1);
      if (error) return { ok: false };
      return { ok: true, lastActivityAt: (data?.[0] as { created_at?: string } | undefined)?.created_at || null };
    } catch {
      return { ok: false };
    }
  });

  let stripeCacheUpdatedAt: string | null = null;
  try {
    const { data } = await db.from('stripe_subscriptions').select('updated_at').order('updated_at', { ascending: false }).limit(1).maybeSingle();
    stripeCacheUpdatedAt = (data as { updated_at?: string } | null)?.updated_at || null;
  } catch { /* freshness is informational; shown as unknown */ }

  const out: CustomerFacts[] = emails.map((email, i) => {
    const g = byEmail.get(email)!;
    const mine = failed.filter((f) => f.customer_id && g.customerIds.has(f.customer_id));
    return {
      email,
      name: g.name,
      customerId: [...g.customerIds][0],
      subscriptions: g.subs,
      failedChargesLast30d: mine.length,
      lastFailedChargeAt: mine[0]?.created_at || null,
      activity: activity[i],
    };
  });

  return { customers: out, subscriptionsWithoutEmail, excludedAccounts: excluded.size, stripeCacheUpdatedAt };
}
