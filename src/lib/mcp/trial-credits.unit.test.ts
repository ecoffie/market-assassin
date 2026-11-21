/** Trial credits: 500 once per person when a Pro/Team card trial starts (owner, 2026-11-18). */
import { describe, it, expect, vi } from 'vitest';

vi.mock('./credits', () => ({ applyCreditOnce: vi.fn() }));
const { grantTrialCredits, trialCreditsKey, TRIAL_CREDITS, TRIAL_CREDITS_REASON } = await import('./trial-credits');

function ledger() {
  const seen = new Set<string>();
  return vi.fn(async (key: string) => (seen.has(key) ? { applied: false, newBalance: 500 } : (seen.add(key), { applied: true, newBalance: 500 })));
}

describe('grantTrialCredits', () => {
  it('grants 500 for a trialing subscription', async () => {
    const apply = ledger();
    const r = await grantTrialCredits({ id: 'sub_1', status: 'trialing' }, 'A@x.com', apply as never);
    expect(TRIAL_CREDITS).toBe(500);
    expect(r).toMatchObject({ granted: true, applied: true });
    expect(apply).toHaveBeenCalledWith(trialCreditsKey('a@x.com'), 'a@x.com', 500, TRIAL_CREDITS_REASON);
  });

  it('once per person: a second trial on a new subscription grants nothing', async () => {
    const apply = ledger();
    await grantTrialCredits({ id: 'sub_1', status: 'trialing' }, 'a@x.com', apply as never);
    const r = await grantTrialCredits({ id: 'sub_2', status: 'trialing' }, 'a@x.com', apply as never);
    expect(r.applied).toBe(false);
  });

  it('skips a subscription that is not in a trial, and a missing email', async () => {
    const apply = ledger();
    expect(await grantTrialCredits({ id: 's', status: 'active' }, 'a@x.com', apply as never)).toMatchObject({ granted: false, skipped: 'not_trialing' });
    expect(await grantTrialCredits({ id: 's', status: 'trialing' }, '', apply as never)).toMatchObject({ granted: false, skipped: 'no_email' });
    expect(apply).not.toHaveBeenCalled();
  });
});
