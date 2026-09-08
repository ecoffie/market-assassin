/**
 * Layer A paid standing — the mid-month App Pro/Team grant must count.
 *
 * THE SCENARIO THIS PINS (real, 2026-09-07): ereck@harrisonplus.com paid for App Pro,
 * the webhook wrote mcp_credit_ledger reason=app_tier_pro (+250), then Claude called
 * get_sblo_contact and got requires_paid_credits. Ordinary metered tools billed
 * normally. PAID_REASONS listed stripe_topup / pro_monthly / admin_grant and ignored
 * the webhook reason, so a mid-month subscriber waited until the 1st-of-month cron
 * wrote pro_monthly.
 *
 * Standing is a LEDGER question (positive delta + accepted reason), never a balance
 * question. A fat free balance does not unlock proprietary tools.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type LedgerRow = { id: string; user_email: string; reason: string; delta: number };

let ledger: LedgerRow[] = [];
let tablesTouched: string[] = [];

function ledgerBuilder() {
  const state: {
    email?: string;
    minDelta?: number;
    reasons?: string[];
  } = {};
  const api = {
    select: () => api,
    eq: (col: string, val: string) => {
      if (col === 'user_email') state.email = val;
      return api;
    },
    gt: (col: string, val: number) => {
      if (col === 'delta') state.minDelta = val;
      return api;
    },
    in: (col: string, vals: string[]) => {
      if (col === 'reason') state.reasons = vals;
      return api;
    },
    limit: (n: number) => {
      let rows = ledger.filter((r) => r.user_email === state.email);
      if (state.minDelta !== undefined) rows = rows.filter((r) => r.delta > state.minDelta);
      if (state.reasons) rows = rows.filter((r) => state.reasons!.includes(r.reason));
      return Promise.resolve({ data: rows.slice(0, n).map((r) => ({ id: r.id })), error: null });
    },
  };
  return api;
}

vi.mock('@/lib/supabase/server-clients', () => ({
  getWriteClient: () => ({
    from: (table: string) => {
      tablesTouched.push(table);
      if (table === 'mcp_credit_ledger') return ledgerBuilder();
      throw new Error(`extraction-guard must not query ${table} for Layer A`);
    },
  }),
}));

import { evaluateExtractionGuard } from './extraction-guard';

const PROPRIETARY = ['get_sblo_contact'];
const EMAIL = 'ereck@harrisonplus.com';

function row(reason: string, delta: number, email = EMAIL): LedgerRow {
  return { id: `${reason}:${delta}:${email}`, user_email: email, reason, delta };
}

beforeEach(() => {
  ledger = [];
  tablesTouched = [];
  delete process.env.MCP_CAP_PAID_ACCOUNTS;
});

async function layerA(email = EMAIL) {
  return evaluateExtractionGuard(email, PROPRIETARY);
}

describe('extraction guard Layer A — paid standing', () => {
  it('app_tier_pro positive ledger grant → proprietary tool passes Layer A', async () => {
    ledger = [row('app_tier_pro', 250)];
    await expect(layerA()).resolves.toBeNull();
  });

  it('app_tier_team positive ledger grant → passes', async () => {
    ledger = [row('app_tier_team', 250)];
    await expect(layerA()).resolves.toBeNull();
  });

  it('pro_monthly → still passes', async () => {
    ledger = [row('pro_monthly', 250)];
    await expect(layerA()).resolves.toBeNull();
  });

  it('stripe_topup → still passes', async () => {
    ledger = [row('stripe_topup', 2000)];
    await expect(layerA()).resolves.toBeNull();
  });

  it('admin_grant → still passes', async () => {
    ledger = [row('admin_grant', 100)];
    await expect(layerA()).resolves.toBeNull();
  });

  it('signup_grant only → still fails', async () => {
    ledger = [row('signup_grant', 100)];
    const verdict = await layerA();
    expect(verdict).toMatchObject({ status: 'requires_paid', code: 'requires_paid_credits' });
  });

  it('zero/negative app_tier_pro row does not establish paid standing', async () => {
    ledger = [row('app_tier_pro', 0), row('app_tier_pro', -250)];
    const verdict = await layerA();
    expect(verdict).toMatchObject({ status: 'requires_paid', code: 'requires_paid_credits' });
  });

  it('sufficient credit balance alone still does not establish paid standing', async () => {
    // The guard never reads mcp_credit_balance. A signup-only account with a large
    // remaining balance is still free-standing. (Ereck's 260 credits did not help.)
    ledger = [row('signup_grant', 100)];
    const verdict = await layerA();
    expect(verdict).toMatchObject({ status: 'requires_paid', code: 'requires_paid_credits' });
    expect(tablesTouched).toEqual(['mcp_credit_ledger']);
    expect(tablesTouched).not.toContain('mcp_credit_balance');
  });
});
