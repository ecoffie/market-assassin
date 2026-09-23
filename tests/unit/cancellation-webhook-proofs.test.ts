/**
 * #1675 release proofs — drive the REAL `POST` in src/app/api/stripe-webhook/route.ts.
 *
 * Hermetic: `@vercel/kv`, Supabase and Stripe are in-memory fakes; identities are synthetic
 * (`*.invalid`). No live system is contacted.
 *
 * Proves, at the route (not the planner):
 *   duplicates        — same event twice (warm instance) and redelivered to a cold instance
 *   out-of-order      — retry-status update after deletion; a stale deletion after the customer
 *                       re-subscribed (same AND different Stripe customer object); a replayed
 *                       checkout grant arriving after the subscription was cancelled
 *   overlapping       — FHC + one-time MA purchase; FHC + live Alert Pro; comp account
 *   paid-through      — immediate cancel mid-period expires at period end; re-subscribing clears it
 *   payment retries   — past_due / unpaid revoke nothing; the later deletion does
 *   unknown provenance — object-valued KV grant is kept; any read failure keeps access
 *   apply failure     — a KV write failure is surfaced (non-2xx) so Stripe retries
 *
 * ⚠️ Fake-KV assumption: `set` clears any pending expiry. That is Redis `SET` semantics (no
 * KEEPTTL), which Upstash follows; it is asserted here, not measured against Upstash.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const EMAIL = 'subscriber@synthetic.invalid';
const NOW = Date.now();
const DAY = 86_400_000;

// ── KV with TTL ────────────────────────────────────────────────────────────
let kvStore: Record<string, unknown> = {};
let kvExpiry: Record<string, number> = {}; // key → epoch ms
let clock = NOW;
let kvGetFails = false;
let kvDelFails = false;
function live(k: string) {
  if (kvExpiry[k] !== undefined && kvExpiry[k] <= clock) { delete kvStore[k]; delete kvExpiry[k]; }
  return kvStore[k];
}
vi.mock('@vercel/kv', () => ({
  kv: {
    get: async (k: string) => { if (kvGetFails) throw new Error('synthetic kv outage'); return live(k) ?? null; },
    set: async (k: string, v: unknown) => { kvStore[k] = v; delete kvExpiry[k]; },
    del: async (k: string) => { if (kvDelFails) throw new Error('synthetic kv outage'); delete kvStore[k]; delete kvExpiry[k]; },
    expireat: async (k: string, sec: number) => { if (kvDelFails) throw new Error('synthetic kv outage'); kvExpiry[k] = sec * 1000; return 1; },
    lpush: async () => 1,
  },
}));

// ── Supabase ───────────────────────────────────────────────────────────────
let purchases: Array<Record<string, unknown>> = [];
let purchasesError: string | null = null;
let profileFlags: Record<string, unknown> = {};
let notif: Record<string, unknown> = { alert_frequency: 'daily', subscription_status: 'active' };
function q(table: string) {
  const r: { data: unknown; error: { message: string } | null } = { data: [], error: null };
  const b: Record<string, unknown> = {
    select() { if (table === 'purchases') { r.data = purchasesError ? null : purchases; r.error = purchasesError ? { message: purchasesError } : null; } return b; },
    eq() { return b; }, ilike() { return b; }, order() { return b; }, limit() { return b; }, range() { return b; }, in() { return b; },
    maybeSingle: async () => ({ data: null, error: null }),
    single: async () => ({ data: null, error: null }),
    insert: async () => ({ error: null }),
    upsert: async (row: Record<string, unknown>) => { if (table === 'user_notification_settings') notif = { ...notif, ...row }; return { error: null }; },
    update(patch: Record<string, unknown>) {
      const done = async () => {
        if (table === 'user_profiles') profileFlags = { ...profileFlags, ...patch };
        if (table === 'user_notification_settings') notif = { ...notif, ...patch };
        return { error: null };
      };
      return { eq: done, ilike: done };
    },
    then(res: (v: typeof r) => unknown, rej?: (e: unknown) => unknown) {
      try { return Promise.resolve(res(r)); } catch (e) { return rej ? Promise.resolve(rej(e)) : Promise.reject(e); }
    },
  };
  return b;
}
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (t: string) => q(t) }) }));

// ── Stripe ─────────────────────────────────────────────────────────────────
type Sub = { id: string; customer: string; status: string; items: { data: Array<{ price: { product: string; metadata: Record<string, string> }; current_period_end?: number }> }; current_period_end?: number };
let customers: Record<string, { email: string }> = {};
let subscriptions: Sub[] = [];
let listFails = false;
let stripeEvent: unknown = null;
/** Like Stripe's ApiListPromise: awaitable AND async-iterable (auto-pagination). */
function pageable<T>(rows: () => T[]) {
  return {
    then: (res: (v: { data: T[]; has_more: boolean }) => unknown, rej?: (e: unknown) => unknown) => {
      try { return Promise.resolve(res({ data: rows(), has_more: false })); } catch (e) { return rej ? Promise.resolve(rej(e)) : Promise.reject(e); }
    },
    async *[Symbol.asyncIterator]() { for (const r of rows()) yield r; },
  };
}
vi.mock('stripe', () => {
  class FakeStripe {
    webhooks = { constructEvent: () => stripeEvent };
    events = { retrieve: async () => stripeEvent };
    customers = {
      retrieve: async (id: string) => ({ id, deleted: false, email: customers[id]?.email ?? null }),
      list: ({ email }: { email: string }) => pageable(() => Object.entries(customers).filter(([, c]) => c.email === email).map(([id, c]) => ({ id, email: c.email }))),
    };
    subscriptions = {
      list: ({ customer }: { customer: string }) => pageable(() => { if (listFails) throw new Error('synthetic stripe outage'); return subscriptions.filter((s) => s.customer === customer); }),
      retrieve: async (id: string) => { const s = subscriptions.find((x) => x.id === id); if (!s) throw new Error('no such subscription'); return s; },
    };
    checkout = { sessions: { listLineItems: async () => ({ data: [{ price: { id: 'price_alertpro', product: 'prod_U9rOClXY6MFcRu' }, description: 'Alert Pro' }] }) } };
  }
  return { default: FakeStripe };
});

vi.mock('@/lib/mcp/stripe-topup', () => ({ handleMcpCreditTopup: async () => ({ handled: false }) }));
vi.mock('@/lib/mcp/autorecharge', () => ({ handleAutoRechargeSetup: async () => false, MCP_AUTORECHARGE_PI_TYPE: 'mcp_autorecharge' }));
vi.mock('@/lib/purchase-attribution', () => ({ savePurchase: async () => {}, getCheckoutStart: async () => null, recordCheckoutStart: async () => {} }));
vi.mock('@/lib/mindy/affiliate-commissions', () => ({ recordAffiliateFromStripePayment: async () => null }));
vi.mock('@/lib/onboarding/ensure-notification-settings', () => ({ ensureNotificationSettings: async () => ({ ok: true }) }));
vi.mock('@/lib/send-email', () => ({
  sendLicenseKeyEmail: async () => {}, sendOpportunityHunterProEmail: async () => {}, sendDatabaseAccessEmail: async () => {},
  sendAccessCodeEmail: async () => {}, sendContentReaperEmail: async () => {}, sendRecompeteEmail: async () => {},
  sendBundleEmail: async () => {}, sendFHCWelcomeEmail: async () => {}, sendMindyFHCBonusEmail: async () => {},
  sendAlertProWelcomeEmail: async () => {}, sendMarketIntelligenceWelcomeEmail: async () => {},
}));
vi.mock('@/lib/supabase/user-profiles', async (orig) => ({
  ...(await orig<typeof import('@/lib/supabase/user-profiles')>()),
  getOrCreateProfile: async () => ({ email: EMAIL }),
  updateAccessFlags: async () => ({}),
}));

const ALERT = { product: 'prod_U9rOClXY6MFcRu', metadata: {} };
const FHC = { product: 'prod_TaiXlKb350EIQs', metadata: {} };
function sub(id: string, customer: string, status: string, price: typeof ALERT, periodEndMs = NOW - DAY): Sub {
  return { id, customer, status, current_period_end: Math.floor(periodEndMs / 1000), items: { data: [{ price, current_period_end: Math.floor(periodEndMs / 1000) }] } };
}
let seq = 0;
function subEvent(type: 'customer.subscription.deleted' | 'customer.subscription.updated', s: Sub, id = `evt_${++seq}`) {
  return { id, type, created: 1, livemode: false, data: { object: s } };
}
async function post(event: unknown, { fresh = false } = {}) {
  stripeEvent = event;
  if (fresh) vi.resetModules();
  const { POST } = await import('@/app/api/stripe-webhook/route');
  const req = new Request('https://synthetic.invalid/api/stripe-webhook', { method: 'POST', headers: { 'stripe-signature': 'sig' }, body: JSON.stringify(event) });
  const res = await POST(req as unknown as Parameters<typeof POST>[0]);
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}
const has = (k: string) => live(`${k}:${EMAIL}`) !== undefined;

beforeEach(() => {
  kvStore = { [`alertpro:${EMAIL}`]: 'true', [`ospro:${EMAIL}`]: 'true' };
  kvExpiry = {}; clock = NOW; kvGetFails = false; kvDelFails = false;
  purchases = []; purchasesError = null; profileFlags = {}; notif = { alert_frequency: 'daily', subscription_status: 'active' };
  customers = { cus_A: { email: EMAIL } }; subscriptions = []; listFails = false;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://synthetic.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic';
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW);
});

describe('duplicates', () => {
  it('same event twice on a warm instance: second is a no-op', async () => {
    const s = sub('sub_1', 'cus_A', 'canceled', ALERT); subscriptions = [s];
    const e = subEvent('customer.subscription.deleted', s);
    expect((await post(e)).body.action).toBe('revoked');
    expect((await post(e)).body.duplicate).toBe(true);
    expect(has('alertpro')).toBe(false);
  });
  it('redelivered to a COLD instance (in-memory dedup gone): idempotent, no error, same end state', async () => {
    const s = sub('sub_1', 'cus_A', 'canceled', ALERT); subscriptions = [s];
    const e = subEvent('customer.subscription.deleted', s);
    await post(e, { fresh: true });
    const second = await post(e, { fresh: true });
    expect(second.status).toBe(200);
    expect(has('alertpro')).toBe(false); expect(has('ospro')).toBe(false);
    expect(notif.alert_frequency).toBe('daily');
  });
});

describe('out-of-order', () => {
  it('a past_due update arriving AFTER the deletion changes nothing and re-grants nothing', async () => {
    const s = sub('sub_1', 'cus_A', 'canceled', ALERT); subscriptions = [s];
    await post(subEvent('customer.subscription.deleted', s));
    const late = await post(subEvent('customer.subscription.updated', { ...s, status: 'past_due' }));
    expect(late.body.action).toBe('none');
    expect(has('alertpro')).toBe(false);
  });
  it('stale deletion of an OLD subscription after re-subscribing on the SAME customer keeps access', async () => {
    const old = sub('sub_old', 'cus_A', 'canceled', ALERT);
    subscriptions = [old, sub('sub_new', 'cus_A', 'active', ALERT, NOW + 30 * DAY)];
    await post(subEvent('customer.subscription.deleted', old));
    expect(has('alertpro')).toBe(true); expect(has('ospro')).toBe(true);
  });
  it('stale deletion after re-subscribing on a DIFFERENT customer object (same email) keeps access', async () => {
    // Payment links create a new Customer per checkout, so this is the common re-subscribe shape.
    customers = { cus_A: { email: EMAIL }, cus_B: { email: EMAIL } };
    const old = sub('sub_old', 'cus_A', 'canceled', ALERT);
    subscriptions = [old, sub('sub_new', 'cus_B', 'active', ALERT, NOW + 30 * DAY)];
    await post(subEvent('customer.subscription.deleted', old));
    expect(has('alertpro')).toBe(true); expect(has('ospro')).toBe(true);
  });
  it('a checkout grant REPLAYED after its subscription was cancelled does not re-grant', async () => {
    kvStore = {};
    subscriptions = [sub('sub_1', 'cus_A', 'canceled', ALERT)];
    const replay = {
      id: `evt_${++seq}`, type: 'checkout.session.completed', created: 1, livemode: false,
      data: { object: { id: 'cs_replay', mode: 'subscription', subscription: 'sub_1', amount_total: 1900, currency: 'usd',
        customer: 'cus_A', customer_email: EMAIL, customer_details: { email: EMAIL, name: 'Synthetic' }, client_reference_id: null, metadata: { tier: 'alert_pro' } } },
    };
    await post(replay);
    expect(has('alertpro')).toBe(false); expect(has('ospro')).toBe(false);
  });
  it('a checkout grant for a LIVE subscription still grants (control)', async () => {
    kvStore = {};
    subscriptions = [sub('sub_1', 'cus_A', 'active', ALERT, NOW + 30 * DAY)];
    const ok = {
      id: `evt_${++seq}`, type: 'checkout.session.completed', created: 1, livemode: false,
      data: { object: { id: 'cs_live', mode: 'subscription', subscription: 'sub_1', amount_total: 1900, currency: 'usd',
        customer: 'cus_A', customer_email: EMAIL, customer_details: { email: EMAIL, name: 'Synthetic' }, client_reference_id: null, metadata: { tier: 'alert_pro' } } },
    };
    await post(ok);
    expect(has('alertpro')).toBe(true); expect(has('ospro')).toBe(true);
  });
});

describe('overlapping grants', () => {
  it('FHC cancel keeps ma: for a one-time Market Assassin buyer', async () => {
    kvStore = { [`ma:${EMAIL}`]: 'true', [`alertpro:${EMAIL}`]: 'true', [`ospro:${EMAIL}`]: 'true' };
    purchases = [{ product_id: 'market-assassin-premium', product_name: 'Market Assassin Premium' }];
    const s = sub('sub_f', 'cus_A', 'canceled', FHC); subscriptions = [s];
    const r = await post(subEvent('customer.subscription.deleted', s));
    expect(has('ma')).toBe(true); expect(has('alertpro')).toBe(false);
    expect(profileFlags.access_assassin_standard).toBeUndefined();
    expect(r.body.action).toBe('revoked');
  });
  it('Alert Pro cancel keeps everything while an FHC membership is live', async () => {
    const s = sub('sub_a', 'cus_A', 'canceled', ALERT);
    subscriptions = [s, sub('sub_f', 'cus_A', 'active', FHC, NOW + 30 * DAY)];
    await post(subEvent('customer.subscription.deleted', s));
    expect(has('alertpro')).toBe(true); expect(has('ospro')).toBe(true);
  });
  it('a comp/staff account keeps everything', async () => {
    const STAFF = 'comp-proof@govcongiants.com';
    customers = { cus_S: { email: STAFF } };
    kvStore = { [`alertpro:${STAFF}`]: 'true', [`ospro:${STAFF}`]: 'true' };
    const s = sub('sub_s', 'cus_S', 'canceled', ALERT); subscriptions = [s];
    const r = await post(subEvent('customer.subscription.deleted', s));
    expect(r.body.action).toBe('none');
    expect(kvStore[`ospro:${STAFF}`]).toBe('true');
  });
});

describe('paid-through', () => {
  it('immediate cancel mid-period: access expires at period end, not now; flags kept', async () => {
    const end = NOW + 10 * DAY;
    const s = sub('sub_1', 'cus_A', 'canceled', ALERT, end); subscriptions = [s];
    await post(subEvent('customer.subscription.deleted', s));
    expect(has('alertpro')).toBe(true);
    expect(kvExpiry[`ospro:${EMAIL}`]).toBe(Math.floor(end / 1000) * 1000);
    expect(profileFlags.access_hunter_pro).toBeUndefined();
    clock = end + 1;
    expect(has('alertpro')).toBe(false); expect(has('ospro')).toBe(false);
  });
  it('re-subscribing before the period ends clears the pending expiry (SET semantics)', async () => {
    const end = NOW + 10 * DAY;
    const s = sub('sub_1', 'cus_A', 'canceled', ALERT, end); subscriptions = [s];
    await post(subEvent('customer.subscription.deleted', s));
    subscriptions.push(sub('sub_2', 'cus_A', 'active', ALERT, NOW + 40 * DAY));
    await post({ id: `evt_${++seq}`, type: 'checkout.session.completed', created: 1, livemode: false,
      data: { object: { id: 'cs_2', mode: 'subscription', subscription: 'sub_2', amount_total: 1900, currency: 'usd', customer: 'cus_A',
        customer_email: EMAIL, customer_details: { email: EMAIL, name: 'Synthetic' }, client_reference_id: null, metadata: { tier: 'alert_pro' } } } });
    clock = end + 1;
    expect(has('alertpro')).toBe(true); expect(has('ospro')).toBe(true);
  });
});

describe('payment retries', () => {
  it.each(['past_due', 'unpaid'])('%s update revokes nothing; the eventual deletion does', async (status) => {
    const s = sub('sub_1', 'cus_A', status, ALERT); subscriptions = [s];
    const r = await post(subEvent('customer.subscription.updated', s));
    expect(r.body.action).toBe('none');
    expect(has('alertpro')).toBe(true); expect(notif.subscription_status).toBe('active');
    const ended = { ...s, status: 'canceled' }; subscriptions = [ended];
    await post(subEvent('customer.subscription.deleted', ended));
    expect(has('alertpro')).toBe(false);
  });
});

describe('unknown grant provenance', () => {
  it('an object-valued (purchase/admin) ospro: grant is kept', async () => {
    kvStore[`ospro:${EMAIL}`] = { email: EMAIL, tier: 'pro', source: 'admin' };
    const s = sub('sub_1', 'cus_A', 'canceled', ALERT); subscriptions = [s];
    await post(subEvent('customer.subscription.deleted', s));
    expect(has('alertpro')).toBe(false); expect(has('ospro')).toBe(true);
  });
  it.each([
    ['KV read fails', () => { kvGetFails = true; }],
    ['subscription list fails', () => { listFails = true; }],
    ['purchases read fails', () => { purchasesError = 'synthetic'; }],
  ])('%s → keep access, report kept_uncertain_attribution', async (_n, arm) => {
    const s = sub('sub_1', 'cus_A', 'canceled', ALERT); subscriptions = [s];
    arm();
    const r = await post(subEvent('customer.subscription.deleted', s));
    expect(r.body.action).toBe('kept_uncertain_attribution');
    kvGetFails = false;
    expect(has('alertpro')).toBe(true); expect(has('ospro')).toBe(true);
  });
});

describe('apply failure', () => {
  it('a KV write failure is surfaced as non-2xx so Stripe redelivers (revocation is idempotent)', async () => {
    const s = sub('sub_1', 'cus_A', 'canceled', ALERT); subscriptions = [s];
    kvDelFails = true;
    const e = subEvent('customer.subscription.deleted', s);
    const r = await post(e);
    expect(r.status).toBeGreaterThanOrEqual(500);
    kvDelFails = false;
    // Stripe redelivers the SAME event id, often to the same warm instance: the in-memory dedup
    // must not swallow the retry of a failed attempt.
    const retry = await post(e);
    expect(retry.body.duplicate).toBeUndefined();
    expect(retry.status).toBe(200);
    expect(has('alertpro')).toBe(false);
  });
});
