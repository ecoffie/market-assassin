/**
 * Deleted Stripe customers kept email '' in the mirror forever, so their cancellations could not be linked to a
 * Mindy account. The email is recovered from the subscription's latest invoice (or the charge) into BLANK rows only.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  retrieve: vi.fn(),
  rows: new Map<string, { email: string; metadata?: unknown }>(),
  updates: [] as Array<{ id: string; email: string; source: unknown }>,
}));
vi.mock('@/lib/stripe', () => ({ getStripe: () => ({ subscriptions: { retrieve: h.retrieve } }) }));
function db() {
  return {
    from: (table: string) => ({
      upsert: async (row: { id: string; email: string }, opts: { ignoreDuplicates?: boolean }) => {
        if (table === 'stripe_customers' && (!opts?.ignoreDuplicates || !h.rows.has(row.id))) h.rows.set(row.id, { email: row.email });
        return { error: null };
      },
      update: (patch: { email: string; metadata: { email_source: string } }) => {
        const f: Record<string, unknown> = {};
        const q = {
          eq: (c: string, v: unknown) => { f[c] = v; return q; },
          select: async () => {
            const r = h.rows.get(String(f.id));
            if (r && r.email === f.email) {
              r.email = patch.email; h.updates.push({ id: String(f.id), email: patch.email, source: patch.metadata.email_source });
              return { data: [{ id: f.id }], error: null };
            }
            return { data: [], error: null };
          },
        };
        return q;
      },
    }),
  };
}
vi.mock('@/lib/supabase/server-clients', () => ({ getWriteClient: () => db() }));

import { mirrorSubscription, fillBlankCustomerEmail } from './subscription-mirror';

const sub = (customer: unknown, latest_invoice: unknown = null) => ({
  id: 'sub_1', status: 'canceled', livemode: true, created: 1_700_000_000, cancel_at_period_end: false,
  canceled_at: 1_700_100_000, ended_at: 1_700_100_000, trial_start: null, trial_end: null, metadata: {},
  customer, latest_invoice, items: { data: [{ current_period_start: 1, current_period_end: 2, plan: { id: 'p', amount: 1, interval: 'month' } }] },
});

beforeEach(() => { h.rows.clear(); h.updates.length = 0; h.retrieve.mockReset(); });

describe('deleted customer → email recovered from the latest invoice', () => {
  it('a new deleted customer row gets the invoice email (source recorded)', async () => {
    h.retrieve.mockResolvedValue(sub({ id: 'cus_del', deleted: true }, { customer_email: 'Owner@Corp.com' }));
    const r = await mirrorSubscription('sub_1');
    expect(r.ok).toBe(true);
    expect(h.retrieve).toHaveBeenCalledWith('sub_1', { expand: ['customer', 'latest_invoice'] });
    expect(h.rows.get('cus_del')!.email).toBe('owner@corp.com');
    expect(h.updates).toEqual([{ id: 'cus_del', email: 'owner@corp.com', source: 'latest_invoice' }]);
  });
  it('an existing blank row is filled; an existing REAL email is never overwritten', async () => {
    h.rows.set('cus_del', { email: '' });
    h.retrieve.mockResolvedValue(sub({ id: 'cus_del', deleted: true }, { customer_email: 'a@b.co' }));
    await mirrorSubscription('sub_1');
    expect(h.rows.get('cus_del')!.email).toBe('a@b.co');

    h.rows.set('cus_keep', { email: 'real@corp.com' });
    h.retrieve.mockResolvedValue(sub({ id: 'cus_keep', deleted: true }, { customer_email: 'other@x.com' }));
    await mirrorSubscription('sub_1');
    expect(h.rows.get('cus_keep')!.email).toBe('real@corp.com');
  });
  it('no invoice email → stays blank (unknown), never guessed', async () => {
    h.retrieve.mockResolvedValue(sub({ id: 'cus_del', deleted: true }, { customer_email: null }));
    await mirrorSubscription('sub_1');
    expect(h.rows.get('cus_del')!.email).toBe('');
    expect(h.updates).toEqual([]);
  });
  it('a full customer is mirrored as before (no fill attempted)', async () => {
    h.retrieve.mockResolvedValue(sub({ id: 'cus_full', email: 'x@y.co', name: null, phone: null, metadata: {}, created: 1, livemode: true }));
    await mirrorSubscription('sub_1');
    expect(h.rows.get('cus_full')!.email).toBe('x@y.co');
    expect(h.updates).toEqual([]);
  });
});

describe('fillBlankCustomerEmail', () => {
  it('ignores blank / malformed emails and missing ids', async () => {
    h.rows.set('c', { email: '' });
    expect(await fillBlankCustomerEmail(db(), 'c', '', 'latest_invoice')).toEqual({ filled: false });
    expect(await fillBlankCustomerEmail(db(), 'c', 'not-an-email', 'latest_invoice')).toEqual({ filled: false });
    expect(await fillBlankCustomerEmail(db(), '', 'a@b.co', 'latest_invoice')).toEqual({ filled: false });
    expect(h.rows.get('c')!.email).toBe('');
  });
});
