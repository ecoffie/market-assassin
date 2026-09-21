/**
 * TASK-STRIPE-DUP-004 — audited both-sides entitlement repair.
 *
 * These tests are HERMETIC. They never touch live Stripe, Supabase, KV or email:
 * every external dependency is an in-memory fake, and every identity, product,
 * price, subscription and customer id below is SYNTHETIC (`*.invalid` addresses
 * and `*_SYNTHETIC*` ids). No real customer data appears in this file.
 *
 * They encode the acceptance criteria of the task scope, and each one FAILS
 * against the pre-fix code — that is the point. What they pin down:
 *
 *   dry-run is the default and writes nothing          (scope 2)
 *   entitlement comes from Stripe metadata, not flags  (scope 3)
 *   historical purchase rows are never rewritten       (scope 4)
 *   the audit records what was ACTUALLY written        (scope 5, 7)
 *   both stores reconcile idempotently + postcondition (scope 6)
 *   external failures are surfaced, never swallowed    (scope 8)
 *   expiry is derived per product, never guessed       (scope 9)
 *   briefings_enabled follows its proven contract      (scope 10)
 *   revocation is symmetric and duplicate-safe         (scope 11, 12)
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  repairEntitlement,
  type EntitlementRepairDeps,
  type StripeSubscriptionEvidence,
} from '@/lib/supabase/briefings-entitlement';

// ─────────────────────────────────────────────────────────────────────────────
// Synthetic world
// ─────────────────────────────────────────────────────────────────────────────

const EMAIL_MONTHLY_149 = 'repair-monthly149@synthetic.invalid';
const EMAIL_MONTHLY_49 = 'repair-grandfathered49@synthetic.invalid';
const EMAIL_ANNUAL_497 = 'repair-annual497@synthetic.invalid';
const EMAIL_DUPLICATE = 'repair-duplicate@synthetic.invalid';

/** The authoritative signal: product metadata tier, NOT a name heuristic or amount. */
const BRIEFINGS_PRODUCT = { id: 'prod_SYNTHETICBRIEF', metadata: { tier: 'briefings' } };
const UNRELATED_PRODUCT = { id: 'prod_SYNTHETICOTHER', metadata: { tier: 'mcp_credits' } };
const AMBIGUOUS_PRODUCT = { id: 'prod_SYNTHETICAMBIG', metadata: {} as Record<string, string> };

const ANNUAL_PERIOD_END = '2027-03-01T00:00:00.000Z';

function sub(over: Partial<StripeSubscriptionEvidence> = {}): StripeSubscriptionEvidence {
  return {
    subscriptionId: 'sub_SYNTHETIC0001',
    status: 'active',
    productId: BRIEFINGS_PRODUCT.id,
    productMetadata: { ...BRIEFINGS_PRODUCT.metadata },
    priceId: 'price_SYNTHETIC149M',
    priceMetadata: {},
    interval: 'month',
    unitAmount: 14900,
    currentPeriodEnd: '2026-10-01T00:00:00.000Z',
    cancelAtPeriodEnd: false,
    ...over,
  };
}

type ProfileRow = { access_briefings: boolean; briefings_expires_at: string | null };
/**
 * `is_active` is THREE-valued on purpose: the column is nullable
 * (`is_active BOOLEAN DEFAULT TRUE`, no NOT NULL), so NULL is a real state the
 * repair must be able to observe rather than coerce away.
 */
type SettingsRow = { briefings_enabled: boolean; is_active: boolean | null } | null;

interface WorldOpts {
  profile?: Partial<ProfileRow>;
  settings?: SettingsRow;
  kv?: boolean;
  subscriptions?: StripeSubscriptionEvidence[];
  failProfileWrite?: boolean;
  failKvWrite?: boolean;
  failProfileRead?: boolean;
  failStripe?: boolean;
  purchases?: Array<{ tier: string | null; status: string }>;
}

/** In-memory stand-in for Supabase + KV + Stripe. Records every write. */
function makeWorld(o: WorldOpts = {}) {
  const state = {
    profile: { access_briefings: false, briefings_expires_at: null, ...(o.profile ?? {}) } as ProfileRow,
    settings: o.settings === undefined ? { briefings_enabled: false, is_active: true } : o.settings,
    kv: o.kv ?? false,
    purchases: o.purchases ?? [{ tier: null, status: 'completed' }],
    audits: [] as Array<Record<string, unknown>>,
    profileWrites: 0,
    kvWrites: 0,
  };

  const deps: EntitlementRepairDeps = {
    readStripeSubscriptions: async () => {
      if (o.failStripe) throw new Error('synthetic stripe outage');
      return o.subscriptions ?? [sub()];
    },
    readProfile: async () => {
      if (o.failProfileRead) throw new Error('synthetic profile read failure');
      return { ...state.profile };
    },
    writeProfile: async (patch) => {
      if (o.failProfileWrite) throw new Error('synthetic profile write failure');
      state.profileWrites += 1;
      state.profile = { ...state.profile, ...patch };
    },
    readSettings: async () => (state.settings ? { ...state.settings } : null),
    writeSettings: async (patch) => {
      if (!state.settings) throw new Error('no settings row');
      state.settings = { ...state.settings, ...patch };
    },
    readKv: async () => state.kv,
    writeKv: async (value) => {
      if (o.failKvWrite) throw new Error('synthetic kv write failure');
      state.kvWrites += 1;
      state.kv = value;
    },
    readPurchases: async () => state.purchases.map((p) => ({ ...p })),
    recordAudit: async (entry) => {
      state.audits.push(entry as unknown as Record<string, unknown>);
    },
  };

  return { state, deps };
}

const ADMIN = { role: 'administrator' as const, actor: 'synthetic-admin', confirm: true };

let world: ReturnType<typeof makeWorld>;
beforeEach(() => {
  world = makeWorld();
});

// ─────────────────────────────────────────────────────────────────────────────
// scope 1 + 2 — admin only, confirm required, dry-run default
// ─────────────────────────────────────────────────────────────────────────────

describe('authorization and dry-run default', () => {
  it('refuses a non-administrator caller and writes nothing', async () => {
    const w = makeWorld();
    const res = await repairEntitlement(EMAIL_MONTHLY_149, w.deps, {
      role: 'builder',
      actor: 'not-an-admin',
      confirm: true,
      execute: true,
    });
    expect(res.ok).toBe(false);
    expect(res.refusedReason).toBe('not_administrator');
    expect(w.state.profileWrites).toBe(0);
    expect(w.state.kvWrites).toBe(0);
  });

  it('refuses execution without explicit confirmation', async () => {
    const w = makeWorld();
    const res = await repairEntitlement(EMAIL_MONTHLY_149, w.deps, {
      role: 'administrator',
      actor: 'synthetic-admin',
      confirm: false,
      execute: true,
    });
    expect(res.ok).toBe(false);
    expect(res.refusedReason).toBe('not_confirmed');
    expect(w.state.profileWrites).toBe(0);
    expect(w.state.kvWrites).toBe(0);
  });

  it('DEFAULTS to dry-run: performs zero writes but reports the exact intended end-state', async () => {
    const w = makeWorld();
    const res = await repairEntitlement(EMAIL_MONTHLY_149, w.deps, ADMIN); // no execute flag

    expect(res.ok).toBe(true);
    expect(res.dryRun).toBe(true);
    expect(w.state.profileWrites).toBe(0);
    expect(w.state.kvWrites).toBe(0);
    expect(w.state.audits).toHaveLength(0);

    // It must still say precisely what it WOULD do.
    expect(res.intended).toEqual({
      access_briefings: true,
      briefings_expires_at: null,
      kv: true,
      briefings_enabled: true,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// scope 3 + 13 — the three historical shapes, entitlement derived from metadata
// ─────────────────────────────────────────────────────────────────────────────

describe('evidence-derived entitlement for the three historical shapes', () => {
  it('$149/month Pro: repairs both sides from the observed broken state, no expiry', async () => {
    const w = makeWorld({
      profile: { access_briefings: false, briefings_expires_at: null },
      kv: false,
      purchases: [{ tier: null, status: 'completed' }],
      subscriptions: [sub({ priceId: 'price_SYNTHETIC149M', unitAmount: 14900, interval: 'month' })],
    });

    const res = await repairEntitlement(EMAIL_MONTHLY_149, w.deps, { ...ADMIN, execute: true });

    expect(res.ok).toBe(true);
    expect(res.changed).toBe(true);
    expect(w.state.profile.access_briefings).toBe(true);
    expect(w.state.profile.briefings_expires_at).toBeNull(); // monthly → revocation on cancel
    expect(w.state.kv).toBe(true);
  });

  it('$49/month grandfathered Pro: qualifies on price metadata tier, not on amount', async () => {
    const w = makeWorld({
      kv: false,
      purchases: [{ tier: 'backfill_unknown', status: 'completed' }],
      subscriptions: [
        sub({
          priceId: 'price_SYNTHETIC49M',
          unitAmount: 4900,
          interval: 'month',
          // Authoritative signal lives on the PRICE here.
          productMetadata: {},
          priceMetadata: { tier: 'briefings' },
        }),
      ],
    });

    const res = await repairEntitlement(EMAIL_MONTHLY_49, w.deps, { ...ADMIN, execute: true });

    expect(res.ok).toBe(true);
    expect(w.state.profile.access_briefings).toBe(true);
    expect(w.state.profile.briefings_expires_at).toBeNull();
    expect(w.state.kv).toBe(true);
  });

  it('$497/year annual Pro: expiry is the real current_period_end, never guessed', async () => {
    const w = makeWorld({
      kv: false,
      purchases: [{ tier: null, status: 'completed' }],
      subscriptions: [
        sub({
          priceId: 'price_SYNTHETIC497Y',
          unitAmount: 49700,
          interval: 'year',
          currentPeriodEnd: ANNUAL_PERIOD_END,
        }),
      ],
    });

    const res = await repairEntitlement(EMAIL_ANNUAL_497, w.deps, { ...ADMIN, execute: true });

    expect(res.ok).toBe(true);
    expect(w.state.profile.access_briefings).toBe(true);
    expect(w.state.profile.briefings_expires_at).toBe(ANNUAL_PERIOD_END);
    expect(w.state.kv).toBe(true);
  });

  it('rejects an INACTIVE subscription — no entitlement is derived', async () => {
    const w = makeWorld({ subscriptions: [sub({ status: 'canceled' })] });
    const res = await repairEntitlement(EMAIL_MONTHLY_149, w.deps, { ...ADMIN, execute: true });

    expect(res.ok).toBe(true);
    expect(res.qualifies).toBe(false);
    expect(w.state.profile.access_briefings).toBe(false);
    expect(w.state.kv).toBe(false);
  });

  it('refuses AMBIGUOUS product metadata rather than guessing from the name or amount', async () => {
    const w = makeWorld({
      subscriptions: [
        sub({
          productId: AMBIGUOUS_PRODUCT.id,
          productMetadata: {},
          priceMetadata: {},
          unitAmount: 14900, // looks like Pro, but nothing authoritative says so
        }),
      ],
    });

    const res = await repairEntitlement(EMAIL_MONTHLY_149, w.deps, { ...ADMIN, execute: true });

    expect(res.ok).toBe(false);
    expect(res.refusedReason).toBe('ambiguous_entitlement');
    expect(w.state.profileWrites).toBe(0);
    expect(w.state.kvWrites).toBe(0);
  });

  it('ignores a subscription for an unrelated product (MCP credits are not app entitlement)', async () => {
    const w = makeWorld({
      subscriptions: [sub({ productId: UNRELATED_PRODUCT.id, productMetadata: { tier: 'mcp_credits' } })],
    });
    const res = await repairEntitlement(EMAIL_MONTHLY_149, w.deps, { ...ADMIN, execute: true });

    expect(res.qualifies).toBe(false);
    expect(w.state.profile.access_briefings).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// scope 4 — historical ledger rows are read-only
// ─────────────────────────────────────────────────────────────────────────────

describe('historical purchase rows', () => {
  it('leaves NULL / backfill_unknown purchase rows completely unchanged', async () => {
    const w = makeWorld({
      purchases: [
        { tier: null, status: 'completed' },
        { tier: 'backfill_unknown', status: 'completed' },
      ],
    });
    const before = JSON.stringify(w.state.purchases);

    await repairEntitlement(EMAIL_MONTHLY_149, w.deps, { ...ADMIN, execute: true });

    expect(JSON.stringify(w.state.purchases)).toBe(before);
    // and the repair still worked despite the unmapped tiers
    expect(w.state.profile.access_briefings).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// scope 5 + 7 — the audit must record what was ACTUALLY written
// ─────────────────────────────────────────────────────────────────────────────

describe('truthful audit', () => {
  it('records wroteProfile/wroteKv reflecting real verified changes', async () => {
    const w = makeWorld({ kv: false });
    await repairEntitlement(EMAIL_MONTHLY_149, w.deps, { ...ADMIN, execute: true });

    expect(w.state.audits).toHaveLength(1);
    expect(w.state.audits[0]).toMatchObject({ wroteProfile: true, wroteKv: true });
  });

  it('an EMPTY update is never audited as a successful write', async () => {
    // Already fully correct on both sides → nothing to write.
    const w = makeWorld({
      profile: { access_briefings: true, briefings_expires_at: null },
      kv: true,
      settings: { briefings_enabled: true, is_active: true },
    });

    const res = await repairEntitlement(EMAIL_MONTHLY_149, w.deps, { ...ADMIN, execute: true });

    expect(res.ok).toBe(true);
    expect(res.changed).toBe(false);
    expect(w.state.profileWrites).toBe(0);
    expect(w.state.kvWrites).toBe(0);
    if (w.state.audits.length > 0) {
      expect(w.state.audits[0]).toMatchObject({ wroteProfile: false, wroteKv: false });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// scope 6 — idempotent + postcondition-verified
// ─────────────────────────────────────────────────────────────────────────────

describe('idempotency and postconditions', () => {
  it('a repeat invocation is a no-op reporting changed=false', async () => {
    const w = makeWorld({ kv: false });
    const first = await repairEntitlement(EMAIL_MONTHLY_149, w.deps, { ...ADMIN, execute: true });
    const second = await repairEntitlement(EMAIL_MONTHLY_149, w.deps, { ...ADMIN, execute: true });

    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    expect(w.state.profileWrites).toBe(1);
    expect(w.state.kvWrites).toBe(1);
  });

  it('reports FAILURE when the postcondition re-read does not show the intended end-state', async () => {
    const w = makeWorld({ kv: false });
    // A write that silently does not persist — the exact shape of a lying success.
    w.deps.writeProfile = async () => { /* accepted, changed nothing */ };

    const res = await repairEntitlement(EMAIL_MONTHLY_149, w.deps, { ...ADMIN, execute: true });

    expect(res.ok).toBe(false);
    expect(res.failures.some((f) => /postcondition/i.test(f))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// scope 8 — every external failure surfaces
// ─────────────────────────────────────────────────────────────────────────────

describe('errors are errors', () => {
  it('surfaces a Stripe read failure and never treats it as "no subscription"', async () => {
    const w = makeWorld({ failStripe: true });
    const res = await repairEntitlement(EMAIL_MONTHLY_149, w.deps, { ...ADMIN, execute: true });

    expect(res.ok).toBe(false);
    // A read failure must never be laundered into "no qualifying subscription".
    expect(res.qualifies).toBeUndefined();
    expect(res.failures.join(' ')).toMatch(/stripe/i);
    expect(w.state.profileWrites).toBe(0);
  });

  it('surfaces a profile READ failure instead of assuming a missing record', async () => {
    const w = makeWorld({ failProfileRead: true });
    const res = await repairEntitlement(EMAIL_MONTHLY_149, w.deps, { ...ADMIN, execute: true });

    expect(res.ok).toBe(false);
    expect(res.failures.join(' ')).toMatch(/profile/i);
    expect(w.state.kvWrites).toBe(0);
  });

  it('PARTIAL-STORE FAILURE: a KV write failure is reported, and a retry safely completes', async () => {
    const failing = makeWorld({ kv: false, failKvWrite: true });
    const first = await repairEntitlement(EMAIL_MONTHLY_149, failing.deps, { ...ADMIN, execute: true });

    expect(first.ok).toBe(false);
    expect(first.failures.join(' ')).toMatch(/kv/i);
    // The profile side may have landed; the operation must NOT claim success.
    expect(first.changed === true || first.changed === false).toBe(true);

    // Retry with KV healthy — must converge, not double-apply.
    const healed = makeWorld({
      profile: { ...failing.state.profile },
      kv: false,
      settings: failing.state.settings,
    });
    const second = await repairEntitlement(EMAIL_MONTHLY_149, healed.deps, { ...ADMIN, execute: true });

    expect(second.ok).toBe(true);
    expect(healed.state.profile.access_briefings).toBe(true);
    expect(healed.state.kv).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// scope 10 — briefings_enabled follows its PROVEN contract
// ─────────────────────────────────────────────────────────────────────────────

describe('briefings_enabled contract', () => {
  it('enables delivery when the account is merely unprovisioned', async () => {
    const w = makeWorld({ settings: { briefings_enabled: false, is_active: true } });
    await repairEntitlement(EMAIL_MONTHLY_149, w.deps, { ...ADMIN, execute: true });
    expect(w.state.settings).toMatchObject({ briefings_enabled: true });
  });

  it('PRESERVES an explicit opt-out (is_active=false) — an entitlement never overrides it', async () => {
    const w = makeWorld({ settings: { briefings_enabled: false, is_active: false } });
    const res = await repairEntitlement(EMAIL_MONTHLY_149, w.deps, { ...ADMIN, execute: true });

    expect(w.state.settings).toMatchObject({ briefings_enabled: false });
    // The entitlement itself is still repaired — only delivery is left alone.
    expect(w.state.profile.access_briefings).toBe(true);
    expect(res.deliverySkipped).toBe('opted_out');
  });

  it('does not fabricate a settings row when none exists', async () => {
    const w = makeWorld({ settings: null });
    const res = await repairEntitlement(EMAIL_MONTHLY_149, w.deps, { ...ADMIN, execute: true });

    expect(res.deliverySkipped).toBe('no_settings_row');
    expect(w.state.settings).toBeNull();
    expect(w.state.profile.access_briefings).toBe(true);
  });

  // ── The distinction the contract turns on ────────────────────────────────
  //
  // `is_active` is nullable, so NULL means the repair CANNOT TELL an explicit
  // opt-out from an unprovisioned row. The earlier implementation narrowed the
  // column with `is_active !== false` at the adapter, which resolved NULL to
  // "active" and enabled delivery — mailing someone who may have opted out, on
  // a guess. These assert the fail-CLOSED behaviour instead.

  it('FAILS CLOSED when is_active is NULL — never enables delivery on an ambiguous row', async () => {
    const w = makeWorld({ settings: { briefings_enabled: false, is_active: null } });
    const res = await repairEntitlement(EMAIL_MONTHLY_149, w.deps, { ...ADMIN, execute: true });

    // Delivery is untouched: the stored value is preserved exactly.
    expect(w.state.settings).toMatchObject({ briefings_enabled: false });
    // …and the ambiguity is REPORTED, not swallowed — an operator can resolve it.
    expect(res.deliverySkipped).toBe('opt_out_unknown');
    // Entitlement is still fully repaired: the customer is never left unpaid-for.
    expect(w.state.profile.access_briefings).toBe(true);
    expect(w.state.kv).toBe(true);
  });

  it('reports opt_out_unknown distinctly from opted_out and no_settings_row', async () => {
    const unknown = makeWorld({ settings: { briefings_enabled: false, is_active: null } });
    const optedOut = makeWorld({ settings: { briefings_enabled: false, is_active: false } });
    const missing = makeWorld({ settings: null });

    const [u, o, m] = await Promise.all([
      repairEntitlement(EMAIL_MONTHLY_149, unknown.deps, { ...ADMIN, execute: true }),
      repairEntitlement(EMAIL_MONTHLY_149, optedOut.deps, { ...ADMIN, execute: true }),
      repairEntitlement(EMAIL_MONTHLY_149, missing.deps, { ...ADMIN, execute: true }),
    ]);

    // Three different causes need three different human follow-ups, so they
    // must not collapse into one another.
    expect(new Set([u.deliverySkipped, o.deliverySkipped, m.deliverySkipped]).size).toBe(3);
    expect(u.deliverySkipped).toBe('opt_out_unknown');
    expect(o.deliverySkipped).toBe('opted_out');
    expect(m.deliverySkipped).toBe('no_settings_row');
  });

  it('preserves an explicit opt-out even when delivery was already ON (never silently re-flags)', async () => {
    const w = makeWorld({ settings: { briefings_enabled: true, is_active: false } });
    const res = await repairEntitlement(EMAIL_MONTHLY_149, w.deps, { ...ADMIN, execute: true });

    // The repair must not touch delivery in either direction for an opt-out.
    expect(w.state.settings).toMatchObject({ briefings_enabled: true });
    expect(res.deliverySkipped).toBe('opted_out');
  });

  it('an ambiguous row is preserved in the ON direction too (no write on unknown)', async () => {
    const w = makeWorld({ settings: { briefings_enabled: true, is_active: null } });
    const res = await repairEntitlement(EMAIL_MONTHLY_149, w.deps, { ...ADMIN, execute: true });

    expect(w.state.settings).toMatchObject({ briefings_enabled: true });
    expect(res.deliverySkipped).toBe('opt_out_unknown');
  });

  it('DRY-RUN reports the ambiguity and writes nothing', async () => {
    const w = makeWorld({ settings: { briefings_enabled: false, is_active: null } });
    const res = await repairEntitlement(EMAIL_MONTHLY_149, w.deps, ADMIN);

    expect(res.dryRun).toBe(true);
    expect(res.deliverySkipped).toBe('opt_out_unknown');
    // The intended end-state preserves the stored value rather than proposing true.
    expect(res.intended?.briefings_enabled).toBe(false);
    expect(w.state.profileWrites).toBe(0);
    expect(w.state.kvWrites).toBe(0);
  });

  it('does not regress symmetric revocation: a NULL is_active never blocks REVOKING entitlement', async () => {
    // Not entitled + ambiguous delivery row: both entitlement sides must still
    // clear together. Delivery ambiguity must not strand access.
    const w = makeWorld({
      profile: { access_briefings: true },
      kv: true,
      settings: { briefings_enabled: true, is_active: null },
      subscriptions: [],
    });
    const res = await repairEntitlement(EMAIL_MONTHLY_149, w.deps, { ...ADMIN, execute: true });

    expect(res.qualifies).toBe(false);
    expect(w.state.profile.access_briefings).toBe(false);
    expect(w.state.kv).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// scope 11 + 12 — symmetric revocation, duplicate-subscription safety
// ─────────────────────────────────────────────────────────────────────────────

describe('symmetric revocation and the September 17 duplicate-subscription risk', () => {
  it('DUPLICATE SUBS: the redundant one ending PRESERVES access on both sides', async () => {
    // Two identical active Pro subs on one identity, same price id.
    // One is scheduled to end; the other survives with a real upcoming invoice.
    const ending = sub({
      subscriptionId: 'sub_SYNTHETICENDING',
      cancelAtPeriodEnd: true,
      hasUpcomingInvoice: false,
    });
    const surviving = sub({
      subscriptionId: 'sub_SYNTHETICSURVIVE',
      cancelAtPeriodEnd: false,
      hasUpcomingInvoice: true,
    });

    const w = makeWorld({
      profile: { access_briefings: true, briefings_expires_at: null },
      kv: true,
      subscriptions: [ending, surviving],
    });

    const res = await repairEntitlement(EMAIL_DUPLICATE, w.deps, {
      ...ADMIN,
      execute: true,
      endedSubscriptionId: 'sub_SYNTHETICENDING',
    });

    expect(res.ok).toBe(true);
    expect(res.qualifies).toBe(true);
    // The ending subscription must be EXCLUDED from the surviving set, and the
    // survivor must carry the entitlement on its own. Asserting only that
    // access is preserved is too weak: it stays true even if the ending
    // subscription is wrongly still counted.
    expect(res.survivingSubscriptionIds).toEqual(['sub_SYNTHETICSURVIVE']);
    expect(res.survivingSubscriptionIds).not.toContain('sub_SYNTHETICENDING');
    // Access MUST NOT be revoked.
    expect(w.state.profile.access_briefings).toBe(true);
    expect(w.state.kv).toBe(true);
  });

  it('the ENDING subscription alone does not sustain access once it is excluded', async () => {
    // Same shape as above but WITHOUT a survivor: the only live subscription is
    // the one that is ending. Access must fall, both sides together. This is the
    // case that proves the exclusion is real rather than incidental.
    const w = makeWorld({
      profile: { access_briefings: true, briefings_expires_at: null },
      kv: true,
      subscriptions: [
        sub({ subscriptionId: 'sub_SYNTHETICENDING', cancelAtPeriodEnd: true, hasUpcomingInvoice: false }),
      ],
    });

    const res = await repairEntitlement(EMAIL_DUPLICATE, w.deps, {
      ...ADMIN,
      execute: true,
      endedSubscriptionId: 'sub_SYNTHETICENDING',
    });

    expect(res.ok).toBe(true);
    expect(res.qualifies).toBe(false);
    expect(res.survivingSubscriptionIds).toEqual([]);
    expect(w.state.profile.access_briefings).toBe(false);
    expect(w.state.kv).toBe(false);
  });

  it('FINAL entitlement ending clears BOTH stores together', async () => {
    const w = makeWorld({
      profile: { access_briefings: true, briefings_expires_at: null },
      kv: true,
      subscriptions: [sub({ subscriptionId: 'sub_SYNTHETICLAST', status: 'canceled' })],
    });

    const res = await repairEntitlement(EMAIL_DUPLICATE, w.deps, {
      ...ADMIN,
      execute: true,
      endedSubscriptionId: 'sub_SYNTHETICLAST',
    });

    expect(res.ok).toBe(true);
    expect(res.qualifies).toBe(false);
    expect(w.state.profile.access_briefings).toBe(false);
    expect(w.state.kv).toBe(false);
  });

  it('never leaves ONE store set and the other cleared after a revocation', async () => {
    const w = makeWorld({
      profile: { access_briefings: true, briefings_expires_at: null },
      kv: true,
      subscriptions: [sub({ status: 'canceled' })],
    });

    await repairEntitlement(EMAIL_DUPLICATE, w.deps, { ...ADMIN, execute: true });

    expect(w.state.profile.access_briefings).toBe(w.state.kv);
  });
});
