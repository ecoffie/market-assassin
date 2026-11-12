/**
 * customer.subscription.trial_will_end → Mindy (not Stripe) sends the reminder, exactly once.
 * Drives the real webhook route with a mocked Stripe client and mocked sendEmail/KV.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const sent: Array<{ to: string; subject: string; emailType?: string }> = [];
const kvStore = new Map<string, unknown>();

vi.mock('@vercel/kv', () => ({
  kv: {
    set: vi.fn(async (k: string, v: unknown, o?: { nx?: boolean }) => {
      if (o?.nx && kvStore.has(k)) return null;
      kvStore.set(k, v); return 'OK';
    }),
    get: vi.fn(async (k: string) => kvStore.get(k) ?? null),
    del: vi.fn(async (k: string) => { kvStore.delete(k); return 1; }),
  },
}));

vi.mock('@/lib/send-email', async (orig) => {
  const actual = await orig<Record<string, unknown>>();
  return { ...actual, sendEmail: vi.fn(async (p: { to: string; subject: string; emailType?: string }) => { sent.push(p); }) };
});

vi.mock('stripe', () => {
  class FakeStripe {
    webhooks = { constructEvent: (body: string) => JSON.parse(body) };
    customers = { retrieve: async () => ({ id: 'cus_1', email: 'buyer@acme.com', deleted: false }) };
  }
  return { default: FakeStripe };
});

function trialEvent(id: string) {
  return {
    id, type: 'customer.subscription.trial_will_end', livemode: true,
    data: { object: {
      id: 'sub_123', customer: 'cus_1', status: 'trialing', trial_end: Date.parse('2026-11-26T15:00:00Z') / 1000,
      metadata: { tier: 'team_annual' },
      items: { data: [{ price: { id: 'price_1Uaz3WK5zyiZ50PBKQY8W1WX', unit_amount: 402700, recurring: { interval: 'year' } } }] },
    } },
  };
}

async function post(evt: unknown) {
  const { POST } = await import('./route');
  const req = new NextRequest('http://localhost/api/stripe-webhook', {
    method: 'POST', body: JSON.stringify(evt), headers: { 'stripe-signature': 't=1,v1=x' },
  });
  return POST(req);
}

describe('trial_will_end webhook', () => {
  beforeEach(() => { sent.length = 0; kvStore.clear(); });

  it('sends one Mindy reminder and dedupes a redelivery', async () => {
    const r1 = await post(trialEvent('evt_a'));
    expect(r1.status).toBe(200);
    expect(await r1.json()).toMatchObject({ action: 'trial_reminder_sent' });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: 'buyer@acme.com', emailType: 'trial_ending_reminder' });
    expect(sent[0].subject).toBe('Your Mindy Team trial ends Thursday, November 26, 2026');

    const r2 = await post(trialEvent('evt_b'));
    expect(await r2.json()).toMatchObject({ action: 'trial_reminder_duplicate' });
    expect(sent).toHaveLength(1);
  });
});
