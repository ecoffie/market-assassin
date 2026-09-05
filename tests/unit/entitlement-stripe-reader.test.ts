/**
 * The Stripe evidence READER — `buildEntitlementRepairDeps().readStripeSubscriptions`.
 *
 * These tests are HERMETIC and every identity, customer, subscription, price and
 * product id is SYNTHETIC. No real customer data appears in this file.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM entitlement-repair.test.ts
 *
 * That suite fakes the `deps` boundary, so it exercises the DECISION logic with
 * evidence handed to it ready-made. It passed green while the shipped reader
 * could not fetch that evidence at all: the request asked Stripe to expand
 * `data.items.data.price.product` — FIVE levels — and Stripe hard-rejects an
 * expansion deeper than four. Every live repair aborted with a Stripe read
 * failure and no identity was ever repairable.
 *
 * A fake that ignores `expand` and pre-attaches an expanded product cannot
 * catch that. So the fake below ENFORCES Stripe's real constraint: it throws on
 * a too-deep expansion, and it returns `price.product` as a bare ID string
 * exactly as the live API does under a legal expansion. That is what makes the
 * separate `products.retrieve` step load-bearing rather than decorative.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Synthetic world
// ─────────────────────────────────────────────────────────────────────────────

const EMAIL_PRODUCT_ONLY = 'reader-product-tier@synthetic.invalid';
const EMAIL_PRICE_ONLY = 'reader-price-tier@synthetic.invalid';
const EMAIL_TWO_CUSTOMERS = 'reader-two-customers@synthetic.invalid';
const EMAIL_NO_MATCH = 'reader-nobody@synthetic.invalid';

/** Shared across identities — proves the per-invocation cache does its job. */
const SHARED_PRODUCT_ID = 'prod_SYNTHETICSHARED';

const PRODUCTS: Record<string, { id: string; metadata: Record<string, string>; deleted?: boolean }> = {
  [SHARED_PRODUCT_ID]: { id: SHARED_PRODUCT_ID, metadata: { tier: 'briefings' } },
  prod_SYNTHETICNOTIER: { id: 'prod_SYNTHETICNOTIER', metadata: {} },
};

/** Stripe's real rule: an expansion path may not exceed four levels. */
function assertLegalExpansion(expand: string[] | undefined) {
  for (const path of expand ?? []) {
    if (path.split('.').length > 4) {
      const err = new Error(
        `You cannot expand more than 4 levels of a property. Property: ${path}`,
      );
      (err as Error & { statusCode?: number }).statusCode = 400;
      throw err;
    }
  }
}

type FakeSub = {
  id: string;
  status: string;
  cancel_at_period_end?: boolean;
  priceId: string;
  productId: string;
  priceMetadata?: Record<string, string>;
  interval?: 'month' | 'year';
  unitAmount?: number;
  currentPeriodEnd?: number;
};

type World = {
  customersByEmail: Record<string, string[]>;
  subsByCustomer: Record<string, FakeSub[]>;
  productRetrieveCalls: string[];
  failProductRetrieve?: string;
  failSubscriptionList?: boolean;
};

let world: World;

function makeWorld(over: Partial<World> = {}): World {
  return {
    customersByEmail: {},
    subsByCustomer: {},
    productRetrieveCalls: [],
    ...over,
  };
}

vi.mock('@/lib/stripe', () => ({
  getStripe: () => ({
    customers: {
      list: async ({ email }: { email: string }) => ({
        data: (world.customersByEmail[email] ?? []).map((id) => ({ id })),
        has_more: false,
      }),
    },
    subscriptions: {
      list: async ({ customer, expand }: { customer: string; expand?: string[] }) => {
        assertLegalExpansion(expand);
        if (world.failSubscriptionList) throw new Error('stripe subscriptions.list exploded');
        const subs = world.subsByCustomer[customer] ?? [];
        return {
          data: subs.map((s) => ({
            id: s.id,
            status: s.status,
            cancel_at_period_end: s.cancel_at_period_end ?? false,
            items: {
              data: [
                {
                  current_period_end: s.currentPeriodEnd ?? 1_800_000_000,
                  price: {
                    id: s.priceId,
                    // Under a LEGAL expansion Stripe returns the bare product id.
                    product: s.productId,
                    metadata: s.priceMetadata ?? {},
                    recurring: { interval: s.interval ?? 'month' },
                    unit_amount: s.unitAmount ?? 14900,
                  },
                },
              ],
            },
          })),
          has_more: false,
        };
      },
    },
    products: {
      retrieve: async (id: string) => {
        world.productRetrieveCalls.push(id);
        if (world.failProductRetrieve === id) throw new Error(`product ${id} is unreadable`);
        const p = PRODUCTS[id];
        if (!p) throw new Error(`No such product: ${id}`);
        return p;
      },
    },
  }),
}));

const { buildEntitlementRepairDeps, repairEntitlement } = await import(
  '@/lib/supabase/briefings-entitlement'
);

const ADMIN = { role: 'administrator' as const, actor: 'test', confirm: true };

beforeEach(() => {
  world = makeWorld();
});

// ─────────────────────────────────────────────────────────────────────────────

describe('the fake enforces Stripe’s real expansion limit', () => {
  it('rejects an expansion deeper than four levels', () => {
    expect(() => assertLegalExpansion(['data.items.data.price.product'])).toThrow(
      /cannot expand more than 4 levels/,
    );
  });

  it('accepts the four-level expansion the reader now uses', () => {
    expect(() => assertLegalExpansion(['data.items.data.price'])).not.toThrow();
  });
});

describe('readStripeSubscriptions resolves product metadata', () => {
  it('qualifies a subscription whose tier exists ONLY on product.metadata', async () => {
    world.customersByEmail[EMAIL_PRODUCT_ONLY] = ['cus_SYNTHETIC0001'];
    world.subsByCustomer.cus_SYNTHETIC0001 = [
      {
        id: 'sub_SYNTHETIC0001',
        status: 'active',
        priceId: 'price_SYNTHETIC149M',
        productId: SHARED_PRODUCT_ID,
        priceMetadata: {}, // nothing on the price — the product carries the truth
      },
    ];

    const evidence = await buildEntitlementRepairDeps().readStripeSubscriptions(
      EMAIL_PRODUCT_ONLY,
    );

    expect(evidence).toHaveLength(1);
    expect(evidence[0].productId).toBe(SHARED_PRODUCT_ID);
    expect(evidence[0].productMetadata.tier).toBe('briefings');
    expect(evidence[0].priceMetadata.tier).toBeUndefined();
  });

  it('still honours price.metadata.tier as the existing fallback', async () => {
    world.customersByEmail[EMAIL_PRICE_ONLY] = ['cus_SYNTHETIC0002'];
    world.subsByCustomer.cus_SYNTHETIC0002 = [
      {
        id: 'sub_SYNTHETIC0002',
        status: 'active',
        priceId: 'price_SYNTHETIC49M',
        productId: 'prod_SYNTHETICNOTIER', // product carries NO tier
        priceMetadata: { tier: 'briefings' },
      },
    ];

    const evidence = await buildEntitlementRepairDeps().readStripeSubscriptions(EMAIL_PRICE_ONLY);

    expect(evidence[0].productMetadata.tier).toBeUndefined();
    expect(evidence[0].priceMetadata.tier).toBe('briefings');
  });

  it('retrieves a shared product ONCE per invocation', async () => {
    world.customersByEmail[EMAIL_TWO_CUSTOMERS] = ['cus_SYNTHETIC0003', 'cus_SYNTHETIC0004'];
    world.subsByCustomer.cus_SYNTHETIC0003 = [
      { id: 'sub_SYNTHETIC0003', status: 'canceled', priceId: 'price_A', productId: SHARED_PRODUCT_ID },
    ];
    world.subsByCustomer.cus_SYNTHETIC0004 = [
      { id: 'sub_SYNTHETIC0004', status: 'active', priceId: 'price_B', productId: SHARED_PRODUCT_ID },
    ];

    const evidence = await buildEntitlementRepairDeps().readStripeSubscriptions(
      EMAIL_TWO_CUSTOMERS,
    );

    // BOTH customer objects were aggregated...
    expect(evidence).toHaveLength(2);
    expect(evidence.map((e) => e.subscriptionId).sort()).toEqual([
      'sub_SYNTHETIC0003',
      'sub_SYNTHETIC0004',
    ]);
    // ...and the shared product cost exactly one retrieve.
    expect(world.productRetrieveCalls).toEqual([SHARED_PRODUCT_ID]);
  });

  it('surfaces a product retrieval failure instead of returning tier-less evidence', async () => {
    world.customersByEmail[EMAIL_PRODUCT_ONLY] = ['cus_SYNTHETIC0005'];
    world.subsByCustomer.cus_SYNTHETIC0005 = [
      { id: 'sub_SYNTHETIC0005', status: 'active', priceId: 'price_C', productId: SHARED_PRODUCT_ID },
    ];
    world.failProductRetrieve = SHARED_PRODUCT_ID;

    await expect(
      buildEntitlementRepairDeps().readStripeSubscriptions(EMAIL_PRODUCT_ONLY),
    ).rejects.toThrow(/unreadable/);
  });

  it('returns an authoritative empty when the identity genuinely has no customers', async () => {
    const evidence = await buildEntitlementRepairDeps().readStripeSubscriptions(EMAIL_NO_MATCH);
    expect(evidence).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// End-to-end through repairEntitlement: the reader wired to the decision.
// ─────────────────────────────────────────────────────────────────────────────

function depsWithRealReader(over: Partial<Record<string, unknown>> = {}) {
  const real = buildEntitlementRepairDeps();
  const writes = { profile: 0, kv: 0, settings: 0, audits: 0 };
  return {
    writes,
    deps: {
      readStripeSubscriptions: real.readStripeSubscriptions,
      readProfile: async () => ({ access_briefings: false, briefings_expires_at: null }),
      readKv: async () => false,
      readSettings: async () => ({ is_active: true, briefings_enabled: false }),
      writeProfile: async () => { writes.profile += 1; },
      writeKv: async () => { writes.kv += 1; },
      writeSettings: async () => { writes.settings += 1; },
      recordAudit: async () => { writes.audits += 1; },
      ...over,
    },
  };
}

describe('reader wired into repairEntitlement', () => {
  it('a product-only tier now QUALIFIES (the live failure this fixes)', async () => {
    world.customersByEmail[EMAIL_PRODUCT_ONLY] = ['cus_SYNTHETIC0006'];
    world.subsByCustomer.cus_SYNTHETIC0006 = [
      { id: 'sub_SYNTHETIC0006', status: 'active', priceId: 'price_D', productId: SHARED_PRODUCT_ID },
    ];

    const { deps, writes } = depsWithRealReader();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await repairEntitlement(EMAIL_PRODUCT_ONLY, deps as any, ADMIN);

    expect(res.ok).toBe(true);
    expect(res.qualifies).toBe(true);
    expect(res.failures).toEqual([]);
    expect(res.intended).toMatchObject({ access_briefings: true, kv: true });
    // dry-run default still writes nothing
    expect(writes).toEqual({ profile: 0, kv: 0, settings: 0, audits: 0 });
  });

  it('one canceled customer + one active qualifying customer PRESERVES qualification', async () => {
    world.customersByEmail[EMAIL_TWO_CUSTOMERS] = ['cus_SYNTHETIC0007', 'cus_SYNTHETIC0008'];
    world.subsByCustomer.cus_SYNTHETIC0007 = [
      { id: 'sub_SYNTHETIC0007', status: 'canceled', priceId: 'price_E', productId: SHARED_PRODUCT_ID },
    ];
    world.subsByCustomer.cus_SYNTHETIC0008 = [
      { id: 'sub_SYNTHETIC0008', status: 'active', priceId: 'price_F', productId: SHARED_PRODUCT_ID },
    ];

    const { deps } = depsWithRealReader();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await repairEntitlement(EMAIL_TWO_CUSTOMERS, deps as any, ADMIN);

    expect(res.qualifies).toBe(true);
    expect(res.survivingSubscriptionIds).toEqual(['sub_SYNTHETIC0008']);
  });

  it('a product lookup failure is FAIL-CLOSED: visible failure, no entitlement decision, no write', async () => {
    world.customersByEmail[EMAIL_PRODUCT_ONLY] = ['cus_SYNTHETIC0009'];
    world.subsByCustomer.cus_SYNTHETIC0009 = [
      { id: 'sub_SYNTHETIC0009', status: 'active', priceId: 'price_G', productId: SHARED_PRODUCT_ID },
    ];
    world.failProductRetrieve = SHARED_PRODUCT_ID;

    const { deps, writes } = depsWithRealReader();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await repairEntitlement(EMAIL_PRODUCT_ONLY, deps as any, {
      ...ADMIN,
      execute: true, // even asked to WRITE, a failed read must not write
    });

    expect(res.ok).toBe(false);
    expect(res.failures.join(' ')).toMatch(/stripe read failed/i);
    expect(res.qualifies).toBeUndefined();
    expect(res.changed).toBe(false);
    expect(writes).toEqual({ profile: 0, kv: 0, settings: 0, audits: 0 });
  });

  it('a subscriptions.list failure is likewise fail-closed and never an empty result', async () => {
    world.customersByEmail[EMAIL_PRODUCT_ONLY] = ['cus_SYNTHETIC0010'];
    world.subsByCustomer.cus_SYNTHETIC0010 = [
      { id: 'sub_SYNTHETIC0010', status: 'active', priceId: 'price_H', productId: SHARED_PRODUCT_ID },
    ];
    world.failSubscriptionList = true;

    const { deps, writes } = depsWithRealReader();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await repairEntitlement(EMAIL_PRODUCT_ONLY, deps as any, { ...ADMIN, execute: true });

    expect(res.ok).toBe(false);
    expect(res.failures.join(' ')).toMatch(/stripe read failed/i);
    expect(writes).toEqual({ profile: 0, kv: 0, settings: 0, audits: 0 });
  });
});
