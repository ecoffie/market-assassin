/**
 * mrr-goal against the real shape of the mirror, reading from a fake that fails on a column
 * the table does not have (PostgREST behaviour). That is what hid one-time cash for months.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const CHARGE_COLUMNS = new Set(['amount', 'status', 'invoice_id', 'created_at']);
const db = vi.hoisted(() => ({
  subs: [] as Record<string, unknown>[],
  charges: [] as Record<string, unknown>[],
  subsError: null as null | { message: string },
}));

vi.mock('@/lib/mindy/campaign-exclusions', () => ({ isExcludedFromMetrics: () => false }));
vi.mock('@/lib/mindy/upgrade-intent', () => ({ fetchUpgradeEngagementRows: async () => [] }));

function query(table: string, cols: string) {
  const rows = table === 'stripe_subscriptions' ? db.subs : table === 'stripe_charges' ? db.charges : [];
  const badColumn = table === 'stripe_charges' && cols !== '*' && cols.split(',').map((c) => c.trim()).some((c) => !CHARGE_COLUMNS.has(c));
  const error = badColumn ? { message: 'column does not exist' } : table === 'stripe_subscriptions' && cols.includes('plan_amount') ? db.subsError : null;
  const result = { data: error ? null : rows, error, count: rows.length };
  // Chainable and awaitable at any depth, like the PostgREST builder.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q: any = new Proxy({}, {
    get: (_t, p) => {
      if (p === 'then') return (res: (v: unknown) => void) => res(result);
      if (p === 'maybeSingle') return async () => ({ data: rows[0] ?? null, error: null });
      return () => q;
    },
  });
  return q;
}

vi.mock('@/lib/supabase/server-clients', () => {
  const client = { from: (t: string) => ({ select: (c: string) => query(t, c) }) };
  return { getReadClient: () => client, getCountClient: () => client };
});

process.env.ADMIN_PASSWORD = 'pw';
const call = async () => {
  const { GET } = await import('./route');
  return GET(new NextRequest('https://x.test/api/admin/mrr-goal?password=pw'));
};
const sub = (plan_amount: number, plan_interval: string, plan_interval_count: number | null) => ({
  customer_id: 'c', status: 'active', plan_amount, plan_interval, plan_interval_count,
});

beforeEach(() => { db.subs = []; db.charges = []; db.subsError = null; });

describe('mrr-goal', () => {
  it('a 6-month price counts at a sixth; the rows behind the 2026-11-07 overstatement', async () => {
    db.subs = [sub(79900, 'month', 6), sub(79900, 'month', 6), sub(79900, 'month', 6), sub(14900, 'month', 1), sub(149000, 'year', 1)];
    const j = await (await call()).json();
    expect(j.mrr).toBe(Math.round(399.5 + 149 + 149000 / 1200));
    expect(j.mrrBasis).toEqual({ exact: 5, count_unknown: 0, unmeasurable: 0 });
    expect(j.byPlan).toContainEqual({ monthlyPrice: 133, count: 3 });
  });

  it('discloses rows not yet re-synced instead of passing them as measured', async () => {
    db.subs = [sub(79900, 'month', null)];
    const j = await (await call()).json();
    expect(j.mrr).toBe(799);
    expect(j.mrrBasis.count_unknown).toBe(1);
  });

  it('a failed subscription read is a 500, not a lower MRR', async () => {
    db.subs = [sub(14900, 'month', 1)];
    db.subsError = { message: 'column plan_interval_count does not exist' };
    expect((await call()).status).toBe(500);
  });

  it('one-time cash reads the real column: invoiced renewals excluded, one-time counted', async () => {
    db.charges = [
      { amount: 149700, status: 'succeeded', invoice_id: null, created_at: '2026-11-01T00:00:00Z' },
      { amount: 14900, status: 'succeeded', invoice_id: 'in_1', created_at: '2026-11-02T00:00:00Z' },
      { amount: 500, status: 'failed', invoice_id: null, created_at: '2026-11-03T00:00:00Z' },
    ];
    const j = await (await call()).json();
    expect(j.oneTimeCash30d).toBe(1497);
    expect(j.oneTimeCount30d).toBe(1);
    expect(j.chargesThrough).toBe('2026-11-01T00:00:00Z');
  });
});
