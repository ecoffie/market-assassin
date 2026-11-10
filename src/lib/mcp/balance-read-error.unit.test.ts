/**
 * A database error while READING a balance is not a zero balance.
 *
 * Before this fix `getBalance` destructured `{ data }` and ignored `error`, so a
 * PostgREST failure returned 0. runMeteredTool then treated a paying customer as
 * empty: it logged `rejected_no_credits`, recorded a paywall attempt, and showed the
 * "buy credits" refusal — a legitimate-looking zero built from an outage
 * (Bug Prevention Rule #11: unknown is never zero).
 *
 * Contract now:
 *   - a missing balance row is still 0 (a real, known state: never granted);
 *   - a read error THROWS;
 *   - runMeteredTool turns that into `billing_unavailable`: nothing runs, nothing is
 *     charged, no paywall attempt is recorded, and the message says to retry.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Layer 1: getBalance against a stubbed Supabase client ─────────────────────
const maybeSingle = vi.fn();
vi.mock('@/lib/supabase/server-clients', () => ({
  getWriteClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
  }),
  getReadClient: () => ({}),
}));
vi.mock('./credit-emails', () => ({ sendCreditWelcomeEmail: vi.fn() }));

describe('getBalance — read error vs missing row', () => {
  beforeEach(() => maybeSingle.mockReset());

  it('returns 0 for a user with no balance row (known state)', async () => {
    const { getBalance } = await import('./credits');
    maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(getBalance('new@x.com')).resolves.toBe(0);
  });

  it('returns the stored balance', async () => {
    const { getBalance } = await import('./credits');
    maybeSingle.mockResolvedValue({ data: { balance: 95 }, error: null });
    await expect(getBalance('u@x.com')).resolves.toBe(95);
  });

  it('THROWS on a read error instead of reporting 0', async () => {
    const { getBalance } = await import('./credits');
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'canceling statement due to statement timeout' } });
    await expect(getBalance('payer@x.com')).rejects.toThrow(/getBalance failed/);
  });
});
