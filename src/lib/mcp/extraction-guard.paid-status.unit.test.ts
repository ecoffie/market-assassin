import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fakeDb } from './fake-postgrest.test-helper';
import type { PaidStatus, PaidStatusKind } from '@/lib/entitlements/paid-status';

/**
 * Layer A behind PAID_STATUS_RESOLVER. OFF: the legacy ledger list decides (unchanged).
 * ON: the shared resolver decides — paid funding or complimentary passes; trial,
 * promotional-only and expired need paid credits; unknown fails open.
 */
let db: ReturnType<typeof fakeDb>;
let status: PaidStatus;
const resolveSpy = vi.fn(async () => status);
let grantLive: boolean | 'throw' = false;
const grantSpy = vi.fn(async () => { if (grantLive === 'throw') throw new Error('kv down'); return grantLive; });
vi.mock('@/lib/supabase/server-clients', () => ({ getWriteClient: () => db }));
vi.mock('./payer', () => ({ resolvePayer: async () => ({ kind: 'personal' }) }));
vi.mock('@/lib/entitlements/paid-status', async (orig) => ({
  ...(await orig<typeof import('@/lib/entitlements/paid-status')>()),
  resolvePaidStatus: (...a: unknown[]) => (resolveSpy as unknown as (...x: unknown[]) => Promise<PaidStatus>)(...a),
  hasLiveProGrant: (...a: unknown[]) => (grantSpy as unknown as (...x: unknown[]) => Promise<boolean>)(...a),
}));

import { evaluateExtractionGuard, proprietaryStandingFrom } from './extraction-guard';

const USER = 'acct@example.com';
const PROPRIETARY = ['get_sblo_contact'];
const st = (kind: PaidStatusKind, paidFunding: boolean | null, complimentaryAccess = false): PaidStatus => ({
  kind, paidFunding, complimentaryAccess, sources: [], failures: kind === 'unknown' ? ['x'] : [],
  evidence: { liveSubscriptionStatus: null, promotionalReasons: [], ledgerTruncated: false },
});
const ledger = (reason: string) => [{ user_email: USER, delta: 100, reason }];

beforeEach(() => { resolveSpy.mockClear(); grantSpy.mockClear(); grantLive = false; vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { delete process.env.PAID_STATUS_RESOLVER; delete process.env.PAID_STATUS_SHADOW; });

describe('flag OFF — legacy Layer A unchanged (golden)', () => {
  it.each([
    ['admin_grant', null],
    ['comp_monthly', null],
    ['pro_monthly', null],
    ['app_tier_pro', null],
    ['stripe_topup', null],
    ['mcp_sub_monthly', 'requires_paid'],
    ['auto_recharge', 'requires_paid'],
    ['signup_grant', 'requires_paid'],
  ])('%s → %s', async (reason, expected) => {
    db = fakeDb({ mcp_credit_ledger: ledger(reason), mcp_call_log: [] });
    const v = await evaluateExtractionGuard(USER, PROPRIETARY);
    expect(v?.status ?? null).toBe(expected);
    expect(resolveSpy).not.toHaveBeenCalled();
  });
});

describe('flag ON — shared resolver decides', () => {
  beforeEach(() => { process.env.PAID_STATUS_RESOLVER = 'true'; db = fakeDb({ mcp_credit_ledger: [], mcp_call_log: [] }); });

  it.each([
    ['active_paid', true, false, null],
    ['prepaid', true, false, null],
    ['paid_credits', true, false, null],
    ['complimentary', false, true, null],
    ['unknown', null, false, null],
    ['trial', false, false, 'requires_paid'],
    ['promotional_only', false, false, 'requires_paid'],
    ['expired', false, false, 'requires_paid'],
    ['none', false, false, 'requires_paid'],
  ] as const)('%s → %s', async (kind, paid, comp, expected) => {
    status = st(kind, paid, comp);
    const v = await evaluateExtractionGuard(USER, PROPRIETARY);
    expect(v?.status ?? null).toBe(expected);
    expect(resolveSpy).toHaveBeenCalledTimes(1);
  });

  it('proprietaryStandingFrom never admits a trial', () => {
    expect(proprietaryStandingFrom(st('trial', false))).toBe(false);
  });
});

describe('shadow (flag OFF, PAID_STATUS_SHADOW=true)', () => {
  it('logs a disagreement with a hashed subject and never changes the verdict', async () => {
    process.env.PAID_STATUS_SHADOW = 'true';
    process.env.ENTITLEMENT_SHADOW_SALT = 'test-salt';
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    db = fakeDb({ mcp_credit_ledger: ledger('admin_grant'), mcp_call_log: [] });
    status = st('promotional_only', false);
    expect(await evaluateExtractionGuard(USER, PROPRIETARY)).toBeNull(); // legacy verdict stands
    await new Promise((r) => setTimeout(r, 0));
    expect(info).toHaveBeenCalledTimes(1);
    const line = String(info.mock.calls[0][1]);
    expect(line).not.toContain(USER);
    expect(JSON.parse(line)).toMatchObject({ legacy: true, next: false, kind: 'promotional_only' });
    delete process.env.ENTITLEMENT_SHADOW_SALT;
  });
});

/**
 * Owner rule 2026-11-16: never shorten anyone's access. A Pro Giant buyer whose bundle year
 * has passed but whose Pro grant runs to 2027-04-29 keeps proprietary standing in BOTH flag
 * states. The 1-year rule stays a paid-status label only (paidFunding false).
 */
describe('live Pro grant keeps access (Pro Giant past day 365)', () => {
  const NOW = Date.parse('2026-11-16T12:00:00Z');
  const PURCHASED = '2025-06-01T00:00:00Z'; // > 365 days before NOW
  const GRANT_UNTIL = '2027-04-29T00:00:00Z';

  async function realStatus(): Promise<PaidStatus> {
    const { resolvePaidStatus: real } = await vi.importActual<typeof import('@/lib/entitlements/paid-status')>(
      '@/lib/entitlements/paid-status');
    const ok = <T,>(value: T) => ({ ok: true as const, value });
    return real(USER, {
      now: NOW,
      reader: {
        ledgerGrants: async () => ok([]),
        subscriptionsAndCharges: async () => ok({ subscriptions: [], charges: [] }),
        prepaid: async () => ok([]),
        trialEndsAt: async () => ok(null),
        poolFunded: async () => ok(false),
        lifetimeMember: async () => ok(false),
        proGiant: async () => ok({ purchasedAt: PURCHASED }),
        // grant live until GRANT_UNTIL, which is after NOW
        liveProGrant: async () => ok(Date.parse(GRANT_UNTIL) > NOW),
      },
    });
  }

  it('flag ON: not blocked, while the label stays not paid', async () => {
    process.env.PAID_STATUS_RESOLVER = 'true';
    db = fakeDb({ mcp_credit_ledger: [], mcp_call_log: [] });
    status = await realStatus();
    expect(status.paidFunding).toBe(false);
    expect(status.sources).not.toContain('pro_giant_term');
    expect(status.liveProGrant).toBe(true);
    expect(await evaluateExtractionGuard(USER, PROPRIETARY)).toBeNull();
  });

  it('flag OFF: not blocked even with no paid ledger reason', async () => {
    db = fakeDb({ mcp_credit_ledger: [], mcp_call_log: [] });
    grantLive = true;
    expect(await evaluateExtractionGuard(USER, PROPRIETARY)).toBeNull();
    expect(grantSpy).toHaveBeenCalledTimes(1);
    expect(resolveSpy).not.toHaveBeenCalled();
  });

  it('flag OFF: no live grant and no paid reason is still blocked', async () => {
    db = fakeDb({ mcp_credit_ledger: ledger('signup_grant'), mcp_call_log: [] });
    expect((await evaluateExtractionGuard(USER, PROPRIETARY))?.status).toBe('requires_paid');
  });

  it('flag OFF: a paid ledger reason never needs the grant read', async () => {
    db = fakeDb({ mcp_credit_ledger: ledger('stripe_topup'), mcp_call_log: [] });
    expect(await evaluateExtractionGuard(USER, PROPRIETARY)).toBeNull();
    expect(grantSpy).not.toHaveBeenCalled();
  });

  it('flag OFF: a failed grant read fails open (guard behaviour unchanged)', async () => {
    db = fakeDb({ mcp_credit_ledger: [], mcp_call_log: [] });
    grantLive = 'throw';
    expect(await evaluateExtractionGuard(USER, PROPRIETARY)).toBeNull();
  });

  it('proprietaryStandingFrom admits a live grant on any kind', () => {
    for (const kind of ['expired', 'none', 'promotional_only', 'trial'] as const) {
      expect(proprietaryStandingFrom({ ...st(kind, false), liveProGrant: true })).toBe(true);
      expect(proprietaryStandingFrom(st(kind, false))).toBe(false);
    }
  });
});
