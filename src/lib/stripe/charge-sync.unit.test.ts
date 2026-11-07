/**
 * The charge mirror's watermark is max(created_at), so WRITE ORDER is the no-gap guarantee:
 * oldest first, stop at the first failure or at the deadline. These tests fail if anything writes
 * a newer charge while an older one has not landed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const stripe = vi.hoisted(() => ({ list: vi.fn(), invoice: vi.fn() }));
const state = vi.hoisted(() => ({
  table: [] as Record<string, unknown>[],
  customers: [] as { rows: Record<string, unknown>[]; opts: Record<string, unknown> }[],
  failChargeUpsertOn: -1,
  chargeUpsertCalls: 0,
  failWatermark: false,
}));

vi.mock('@/lib/stripe', () => ({
  getStripe: () => ({ charges: { list: stripe.list }, invoices: { retrieve: stripe.invoice } }),
}));
vi.mock('@/lib/supabase/server-clients', () => ({
  getWriteClient: () => ({
    from: (name: string) => ({
      select: () => ({
        order: () => ({
          limit: async () => {
            if (state.failWatermark) return { data: null, error: { message: 'db down' } };
            const sorted = [...state.table].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
            return { data: sorted.slice(0, 1), error: null };
          },
        }),
        in: async (_c: string, ids: string[]) => ({
          data: state.table.filter((r) => ids.includes(r.id as string)),
          error: null,
        }),
      }),
      upsert: async (rows: Record<string, unknown>[], opts: Record<string, unknown>) => {
        if (name === 'stripe_customers') {
          state.customers.push({ rows, opts });
          return { error: null };
        }
        const call = state.chargeUpsertCalls++;
        if (call === state.failChargeUpsertOn) return { error: { message: 'boom' } };
        for (const row of rows) {
          state.table = state.table.filter((r) => r.id !== row.id);
          state.table.push(row);
        }
        return { error: null };
      },
    }),
  }),
}));

import { syncChargesIncremental, CHARGE_OVERLAP_DAYS } from './charge-sync';

const T0 = Date.parse('2026-06-11T00:00:00Z') / 1000;
const DAY = 86_400;
const charge = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `ch_${String(n).padStart(4, '0')}`, created: T0 + n * DAY, livemode: true, status: 'succeeded', amount: 100 * n,
  currency: 'usd', description: null, receipt_email: null, invoice: null, payment_intent: null,
  refunded: false, amount_refunded: 0, metadata: {}, customer: null, ...extra,
});
const seed = () => { state.table = [{ id: 'ch_seed', created_at: '2026-06-11T00:00:00.000Z', metadata: {} }]; };

/** Stripe's real contract: newest first, cursor pages. */
function servePages(all: ReturnType<typeof charge>[], pageSize = 100) {
  const sorted = [...all].sort((a, b) => b.created - a.created);
  stripe.list.mockImplementation(async (p: { starting_after?: string; created?: { gte: number } }) => {
    const inWindow = sorted.filter((c) => !p.created || c.created >= p.created.gte);
    const start = p.starting_after ? inWindow.findIndex((c) => c.id === p.starting_after) + 1 : 0;
    const data = inWindow.slice(start, start + pageSize);
    return { data, has_more: start + pageSize < inWindow.length };
  });
}
const latest = () => [...state.table].map((r) => String(r.created_at)).sort().at(-1);
const ids = () => state.table.map((r) => r.id).sort();

beforeEach(() => {
  stripe.list.mockReset();
  stripe.invoice.mockReset();
  state.table = [];
  state.customers = [];
  state.failChargeUpsertOn = -1;
  state.chargeUpsertCalls = 0;
  state.failWatermark = false;
});

const far = () => Date.now() + 1_000_000;

describe('syncChargesIncremental', () => {
  it('lists across pages from the watermark minus the overlap and lands every charge', async () => {
    seed();
    servePages(Array.from({ length: 250 }, (_, i) => charge(i + 1)));
    const r = await syncChargesIncremental({ deadlineMs: far() });
    expect(r).toMatchObject({ ok: true, complete: true, listed: 250, upserted: 250, remaining: 0 });
    expect(stripe.list.mock.calls[0][0].created.gte).toBe(T0 - CHARGE_OVERLAP_DAYS * DAY);
    expect(stripe.list.mock.calls[0][0].expand).toEqual(['data.customer']);
    expect(state.table).toHaveLength(251);
  });

  it('a failed chunk stops the run so the watermark stays below the gap, and the next run closes it', async () => {
    seed();
    const all = Array.from({ length: 250 }, (_, i) => charge(i + 1));
    servePages(all);
    state.failChargeUpsertOn = 1; // second chunk: charges 101-200
    const r = await syncChargesIncremental({ deadlineMs: far() });
    expect(r).toMatchObject({ ok: false, complete: false, reason: 'failed', upserted: 100, remaining: 150 });
    expect(r.error).toContain('boom');
    expect(state.chargeUpsertCalls).toBe(2); // the third, newer chunk never ran
    expect(latest()).toBe(new Date((T0 + 100 * DAY) * 1000).toISOString());

    state.failChargeUpsertOn = -1;
    const next = await syncChargesIncremental({ deadlineMs: far() });
    expect(next).toMatchObject({ ok: true, complete: true });
    expect(ids()).toEqual([...all.map((c) => c.id), 'ch_seed'].sort());
  });

  it('out of budget mid-window: stops between chunks, oldest landed first, no gap', async () => {
    seed();
    servePages(Array.from({ length: 250 }, (_, i) => charge(i + 1)));
    let clock = 0;
    // Allowed: one list page x3 + first chunk. Then the deadline has passed.
    const nowMs = () => (clock++ < 4 ? 0 : 10);
    const r = await syncChargesIncremental({ deadlineMs: 5, nowMs });
    expect(r).toMatchObject({ ok: true, complete: false, reason: 'time_budget', upserted: 100, remaining: 150 });
    expect(latest()).toBe(new Date((T0 + 100 * DAY) * 1000).toISOString());
  });

  it('out of budget while listing writes nothing', async () => {
    seed();
    servePages(Array.from({ length: 250 }, (_, i) => charge(i + 1)));
    let clock = 0;
    const r = await syncChargesIncremental({ deadlineMs: 5, nowMs: () => (clock++ < 1 ? 0 : 10) });
    expect(r).toMatchObject({ ok: true, complete: false, reason: 'time_budget', upserted: 0 });
    expect(state.chargeUpsertCalls).toBe(0);
  });

  it('an empty mirror is refused, not treated as "start now"', async () => {
    const r = await syncChargesIncremental({ deadlineMs: far() });
    expect(r).toMatchObject({ ok: false, complete: false, reason: 'no_watermark' });
    expect(stripe.list).not.toHaveBeenCalled();
  });

  it('returns a failed read instead of throwing or inventing a window', async () => {
    state.failWatermark = true;
    const r = await syncChargesIncremental({ deadlineMs: far() });
    expect(r).toMatchObject({ ok: false, reason: 'failed' });
    expect(stripe.list).not.toHaveBeenCalled();
  });

  it('a Stripe failure is returned, never thrown', async () => {
    seed();
    stripe.list.mockRejectedValue(new Error('stripe 500'));
    expect(await syncChargesIncremental({ deadlineMs: far() })).toMatchObject({ ok: false, error: 'stripe 500' });
  });

  it('skips test-mode charges', async () => {
    seed();
    servePages([charge(1), charge(2, { livemode: false })]);
    expect(await syncChargesIncremental({ deadlineMs: far() })).toMatchObject({ listed: 1, upserted: 1 });
  });

  it('keeps enriched metadata and refreshes refund fields without another invoice call', async () => {
    state.table = [{ id: 'ch_0001', created_at: new Date((T0 + DAY) * 1000).toISOString(), metadata: { product_name: 'Mindy Pro', price_id: 'p' } }];
    servePages([charge(1, { invoice: 'in_1', refunded: true, amount_refunded: 100 })]);
    const r = await syncChargesIncremental({ deadlineMs: far() });
    expect(stripe.invoice).not.toHaveBeenCalled();
    expect(r.invoiceLookups).toBe(0);
    expect(state.table[0]).toMatchObject({ refunded: true, amount_refunded: 100, metadata: { product_name: 'Mindy Pro', price_id: 'p' } });
  });

  it('enriches a new invoice charge from its invoice; an invoice failure still lands the row', async () => {
    seed();
    servePages([charge(1, { invoice: 'in_1' }), charge(2, { invoice: 'in_2' })]);
    stripe.invoice.mockImplementation(async (id: string) => {
      if (id === 'in_2') throw new Error('nope');
      return { lines: { data: [{ price: { id: 'price_x', product: { id: 'prod_x', name: 'Mindy Pro' } } }] }, subscription: 'sub_1' };
    });
    await syncChargesIncremental({ deadlineMs: far() });
    const one = state.table.find((r) => r.id === 'ch_0001')!;
    expect(one).toMatchObject({ invoice_id: 'in_1', metadata: { product_name: 'Mindy Pro', subscription_id: 'sub_1' } });
    expect(state.table.find((r) => r.id === 'ch_0002')).toMatchObject({ invoice_id: 'in_2', metadata: {} });
  });

  it('self-heals the customer FK once per id, and a bare id never overwrites a row', async () => {
    seed();
    const full = { id: 'cus_1', email: 'o@x.com', name: 'A', phone: null, metadata: {}, created: T0, livemode: true };
    servePages([
      charge(1, { customer: full }),
      charge(2, { customer: full }),
      charge(3, { customer: 'cus_2' }),
      charge(4, { customer: { id: 'cus_3', deleted: true } }),
    ]);
    await syncChargesIncremental({ deadlineMs: far() });
    const refreshed = state.customers.find((c) => !c.opts.ignoreDuplicates)!;
    expect(refreshed.rows.map((r) => r.id)).toEqual(['cus_1']);
    expect(refreshed.rows[0].email).toBe('o@x.com');
    const fillOnly = state.customers.find((c) => c.opts.ignoreDuplicates)!;
    expect(fillOnly.rows.map((r) => r.id).sort()).toEqual(['cus_2', 'cus_3']);
  });
});
