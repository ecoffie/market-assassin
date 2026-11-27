/**
 * Mindy Day annual promo rule: annual plan bought Nov 28 – Dec 5 2026 (New York) → 2x monthly
 * credits for the first paid year. Everything else → 1x.
 */
import { describe, expect, it } from 'vitest';
import {
  MINDY_DAY_FIRST_DAY, MINDY_DAY_LAST_DAY, MINDY_DAY_TIMEZONE, MINDY_DAY_WINDOW_END_MS, MINDY_DAY_WINDOW_START_MS,
  applyMindyDayPromo, isInMindyDayWindow, isMindyDayAnnualPromo, mindyDayPromoLine, promoMultiplier,
  type PromoSubscription,
} from './mindy-day-annual-promo';
import { PRO_MONTHLY_CREDITS, TEAM_MONTHLY_CREDITS } from '@/lib/mcp/packages';

const sec = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const YEAR_S = 365 * 24 * 3600;

/** A subscription in the newer API shape (period on the item). */
function sub(interval: 'year' | 'month', periodStartIso: string, extra: Partial<PromoSubscription> = {}): PromoSubscription {
  return {
    status: 'active',
    items: { data: [{ current_period_start: sec(periodStartIso), price: { recurring: { interval } } }] },
    ...extra,
  };
}

/** New York wall-clock date + time for an instant. */
const nyClock = (ms: number) => new Intl.DateTimeFormat('en-CA', {
  timeZone: MINDY_DAY_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).format(ms).replace(',', '');

describe('window edges (America/New_York)', () => {
  it('starts at 00:00 Nov 28 New York time and ends at 00:00 Dec 6 (exclusive)', () => {
    expect(nyClock(MINDY_DAY_WINDOW_START_MS)).toBe(`${MINDY_DAY_FIRST_DAY} 00:00`);
    expect(nyClock(MINDY_DAY_WINDOW_END_MS)).toBe('2026-12-06 00:00');
    expect(nyClock(MINDY_DAY_WINDOW_END_MS - 1).startsWith(MINDY_DAY_LAST_DAY)).toBe(true);
  });

  it('includes the first and last New York moments, excludes one millisecond either side', () => {
    expect(isInMindyDayWindow(MINDY_DAY_WINDOW_START_MS - 1)).toBe(false);
    expect(isInMindyDayWindow(MINDY_DAY_WINDOW_START_MS)).toBe(true);
    expect(isInMindyDayWindow(MINDY_DAY_WINDOW_END_MS - 1)).toBe(true);
    expect(isInMindyDayWindow(MINDY_DAY_WINDOW_END_MS)).toBe(false);
  });

  it('uses New York time, not UTC: Nov 28 02:00 UTC is still Nov 27 in New York', () => {
    expect(isInMindyDayWindow(Date.parse('2026-11-28T02:00:00Z'))).toBe(false);
    expect(isInMindyDayWindow(Date.parse('2026-11-28T05:00:00Z'))).toBe(true);
    // Dec 5 23:30 New York = Dec 6 04:30 UTC: still in.
    expect(isInMindyDayWindow(Date.parse('2026-12-06T04:30:00Z'))).toBe(true);
    expect(isInMindyDayWindow(Date.parse('2026-12-06T05:00:00Z'))).toBe(false);
  });

  it('an annual period starting 23:59 Dec 5 New York counts; 00:00 Dec 6 does not', () => {
    expect(promoMultiplier(sub('year', '2026-12-06T04:59:00Z'))).toBe(2);
    expect(promoMultiplier(sub('year', '2026-12-06T05:00:00Z'))).toBe(1);
    expect(promoMultiplier(sub('year', '2026-11-28T04:59:59Z'))).toBe(1);
    expect(promoMultiplier(sub('year', '2026-11-28T05:00:00Z'))).toBe(2);
  });
});

describe('isMindyDayAnnualPromo / promoMultiplier', () => {
  it('annual, bought inside the window → 2x', () => {
    const s = sub('year', '2026-12-01T15:00:00Z');
    expect(isMindyDayAnnualPromo(s)).toBe(true);
    expect(promoMultiplier(s)).toBe(2);
  });

  it('monthly, even bought inside the window → 1x', () => {
    expect(promoMultiplier(sub('month', '2026-12-01T15:00:00Z'))).toBe(1);
  });

  it('annual started before the window → 1x', () => {
    expect(promoMultiplier(sub('year', '2026-11-20T15:00:00Z'))).toBe(1);
  });

  it('annual started after the window → 1x', () => {
    expect(promoMultiplier(sub('year', '2026-12-10T15:00:00Z'))).toBe(1);
  });

  it('a switcher: an old subscription whose annual period starts in the window → 2x', () => {
    // Monthly since March, switched to annual in the billing portal on Dec 2 (Stripe resets the
    // billing period on an interval change, so the annual period starts on the switch day).
    const s = sub('year', '2026-12-02T18:00:00Z', { trial_start: sec('2026-03-01T00:00:00Z'), trial_end: sec('2026-03-15T00:00:00Z') });
    expect(promoMultiplier(s)).toBe(2);
  });

  it('next year\'s renewal of a promo subscription is outside the window → 1x', () => {
    expect(promoMultiplier(sub('year', new Date((sec('2026-12-01T15:00:00Z') + YEAR_S) * 1000).toISOString()))).toBe(1);
  });

  it('reads the older API shape too (period on the subscription, plan.interval)', () => {
    const s: PromoSubscription = {
      status: 'active', current_period_start: sec('2026-11-29T12:00:00Z'),
      items: { data: [{ plan: { interval: 'year' } }] },
    };
    expect(promoMultiplier(s)).toBe(2);
  });

  it('an annual trial started in the window counts once it is paid (first paid period starts at trial end)', () => {
    const trialStart = sec('2026-11-30T15:00:00Z');
    const trialEnd = trialStart + 14 * 86400; // Dec 14, outside the window
    const s = sub('year', new Date(trialEnd * 1000).toISOString(), { trial_start: trialStart, trial_end: trialEnd });
    expect(promoMultiplier(s)).toBe(2);
  });

  it('an annual trial started AND paid before the window → 1x', () => {
    const ts = sec('2026-11-10T15:00:00Z'); const te = ts + 14 * 86400; // paid Nov 24
    expect(promoMultiplier(sub('year', new Date(te * 1000).toISOString(), { trial_start: ts, trial_end: te }))).toBe(1);
  });

  it('an annual trial started before the window but first PAID inside it → 2x (the payment is a purchase)', () => {
    // Trial Nov 20, ends (or "Upgrade now") Dec 1: the first paid annual period starts Dec 1.
    const ts = sec('2026-11-20T15:00:00Z'); const te = sec('2026-12-01T15:00:00Z');
    expect(promoMultiplier(sub('year', '2026-12-01T15:00:00Z', { trial_start: ts, trial_end: te }))).toBe(2);
  });

  it('an old trial does not pull a later period into the promo (trial must directly precede the period)', () => {
    // Trial Nov 30 – Dec 14 2026, but this is the Dec 14 2027 renewal: not the post-trial period.
    const ts = sec('2026-11-30T15:00:00Z'); const te = ts + 14 * 86400;
    expect(promoMultiplier(sub('year', new Date((te + YEAR_S) * 1000).toISOString(), { trial_start: ts, trial_end: te }))).toBe(1);
  });

  it('no doubling during the trial itself', () => {
    const ts = sec('2026-11-30T15:00:00Z');
    expect(promoMultiplier(sub('year', '2026-11-30T15:00:00Z', { status: 'trialing', trial_start: ts, trial_end: ts + 14 * 86400 }))).toBe(1);
  });

  it('unknown shape → 1x (never guessed into the promo)', () => {
    expect(promoMultiplier(null)).toBe(1);
    expect(promoMultiplier({})).toBe(1);
    expect(promoMultiplier({ status: 'active', items: { data: [{ price: { recurring: { interval: 'year' } } }] } })).toBe(1);
  });
});

describe('applyMindyDayPromo', () => {
  it('only multiplies what would already be granted', () => {
    const promo = sub('year', '2026-12-01T15:00:00Z');
    expect(applyMindyDayPromo(PRO_MONTHLY_CREDITS, promo)).toBe(PRO_MONTHLY_CREDITS * 2);
    expect(applyMindyDayPromo(TEAM_MONTHLY_CREDITS, promo)).toBe(TEAM_MONTHLY_CREDITS * 2);
    expect(applyMindyDayPromo(0, promo)).toBe(0);
    expect(applyMindyDayPromo(PRO_MONTHLY_CREDITS, sub('month', '2026-12-01T15:00:00Z'))).toBe(PRO_MONTHLY_CREDITS);
  });
});

describe('mindyDayPromoLine (pricing copy)', () => {
  const credits = { proCredits: PRO_MONTHLY_CREDITS, teamCredits: TEAM_MONTHLY_CREDITS };

  it('shows inside the window with numbers from the constants', () => {
    const line = mindyDayPromoLine(Date.parse('2026-12-01T15:00:00Z'), credits);
    expect(line).not.toBeNull();
    expect(line).toContain((PRO_MONTHLY_CREDITS * 2).toLocaleString('en-US'));
    expect(line).toContain((TEAM_MONTHLY_CREDITS * 2).toLocaleString('en-US'));
    expect(line).toContain('Dec 5');
  });

  it('follows the constants when they change (e.g. Team raised to 7,500)', () => {
    expect(mindyDayPromoLine(MINDY_DAY_WINDOW_START_MS, { proCredits: 1500, teamCredits: 7500 })).toContain('15,000 on Team');
  });

  it('is hidden before and after the window', () => {
    expect(mindyDayPromoLine(MINDY_DAY_WINDOW_START_MS - 1, credits)).toBeNull();
    expect(mindyDayPromoLine(MINDY_DAY_WINDOW_END_MS, credits)).toBeNull();
  });

  it('uses no superlatives', () => {
    const line = mindyDayPromoLine(MINDY_DAY_WINDOW_START_MS, credits)!;
    expect(line).not.toMatch(/\b(best|biggest|greatest|ultimate|unbeatable|lowest|cheapest|most|ever|amazing|incredible)\b/i);
  });
});
