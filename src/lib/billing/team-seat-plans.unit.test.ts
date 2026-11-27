import { describe, expect, it, vi } from 'vitest';

describe('Team by seats', () => {
  it('starts at $249 for 2 users and adds about $116.67 a seat, 1,500 credits per user', async () => {
    const { TEAM_SEAT_PLANS } = await import('./team-seat-plans');
    expect(TEAM_SEAT_PLANS.map((p) => [p.seats, p.monthlyUsd, p.credits])).toEqual([
      [2, 249, 3000], [3, 366, 4500], [4, 482, 6000], [5, 599, 7500],
    ]);
    expect(TEAM_SEAT_PLANS[0]).toMatchObject({ annualUsd: 2490, annualPerMonthUsd: 208 });
  });

  it('has no Stripe price until one is configured, and is off by default', async () => {
    const m = await import('./team-seat-plans');
    expect(m.TEAM_SEAT_PLANS.every((p) => p.monthlyPriceId === null && p.annualPriceId === null)).toBe(true);
    expect(m.TEAM_SEAT_PRICING_ON).toBe(false);
    expect(m.teamSeatPlanForPriceId('price_1TuxApK5zyiZ50PBPV40eCvG')).toBeNull(); // Mid $249 is NOT Team
  });

  it('recognises a configured seat price by id, never by amount', async () => {
    vi.resetModules();
    vi.stubEnv('STRIPE_TEAM_3_SEATS_MONTHLY_PRICE', 'price_team3m');
    vi.stubEnv('STRIPE_TEAM_3_SEATS_ANNUAL_PRICE', 'price_team3y');
    const { teamSeatPlanForPriceId, teamSeatPlan } = await import('./team-seat-plans');
    expect(teamSeatPlanForPriceId('price_team3m')).toMatchObject({ interval: 'month', plan: { seats: 3, credits: 4500 } });
    expect(teamSeatPlanForPriceId('price_team3y')?.interval).toBe('year');
    expect(teamSeatPlan('9')).toBeNull();
    vi.unstubAllEnvs();
    vi.resetModules();
  });
});
