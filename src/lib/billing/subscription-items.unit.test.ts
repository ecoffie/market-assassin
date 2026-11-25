import { describe, expect, it } from 'vitest';
import { appTierItem, primaryItem, subscriptionTotalCents } from './subscription-items';
import { describeSubscription, subscriptionKind } from './subscription-list';
import { trialContextFromSubscription } from './trial-onboarding-emails';

const pro = { price: { id: 'price_pro', unit_amount: 14900, currency: 'usd', recurring: { interval: 'month' } }, quantity: 1 };
const mid = { price: { id: 'price_1TuxApK5zyiZ50PBPV40eCvG', unit_amount: 24900, currency: 'usd', recurring: { interval: 'month' } }, quantity: 1 };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sub = (items: any[], over: any = {}) => ({ id: 'sub_1', status: 'trialing', metadata: {}, cancel_at_period_end: false, trial_end: 1800000000, items: { data: items }, ...over }) as any;

describe('subscriptions with Pro + a credit add-on', () => {
  it('find the Pro item wherever it sits, and total every item', () => {
    expect(appTierItem(sub([mid, pro]))).toBe(pro);
    expect(primaryItem(sub([mid, pro]))).toBe(pro);
    expect(subscriptionTotalCents(sub([pro, mid]))).toBe(39800);
  });

  it('a one-item subscription reads exactly as before', () => {
    expect(primaryItem(sub([mid]))).toBe(mid);
    expect(subscriptionTotalCents(sub([pro]))).toBe(14900);
  });

  it('is an APP subscription (the add-on never relabels Pro as an MCP plan) and shows the full amount', () => {
    const s = sub([pro, mid]);
    expect(subscriptionKind(s)).toBe('app');
    const row = describeSubscription(s, 'Mindy Ai', 'a@x.co');
    expect(row).toMatchObject({ kind: 'app', amount: 398, planName: 'Mindy Ai + extra credits', interval: 'month' });
  });

  it('a lone credit plan is still an MCP subscription', () => {
    expect(subscriptionKind(sub([mid]))).toBe('mcp');
  });

  it('the trial emails quote the whole first charge, as Mindy Pro', () => {
    const ctx = trialContextFromSubscription(sub([pro, mid]), 'a@x.co', 'Al');
    expect(ctx).toMatchObject({ planLabel: 'Mindy Pro', amountUsd: 398, interval: 'month' });
  });
});
