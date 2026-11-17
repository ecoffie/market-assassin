import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const retrieve = vi.hoisted(() => vi.fn());
vi.mock('stripe', () => ({ default: class { checkout = { sessions: { retrieve } }; } }));

const kvStore = vi.hoisted(() => new Map<string, unknown>());
const kvFail = vi.hoisted(() => ({ set: false }));
vi.mock('@vercel/kv', () => ({
  kv: {
    set: vi.fn(async (k: string, v: unknown, o?: { nx?: boolean }) => {
      if (kvFail.set) throw new Error('kv down');
      if (o?.nx && kvStore.has(k)) return null;
      kvStore.set(k, v); return 'OK';
    }),
    get: vi.fn(async (k: string) => kvStore.get(k) ?? null),
    del: vi.fn(async (k: string) => { kvStore.delete(k); return 1; }),
  },
}));

const access = vi.hoisted(() => ({ oh: new Set<string>(), ma: new Map<string, string>(), cg: new Map<string, string>(), failGrant: false }));
const grants = vi.hoisted(() => [] as string[]);
vi.mock('@/lib/access-codes', () => ({
  hasOpportunityHunterProAccess: vi.fn(async (e: string) => access.oh.has(e)),
  grantOpportunityHunterProAccess: vi.fn(async (e: string) => { if (access.failGrant) throw new Error('kv write'); access.oh.add(e); grants.push(`oh:${e}`); }),
  getMarketAssassinAccess: vi.fn(async (e: string) => (access.ma.has(e) ? { tier: access.ma.get(e) } : null)),
  grantMarketAssassinAccess: vi.fn(async (e: string, t: string) => { if (access.failGrant) throw new Error('kv write'); access.ma.set(e, t); grants.push(`ma:${t}:${e}`); }),
  getContentGeneratorAccess: vi.fn(async (e: string) => (access.cg.has(e) ? { tier: access.cg.get(e) } : null)),
  grantContentGeneratorAccess: vi.fn(async (e: string, t: string) => { if (access.failGrant) throw new Error('kv write'); access.cg.set(e, t); grants.push(`cg:${t}:${e}`); }),
}));
const sendOh = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock('@/lib/send-email', () => ({ sendOpportunityHunterProEmail: sendOh }));

import { GET } from './route';
import { LEGACY_PRICE_PRODUCTS } from '@/lib/billing/legacy-session-products';

const priceOf = (p: string) => Object.entries(LEGACY_PRICE_PRODUCTS).find(([, v]) => v === p)![0];
const SID = 'cs_live_a1B2c3D4e5F6g7H8i9J0';
const EMAIL = 'buyer@example.com';
const now = () => Math.floor(Date.now() / 1000);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function session(o: Partial<Record<string, any>> = {}) {
  return {
    id: SID, status: 'complete', payment_status: 'paid', created: now() - 60,
    customer_details: { email: EMAIL, name: 'Buyer Name' }, customer_email: null,
    line_items: { has_more: false, data: [{ quantity: 1, price: { id: priceOf('market-assassin-standard') } }] },
    ...o,
  };
}
const call = (q: string) => GET(new NextRequest(`http://localhost/api/stripe-session?${q}`));

beforeEach(() => {
  retrieve.mockReset(); kvStore.clear(); kvFail.set = false; grants.length = 0;
  access.oh.clear(); access.ma.clear(); access.cg.clear(); access.failGrant = false; sendOh.mockClear();
});

describe('refusals grant nothing and disclose nothing', () => {
  it.each([
    ['open session', { status: 'open', payment_status: 'unpaid' }],
    ['expired session', { status: 'expired', payment_status: 'unpaid' }],
    ['complete but unpaid', { status: 'complete', payment_status: 'unpaid' }],
    ['no_payment_required', { status: 'complete', payment_status: 'no_payment_required' }],
  ])('%s → 402, no grant, no PII', async (_l, o) => {
    retrieve.mockResolvedValue(session(o));
    const r = await call(`session_id=${SID}&product=market-assassin-premium`);
    expect(r.status).toBe(402);
    const j = await r.json();
    expect(j.success).toBe(false);
    expect(JSON.stringify(j)).not.toContain(EMAIL);
    expect(JSON.stringify(j)).not.toContain('Buyer Name');
    expect(grants).toEqual([]);
  });

  it('an old paid session (> 48h) → 410, no grant, no PII', async () => {
    retrieve.mockResolvedValue(session({ created: now() - 49 * 3600 }));
    const r = await call(`session_id=${SID}&product=market-assassin-standard`);
    expect(r.status).toBe(410);
    expect(JSON.stringify(await r.json())).not.toContain(EMAIL);
    expect(grants).toEqual([]);
  });

  it('a paid session that bought none of the listed products → 422, no grant, no PII', async () => {
    retrieve.mockResolvedValue(session({ line_items: { has_more: false, data: [{ quantity: 1, price: { id: 'price_somethingElse' } }] } }));
    const r = await call(`session_id=${SID}&product=market-assassin-premium`);
    expect(r.status).toBe(422);
    expect(JSON.stringify(await r.json())).not.toContain(EMAIL);
    expect(grants).toEqual([]);
  });

  it('a Stripe error → 5xx with no grant', async () => {
    retrieve.mockRejectedValue(new Error('No such checkout.session'));
    const r = await call(`session_id=${SID}&product=market-assassin-standard`);
    expect(r.status).toBeGreaterThanOrEqual(500);
    expect(grants).toEqual([]);
  });

  it('truncated line items → 5xx with no grant', async () => {
    retrieve.mockResolvedValue(session({ line_items: { has_more: true, data: [{ quantity: 1, price: { id: priceOf('market-assassin-standard') } }] } }));
    expect((await call(`session_id=${SID}`)).status).toBe(502);
    expect(grants).toEqual([]);
  });

  it('malformed or missing session id → 400 without calling Stripe', async () => {
    expect((await call('product=full-fix')).status).toBe(400);
    expect((await call('session_id=../../etc&product=full-fix')).status).toBe(400);
    expect(retrieve).not.toHaveBeenCalled();
  });

  it('a KV outage at claim time → 503, no grant', async () => {
    retrieve.mockResolvedValue(session());
    kvFail.set = true;
    expect((await call(`session_id=${SID}`)).status).toBe(503);
    expect(grants).toEqual([]);
  });
});

describe('a paid session grants only what was bought', () => {
  it('grants the bought product and returns the confirmation', async () => {
    retrieve.mockResolvedValue(session());
    const r = await call(`session_id=${SID}&product=market-assassin-standard`);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ success: true, email: EMAIL, product: 'market-assassin-standard', tier: 'standard' });
    expect(grants).toEqual([`ma:standard:${EMAIL}`]);
    expect(retrieve).toHaveBeenCalledWith(SID, { expand: ['line_items.data.price'] });
  });

  it('a mismatched ?product= cannot add a product: a Standard purchase never grants Premium', async () => {
    retrieve.mockResolvedValue(session());
    const r = await call(`session_id=${SID}&product=market-assassin-premium`);
    expect(await r.json()).toMatchObject({ success: true, product: 'market-assassin-standard', tier: 'standard' });
    expect(grants).toEqual([`ma:standard:${EMAIL}`]);
    expect(access.ma.get(EMAIL)).toBe('standard');
  });

  it('a cross-family hint cannot add a product: an MA purchase never grants Content Reaper', async () => {
    retrieve.mockResolvedValue(session());
    await call(`session_id=${SID}&product=full-fix`);
    expect(access.cg.size).toBe(0);
    expect(grants).toEqual([`ma:standard:${EMAIL}`]);
  });

  it('never downgrades an existing Premium holder', async () => {
    access.ma.set(EMAIL, 'premium');
    retrieve.mockResolvedValue(session());
    await call(`session_id=${SID}`);
    expect(access.ma.get(EMAIL)).toBe('premium');
    expect(grants).toEqual([]);
  });

  it('content full fix sets the redirect and tier', async () => {
    retrieve.mockResolvedValue(session({ line_items: { has_more: false, data: [{ quantity: 1, price: { id: priceOf('full-fix') } }] } }));
    expect(await (await call(`session_id=${SID}&product=full-fix`)).json())
      .toMatchObject({ product: 'full-fix', tier: 'full-fix', redirectUrl: '/content-generator' });
    expect(grants).toEqual([`cg:full-fix:${EMAIL}`]);
  });
});

describe('idempotent per session id', () => {
  it('a replay is a no-op that returns the same success (single grant, single email)', async () => {
    retrieve.mockResolvedValue(session({ line_items: { has_more: false, data: [{ quantity: 1, price: { id: priceOf('opportunity-hunter-pro') } }] } }));
    const a = await (await call(`session_id=${SID}&product=opportunity-hunter-pro`)).json();
    access.oh.clear(); // even if access were somehow removed, the marker blocks a re-grant from this session
    const b = await (await call(`session_id=${SID}&product=opportunity-hunter-pro`)).json();
    expect(b).toEqual(a);
    expect(grants).toEqual([`oh:${EMAIL}`]);
    expect(sendOh).toHaveBeenCalledTimes(1);
  });

  it('a grant failure returns 5xx, records nothing, and a retry can complete', async () => {
    retrieve.mockResolvedValue(session());
    access.failGrant = true;
    expect((await call(`session_id=${SID}`)).status).toBe(500);
    expect(kvStore.size).toBe(0);
    access.failGrant = false;
    expect((await call(`session_id=${SID}`)).status).toBe(200);
    expect(grants).toEqual([`ma:standard:${EMAIL}`]);
  });

  it('an in-flight confirmation answers 409 without granting', async () => {
    kvStore.set(`stripe-session:confirmed:${SID}`, { state: 'pending' });
    retrieve.mockResolvedValue(session());
    const r = await call(`session_id=${SID}`);
    expect(r.status).toBe(409);
    expect(JSON.stringify(await r.json())).not.toContain(EMAIL);
    expect(grants).toEqual([]);
  });
});
