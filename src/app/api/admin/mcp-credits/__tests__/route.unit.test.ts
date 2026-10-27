/**
 * Admin MCP credits — a negative amount must actually debit.
 *
 * mcp_grant_credits no-ops on p_amount <= 0 and returns the current balance, so the
 * route used to answer success:true for a negative amount while changing nothing.
 */
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env.ADMIN_PASSWORD = 'pw';

const grantCredits = vi.fn();
const debitCredits = vi.fn();
vi.mock('@/lib/mcp/credits', () => ({
  getBalance: vi.fn(async () => 0),
  grantCredits: (...a: unknown[]) => grantCredits(...a),
  debitCredits: (...a: unknown[]) => debitCredits(...a),
}));

const { POST } = await import('../route');

const post = (body: unknown) =>
  POST(new NextRequest('https://getmindy.ai/api/admin/mcp-credits?password=pw', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));

beforeEach(() => vi.clearAllMocks());

describe('POST /api/admin/mcp-credits', () => {
  it('positive amount grants', async () => {
    grantCredits.mockResolvedValue(1000);
    const res = await post({ email: 'A@x.com', amount: 1000 });
    expect(res.status).toBe(200);
    expect(grantCredits).toHaveBeenCalledWith('A@x.com', 1000, 'admin_grant');
    expect(debitCredits).not.toHaveBeenCalled();
    expect((await res.json()).balance).toBe(1000);
  });

  it('negative amount debits, never routes through the no-op grant', async () => {
    debitCredits.mockResolvedValue({ ok: true, newBalance: 0 });
    const res = await post({ email: 'a@x.com', amount: -1000 });
    expect(res.status).toBe(200);
    expect(debitCredits).toHaveBeenCalledWith('a@x.com', 1000, { reason: 'admin_debit', toolName: 'admin_debit' });
    expect(grantCredits).not.toHaveBeenCalled();
    const json = await res.json();
    expect(json).toMatchObject({ success: true, debited: 1000, balance: 0 });
  });

  it('negative amount larger than the balance is a 409, not a success', async () => {
    debitCredits.mockResolvedValue({ ok: false, newBalance: 200 });
    const res = await post({ email: 'a@x.com', amount: -1000 });
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.success).toBeUndefined();
    expect(json.balance).toBe(200);
  });

  it('rejects zero and fractional amounts', async () => {
    expect((await post({ email: 'a@x.com', amount: 0 })).status).toBe(400);
    expect((await post({ email: 'a@x.com', amount: 2.5 })).status).toBe(400);
    expect(grantCredits).not.toHaveBeenCalled();
    expect(debitCredits).not.toHaveBeenCalled();
  });
});
