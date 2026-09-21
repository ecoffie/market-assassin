/**
 * The first-connect grant is gated on the LEDGER, never on the balance.
 *
 * THE SCENARIO THIS PINS (real, 2026-08-26): an admin transferred a grant off an
 * account, leaving a legitimate `mcp_credit_balance` row at 0. Under a balance-row gate
 * that account would look like it had ALREADY consumed its one-time welcome grant, and
 * a user who never received credits would be silently denied them.
 *
 * The authority is the partial unique index
 *   uq_mcp_credit_ledger_one_signup_grant ON mcp_credit_ledger(user_email)
 *     WHERE reason = 'signup_grant'
 * so the RPC claims the grant by INSERTING the ledger row and letting the index pick a
 * winner. These tests assert the contract the app relies on:
 *   - a zero-balance row does NOT block eligibility
 *   - an existing signup_grant DOES block it
 *   - the loser of a concurrent claim grants 0 and does not double-credit
 *   - a failed grant never throws into an auth path
 *   - the welcome email fires ONLY on a real grant
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();
const sendCreditWelcomeEmail = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/supabase/server-clients', () => ({
  getWriteClient: () => ({ rpc, from: () => ({ insert: vi.fn() }) }),
}));
vi.mock('./credit-emails', () => ({ sendCreditWelcomeEmail }));

async function load() {
  vi.resetModules();
  return import('./credits');
}

beforeEach(() => {
  rpc.mockReset();
  sendCreditWelcomeEmail.mockClear();
  sendCreditWelcomeEmail.mockResolvedValue(undefined);
});

describe('first-connect grant eligibility', () => {
  it('grants when no signup_grant exists — even though a zero-balance row does', async () => {
    // The RPC is the authority; a 0 balance is irrelevant to eligibility. This is the
    // admin-transfer case: balance row present at 0, grant never issued.
    rpc.mockResolvedValue({ data: [{ granted: 100, balance: 100 }], error: null });
    const { grantSignupCreditsIfFirst } = await load();

    const granted = await grantSignupCreditsIfFirst('transferred@example.com');

    expect(granted).toBe(100);
    expect(rpc).toHaveBeenCalledWith('mcp_grant_signup_credits', {
      p_user: 'transferred@example.com',
      p_amount: expect.any(Number),
    });
  });

  it('grants 0 when the account already holds a signup_grant', async () => {
    rpc.mockResolvedValue({ data: [{ granted: 0, balance: 4820 }], error: null });
    const { grantSignupCreditsIfFirst } = await load();

    expect(await grantSignupCreditsIfFirst('veteran@example.com')).toBe(0);
  });

  it('re-minting a key cannot farm credits', async () => {
    rpc
      .mockResolvedValueOnce({ data: [{ granted: 100, balance: 100 }], error: null })
      .mockResolvedValueOnce({ data: [{ granted: 0, balance: 100 }], error: null })
      .mockResolvedValueOnce({ data: [{ granted: 0, balance: 100 }], error: null });
    const { grantSignupCreditsIfFirst } = await load();

    const runs = [
      await grantSignupCreditsIfFirst('farmer@example.com'),
      await grantSignupCreditsIfFirst('farmer@example.com'),
      await grantSignupCreditsIfFirst('farmer@example.com'),
    ];

    expect(runs).toEqual([100, 0, 0]);
    expect(runs.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('the loser of a concurrent first-connect grants 0', async () => {
    // OAuth completion and an immediate tool call race; the index picks one winner.
    rpc
      .mockResolvedValueOnce({ data: [{ granted: 100, balance: 100 }], error: null })
      .mockResolvedValueOnce({ data: [{ granted: 0, balance: 100 }], error: null });
    const { grantSignupCreditsIfFirst } = await load();

    const [a, b] = await Promise.all([
      grantSignupCreditsIfFirst('racer@example.com'),
      grantSignupCreditsIfFirst('racer@example.com'),
    ]);

    expect(a + b).toBe(100);
  });

  it('normalizes the email so case cannot create a second eligibility', async () => {
    rpc.mockResolvedValue({ data: [{ granted: 100, balance: 100 }], error: null });
    const { grantSignupCreditsIfFirst } = await load();

    await grantSignupCreditsIfFirst('  MiXeD@Example.COM  ');

    expect(rpc).toHaveBeenCalledWith(
      'mcp_grant_signup_credits',
      expect.objectContaining({ p_user: 'mixed@example.com' })
    );
  });
});

describe('the grant never breaks an auth path', () => {
  it('returns 0 instead of throwing when the RPC errors', async () => {
    // This runs inside OAuth/token issuance. A user with no credits sees an upgrade
    // prompt; a user who cannot authenticate sees a broken product.
    rpc.mockResolvedValue({ data: null, error: { message: 'connection reset' } });
    const { grantSignupCreditsIfFirst } = await load();

    await expect(grantSignupCreditsIfFirst('unlucky@example.com')).resolves.toBe(0);
  });

  it('still returns the grant when the welcome email fails', async () => {
    rpc.mockResolvedValue({ data: [{ granted: 100, balance: 100 }], error: null });
    sendCreditWelcomeEmail.mockRejectedValue(new Error('resend down'));
    const { grantSignupCreditsIfFirst } = await load();

    expect(await grantSignupCreditsIfFirst('noemail@example.com')).toBe(100);
  });
});

describe('the welcome email tracks the real grant', () => {
  it('sends on a genuine first grant', async () => {
    rpc.mockResolvedValue({ data: [{ granted: 100, balance: 100 }], error: null });
    const { grantSignupCreditsIfFirst } = await load();

    await grantSignupCreditsIfFirst('newbie@example.com');

    expect(sendCreditWelcomeEmail).toHaveBeenCalledWith({
      email: 'newbie@example.com',
      credits: 100,
    });
  });

  it('does NOT re-send on the idempotent no-op', async () => {
    rpc.mockResolvedValue({ data: [{ granted: 0, balance: 500 }], error: null });
    const { grantSignupCreditsIfFirst } = await load();

    await grantSignupCreditsIfFirst('returning@example.com');

    expect(sendCreditWelcomeEmail).not.toHaveBeenCalled();
  });
});
