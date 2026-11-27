import { describe, expect, it, vi } from 'vitest';

describe('Team by seats', () => {
  it('starts at $249 for 2 users and adds about $116.67 a seat, 1,500 credits per user', async () => {
    const { TEAM_SEAT_PLANS } = await import('./team-seat-plans');
    expect(TEAM_SEAT_PLANS.map((p) => [p.seats, p.monthlyUsd, p.credits])).toEqual([
      [2, 249, 3000], [3, 366, 4500], [4, 482, 6000], [5, 599, 7500],
    ]);
    // Annual: 33% off (owner 2026-11-27), matching the yearly Stripe prices.
    expect(TEAM_SEAT_PLANS.map((p) => [p.annualUsd, p.annualPerMonthUsd])).toEqual([[2002, 167], [2943, 245], [3875, 323], [4816, 401]]);
  });

  it('uses the live monthly and yearly prices, and is off by default', async () => {
    const m = await import('./team-seat-plans');
    expect(m.TEAM_SEAT_PLANS.map((p) => p.monthlyPriceId)).toEqual([
      'price_1UgRmNK5zyiZ50PBB0eGUTYw', 'price_1UgRmiK5zyiZ50PBUawhanUw', 'price_1UgRn2K5zyiZ50PBEOLJgMT4', 'price_1UgRnIK5zyiZ50PB2dZhuXH7',
    ]);
    expect(m.TEAM_SEAT_PLANS.map((p) => p.annualPriceId)).toEqual([
      'price_1UgVNCK5zyiZ50PBMWX0AYds', 'price_1UgVNPK5zyiZ50PB1trRyBga', 'price_1UgVNZK5zyiZ50PB4tOkK7Nf', 'price_1UgVNuK5zyiZ50PBj3JNMTzh',
    ]);
    expect(m.teamSeatPlanForPriceId('price_1UgVNPK5zyiZ50PB1trRyBga')).toMatchObject({ interval: 'year', plan: { seats: 3, credits: 4500 } });
    expect(m.teamSeatPlanForPriceId('price_1UgRnIK5zyiZ50PB2dZhuXH7')).toMatchObject({ interval: 'month', plan: { seats: 5, credits: 7500 } });
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
