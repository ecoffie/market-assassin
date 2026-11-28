import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MINDY_DAY_ANNUAL_PRICE_IDS,
  MINDY_DAY_WINDOW,
  TEAM_SEAT_PLANS,
  isMindyDayPricing,
  teamSeatAnnualOffer,
  teamSeatPlanForPriceId,
} from './team-seat-plans';

const DURING = Date.UTC(2026, 10, 30, 15); // Mon Nov 30 2026
const BEFORE = MINDY_DAY_WINDOW.startMs - 1;
const AFTER = MINDY_DAY_WINDOW.endMs; // end is exclusive

describe('Mindy Day yearly Team prices (2 months free, one week)', () => {
  it('window is Nov 27 00:00 ET to Dec 6 00:00 ET', () => {
    expect(new Date(MINDY_DAY_WINDOW.startMs).toISOString()).toBe('2026-11-27T05:00:00.000Z');
    expect(new Date(MINDY_DAY_WINDOW.endMs).toISOString()).toBe('2026-12-06T05:00:00.000Z');
    expect(isMindyDayPricing(BEFORE)).toBe(false);
    expect(isMindyDayPricing(DURING)).toBe(true);
    expect(isMindyDayPricing(AFTER)).toBe(false);
  });

  it('during the week: 10 x monthly, Mindy Day price ids', () => {
    for (const plan of TEAM_SEAT_PLANS) {
      const o = teamSeatAnnualOffer(plan.seats, DURING);
      expect(o.mindyDay).toBe(true);
      expect(o.usd).toBe(plan.monthlyUsd * 10);
      expect(o.priceId).toBe(MINDY_DAY_ANNUAL_PRICE_IDS[plan.seats]);
    }
  });

  it('outside the week: the normal 33%-off yearly price', () => {
    for (const t of [BEFORE, AFTER]) {
      for (const plan of TEAM_SEAT_PLANS) {
        const o = teamSeatAnnualOffer(plan.seats, t);
        expect(o.mindyDay).toBe(false);
        expect(o.usd).toBe(plan.annualUsd);
        expect(o.priceId).toBe(plan.annualPriceId);
      }
    }
  });

  it('Mindy Day subscribers stay recognised (seats + yearly) after the week ends', () => {
    for (const plan of TEAM_SEAT_PLANS) {
      const hit = teamSeatPlanForPriceId(MINDY_DAY_ANNUAL_PRICE_IDS[plan.seats]);
      expect(hit?.plan.seats).toBe(plan.seats);
      expect(hit?.interval).toBe('year');
    }
  });

  it('checkout and /pricing both read the time-aware offer', () => {
    const checkout = readFileSync(join(process.cwd(), 'src/app/api/checkout/team-seats/route.ts'), 'utf8');
    expect(checkout).toContain('teamSeatAnnualOffer(plan.seats).priceId');
    const page = readFileSync(join(process.cwd(), 'src/components/public-site/pricing/SimplePricing.tsx'), 'utf8');
    expect(page).toContain('teamSeatAnnualOffer(seatPlan.seats)');
    expect(page).toContain('isMindyDayPricing()');
  });
});
