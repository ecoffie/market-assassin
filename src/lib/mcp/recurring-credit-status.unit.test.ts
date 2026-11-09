import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * "Monthly MCP credits: not included with this access" must be shown only when the absence
 * is ESTABLISHED, and never when the lookup failed (unknown is not "not included").
 */
const claimed = new Set<string>();
let claimError: Error | null = null;
let ledgerRows: Array<{ reason: string; created_at: string }> = [];
let ledgerError: { message: string } | null = null;

vi.mock('@/lib/mcp/prepaid-entitlements', () => ({
  isMonthClaimed: vi.fn(async (email: string, month: string) => {
    if (claimError) throw claimError;
    return claimed.has(`${email}:${month}`);
  }),
}));

vi.mock('@/lib/supabase/server-clients', () => {
  const q: Record<string, unknown> = {};
  for (const m of ['from', 'select', 'eq', 'in', 'gte']) q[m] = () => q;
  q.limit = async () => ({ data: ledgerError ? null : ledgerRows, error: ledgerError });
  return { getWriteClient: () => q };
});

import { recurringMonthlyCreditStatus, currentAndPreviousMonth } from './recurring-credit-status';

const NOW = new Date('2026-11-09T12:00:00Z');

beforeEach(() => {
  claimed.clear();
  claimError = null;
  ledgerRows = [];
  ledgerError = null;
});

describe('recurringMonthlyCreditStatus', () => {
  it('a beta-preview Pro account with only the July 2026 grant is not_included', async () => {
    claimed.add('andre@example.com:2026-07');
    expect(await recurringMonthlyCreditStatus('andre@example.com', NOW)).toBe('not_included');
  });

  it('a current-month claim (cron, sponsor top-up, invoice webhook) is included', async () => {
    claimed.add('sub@example.com:2026-11');
    expect(await recurringMonthlyCreditStatus('SUB@example.com', NOW)).toBe('included');
  });

  it('a previous-month claim counts (the 1st, before the 09:00 UTC run)', async () => {
    claimed.add('sub@example.com:2026-10');
    expect(await recurringMonthlyCreditStatus('sub@example.com', new Date('2026-11-01T02:00:00Z'))).toBe('included');
  });

  it('a live MCP credit plan is included', async () => {
    ledgerRows = [{ reason: 'mcp_sub_monthly', created_at: '2026-10-20T00:00:00Z' }];
    expect(await recurringMonthlyCreditStatus('mcp@example.com', NOW)).toBe('included');
    ledgerRows = [{ reason: 'mcp_sub_annual', created_at: '2026-02-01T00:00:00Z' }];
    expect(await recurringMonthlyCreditStatus('mcp@example.com', NOW)).toBe('included');
  });

  it('a lapsed monthly MCP plan is not_included', async () => {
    ledgerRows = [{ reason: 'mcp_sub_monthly', created_at: '2026-08-01T00:00:00Z' }];
    expect(await recurringMonthlyCreditStatus('mcp@example.com', NOW)).toBe('not_included');
  });

  it('a claim read error is unknown, never not_included', async () => {
    claimError = new Error('db down');
    expect(await recurringMonthlyCreditStatus('x@example.com', NOW)).toBe('unknown');
  });

  it('a ledger read error is unknown, never not_included', async () => {
    ledgerError = { message: 'db down' };
    expect(await recurringMonthlyCreditStatus('x@example.com', NOW)).toBe('unknown');
  });

  it('January rolls back to the previous December', () => {
    expect(currentAndPreviousMonth(new Date('2027-01-01T00:00:00Z'))).toEqual(['2027-01', '2026-12']);
  });
});
