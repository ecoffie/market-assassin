/**
 * Account-id credit invariants (hermetic).
 *
 * 1) Email change preserves credits when balance is keyed by account_id.
 * 2) Stripe/monthly retry exactly-once across email change via shared
 *    pro:acct:<uuid>:<YYYY-MM> key (pure key-set logic + mocked RPC).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  proMonthlyAccountKey,
  proMonthlyCreditKeys,
  proMonthlyLegacyEmailKey,
} from './pro-monthly-keys';
import { normalizeEmail } from './account';

const ACCOUNT_ID = '82261438-aaaa-bbbb-cccc-ddddeeeeffff';
const MONTH = '2026-09';

const rpc = vi.fn();
const fromMock = vi.fn();
const resolveAccountIdMock = vi.fn();

vi.mock('@/lib/supabase/server-clients', () => ({
  getWriteClient: () => ({ rpc, from: fromMock }),
}));

vi.mock('@/lib/mcp/credit-emails', () => ({
  sendCreditWelcomeEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/identity/account', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./account')>();
  return {
    ...actual,
    resolveAccountId: (...args: unknown[]) => resolveAccountIdMock(...args),
  };
});

import { getBalance, applyCreditOnce, applyProMonthlyCredits } from '@/lib/mcp/credits';

beforeEach(() => {
  rpc.mockReset();
  fromMock.mockReset();
  resolveAccountIdMock.mockReset();
});

describe('normalizeEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmail('  Foo@Bar.COM ')).toBe('foo@bar.com');
  });
});

describe('email change preserves credits (account_id balance)', () => {
  it('getBalance returns the same credits after primary email string changes', async () => {
    resolveAccountIdMock.mockImplementation(async (email: string) => {
      const e = String(email).toLowerCase();
      if (e === 'old@example.com' || e === 'new@example.com') return ACCOUNT_ID;
      return null;
    });

    fromMock.mockImplementation((table: string) => {
      if (table !== 'mcp_credit_balance') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) };
      }
      return {
        select: () => ({
          eq: (col: string, val: string) => ({
            maybeSingle: async () => {
              if (col === 'account_id' && val === ACCOUNT_ID) {
                return { data: { balance: 250 } };
              }
              return { data: null };
            },
          }),
        }),
      };
    });

    expect(await getBalance('old@example.com')).toBe(250);
    expect(await getBalance('new@example.com')).toBe(250);
  });
});

describe('Stripe retry exactly once across email change', () => {
  it('key sets share pro:acct:UUID:month so second apply is a no-op', () => {
    const first = proMonthlyCreditKeys({
      accountId: ACCOUNT_ID,
      month: MONTH,
      emails: ['old@x.com'],
    });
    const second = proMonthlyCreditKeys({
      accountId: ACCOUNT_ID,
      month: MONTH,
      emails: ['new@x.com'],
    });
    expect(first[0]).toBe(proMonthlyAccountKey(ACCOUNT_ID, MONTH));
    expect(second[0]).toBe(proMonthlyAccountKey(ACCOUNT_ID, MONTH));
    expect(first).toContain(proMonthlyLegacyEmailKey('old@x.com', MONTH));
    expect(second).toContain(proMonthlyLegacyEmailKey('new@x.com', MONTH));
    expect(first.filter((k) => second.includes(k))).toEqual([
      proMonthlyAccountKey(ACCOUNT_ID, MONTH),
    ]);
  });

  it('applyProMonthlyCredits second call (mock RPC) returns applied=false', async () => {
    let call = 0;
    rpc.mockImplementation(async (name: string) => {
      expect(name).toBe('mcp_apply_credit_account');
      call += 1;
      return {
        data: [{ applied: call === 1, new_balance: 250 }],
        error: null,
      };
    });

    const first = await applyProMonthlyCredits(ACCOUNT_ID, 'old@x.com', 250, MONTH);
    const second = await applyProMonthlyCredits(ACCOUNT_ID, 'new@x.com', 250, MONTH);

    expect(first.applied).toBe(true);
    expect(second.applied).toBe(false);
    expect(second.newBalance).toBe(250);

    const keySets = rpc.mock.calls.map((c) => c[1].p_keys as string[]);
    expect(keySets[0]).toContain(proMonthlyAccountKey(ACCOUNT_ID, MONTH));
    expect(keySets[0]).toContain(proMonthlyLegacyEmailKey('old@x.com', MONTH));
    expect(keySets[1]).toContain(proMonthlyAccountKey(ACCOUNT_ID, MONTH));
    expect(keySets[1]).toContain(proMonthlyLegacyEmailKey('new@x.com', MONTH));
  });

  it('applyCreditOnce accepts legacyKeys alongside primary', async () => {
    resolveAccountIdMock.mockResolvedValue(ACCOUNT_ID);
    rpc.mockResolvedValue({ data: [{ applied: false, new_balance: 100 }], error: null });

    const result = await applyCreditOnce(
      proMonthlyAccountKey(ACCOUNT_ID, MONTH),
      'new@x.com',
      250,
      'pro_monthly',
      [proMonthlyLegacyEmailKey('old@x.com', MONTH), proMonthlyLegacyEmailKey('new@x.com', MONTH)],
    );

    expect(result.applied).toBe(false);
    expect(rpc).toHaveBeenCalledWith(
      'mcp_apply_credit_account',
      expect.objectContaining({
        p_keys: [
          proMonthlyAccountKey(ACCOUNT_ID, MONTH),
          proMonthlyLegacyEmailKey('old@x.com', MONTH),
          proMonthlyLegacyEmailKey('new@x.com', MONTH),
        ],
        p_account_id: ACCOUNT_ID,
      }),
    );
  });
});
