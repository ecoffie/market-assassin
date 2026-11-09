import { describe, expect, it } from 'vitest';
import type Stripe from 'stripe';
import { describeSubscription, subscriptionKind } from './subscription-list';
import { SUBSCRIPTION_PLANS } from '@/lib/mcp/packages';

function sub(over: { priceId?: string; meta?: Record<string, string>; cancel?: boolean; status?: string } = {}) {
  return {
    id: 'sub_1',
    status: over.status ?? 'active',
    cancel_at_period_end: !!over.cancel,
    metadata: over.meta ?? {},
    items: {
      data: [
        {
          current_period_end: 1_800_000_000,
          price: { id: over.priceId ?? 'price_app_pro', unit_amount: 14900, currency: 'usd', nickname: null, recurring: { interval: 'month' } },
        },
      ],
    },
  } as unknown as Stripe.Subscription;
}

describe('subscription list', () => {
  it('an MCP credits plan is recognised by its Stripe price id', () => {
    const mcpPrice = SUBSCRIPTION_PLANS[0].monthly.priceId;
    expect(subscriptionKind(sub({ priceId: mcpPrice }))).toBe('mcp');
  });

  it('…or by the mcp_subscription checkout metadata', () => {
    expect(subscriptionKind(sub({ meta: { type: 'mcp_subscription' } }))).toBe('mcp');
  });

  it('anything else is the Mindy app subscription', () => {
    expect(subscriptionKind(sub())).toBe('app');
  });

  it('describes price, renewal, cancel state and who it is billed to', () => {
    const row = describeSubscription(sub({ cancel: true }), 'Mindy Pro', 'a@b.com');
    expect(row).toMatchObject({ kind: 'app', planName: 'Mindy Pro', amount: 149, interval: 'month', cancelAtPeriodEnd: true, billedTo: 'a@b.com' });
    expect(row.currentPeriodEnd).toBe(new Date(1_800_000_000 * 1000).toISOString());
  });
});
