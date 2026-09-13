import { describe, it, expect } from 'vitest';
import { PRO_MONTHLY_CREDITS, TEAM_MONTHLY_CREDITS, CREDIT_PACKAGES } from './packages';
import { SIGNUP_CREDITS } from './credits';

/**
 * ── THE GOVERNING STRATEGY CHANGED ON 2026-09-08. Read this before editing. ──
 *
 * OLD (GOS #015/#016, 2026-07-19): MCP inside a Mindy subscription is a TASTE.
 * Bundled credits were deliberately priced so the standalone MCP ladder stayed the
 * economical way to consume MCP — this file asserted `teamRate > entryRate` to
 * protect exactly that.
 *
 * NEW (Eric, 2026-09-08): normal interactive MCP use is an INCLUDED way to use
 * Mindy — "Mindy everywhere". Standalone MCP is being re-aimed at high-volume /
 * developer / machine / external-agent use, and is NOT redesigned here.
 *
 * The old assertion was NOT silently edited to go green. It is replaced, below, by
 * a test that pins the NEW direction and says so — because a strategy reversal
 * hidden in a changed assertion is indistinguishable from a bug someone patched
 * around, and this repo has been bitten by exactly that.
 */
describe('app-tier credit allowances', () => {
  /**
   * Pin BOTH allowances together. They are one coordinated product decision, so a
   * change to either should have to state its intent here rather than drift alone.
   */
  it('Pro is 1,500/mo and Team is 1,000/mo (Eric, 2026-09-08)', () => {
    expect(PRO_MONTHLY_CREDITS).toBe(1500);
    // ⚠️ Team is INTENTIONALLY still 1,000. The approved long-term target is 6,000
    // SHARED, and it is blocked on real pooling: `mcp_credit_balance` is keyed by
    // user_email, so a Team grant today credits only the Stripe billing contact.
    // Shipping 6,000 on that path would multiply a per-seat grant, not pool it.
    expect(TEAM_MONTHLY_CREDITS).toBe(1000);
  });

  /**
   * THE REVERSAL, pinned deliberately. This is the inverse of what this file used to
   * assert. At $149/1,500 the bundled rate (~$0.099/cr) is CHEAPER than the
   * standalone Entry pack ($99/500 = $0.198/cr) — that is the point of "included",
   * not an accident to be corrected.
   */
  it('bundled Pro credits are now CHEAPER per credit than the standalone top-up', () => {
    // Read the real package rather than restating a price — the standalone top-up is
    // $119/500 ($0.238/cr), NOT the $99/500 the old comment claimed.
    const entry = CREDIT_PACKAGES.find((p) => p.credits === 500);
    expect(entry, 'the 500-credit standalone top-up should still exist').toBeTruthy();
    const entryRate = entry!.usd / entry!.credits;
    const proRate = 149 / PRO_MONTHLY_CREDITS;
    expect(proRate).toBeLessThan(entryRate);
  });

  /**
   * Guards the sizing rationale. 1,500 was chosen to sit above the highest
   * RECONSTRUCTED user-month (1,100 — observed spend plus suppressed demand from
   * rejected_no_credits attempts priced at their historical rates), so ordinary
   * interactive use does not meet a wall. If someone lowers this below that
   * ceiling, the "included" promise quietly stops being true.
   */
  it('Pro clears the highest reconstructed interactive user-month (1,100)', () => {
    expect(PRO_MONTHLY_CREDITS).toBeGreaterThan(1100);
  });

  it('Free stays a ONE-TIME grant, not a monthly refill', () => {
    // Guards the copy risk: rendering "100" beside two monthly numbers implies recurring.
    expect(SIGNUP_CREDITS).toBe(100);
    expect(SIGNUP_CREDITS).toBeLessThan(PRO_MONTHLY_CREDITS);
  });
});

/**
 * CROSS-SURFACE CONSISTENCY. `packages.ts` is the single source of truth; every
 * other surface must READ it rather than restate it. A hardcoded allowance is how
 * `mcp/tools/page.tsx` came to serve `?? 1000` while production granted 250, and
 * how CLAUDE.md came to claim 6,000.
 */
describe('allowances are not hardcoded anywhere else', () => {
  it('the catalog API derives tierCredits from the constants', async () => {
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync('src/app/api/mcp/catalog/route.ts', 'utf8'));
    // It must reference the constants, not literals.
    expect(src).toContain('PRO_MONTHLY_CREDITS');
    expect(src).toContain('TEAM_MONTHLY_CREDITS');
    expect(src).not.toMatch(/credits:\s*1500\b/);
    expect(src).not.toMatch(/credits:\s*1000\b/);
  });

  it('no page hardcodes a monthly allowance fallback', async () => {
    const fs = await import('node:fs');
    for (const f of ['src/app/mcp/tools/page.tsx', 'src/app/pricing/page.tsx']) {
      const src = fs.readFileSync(f, 'utf8');
      // `?? 1000` / `?? 250` / `?? 1500` are the shape that drifted before.
      expect(src, `${f} must not hardcode an allowance fallback`)
        .not.toMatch(/proMonthlyCredits:\s*[^,\n]*\?\?\s*\d{3,}/);
    }
  });
});
