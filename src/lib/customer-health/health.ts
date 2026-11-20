/**
 * Customer health — one status per PAYING customer, so the team can reach out before they leave.
 * A paying customer is anyone with a live subscription OR a lifetime (one-time) Mindy purchase.
 *
 * Pure: no I/O. Inputs come from src/lib/customer-health/load.ts. Shown at /admin/customer-health.
 *
 * Statuses, checked in this order (the first match wins, so the most urgent problem shows):
 *   payment_problem  subscription past_due / unpaid, OR a failed charge in the last 30 days
 *   canceling        every subscription has cancel_at_period_end and they own no lifetime plan
 *                    (they asked to leave; still paying until period end)
 *   unknown          we could not read their activity — never shown as "inactive" (unknown is never zero)
 *   never_used       activity read OK and they have no recorded activity at all
 *   gone_quiet       last activity more than QUIET_DAYS ago
 *   healthy          everything else
 */

export const QUIET_DAYS = 14;
export const FAILED_CHARGE_WINDOW_DAYS = 30;

export type HealthStatus = 'payment_problem' | 'canceling' | 'unknown' | 'never_used' | 'gone_quiet' | 'healthy';

export const STATUS_ORDER: HealthStatus[] = ['payment_problem', 'canceling', 'unknown', 'never_used', 'gone_quiet', 'healthy'];

export const STATUS_LABEL: Record<HealthStatus, string> = {
  payment_problem: 'Payment problem',
  canceling: 'Canceling',
  unknown: 'Activity unknown',
  never_used: 'Never used it',
  gone_quiet: `Gone quiet (${QUIET_DAYS}+ days)`,
  healthy: 'Healthy',
};

export interface SubscriptionFact {
  subscriptionId: string;
  status: string; // Stripe status: active, trialing, past_due, unpaid, …
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  monthlyCents: number | null; // null = could not be normalized
  createdAt: string | null;
}

/** A lifetime (one-time) Mindy purchase. It earns no monthly revenue but they are still a customer. */
export interface LifetimeFact {
  productName: string;
  paidCents: number | null; // null = the amount was not recorded
  purchasedAt: string | null;
}

/** Activity lookup result. `ok: false` means the read failed: the status is unknown, not "inactive". */
export type ActivityFact = { ok: true; lastActivityAt: string | null } | { ok: false };

export interface CustomerFacts {
  email: string;
  name: string | null;
  /** null for a lifetime-only buyer with no Stripe customer record in the cache. */
  customerId: string | null;
  subscriptions: SubscriptionFact[];
  lifetime: LifetimeFact | null;
  failedChargesLast30d: number;
  lastFailedChargeAt: string | null;
  activity: ActivityFact;
}

export interface CustomerHealth {
  email: string;
  name: string | null;
  customerId: string | null;
  status: HealthStatus;
  reasons: string[];
  /** 'subscription', 'lifetime', or 'both'. */
  plan: 'subscription' | 'lifetime' | 'both';
  /** Monthly RECURRING revenue: sum over their paying subscriptions (0 for lifetime-only);
   *  null if any subscription could not be normalized. */
  monthlyCents: number | null;
  lifetime: LifetimeFact | null;
  subscriptionStatus: string;
  renewsOrEndsAt: string | null;
  lastActivityAt: string | null;
  daysSinceActivity: number | null;
  customerSince: string | null;
}

const DAY = 86_400_000;
const PAYMENT_BAD = new Set(['past_due', 'unpaid']);

export function daysBetween(fromIso: string, now: Date): number {
  return Math.floor((now.getTime() - new Date(fromIso).getTime()) / DAY);
}

export function classifyCustomer(c: CustomerFacts, now: Date = new Date()): CustomerHealth {
  const subs = c.subscriptions;
  const reasons: string[] = [];

  const badSub = subs.find((s) => PAYMENT_BAD.has(s.status));
  // A lifetime owner who cancels a subscription is still a customer, so that is not "canceling".
  const canceling = !c.lifetime && subs.length > 0 && subs.every((s) => s.cancelAtPeriodEnd);
  const lastActivityAt = c.activity.ok ? c.activity.lastActivityAt : null;
  const daysSinceActivity = lastActivityAt ? daysBetween(lastActivityAt, now) : null;

  let status: HealthStatus;
  if (badSub || c.failedChargesLast30d > 0) {
    status = 'payment_problem';
    if (badSub) reasons.push(`Subscription is ${badSub.status.replace('_', ' ')}`);
    if (c.failedChargesLast30d > 0) {
      reasons.push(`${c.failedChargesLast30d} failed charge${c.failedChargesLast30d === 1 ? '' : 's'} in the last ${FAILED_CHARGE_WINDOW_DAYS} days`);
    }
  } else if (canceling) {
    status = 'canceling';
    reasons.push('Set to cancel at the end of the billing period');
  } else if (!c.activity.ok) {
    status = 'unknown';
    reasons.push('Could not read their activity');
  } else if (!lastActivityAt) {
    status = 'never_used';
    reasons.push('Paying, but no recorded activity');
  } else if ((daysSinceActivity ?? 0) > QUIET_DAYS) {
    status = 'gone_quiet';
    reasons.push(`No activity for ${daysSinceActivity} days`);
  } else {
    status = 'healthy';
  }

  // Secondary signals, so a payment problem does not hide that they also went quiet.
  if (status === 'payment_problem' || status === 'canceling') {
    if (!c.activity.ok) reasons.push('Activity unknown');
    else if (!lastActivityAt) reasons.push('No recorded activity');
    else if (daysSinceActivity !== null && daysSinceActivity > QUIET_DAYS) reasons.push(`No activity for ${daysSinceActivity} days`);
  }

  const monthlyCents = subs.some((s) => s.monthlyCents === null)
    ? null
    : subs.reduce((sum, s) => sum + (s.monthlyCents || 0), 0);

  const primary = badSub || [...subs].sort((a, b) => (b.monthlyCents || 0) - (a.monthlyCents || 0))[0];
  const created = [...subs.map((s) => s.createdAt), c.lifetime?.purchasedAt ?? null]
    .filter((d): d is string => !!d).sort()[0] || null;
  const plan = subs.length && c.lifetime ? 'both' : c.lifetime ? 'lifetime' : 'subscription';

  return {
    email: c.email,
    name: c.name,
    customerId: c.customerId,
    status,
    reasons,
    plan,
    monthlyCents,
    lifetime: c.lifetime,
    subscriptionStatus: primary ? primary.status : 'none',
    renewsOrEndsAt: primary ? primary.currentPeriodEnd : null,
    lastActivityAt,
    daysSinceActivity,
    customerSince: created,
  };
}

/** Most urgent first; inside a status, the biggest monthly value first (who to call first). */
export function sortForOutreach(rows: CustomerHealth[]): CustomerHealth[] {
  const rank = new Map(STATUS_ORDER.map((s, i) => [s, i]));
  return [...rows].sort((a, b) =>
    (rank.get(a.status)! - rank.get(b.status)!)
    || ((b.monthlyCents ?? -1) - (a.monthlyCents ?? -1))
    || ((b.lifetime?.paidCents ?? -1) - (a.lifetime?.paidCents ?? -1))
    || a.email.localeCompare(b.email));
}

export interface HealthSummary {
  customers: number;
  byStatus: Record<HealthStatus, number>;
  /** Monthly RECURRING revenue held by customers who are not healthy. null if any of it could not be
   *  measured. Lifetime purchases add nothing here: they are counted below instead. */
  atRiskMonthlyCents: number | null;
  lifetimeCustomers: number;
  lifetimeNotHealthy: number;
}

export function summarize(rows: CustomerHealth[]): HealthSummary {
  const byStatus = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0])) as Record<HealthStatus, number>;
  let atRisk: number | null = 0;
  let lifetimeCustomers = 0;
  let lifetimeNotHealthy = 0;
  for (const r of rows) {
    byStatus[r.status]++;
    if (r.lifetime) {
      lifetimeCustomers++;
      if (r.status !== 'healthy') lifetimeNotHealthy++;
    }
    if (r.status !== 'healthy') {
      if (r.monthlyCents === null || atRisk === null) atRisk = null;
      else atRisk += r.monthlyCents;
    }
  }
  return { customers: rows.length, byStatus, atRiskMonthlyCents: atRisk, lifetimeCustomers, lifetimeNotHealthy };
}
