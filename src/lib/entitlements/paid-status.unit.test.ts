import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import {
  classifyPaidStatus, resolvePaidStatus, activationPaidReasons, paidStatusResolverEnabled,
  LEGACY_ACTIVATION_PAID_REASONS, PAID_FUNDING_REASONS, LEDGER_CAP, PAID_STATUS_POLICY, PROMOTIONAL_REASONS,
  type PaidStatusFacts, type PaidStatusReader, type LedgerGrant, type SubscriptionFact,
} from './paid-status';
import { impactReport, LEGACY_GUARD_PAID_REASONS, type ImpactFixture } from './paid-status-impact';
import { PAID_LEDGER_REASONS, proprietaryStandingFrom } from '@/lib/mcp/extraction-guard';

const NOW = Date.parse('2026-11-14T12:00:00Z');
const g = (reason: string, created_at = '2026-11-01T00:00:00Z'): LedgerGrant => ({ reason, created_at });

function facts(over: Partial<PaidStatusFacts> = {}): PaidStatusFacts {
  return {
    now: NOW, ledgerGrants: [], subscriptions: [], charges: [], prepaid: [], trialEndsAt: null,
    trialReadOk: true, poolFunded: false, isStaff: false, isAdvocate: false, isComp: false, ...over,
  };
}
const sub = (over: Partial<SubscriptionFact>): SubscriptionFact => ({
  status: 'active', plan_amount: 14900, trial_end: null, current_period_end: '2026-12-01T00:00:00Z', ended_at: null, ...over,
});
const paidCharge = { amount: 14900, amount_refunded: 0, status: 'succeeded', refunded: false, invoice_id: 'in_1', created_at: '2026-11-02T00:00:00Z' };

afterEach(() => {
  delete process.env.PAID_STATUS_RESOLVER;
});

describe('classifyPaidStatus — the required cases', () => {
  it('MCP plan with only mcp_sub_monthly → active_paid', () => {
    const s = classifyPaidStatus(facts({ ledgerGrants: [g('mcp_sub_monthly')] }));
    expect(s.kind).toBe('active_paid');
    expect(s.paidFunding).toBe(true);
    expect(s.sources).toContain('mcp_subscription_ledger');
  });

  it('admin_grant only → promotional_only, NOT paid', () => {
    const s = classifyPaidStatus(facts({ ledgerGrants: [g('admin_grant')] }));
    expect(s.kind).toBe('promotional_only');
    expect(s.paidFunding).toBe(false);
    expect(s.evidence.promotionalReasons).toEqual(['admin_grant']);
  });

  it('an unknown/new reason (e.g. trial_promo) is promotional, never paid', () => {
    const s = classifyPaidStatus(facts({ ledgerGrants: [g('trial_promo'), g('referral'), g('signup_grant')] }));
    expect(s.kind).toBe('promotional_only');
    expect(s.paidFunding).toBe(false);
  });

  it.each([
    ['staff', { isStaff: true }],
    ['advocate', { isAdvocate: true }],
    ['comp', { isComp: true }],
    ['comp_monthly ledger', { ledgerGrants: [g('comp_monthly')] }],
  ])('%s → complimentary, access yes, paid no', (_l, over) => {
    const s = classifyPaidStatus(facts(over as Partial<PaidStatusFacts>));
    expect(s.kind).toBe('complimentary');
    expect(s.complimentaryAccess).toBe(true);
    expect(s.paidFunding).toBe(false);
  });

  it('$0 trial (trialing sub + app_tier_pro row, no charge) → trial, not paid', () => {
    const s = classifyPaidStatus(facts({
      ledgerGrants: [g('app_tier_pro')],
      subscriptions: [sub({ status: 'trialing', trial_end: '2026-11-20T00:00:00Z' })],
    }));
    expect(s.kind).toBe('trial');
    expect(s.paidFunding).toBe(false);
    expect(s.sources).toContain('unverified_app_tier');
  });

  it('profile trial_ends_at in the future → trial', () => {
    expect(classifyPaidStatus(facts({ trialEndsAt: '2026-11-30T00:00:00Z' })).kind).toBe('trial');
  });

  it('annual plan cancelled, period over, last grant < 370 days old → expired', () => {
    const s = classifyPaidStatus(facts({
      ledgerGrants: [g('mcp_sub_annual', '2026-05-01T00:00:00Z')],
      subscriptions: [sub({ status: 'canceled', plan_amount: 59000, current_period_end: '2026-11-01T00:00:00Z', ended_at: '2026-11-01T00:00:00Z' })],
    }));
    expect(s.kind).toBe('expired');
    expect(s.paidFunding).toBe(false);
  });

  it('live prepaid term → prepaid (paid off-Stripe)', () => {
    const s = classifyPaidStatus(facts({ prepaid: [{ access_starts_on: '2026-10-01', access_ends_on: '2027-03-31' }] }));
    expect(s.kind).toBe('prepaid');
    expect(s.paidFunding).toBe(true);
  });

  it('ended prepaid term → not prepaid', () => {
    const s = classifyPaidStatus(facts({ prepaid: [{ access_starts_on: '2026-01-01', access_ends_on: '2026-06-30' }] }));
    expect(s.kind).toBe('none');
  });

  it('paid Pro: active priced sub + succeeded charge → active_paid with corroborated app_tier', () => {
    const s = classifyPaidStatus(facts({ ledgerGrants: [g('app_tier_pro')], subscriptions: [sub({})], charges: [paidCharge] }));
    expect(s.kind).toBe('active_paid');
    expect(s.sources).toContain('app_tier_ledger_corroborated');
  });

  it('auto_recharge / stripe_topup only → paid_credits', () => {
    expect(classifyPaidStatus(facts({ ledgerGrants: [g('auto_recharge')] })).kind).toBe('paid_credits');
    expect(classifyPaidStatus(facts({ ledgerGrants: [g('stripe_topup')] })).kind).toBe('paid_credits');
  });

  it('funded team pool → active_paid', () => {
    expect(classifyPaidStatus(facts({ poolFunded: true })).kind).toBe('active_paid');
  });

  it('a refunded charge is not a paid invoice', () => {
    const s = classifyPaidStatus(facts({
      ledgerGrants: [g('app_tier_pro')], subscriptions: [sub({})],
      charges: [{ ...paidCharge, refunded: true, amount_refunded: 14900 }],
    }));
    expect(s.kind).toBe('unknown');
    expect(s.failures).toEqual(['paid_invoice_not_mirrored']);
  });

  it('nothing at all → none', () => {
    expect(classifyPaidStatus(facts()).kind).toBe('none');
  });
});

describe('unknown is never free', () => {
  it.each([
    ['ledger', { ledgerGrants: null }],
    ['stripe', { subscriptions: null, charges: null }],
    ['prepaid', { prepaid: null }],
    ['trial', { trialReadOk: false }],
    ['payer', { poolFunded: null }],
  ])('a failed %s read → unknown, paidFunding null', (_l, over) => {
    const s = classifyPaidStatus(facts(over as Partial<PaidStatusFacts>));
    expect(s.kind).toBe('unknown');
    expect(s.paidFunding).toBeNull();
    expect(s.failures.length).toBeGreaterThan(0);
  });

  it('a capped ledger read cannot establish "not paid"', () => {
    const s = classifyPaidStatus(facts({ ledgerGrants: [g('signup_grant')], ledgerTruncated: true }));
    expect(s.kind).toBe('unknown');
  });

  it('…but positive evidence from a capped read still stands', () => {
    const s = classifyPaidStatus(facts({ ledgerGrants: [g('auto_recharge')], ledgerTruncated: true }));
    expect(s.kind).toBe('paid_credits');
  });

  it('a bare legacy pro_monthly row (paid OR lifetime OR comp historically) → unknown', () => {
    const s = classifyPaidStatus(facts({ ledgerGrants: [g('pro_monthly')] }));
    expect(s.kind).toBe('unknown');
    expect(s.failures).toEqual(['ambiguous_pro_monthly']);
  });

  it('a positive credit balance is not an input at all — balance never implies paid', () => {
    expect(Object.keys(facts())).not.toContain('balance');
  });
});

describe('resolvePaidStatus (loader)', () => {
  const ok = <T>(value: T) => Promise.resolve({ ok: true as const, value });
  const reader = (over: Partial<PaidStatusReader> = {}): PaidStatusReader => ({
    ledgerGrants: () => ok([g('mcp_sub_monthly')]),
    subscriptionsAndCharges: () => ok({ subscriptions: [], charges: [] }),
    prepaid: () => ok([]),
    trialEndsAt: () => ok(null),
    poolFunded: () => ok(false),
    ...over,
  });

  it('resolves through the reader', async () => {
    const s = await resolvePaidStatus('buyer@example.com', { now: NOW, reader: reader() });
    expect(s.kind).toBe('active_paid');
  });

  it('a DB error → unknown', async () => {
    const s = await resolvePaidStatus('buyer@example.com', {
      now: NOW, reader: reader({ subscriptionsAndCharges: () => Promise.resolve({ ok: false as const }) }),
    });
    expect(s.kind).toBe('unknown');
    expect(s.failures).toContain('stripe_subscriptions');
  });

  it('a thrown reader (e.g. KV/network) → unknown, never throws', async () => {
    const s = await resolvePaidStatus('buyer@example.com', {
      now: NOW, reader: reader({ poolFunded: () => Promise.reject(new Error('boom')) }),
    });
    expect(s.kind).toBe('unknown');
  });

  it('a ledger read that hits the cap is marked truncated', async () => {
    const many = Array.from({ length: LEDGER_CAP }, () => g('signup_grant'));
    const s = await resolvePaidStatus('buyer@example.com', { now: NOW, reader: reader({ ledgerGrants: () => ok(many) }) });
    expect(s.kind).toBe('unknown');
    expect(s.evidence.ledgerTruncated).toBe(true);
  });
});

describe('flag OFF = old behaviour unchanged (golden)', () => {
  it('flag is off by default and only the literal "true" turns it on', () => {
    expect(paidStatusResolverEnabled()).toBe(false);
    process.env.PAID_STATUS_RESOLVER = '1';
    expect(paidStatusResolverEnabled()).toBe(false);
    process.env.PAID_STATUS_RESOLVER = 'true';
    expect(paidStatusResolverEnabled()).toBe(true);
  });

  it('activation reasons: OFF is the exact legacy list, ON is PAID_FUNDING_REASONS', () => {
    expect(activationPaidReasons()).toEqual(['pro_monthly', 'app_tier_pro', 'mcp_sub_monthly', 'mcp_sub_annual', 'stripe_topup']);
    expect(activationPaidReasons()).toEqual([...LEGACY_ACTIVATION_PAID_REASONS]);
    process.env.PAID_STATUS_RESOLVER = 'true';
    expect(activationPaidReasons()).toEqual([...PAID_FUNDING_REASONS]);
    expect(activationPaidReasons()).not.toContain('pro_monthly');
    expect(activationPaidReasons()).toContain('auto_recharge');
    expect(activationPaidReasons()).toContain('app_tier_team');
  });

  it('extraction-guard legacy list is unchanged, and the impact mirror equals it', () => {
    expect([...PAID_LEDGER_REASONS]).toEqual(['stripe_topup', 'pro_monthly', 'comp_monthly', 'admin_grant', 'app_tier_pro', 'app_tier_team']);
    expect([...LEGACY_GUARD_PAID_REASONS]).toEqual([...PAID_LEDGER_REASONS]);
  });
});

describe('consumer impact (synthetic fixture)', () => {
  const raw = JSON.parse(readFileSync('tests/fixtures/paid-status-impact.fixture.json', 'utf8')) as Array<{ label: string; facts: Record<string, unknown> }>;
  const fixtures: ImpactFixture[] = raw.map(({ label, facts: f }) => ({
    label, facts: { ...f, now: Date.parse(f.now as string) } as unknown as PaidStatusFacts,
  }));
  const rows = Object.fromEntries(impactReport(fixtures).map((r) => [r.label.split(' ')[0], r]));

  it('lists exactly the accounts whose answer changes', () => {
    expect(Object.values(rows).filter((r) => r.changed).map((r) => r.label.split(' ')[0]).sort())
      .toEqual(['A', 'B', 'D', 'F', 'G', 'J']);
  });

  it('paying MCP-plan subscriber: guard block → allow', () => {
    expect([rows.A.guardOld, rows.A.guardNew]).toEqual([false, true]);
  });

  it('admin-grant-only: guard allow → block', () => {
    expect([rows.B.guardOld, rows.B.guardNew]).toEqual([true, false]);
  });

  it('$0 trialist: guard allow → block (activation keeps the historical app_tier_pro caveat)', () => {
    expect([rows.D.guardOld, rows.D.guardNew]).toEqual([true, false]);
    expect(rows.D.activationNew).toBe(true);
  });

  it('legacy pro_monthly-only: guard unchanged (unknown fails open); activation drops it', () => {
    expect([rows.J.guardOld, rows.J.guardNew]).toEqual([true, true]);
    expect([rows.J.activationOld, rows.J.activationNew]).toEqual([true, false]);
  });
});

describe('review fixes: Stripe email mismatch and stale mirror', () => {
  it('a recent app_tier_pro grant with NO mirrored subscription (Stripe email differs) → unknown, guard allows', () => {
    const s = classifyPaidStatus(facts({ ledgerGrants: [g('app_tier_pro', '2026-10-20T00:00:00Z')] }));
    expect(s.kind).toBe('unknown');
    expect(s.failures).toEqual(['app_tier_no_mirrored_subscription']);
    expect(proprietaryStandingFrom(s)).toBe(true);
  });

  it('an app_tier_pro grant older than a year with no mirrored subscription → expired', () => {
    const s = classifyPaidStatus(facts({ ledgerGrants: [g('app_tier_pro', '2025-09-01T00:00:00Z')] }));
    expect(s.kind).toBe('expired');
  });

  it('a stale mirror (sub shows canceled) with an app_tier grant from 10 days ago → unknown, guard allows', () => {
    const s = classifyPaidStatus(facts({
      ledgerGrants: [g('app_tier_pro', '2026-11-04T00:00:00Z')],
      subscriptions: [sub({ status: 'canceled', ended_at: '2026-11-03T00:00:00Z' })],
    }));
    expect(s.kind).toBe('unknown');
    expect(s.failures).toEqual(['app_tier_mirror_stale']);
    expect(proprietaryStandingFrom(s)).toBe(true);
  });

  it('a canceled sub whose last app_tier grant is 60 days old → expired', () => {
    const s = classifyPaidStatus(facts({
      ledgerGrants: [g('app_tier_pro', '2026-09-15T00:00:00Z')],
      subscriptions: [sub({ status: 'canceled', ended_at: '2026-10-15T00:00:00Z' })],
    }));
    expect(s.kind).toBe('expired');
  });
});

describe('review fixes: charges must belong to the live subscription', () => {
  const live = sub({ current_period_start: '2026-11-01T00:00:00Z' });
  it('one old invoice charge does not make a coupon/stale subscription paid', () => {
    const s = classifyPaidStatus(facts({
      ledgerGrants: [g('app_tier_pro')], subscriptions: [live],
      charges: [{ ...paidCharge, created_at: '2026-04-01T00:00:00Z' }],
    }));
    expect(s.kind).toBe('unknown');
    expect(s.failures).toEqual(['paid_invoice_not_mirrored']);
  });

  it('a recent one-off (non-invoice) charge does not count for the subscription', () => {
    const s = classifyPaidStatus(facts({ subscriptions: [live], charges: [{ ...paidCharge, invoice_id: null }] }));
    expect(s.kind).toBe('unknown');
  });

  it('an invoice charge inside the current period → active_paid', () => {
    const s = classifyPaidStatus(facts({ subscriptions: [live], charges: [paidCharge] }));
    expect(s.kind).toBe('active_paid');
  });

  it('annual plan without a mirrored period start: a charge 300 days ago still counts', () => {
    const s = classifyPaidStatus(facts({
      subscriptions: [sub({ plan_amount: 149000, plan_interval: 'year' })],
      charges: [{ ...paidCharge, amount: 149000, created_at: '2026-01-18T00:00:00Z' }],
    }));
    expect(s.kind).toBe('active_paid');
  });
});

describe('review fixes: trials, truncation', () => {
  it('a trial on another plan does not keep an ended MCP plan live', () => {
    const s = classifyPaidStatus(facts({
      ledgerGrants: [g('mcp_sub_monthly', '2026-11-01T00:00:00Z')],
      subscriptions: [
        sub({ status: 'canceled', plan_amount: 9900, ended_at: '2026-11-05T00:00:00Z' }),
        sub({ status: 'trialing', trial_end: '2026-11-25T00:00:00Z' }),
      ],
    }));
    expect(s.kind).toBe('trial');
    expect(s.paidFunding).toBe(false);
  });

  it('a capped Stripe read cannot establish "not paid"', () => {
    const s = classifyPaidStatus(facts({ ledgerGrants: [g('signup_grant')], stripeTruncated: true }));
    expect(s.kind).toBe('unknown');
    expect(s.failures).toEqual(['stripe_mirror_truncated']);
  });

  it('the loader passes the Stripe truncation flag through', async () => {
    const reader: PaidStatusReader = {
      ledgerGrants: async () => ({ ok: true, value: [] }),
      subscriptionsAndCharges: async () => ({ ok: true, value: { subscriptions: [], charges: [], truncated: true } }),
      prepaid: async () => ({ ok: true, value: [] }),
      trialEndsAt: async () => ({ ok: true, value: null }),
      poolFunded: async () => ({ ok: true, value: false }),
    };
    expect((await resolvePaidStatus('x@acme.test', { now: NOW, reader })).failures).toEqual(['stripe_mirror_truncated']);
  });
});

describe('review fixes: owner policy is explicit and one line each', () => {
  it('defaults: admin grants are promotional, complimentary admitted, unknown allows', () => {
    expect(PAID_STATUS_POLICY).toEqual({ adminGrantIsPaid: false, admitComplimentary: true, unknownAllows: true });
    expect(PROMOTIONAL_REASONS.has('admin_grant')).toBe(true);
  });

  it('adminGrantIsPaid flips admin_grant to bought credits', () => {
    const f = facts({ ledgerGrants: [g('admin_grant')] });
    expect(classifyPaidStatus(f).kind).toBe('promotional_only');
    expect(classifyPaidStatus(f, { ...PAID_STATUS_POLICY, adminGrantIsPaid: true }).kind).toBe('paid_credits');
  });

  it('unknownAllows and admitComplimentary drive the guard', () => {
    const unknown = classifyPaidStatus(facts({ ledgerGrants: null }));
    expect(proprietaryStandingFrom(unknown)).toBe(true);
    expect(proprietaryStandingFrom(unknown, { ...PAID_STATUS_POLICY, unknownAllows: false })).toBe(false);
    const comp = classifyPaidStatus(facts({ isComp: true }));
    expect(proprietaryStandingFrom(comp)).toBe(true);
    expect(proprietaryStandingFrom(comp, { ...PAID_STATUS_POLICY, admitComplimentary: false })).toBe(false);
  });
});
