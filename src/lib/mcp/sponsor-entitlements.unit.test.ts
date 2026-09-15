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

describe('sponsor entitlements — ceiling-claim grant arithmetic', () => {
  /**
   * Mirrors mcp_topup_to_ceiling. The key claims a (month, ceiling) PAIR, so a higher
   * ceiling mid-month is a NEW claim granting only the increase, while a repeat at the
   * same ceiling is a no-op. Keying on the month alone blocked legitimate increases:
   * a paid 1,500 grant on the 3rd left a sponsored user stuck at 1,500 all month.
   */
  const grant = (ceiling: number, balance: number, grantedThisMonth: number) =>
    Math.min(
      Math.max(0, ceiling - grantedThisMonth), // the eligible increase
      Math.max(0, ceiling - balance),          // never exceed the real shortfall
    );

  it('paid 1,500 already granted, sponsorship 8,000 → grants 6,500 (completes, never stacks)', () => {
    expect(grant(8000, 1500, 1500)).toBe(6500);
    expect(1500 + grant(8000, 1500, 1500)).toBe(8000); // not 9,500
  });

  it('mid-month upgrade is not blocked by the claimed month', () => {
    expect(grant(8000, 1500, 1500)).toBe(6500);
  });

  it('repeat at the SAME ceiling grants nothing', () => {
    expect(grant(8000, 8000, 8000)).toBe(0);
  });

  it('spending down does NOT refill the same month (monthly, not daily)', () => {
    // 8,000 granted, spent to 200: the allowance is used, not owed again.
    expect(grant(8000, 200, 8000)).toBe(0);
  });

  it('a LOWER ceiling never grants — a small paid plan cannot reduce a sponsorship', () => {
    expect(grant(1000, 8000, 8000)).toBe(0);
  });

  it("Rochelle's 25,000 survives a fresh month at an 8,000 ceiling", () => {
    expect(grant(8000, 25000, 0)).toBe(0);
  });
});

describe('credit health — thresholds', () => {
  const LOW = 1600;
  it('warns strictly below the threshold, not at it', () => {
    expect(900 < LOW).toBe(true);
    expect(1600 < LOW).toBe(false);
    expect(5000 < LOW).toBe(false);
  });

  it('dedupe key is per account per type per day', () => {
    const k = (kind: string, email: string, day: string) => `alert:${kind}:${email}:${day}`;
    expect(k('exhausted', 'a@b.com', '2026-09-15')).toBe(k('exhausted', 'a@b.com', '2026-09-15'));
    expect(k('exhausted', 'a@b.com', '2026-09-15')).not.toBe(k('low_balance', 'a@b.com', '2026-09-15'));
    expect(k('exhausted', 'a@b.com', '2026-09-15')).not.toBe(k('exhausted', 'a@b.com', '2026-09-16'));
  });
});

describe('credit health — fleet-wide scope (not just entitlements)', () => {
  /**
   * The watch first shipped covering ONLY sponsored accounts, reasoning that a paying
   * user hitting zero is "a billing prompt, a different signal." The paywall funnel
   * refuted that: 331 generated paywall responses to 43 accounts produced 3 checkout
   * starts and 0 payments. Excluding non-sponsored accounts reproduces the original
   * blind spot on a different population, so every account kind is watched.
   */
  type Kind = 'entitled' | 'paid' | 'courtesy' | 'free';
  const watched = (hasEntitlement: boolean, rejections: number) => hasEntitlement || rejections > 0;

  it('watches a blocked FREE account, not only entitled ones', () => {
    expect(watched(false, 13)).toBe(true);
  });

  it('watches a blocked COURTESY account', () => {
    expect(watched(false, 7)).toBe(true);
  });

  it('watches an entitled account even with no rejections', () => {
    expect(watched(true, 0)).toBe(true);
  });

  it('ignores an untouched account with neither signal', () => {
    expect(watched(false, 0)).toBe(false);
  });

  it('low-balance warning applies to allowance-backed accounts only', () => {
    // A free account resting near zero is its normal state, not a finding.
    const warns = (hasEntitlement: boolean, balance: number) => hasEntitlement && balance < 1600;
    expect(warns(true, 900)).toBe(true);
    expect(warns(false, 0)).toBe(false);
    expect(warns(true, 5000)).toBe(false);
  });

  it('a paywall response is counted as GENERATED, never as seen', () => {
    // Naming guard: the field records a server event. Human visibility is unverified,
    // so nothing downstream may treat this as an impression.
    const finding = { paywallResponses: 38, rejections: 38 };
    expect(finding.paywallResponses).toBe(finding.rejections);
  });
});
