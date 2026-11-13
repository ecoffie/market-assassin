import { describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import { endAppAccessIfNoOtherSource, MINDY_APP_PRODUCT, type EndAccessDeps } from './app-subscription-end';

const sub = (id: string, status: string, opts: { product?: string; price?: string; amount?: number; tier?: string } = {}) => ({
  id, status, metadata: opts.tier ? { tier: opts.tier } : {},
  items: { data: [{ price: { id: opts.price || 'price_pro', product: opts.product ?? MINDY_APP_PRODUCT, unit_amount: opts.amount ?? 14900 } }] },
}) as unknown as Stripe.Subscription;

function deps(over: Partial<EndAccessDeps> = {}): EndAccessDeps & { revokePro: ReturnType<typeof vi.fn>; revokeTeam: ReturnType<typeof vi.fn> } {
  return {
    listSubscriptionsForEmail: vi.fn(async () => []),
    listPurchases: vi.fn(async () => []),
    isAdvocate: () => false,
    revokePro: vi.fn(async () => ({ ok: true, failures: [] })),
    revokeTeam: vi.fn(async () => ({ ok: true })),
    ...over,
  } as never;
}

describe('endAppAccessIfNoOtherSource', () => {
  it('revokes Pro when a Pro subscription (or ended trial) is cancelled and nothing else grants Pro', async () => {
    const d = deps();
    const r = await endAppAccessIfNoOtherSource('A@x.com', sub('s1', 'canceled'), d);
    expect(r.action).toBe('revoked');
    expect(d.revokePro).toHaveBeenCalledWith('a@x.com');
    expect(d.revokeTeam).not.toHaveBeenCalled();
  });

  it('does nothing while the card is past due, or for non-Mindy products', async () => {
    const d = deps();
    expect((await endAppAccessIfNoOtherSource('a@x.com', sub('s1', 'past_due'), d)).action).toBe('not_applicable');
    expect((await endAppAccessIfNoOtherSource('a@x.com', sub('s1', 'canceled', { product: 'prod_other' }), d)).action).toBe('not_applicable');
    expect(d.revokePro).not.toHaveBeenCalled();
  });

  it('keeps Pro when another Mindy subscription is still live', async () => {
    const d = deps({ listSubscriptionsForEmail: vi.fn(async () => [sub('s1', 'canceled'), sub('s2', 'active')]) });
    const r = await endAppAccessIfNoOtherSource('a@x.com', sub('s1', 'canceled'), d);
    expect(r).toMatchObject({ action: 'kept', keep: 'other_live_app_subscription' });
    expect(d.revokePro).not.toHaveBeenCalled();
  });

  it('keeps Pro for bundle/lifetime buyers and advocates', async () => {
    const d = deps({ listPurchases: vi.fn(async () => [{ product_id: 'ultimate-govcon-bundle', product_name: null }]) });
    expect((await endAppAccessIfNoOtherSource('a@x.com', sub('s1', 'canceled'), d)).keep).toBe('lifetime_purchase');
    const adv = deps({ isAdvocate: () => true });
    expect((await endAppAccessIfNoOtherSource('a@x.com', sub('s1', 'canceled'), adv)).keep).toBe('advocate');
    expect(d.revokePro).not.toHaveBeenCalled();
  });

  it('keeps access when a lookup fails (never locks out a payer on an error)', async () => {
    const d = deps({ listPurchases: vi.fn(async () => { throw new Error('db down'); }) });
    expect(await endAppAccessIfNoOtherSource('a@x.com', sub('s1', 'canceled'), d)).toMatchObject({ action: 'kept', keep: 'check_failed' });
    expect(d.revokePro).not.toHaveBeenCalled();
  });

  it('a cancelled Team sub removes Team; Pro too unless a Pro sub is still live', async () => {
    const d = deps();
    const r = await endAppAccessIfNoOtherSource('a@x.com', sub('t1', 'canceled', { price: 'price_1TZxaaK5zyiZ50PBzhQJ1Pk8', amount: 49900 }), d);
    expect(r).toMatchObject({ revokedTeam: true, revokedPro: true });
    const d2 = deps({ listSubscriptionsForEmail: vi.fn(async () => [sub('p1', 'active')]) });
    const r2 = await endAppAccessIfNoOtherSource('a@x.com', sub('t1', 'unpaid', { tier: 'team_monthly', amount: 49900 }), d2);
    expect(r2).toMatchObject({ revokedTeam: true, revokedPro: false, keep: 'other_live_app_subscription' });
  });
});
