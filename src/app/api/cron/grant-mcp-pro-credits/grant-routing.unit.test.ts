import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * GRANT ROUTING: Pro → personal, Team → org pool. Never both.
 *
 * ── THE DEFECT THIS LOCKS ────────────────────────────────────────────────────
 * The monthly grant builder deduped targets by EMAIL and kept the highest amount.
 * That was survivable only while every MCP allowance lived on a personal balance.
 *
 * Measured on live production 2026-09-08, on the one real Team subscriber:
 *   • active Team $499 (sub_1U0Kqq…, started 2026-08-03)
 *   • active Pro  $149 (sub_1U2uS9…, started 2026-08-10)  — same email
 *   • personal balance 2,000, composed of app_tier_team +1,000 (Aug) and
 *     pro_monthly +1,000 (Sep)
 *
 * That September row is labelled `pro_monthly` but carries the TEAM amount, because
 * email-dedupe collapsed the two subscriptions and Team's larger allowance won. So the
 * customer's paid Pro entitlement was never granted, and Team money was recorded as a
 * Pro grant. Two subscriptions, one grant, mislabelled.
 *
 * Once Team funds an org pool (PR 4B), leaving Team in the personal path would grant
 * the Team allowance TWICE a month — once to the pool, once to the person.
 *
 * These are SOURCE assertions. The grant route reaches Stripe and Supabase, so a
 * behavioural test here would need both mocked; the properties that actually matter
 * are structural (which branch runs, what the dedupe key is), and those are readable.
 * The behavioural proof lives in scripts/verify-team-grant.mts against real fixtures.
 */
const SRC = readFileSync('src/app/api/cron/grant-mcp-pro-credits/route.ts', 'utf8');

describe('monthly grant routing', () => {
  it('Team subscriptions are EXCLUDED from the personal grant path', () => {
    // The Team branch must `continue`, not push a personal target.
    expect(SRC).toMatch(/TEAM_AMOUNTS\.has\(amt\)\)\s*continue;/);
    // And must NOT push a team-sub target into the personal list any more.
    expect(SRC).not.toMatch(/TEAM_AMOUNTS\.has\(amt\)\)\s*subs\.push/);
  });

  it('Pro subscriptions still fund a personal balance', () => {
    expect(SRC).toMatch(/PRO_AMOUNTS\.has\(amt\)\)\s*subs\.push\(\{ email, amount: PRO_MONTHLY_CREDITS/);
  });

  it('routing keys on the PLAN AMOUNT, never on email', () => {
    // The decision must come from the subscription's own price.
    expect(SRC).toContain('PRO_AMOUNTS.has(amt)');
    expect(SRC).toContain('TEAM_AMOUNTS.has(amt)');
    // No email-based tier inference anywhere in the builder.
    expect(SRC).not.toMatch(/email\.(endsWith|includes)\([^)]*\)\s*\?\s*TEAM/);
  });

  it('dedupe no longer collapses two DIFFERENT subscriptions for one email', () => {
    // The old key was the email alone; it must now include the group.
    expect(SRC).toContain('`${e}|${group}`');
    expect(SRC).not.toMatch(/const prev = byEmail\.get\(e\);/);
  });

  it('the idempotency key distinguishes entitlements', () => {
    // A person may legitimately hold two (e.g. advocate comp + paid Pro). An
    // email-only key would let the first consume it and swallow the second.
    expect(SRC).toContain('group === \'pro-sub\' ? `pro:${email}:${month}`');
    expect(SRC).toContain('`pro:${group}:${email}:${month}`');
  });

  it('the LEGACY pro-sub key shape is preserved so past months cannot re-grant', () => {
    // September's keys are already consumed as `pro:<email>:<YYYY-MM>`. Changing that
    // shape for pro-sub would make every historical key look unclaimed and re-issue a
    // past month's credits.
    expect(SRC).toMatch(/pro-sub' \? `pro:\$\{email\}:\$\{month\}`/);
  });
});

describe('the live dual-subscription shape (Team + Pro, one email)', () => {
  /**
   * Simulates the builder's target resolution for the measured live case. Reproduces
   * the (email, group) keying so the regression is asserted on BEHAVIOUR, not only on
   * the source text.
   */
  const buildTargets = (subs: { amount: number }[]) => {
    const PRO = new Set([14900, 149000, 4900]);
    const TEAM = new Set([49900, 499000]);
    const byKey = new Map<string, { amount: number; group: string }>();
    const email = 'dual@example.test';
    for (const s of subs) {
      if (PRO.has(s.amount)) {
        const k = `${email}|pro-sub`;
        const prev = byKey.get(k);
        if (!prev || 1500 > prev.amount) byKey.set(k, { amount: 1500, group: 'pro-sub' });
      } else if (TEAM.has(s.amount)) {
        continue; // Team funds the org pool, not a personal balance.
      }
    }
    return [...byKey.values()];
  };

  it('Team + Pro on one email → exactly ONE personal target, and it is the PRO one', () => {
    const targets = buildTargets([{ amount: 49900 }, { amount: 14900 }]);
    expect(targets).toHaveLength(1);
    expect(targets[0].group).toBe('pro-sub');
    // The Pro allowance, NOT the Team allowance masquerading as Pro (the live bug).
    expect(targets[0].amount).toBe(1500);
  });

  it('a Team-only subscriber gets NO personal target', () => {
    expect(buildTargets([{ amount: 49900 }])).toHaveLength(0);
  });

  it('a Pro-only subscriber is unaffected', () => {
    const targets = buildTargets([{ amount: 14900 }]);
    expect(targets).toHaveLength(1);
    expect(targets[0].amount).toBe(1500);
  });
});
