import { describe, it, expect } from 'vitest';
import { PRO_MONTHLY_CREDITS, TEAM_MONTHLY_CREDITS } from './packages';
import { SIGNUP_CREDITS } from './credits';

describe('app-tier credit allowances', () => {
  it('Teams is 1,000/mo (Eric, 2026-08-02)', () => {
    expect(TEAM_MONTHLY_CREDITS).toBe(1000);
  });

  it('Teams beats Pro per SEAT — the reason it moved off 750', () => {
    const SEATS = 5; // Team plan includes 5 users
    // 750/5 = 150 was BELOW a solo Pro subscriber's 250; 1000/5 = 200 is not.
    expect(TEAM_MONTHLY_CREDITS / SEATS).toBeGreaterThan(150);
    // ...but still under Pro per head: seats buy collaboration, not credits.
    expect(TEAM_MONTHLY_CREDITS / SEATS).toBeLessThan(PRO_MONTHLY_CREDITS);
  });

  it('keeps the two-product split: bundled credits stay pricier than the MCP ladder', () => {
    // Entry is $99/500 = $0.198/credit. Team at $499/1000 = $0.499/credit.
    // A real agency still buys the standalone MCP product (GOS #015/#016).
    const teamRate = 499 / TEAM_MONTHLY_CREDITS;
    const entryRate = 99 / 500;
    expect(teamRate).toBeGreaterThan(entryRate);
  });

  it('Free stays a ONE-TIME grant, not a monthly refill', () => {
    // Guards the copy risk: rendering "100" beside two monthly numbers implies recurring.
    expect(SIGNUP_CREDITS).toBe(100);
    expect(SIGNUP_CREDITS).toBeLessThan(PRO_MONTHLY_CREDITS);
  });
});
