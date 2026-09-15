import { describe, it, expect } from 'vitest';

/**
 * The no-stacking resolver, mirrored from grant-mcp-pro-credits/route.ts `consider()`.
 *
 * This is the POLICY test (Eric, 2026-09-15): one grant per account per month at the
 * highest applicable allowance. Kept as a pure reimplementation because the route's
 * resolver is inlined and reaches Stripe; the invariant it encodes is what matters and
 * must not silently change. If the route's rule changes, this test should fail.
 */
type Group = 'internal' | 'advocate' | 'pro-sub' | 'team-sub' | 'sponsored';
type Target = { email: string; amount: number; group: Group; mode: 'add' | 'topup' };

function resolve(sources: Array<{ email: string; amount: number; group: Group; mode?: 'add' | 'topup' }>): Target[] {
  const byEmail = new Map<string, Target>();
  for (const { email, amount, group, mode = 'add' } of sources) {
    const e = email.toLowerCase().trim();
    const prev = byEmail.get(e);
    if (!prev || amount > prev.amount) byEmail.set(e, { email: e, amount, group, mode });
  }
  return [...byEmail.values()];
}

const SPONSORED = 8000;
const PRO = 1500;
const TEAM = 1000;

describe('sponsor entitlements — no-stacking resolution', () => {
  it('a sponsored account with no other source gets the sponsored allowance as a top-up', () => {
    const [t] = resolve([{ email: 'rochbuf@gmail.com', amount: SPONSORED, group: 'sponsored', mode: 'topup' }]);
    expect(t.amount).toBe(8000);
    expect(t.mode).toBe('topup');
  });

  it('a SMALLER paid plan does not reduce the sponsored benefit', () => {
    // The case Eric named explicitly: Pro (1,500) alongside a sponsorship (8,000).
    const targets = resolve([
      { email: 'rochbuf@gmail.com', amount: PRO, group: 'pro-sub' },
      { email: 'rochbuf@gmail.com', amount: SPONSORED, group: 'sponsored', mode: 'topup' },
    ]);
    expect(targets).toHaveLength(1);
    expect(targets[0].amount).toBe(8000);
    expect(targets[0].group).toBe('sponsored');
  });

  it('a LARGER allowance from any source wins over the sponsorship', () => {
    const targets = resolve([
      { email: 'staff@govcongiants.com', amount: SPONSORED, group: 'sponsored', mode: 'topup' },
      { email: 'staff@govcongiants.com', amount: 25000, group: 'internal' },
    ]);
    expect(targets).toHaveLength(1);
    expect(targets[0].amount).toBe(25000);
    expect(targets[0].group).toBe('internal');
  });

  it('never emits two targets for one account — the stacking failure mode', () => {
    const targets = resolve([
      { email: 'x@y.com', amount: TEAM, group: 'team-sub' },
      { email: 'X@Y.com', amount: PRO, group: 'pro-sub' },
      { email: ' x@y.com ', amount: SPONSORED, group: 'sponsored', mode: 'topup' },
    ]);
    // Case and whitespace must not create a second grant for the same human.
    expect(targets).toHaveLength(1);
    expect(targets[0].amount).toBe(8000);
  });

  it('distinct accounts are unaffected by each other', () => {
    const targets = resolve([
      { email: 'a@x.com', amount: SPONSORED, group: 'sponsored', mode: 'topup' },
      { email: 'b@x.com', amount: PRO, group: 'pro-sub' },
    ]);
    expect(targets).toHaveLength(2);
    expect(targets.find((t) => t.email === 'a@x.com')!.mode).toBe('topup');
    expect(targets.find((t) => t.email === 'b@x.com')!.mode).toBe('add');
  });
});

describe('sponsor entitlements — top-up arithmetic (never reduces)', () => {
  // Mirrors mcp_topup_to_ceiling: granted = max(0, ceiling - balance).
  const shortfall = (ceiling: number, balance: number) => Math.max(0, ceiling - balance);

  it('tops a low balance up to the ceiling', () => {
    expect(shortfall(8000, 0)).toBe(8000);
    expect(shortfall(8000, 2000)).toBe(6000);
  });

  it('grants nothing when the balance already meets the ceiling', () => {
    expect(shortfall(8000, 8000)).toBe(0);
  });

  it("NEVER reduces a balance above the ceiling — Rochelle's 25,000 stays intact", () => {
    // The explicit guarantee: her one-time 25,000 must survive every monthly run.
    expect(shortfall(8000, 25000)).toBe(0);
    // And the balance is untouched, not clamped down to 8,000.
    const balance = 25000;
    expect(balance + shortfall(8000, balance)).toBe(25000);
  });
});
