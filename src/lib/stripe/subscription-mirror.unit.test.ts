/**
 * The subscription mirror is what lets a new pooled subscription spend immediately
 * (the payer reads it). It must re-read Stripe, upsert idempotently, never clobber a
 * customer row with a bare id, skip test mode, and RETURN failures instead of throwing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const stripe = vi.hoisted(() => ({ retrieve: vi.fn() }));
const upserts = vi.hoisted(() => [] as { table: string; row: Record<string, unknown>; opts: Record<string, unknown> }[]);
const failTable = vi.hoisted(() => ({ name: '' }));

vi.mock('@/lib/stripe', () => ({ getStripe: () => ({ subscriptions: { retrieve: stripe.retrieve } }) }));
vi.mock('@/lib/supabase/server-clients', () => ({
  getWriteClient: () => ({
    from: (table: string) => ({
      upsert: async (row: Record<string, unknown>, opts: Record<string, unknown>) => {
        upserts.push({ table, row, opts });
        return { error: failTable.name === table ? { message: 'boom' } : null };
      },
    }),
  }),
}));

import { mirrorSubscription, subscriptionMirrorRow } from './subscription-mirror';

const SUB = {
  id: 'sub_1', status: 'active', livemode: true, created: 1_700_000_000, cancel_at_period_end: false,
  canceled_at: null, ended_at: null, trial_start: null, trial_end: null, metadata: { internal_canary: 'true' },
  customer: { id: 'cus_1', email: 'o@x.com', name: 'Acme', phone: null, metadata: {}, created: 1_690_000_000, livemode: true },
  // Newer API versions carry the period on the ITEM, not the subscription.
  items: { data: [{ current_period_start: 1_700_000_000, current_period_end: 1_702_592_000, plan: { id: 'price_g', amount: 39900, interval: 'month' } }] },
};

beforeEach(() => { upserts.length = 0; failTable.name = ''; stripe.retrieve.mockReset(); });

describe('mirrorSubscription', () => {
  it('re-reads Stripe and upserts customer then subscription, keyed on id', async () => {
    stripe.retrieve.mockResolvedValue(SUB);
    expect(await mirrorSubscription('sub_1')).toEqual({ ok: true, subscriptionId: 'sub_1', status: 'active' });
    expect(stripe.retrieve).toHaveBeenCalledWith('sub_1', { expand: ['customer'] });
    expect(upserts.map((u) => u.table)).toEqual(['stripe_customers', 'stripe_subscriptions']);
    expect(upserts[1].opts).toEqual({ onConflict: 'id' });
    expect(upserts[1].row).toMatchObject({ id: 'sub_1', customer_id: 'cus_1', status: 'active', plan_amount: 39900 });
  });

  it('takes period dates from the item when the subscription lacks them', () => {
    const row = subscriptionMirrorRow(SUB as never);
    expect(row.current_period_end).toBe(new Date(1_702_592_000 * 1000).toISOString());
  });

  it('a bare customer id only fills the foreign key (never overwrites the email)', async () => {
    stripe.retrieve.mockResolvedValue({ ...SUB, customer: 'cus_1' });
    await mirrorSubscription('sub_1');
    expect(upserts[0].opts).toEqual({ onConflict: 'id', ignoreDuplicates: true });
  });

  it('skips test-mode subscriptions', async () => {
    stripe.retrieve.mockResolvedValue({ ...SUB, livemode: false });
    expect(await mirrorSubscription('sub_1')).toMatchObject({ ok: false, skipped: 'test_mode' });
    expect(upserts).toHaveLength(0);
  });

  it('returns (never throws) a Stripe or database failure', async () => {
    stripe.retrieve.mockRejectedValue(new Error('stripe down'));
    expect(await mirrorSubscription('sub_1')).toMatchObject({ ok: false, error: 'stripe down' });
    stripe.retrieve.mockResolvedValue(SUB);
    failTable.name = 'stripe_subscriptions';
    expect(await mirrorSubscription('sub_1')).toMatchObject({ ok: false, error: 'subscription mirror failed: boom' });
  });
});
