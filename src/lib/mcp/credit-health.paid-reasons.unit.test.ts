/**
 * credit-health reads its "has paid us" reasons from the shared paid-status module.
 * With PAID_STATUS_RESOLVER off (the default) every account must classify exactly as the
 * old hardcoded list did; with it on, the shared PAID_FUNDING_REASONS apply.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  creditHealthPaidReasons,
  LEGACY_CREDIT_HEALTH_PAID_REASONS,
  PAID_FUNDING_REASONS,
} from '@/lib/entitlements/paid-reasons';

// One blocked call each, so every account appears in `exhausted` with its accountKind.
const LEDGER: Array<{ user_email: string; reason: string }> = [
  { user_email: 'topup@example.test', reason: 'stripe_topup' },
  { user_email: 'legacy-sub@example.test', reason: 'subscription' },
  { user_email: 'mcp-plan@example.test', reason: 'mcp_sub_monthly' },
  { user_email: 'app-pro@example.test', reason: 'app_tier_pro' },
  { user_email: 'app-team@example.test', reason: 'app_tier_team' },
  { user_email: 'signup@example.test', reason: 'signup_grant' },
  { user_email: 'comp@example.test', reason: 'comp_monthly' },
  { user_email: 'admin@example.test', reason: 'admin_grant' },
];
const EMAILS = LEDGER.map((r) => r.user_email);

function table(name: string) {
  const rows: Record<string, unknown[]> = {
    sponsor_active_entitlements: [],
    mcp_call_log: EMAILS.map((user_email) => ({ user_email })),
    mcp_credit_balance: EMAILS.map((user_email) => ({ user_email, balance: 0 })),
    mcp_credit_ledger: LEDGER,
    mcp_paywall_attempts: [],
  };
  const result = { data: rows[name] ?? [], error: null };
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'gte', 'gt', 'in']) q[m] = () => q;
  q.then = (resolve: (v: typeof result) => unknown) => resolve(result);
  return q;
}

vi.mock('@/lib/supabase/server-clients', () => ({ getWriteClient: () => ({ from: table }) }));

async function kinds(): Promise<Record<string, string>> {
  vi.resetModules();
  const { collectCreditHealth } = await import('./credit-health');
  const h = await collectCreditHealth(24);
  expect(h.errors).toEqual([]);
  return Object.fromEntries(h.exhausted.map((f) => [f.userEmail, f.accountKind]));
}

afterEach(() => vi.unstubAllEnvs());

describe('creditHealthPaidReasons', () => {
  it('flag OFF: exactly the frozen legacy list', () => {
    vi.stubEnv('PAID_STATUS_RESOLVER', '');
    expect([...creditHealthPaidReasons()].sort()).toEqual([...LEGACY_CREDIT_HEALTH_PAID_REASONS].sort());
    expect([...LEGACY_CREDIT_HEALTH_PAID_REASONS].sort()).toEqual(
      ['auto_recharge', 'mcp_sub_annual', 'mcp_sub_monthly', 'stripe_topup', 'subscription'],
    );
  });

  it('flag ON: the shared PAID_FUNDING_REASONS', () => {
    vi.stubEnv('PAID_STATUS_RESOLVER', 'true');
    expect([...creditHealthPaidReasons()].sort()).toEqual([...PAID_FUNDING_REASONS].sort());
  });

  it('only the literal "true" turns it on', () => {
    for (const v of ['1', 'on', 'yes', 'TRUE ']) {
      vi.stubEnv('PAID_STATUS_RESOLVER', v);
      const on = v.trim().toLowerCase() === 'true';
      expect([...creditHealthPaidReasons()].includes('subscription')).toBe(!on);
    }
  });
});

describe('collectCreditHealth account kinds', () => {
  it('flag OFF: classification identical to the old hardcoded list', async () => {
    vi.stubEnv('PAID_STATUS_RESOLVER', '');
    expect(await kinds()).toEqual({
      'topup@example.test': 'paid',
      'legacy-sub@example.test': 'paid',
      'mcp-plan@example.test': 'paid',
      'app-pro@example.test': 'courtesy',
      'app-team@example.test': 'courtesy',
      'signup@example.test': 'free',
      'comp@example.test': 'courtesy',
      'admin@example.test': 'courtesy',
    });
  });

  it('flag ON: app-tier grants count as paid, the unwritten "subscription" reason does not', async () => {
    vi.stubEnv('PAID_STATUS_RESOLVER', 'true');
    expect(await kinds()).toEqual({
      'topup@example.test': 'paid',
      'legacy-sub@example.test': 'courtesy',
      'mcp-plan@example.test': 'paid',
      'app-pro@example.test': 'paid',
      'app-team@example.test': 'paid',
      'signup@example.test': 'free',
      'comp@example.test': 'courtesy',
      'admin@example.test': 'courtesy',
    });
  });
});
