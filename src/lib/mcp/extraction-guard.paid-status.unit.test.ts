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
vi.mock('@/lib/supabase/server-clients', () => ({ getWriteClient: () => db }));
vi.mock('./payer', () => ({ resolvePayer: async () => ({ kind: 'personal' }) }));
vi.mock('@/lib/entitlements/paid-status', async (orig) => ({
  ...(await orig<typeof import('@/lib/entitlements/paid-status')>()),
  resolvePaidStatus: (...a: unknown[]) => (resolveSpy as unknown as (...x: unknown[]) => Promise<PaidStatus>)(...a),
}));

import { evaluateExtractionGuard, proprietaryStandingFrom } from './extraction-guard';

const USER = 'acct@example.com';
const PROPRIETARY = ['get_sblo_contact'];
const st = (kind: PaidStatusKind, paidFunding: boolean | null, complimentaryAccess = false): PaidStatus => ({
  kind, paidFunding, complimentaryAccess, sources: [], failures: kind === 'unknown' ? ['x'] : [],
  evidence: { liveSubscriptionStatus: null, promotionalReasons: [], ledgerTruncated: false },
});
const ledger = (reason: string) => [{ user_email: USER, delta: 100, reason }];

beforeEach(() => { resolveSpy.mockClear(); vi.spyOn(console, 'error').mockImplementation(() => {}); });
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
