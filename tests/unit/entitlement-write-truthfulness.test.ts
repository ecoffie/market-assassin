/**
 * TASK-STRIPE-DUP-006 — the two call-site defects, pinned to PRODUCTION code.
 *
 * Hermetic: `@vercel/kv`, Supabase and Stripe are in-memory fakes. No live
 * Stripe, Supabase, KV or email. All identities are synthetic (`*.invalid`).
 *
 *  scope 7  — an empty update must never be audited as a successful write
 *  scope 11 — revocation must clear BOTH stores, and surface partial failure
 *
 * ── Why scope 7 drives the ROUTE, not a local predicate ───────────────────────
 * The superseded version of this file asserted on a helper reimplemented INSIDE
 * the test (`const auditWrote = (u) => Object.keys(u).length > 0`). That helper
 * is not the shipped code: reverting the route to `Boolean(accessUpdates)` left
 * the whole suite green, so the regression it existed to prevent could ship
 * unnoticed. Proven on 2026-09-05 by reintroducing the bug — 5/5 tests passed.
 *
 * The scope-7 tests below therefore invoke the real `POST` handler from
 * `src/app/api/stripe-webhook/route.ts` and assert on the `wrote_profile` value
 * that actually reaches the `access_grants` insert. The expression under test is
 * the one that ships; reverting it fails these tests on the false claim itself.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const EMAIL = 'revoke-target@synthetic.invalid';
const WEBHOOK_EMAIL = 'webhook-audit@synthetic.invalid';

// ── in-memory KV ────────────────────────────────────────────────────────────
let kvStore: Record<string, string> = {};
let kvDelShouldFail = false;

vi.mock('@vercel/kv', () => ({
  kv: {
    get: async (k: string) => kvStore[k] ?? null,
    set: async (k: string, v: string) => { kvStore[k] = v; },
    del: async (k: string) => {
      if (kvDelShouldFail) throw new Error('synthetic kv outage');
      delete kvStore[k];
    },
  },
}));

// ── in-memory Supabase ──────────────────────────────────────────────────────
let profileRow: { access_briefings: boolean; briefings_expires_at: string | null } = {
  access_briefings: true,
  briefings_expires_at: null,
};
let profileUpdateError: string | null = null;
let updateCalls = 0;

/**
 * Every row the PRODUCTION `recordAccessGrant` inserts into `access_grants`
 * during a test. This is the audit artefact scope 7 is about — `wrote_profile`
 * here is written by the route's own expression, not by the test.
 */
let accessGrantInserts: Array<Record<string, unknown>> = [];

/**
 * Chainable Supabase fake.
 *
 * The webhook issues several different query shapes against the same client
 * (`select().eq().limit()`, `select().eq().maybeSingle()`, `insert()`,
 * `update().eq()`). The builder below is thenable, so ANY of those chains
 * resolves — a fake that supports only one shape leaves the route awaiting a
 * value that never arrives, which reads as a hang rather than a failed
 * assertion.
 *
 * It records exactly two things the assertions depend on: rows inserted into
 * `access_grants`, and updates applied to the profile row.
 */
function makeQuery(table: string) {
  const result: { data: unknown; error: { message: string } | null } = { data: [], error: null };

  const builder: Record<string, unknown> = {
    select() {
      if (table === 'user_profiles') result.data = profileRow;
      return builder;
    },
    eq() { return builder; },
    limit() { return builder; },
    maybeSingle: async () => ({
      data: table === 'user_profiles' ? profileRow : null,
      error: null,
    }),
    insert: async (row: Record<string, unknown>) => {
      if (table === 'access_grants') accessGrantInserts.push(row);
      return { error: null };
    },
    update(patch: Record<string, unknown>) {
      return {
        eq: async () => {
          updateCalls += 1;
          if (profileUpdateError) return { error: { message: profileUpdateError } };
          profileRow = { ...profileRow, ...(patch as typeof profileRow) };
          return { error: null };
        },
      };
    },
    // Makes the builder awaitable for chains that never call a terminal method
    // (`select().eq().limit()` is awaited directly). `result` is a PLAIN object
    // with no `then`, so awaiting it terminates instead of recursively
    // unwrapping the builder into itself.
    then(resolve: (v: typeof result) => unknown, reject?: (e: unknown) => unknown) {
      try { return Promise.resolve(resolve(result)); } catch (e) { return reject ? Promise.resolve(reject(e)) : Promise.reject(e); }
    },
  };

  return builder;
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (table: string) => makeQuery(table) }),
}));

import { revokeBriefingsAccessBothSides } from '@/lib/briefings/access';

beforeEach(() => {
  kvStore = { [`briefings:${EMAIL}`]: 'true' };
  kvDelShouldFail = false;
  profileRow = { access_briefings: true, briefings_expires_at: null };
  profileUpdateError = null;
  updateCalls = 0;
  accessGrantInserts = [];
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://synthetic.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-service-role-key';
});

describe('symmetric revocation (scope 11)', () => {
  it('clears BOTH the KV key and the profile entitlement', async () => {
    const res = await revokeBriefingsAccessBothSides(EMAIL);

    expect(res.ok).toBe(true);
    expect(res.wroteKv).toBe(true);
    expect(res.wroteProfile).toBe(true);
    expect(kvStore[`briefings:${EMAIL}`]).toBeUndefined();
    expect(profileRow.access_briefings).toBe(false);
    expect(profileRow.briefings_expires_at).toBeNull();
  });

  it('does NOT leave the profile flag stranded when KV deletion fails', async () => {
    kvDelShouldFail = true;
    const res = await revokeBriefingsAccessBothSides(EMAIL);

    // The failure is surfaced, not swallowed...
    expect(res.ok).toBe(false);
    expect(res.wroteKv).toBe(false);
    expect(res.failures.join(' ')).toMatch(/kv/i);
    // ...and the profile side still cleared, so the entitlement cannot survive
    // on the fallback path.
    expect(profileRow.access_briefings).toBe(false);
  });

  it('surfaces a profile update failure instead of reporting success', async () => {
    profileUpdateError = 'synthetic permission denied';
    const res = await revokeBriefingsAccessBothSides(EMAIL);

    expect(res.ok).toBe(false);
    expect(res.wroteProfile).toBe(false);
    expect(res.failures.join(' ')).toMatch(/profile/i);
    expect(updateCalls).toBe(1);
  });
});

// ── scope 7: the PRODUCTION webhook audit path ──────────────────────────────
//
// `updateAccessFlags` returns `{}` on three no-write paths. The one modelled
// here is an UNMAPPED TIER: the tier string matches no branch of the flag map,
// so no column is ever written — yet the route still reaches `recordAccessGrant`
// and audits the outcome. `Boolean({})` is `true`, so the audit claimed a
// profile write that never happened. That is the live defect: two `access_grants`
// rows asserting wrote_profile=true for a customer whose `access_briefings` was
// false.
//
// Driving `POST` end-to-end means these assertions read the shipped expression.

/** Minimal Stripe stub: signature verification passes through to our event. */
let stripeEvent: unknown = null;

vi.mock('stripe', () => {
  class FakeStripe {
    webhooks = { constructEvent: () => stripeEvent };
    checkout = {
      sessions: {
        listLineItems: async () => ({
          data: [{ price: { id: 'price_synthetic_unmapped' }, description: 'Synthetic Unmapped Product' }],
        }),
      },
    };
    events = { retrieve: async () => stripeEvent };
  }
  return { default: FakeStripe };
});

// Collaborators the audit assertion does not depend on. Each is stubbed so the
// handler reaches recordAccessGrant without touching a real system; NONE of them
// stands in for the expression under test.
vi.mock('@/lib/mcp/stripe-topup', () => ({ handleMcpCreditTopup: async () => ({ handled: false }) }));
vi.mock('@/lib/mcp/autorecharge', () => ({
  handleAutoRechargeSetup: async () => false,
  MCP_AUTORECHARGE_PI_TYPE: 'mcp_autorecharge',
}));
vi.mock('@/lib/purchase-attribution', () => ({
  savePurchase: async () => {},
  getCheckoutStart: async () => null,
  recordCheckoutStart: async () => {},
}));
vi.mock('@/lib/mindy/affiliate-commissions', () => ({ recordAffiliateFromStripePayment: async () => null }));
vi.mock('@/lib/onboarding/ensure-notification-settings', () => ({
  ensureNotificationSettings: async () => ({ ok: true }),
}));
// Named explicitly rather than via a Proxy: vitest enumerates a mocked module's
// namespace, and a catch-all Proxy `get` trap makes that enumeration hang — the
// route import never resolves, which surfaces as a timeout with no stack.
vi.mock('@/lib/send-email', () => ({
  sendLicenseKeyEmail: async () => {},
  sendOpportunityHunterProEmail: async () => {},
  sendDatabaseAccessEmail: async () => {},
  sendAccessCodeEmail: async () => {},
  sendContentReaperEmail: async () => {},
  sendRecompeteEmail: async () => {},
  sendBundleEmail: async () => {},
  sendFHCWelcomeEmail: async () => {},
  sendMindyFHCBonusEmail: async () => {},
  sendAlertProWelcomeEmail: async () => {},
  sendMarketIntelligenceWelcomeEmail: async () => {},
}));

/**
 * The real flag map. Kept UNMOCKED on purpose for the `{}` case so the empty
 * return the route audits is produced by production logic, not by the test.
 */
vi.mock('@/lib/supabase/user-profiles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/supabase/user-profiles')>();
  return { ...actual, getOrCreateProfile: async () => ({ email: WEBHOOK_EMAIL }) };
});

/** Build a synthetic checkout.session.completed event for the given tier. */
function checkoutEvent(tier: string) {
  return {
    id: `evt_synthetic_${tier}_${Math.random().toString(36).slice(2)}`,
    type: 'checkout.session.completed',
    created: 1_700_000_000,
    livemode: false,
    data: {
      object: {
        id: `cs_synthetic_${Math.random().toString(36).slice(2)}`,
        mode: 'payment',
        amount_total: 12_300,
        currency: 'usd',
        customer_details: { email: WEBHOOK_EMAIL, name: 'Synthetic Buyer' },
        customer_email: WEBHOOK_EMAIL,
        customer: 'cus_synthetic',
        client_reference_id: null,
        metadata: { tier },
      },
    },
  };
}

/** Invoke the real route handler with a synthetic signed request. */
async function postWebhook(tier: string) {
  stripeEvent = checkoutEvent(tier);
  const { POST } = await import('@/app/api/stripe-webhook/route');
  const request = new Request('https://synthetic.invalid/api/stripe-webhook', {
    method: 'POST',
    headers: { 'stripe-signature': 'synthetic-signature' },
    body: JSON.stringify(stripeEvent),
  });
  return POST(request as unknown as Parameters<typeof POST>[0]);
}

/** The access_grants row the PRODUCTION route wrote for the automatic grant. */
function webhookGrantRow() {
  return accessGrantInserts.find((r) => r.source === 'stripe_webhook');
}

describe('empty-update audit truthfulness (scope 7, production webhook path)', () => {
  it('does NOT audit a profile write when updateAccessFlags wrote nothing', async () => {
    // Sanity: this is the trap the production expression must not fall into.
    expect(Boolean({})).toBe(true);

    // 'mcp_entry' maps to no access flag, so updateAccessFlags returns {}.
    await postWebhook('mcp_entry');

    const row = webhookGrantRow();
    expect(row, 'the webhook must audit its automatic grant').toBeDefined();
    // The assertion that fails on `wroteProfile: Boolean(accessUpdates)`.
    expect(
      row!.wrote_profile,
      'an empty flag map must never be audited as a profile write',
    ).toBe(false);
  });

  it('DOES audit a profile write when a real flag was written', async () => {
    await postWebhook('briefings');

    const row = webhookGrantRow();
    expect(row).toBeDefined();
    expect(row!.wrote_profile).toBe(true);
  });
});
