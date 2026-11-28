import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const create = vi.fn(async () => ({ url: 'https://checkout.stripe.com/c/test' }));
vi.mock('@/lib/stripe', () => ({ getStripe: () => ({ checkout: { sessions: { create } } }) }));

import { GET } from './route';

type SessionArgs = { subscription_data: Record<string, unknown>; success_url: string };
const call = async (qs: string): Promise<SessionArgs> => {
  create.mockClear();
  const res = await GET(new NextRequest(`https://getmindy.ai/api/checkout/team-seats?${qs}`));
  expect(res.status).toBe(303);
  expect(create).toHaveBeenCalledTimes(1);
  return (create.mock.calls[0] as unknown as [SessionArgs])[0];
};

describe('team seat checkout — trial vs pay now', () => {
  beforeEach(() => create.mockClear());

  it('yearly is charged immediately: no trial', async () => {
    for (const seats of [2, 3, 4, 5]) {
      const args = await call(`seats=${seats}&billing=annual`);
      expect(args.subscription_data).not.toHaveProperty('trial_period_days');
      expect(args.success_url).toContain('checkout=success');
    }
  });

  it('monthly keeps the 14-day trial', async () => {
    const args = await call('seats=2&billing=monthly');
    expect(args.subscription_data.trial_period_days).toBe(14);
    expect(args.success_url).toContain('trial=started');
  });
});
