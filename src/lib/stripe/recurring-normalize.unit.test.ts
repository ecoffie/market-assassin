import { describe, it, expect } from 'vitest';
import { monthlyRecurring } from './recurring-normalize';

const dollars = (p: Parameters<typeof monthlyRecurring>[0]) => {
  const { monthlyCents } = monthlyRecurring(p);
  return monthlyCents === null ? null : Math.round(monthlyCents) / 100;
};

describe('monthlyRecurring', () => {
  it('divides by the interval count: $799 every 6 months is $133.17/mo', () => {
    expect(dollars({ plan_amount: 79900, plan_interval: 'month', plan_interval_count: 6 })).toBe(133.17);
    expect(monthlyRecurring({ plan_amount: 79900, plan_interval: 'month', plan_interval_count: 6 }).basis).toBe('exact');
  });

  it('normalizes annual and monthly prices', () => {
    expect(dollars({ plan_amount: 149000, plan_interval: 'year', plan_interval_count: 1 })).toBe(124.17);
    expect(dollars({ plan_amount: 14900, plan_interval: 'month', plan_interval_count: 1 })).toBe(149);
    expect(dollars({ plan_amount: 120000, plan_interval: 'year', plan_interval_count: 2 })).toBe(50);
  });

  it('a known count retires the large-amount guess: $1,200 billed monthly stays $1,200/mo', () => {
    expect(dollars({ plan_amount: 120000, plan_interval: 'month', plan_interval_count: 1 })).toBe(1200);
  });

  it('a row with no count yet keeps the prior inference and says so', () => {
    expect(monthlyRecurring({ plan_amount: 79900, plan_interval: 'month', plan_interval_count: null })).toEqual({ monthlyCents: 79900, basis: 'count_unknown' });
    expect(dollars({ plan_amount: 149000, plan_interval: 'year' })).toBe(124.17);
    expect(dollars({ plan_amount: 150000, plan_interval: 'month' })).toBe(125);
  });

  it('never guesses an interval it cannot convert', () => {
    expect(monthlyRecurring({ plan_amount: 5000, plan_interval: 'fortnight', plan_interval_count: 1 })).toEqual({ monthlyCents: null, basis: 'unmeasurable' });
    expect(monthlyRecurring({ plan_amount: 5000, plan_interval: null, plan_interval_count: 1 })).toEqual({ monthlyCents: null, basis: 'unmeasurable' });
    expect(monthlyRecurring({ plan_amount: 5000, plan_interval: 'month', plan_interval_count: 0 })).toEqual({ monthlyCents: null, basis: 'unmeasurable' });
  });
});
