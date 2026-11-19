import { describe, expect, it } from 'vitest';
import { classifyCustomer, sortForOutreach, summarize, type CustomerFacts, type SubscriptionFact } from './health';
import { loadCustomerHealthData } from './load';

const NOW = new Date('2026-11-19T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const sub = (o: Partial<SubscriptionFact> = {}): SubscriptionFact => ({
  subscriptionId: 'sub_1', status: 'active', cancelAtPeriodEnd: false, currentPeriodEnd: daysAgo(-20), monthlyCents: 14900, createdAt: daysAgo(200), ...o,
});
const facts = (o: Partial<CustomerFacts> = {}): CustomerFacts => ({
  email: 'a@x.com', name: null, customerId: 'cus_1', subscriptions: [sub()], failedChargesLast30d: 0, lastFailedChargeAt: null,
  activity: { ok: true, lastActivityAt: daysAgo(2) }, ...o,
});

describe('classifyCustomer', () => {
  it('healthy when paying and active recently', () => {
    expect(classifyCustomer(facts(), NOW).status).toBe('healthy');
  });

  it('payment problem beats everything, and still says they went quiet', () => {
    const h = classifyCustomer(facts({ subscriptions: [sub({ status: 'past_due', cancelAtPeriodEnd: true })], activity: { ok: true, lastActivityAt: daysAgo(40) } }), NOW);
    expect(h.status).toBe('payment_problem');
    expect(h.reasons.join(' ')).toContain('past due');
    expect(h.reasons.join(' ')).toContain('40 days');
  });

  it('a failed charge alone is a payment problem', () => {
    expect(classifyCustomer(facts({ failedChargesLast30d: 2 }), NOW).status).toBe('payment_problem');
  });

  it('canceling only when every subscription is set to cancel', () => {
    expect(classifyCustomer(facts({ subscriptions: [sub({ cancelAtPeriodEnd: true })] }), NOW).status).toBe('canceling');
    expect(classifyCustomer(facts({ subscriptions: [sub({ cancelAtPeriodEnd: true }), sub({ subscriptionId: 's2' })] }), NOW).status).toBe('healthy');
  });

  it('a failed activity read is UNKNOWN, never "never used" or "gone quiet"', () => {
    const h = classifyCustomer(facts({ activity: { ok: false } }), NOW);
    expect(h.status).toBe('unknown');
    expect(h.lastActivityAt).toBeNull();
  });

  it('never used vs gone quiet', () => {
    expect(classifyCustomer(facts({ activity: { ok: true, lastActivityAt: null } }), NOW).status).toBe('never_used');
    expect(classifyCustomer(facts({ activity: { ok: true, lastActivityAt: daysAgo(15) } }), NOW).status).toBe('gone_quiet');
    expect(classifyCustomer(facts({ activity: { ok: true, lastActivityAt: daysAgo(14) } }), NOW).status).toBe('healthy');
  });

  it('monthly value is unknown (null) when any subscription cannot be measured', () => {
    expect(classifyCustomer(facts({ subscriptions: [sub(), sub({ monthlyCents: null })] }), NOW).monthlyCents).toBeNull();
  });
});

describe('sort + summary', () => {
  it('most urgent first, then biggest value', () => {
    const rows = sortForOutreach([
      classifyCustomer(facts({ email: 'h@x.com' }), NOW),
      classifyCustomer(facts({ email: 'q-small@x.com', subscriptions: [sub({ monthlyCents: 9900 })], activity: { ok: true, lastActivityAt: daysAgo(30) } }), NOW),
      classifyCustomer(facts({ email: 'q-big@x.com', subscriptions: [sub({ monthlyCents: 24900 })], activity: { ok: true, lastActivityAt: daysAgo(30) } }), NOW),
      classifyCustomer(facts({ email: 'p@x.com', failedChargesLast30d: 1 }), NOW),
    ]);
    expect(rows.map((r) => r.email)).toEqual(['p@x.com', 'q-big@x.com', 'q-small@x.com', 'h@x.com']);
  });

  it('revenue at risk is null (unknown), not a smaller number, when any at-risk value is unknown', () => {
    const s = summarize([
      classifyCustomer(facts({ failedChargesLast30d: 1 }), NOW),
      classifyCustomer(facts({ email: 'b@x.com', subscriptions: [sub({ monthlyCents: null })], activity: { ok: true, lastActivityAt: null } }), NOW),
    ]);
    expect(s.atRiskMonthlyCents).toBeNull();
    expect(s.byStatus.payment_problem).toBe(1);
    expect(s.byStatus.never_used).toBe(1);
  });
});

// Minimal fake of the supabase query builder for the tables the loader reads.
function fakeDb(tables: Record<string, Record<string, unknown>[]>, fail: Set<string> = new Set()) {
  return {
    from(table: string) {
      let rows = [...(tables[table] || [])];
      let lim: number | null = null;
      let range: [number, number] | null = null;
      const q = {
        select: () => q,
        in: (col: string, vals: unknown[]) => { rows = rows.filter((r) => vals.includes(r[col])); return q; },
        eq: (col: string, v: unknown) => { rows = rows.filter((r) => r[col] === v); return q; },
        gte: (col: string, v: string) => { rows = rows.filter((r) => String(r[col]) >= v); return q; },
        order: (col: string, o?: { ascending?: boolean }) => { rows.sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (o?.ascending === false ? -1 : 1)); return q; },
        limit: (n: number) => { lim = n; return q; },
        range: (a: number, b: number) => { range = [a, b]; return q; },
        maybeSingle: () => Promise.resolve({ data: rows[0] || null, error: null }),
        then: (res: (v: unknown) => unknown) => {
          if (fail.has(table)) return Promise.resolve({ data: null, error: { message: 'boom' } }).then(res);
          let out = rows;
          if (range) out = out.slice(range[0], range[1] + 1);
          if (lim !== null) out = out.slice(0, lim);
          return Promise.resolve({ data: out, error: null }).then(res);
        },
      };
      return q;
    },
  } as never;
}

describe('loadCustomerHealthData', () => {
  const tables = {
    stripe_subscriptions: [
      { id: 's1', customer_id: 'c1', status: 'active', cancel_at_period_end: false, current_period_end: daysAgo(-10), created_at: daysAgo(100), plan_amount: 14900, plan_interval: 'month', plan_interval_count: 1, updated_at: daysAgo(0.5) },
      { id: 's2', customer_id: 'c2', status: 'past_due', cancel_at_period_end: false, current_period_end: daysAgo(-3), created_at: daysAgo(50), plan_amount: 9900, plan_interval: 'month', plan_interval_count: 1 },
      { id: 's3', customer_id: 'c3', status: 'canceled', plan_amount: 9900 },
      { id: 's4', customer_id: 'c4', status: 'active', plan_amount: 9900, plan_interval: 'month', plan_interval_count: 1 },
    ],
    stripe_customers: [
      { id: 'c1', email: 'One@X.com', name: 'One' },
      { id: 'c2', email: 'two@x.com', name: null },
      { id: 'c3', email: 'gone@x.com', name: null },
    ],
    stripe_charges: [{ customer_id: 'c2', status: 'failed', created_at: daysAgo(3) }],
    user_engagement: [{ user_email: 'one@x.com', created_at: daysAgo(1) }],
  };

  it('groups by lower-cased email, skips non-paying, counts subscriptions with no email', async () => {
    const r = await loadCustomerHealthData(fakeDb(tables), NOW);
    expect(r.customers.map((c) => c.email).sort()).toEqual(['one@x.com', 'two@x.com']);
    expect(r.subscriptionsWithoutEmail).toBe(1);
    const two = r.customers.find((c) => c.email === 'two@x.com')!;
    expect(two.failedChargesLast30d).toBe(1);
    expect(two.activity).toEqual({ ok: true, lastActivityAt: null });
  });

  it('a failed activity read becomes unknown, not empty', async () => {
    const r = await loadCustomerHealthData(fakeDb(tables, new Set(['user_engagement'])), NOW);
    expect(r.customers.every((c) => c.activity.ok === false)).toBe(true);
  });

  it('a failed billing read throws instead of showing a partial list', async () => {
    await expect(loadCustomerHealthData(fakeDb(tables, new Set(['stripe_charges'])), NOW)).rejects.toThrow(/stripe_charges/);
  });
});
