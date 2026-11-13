import { describe, expect, it, vi } from 'vitest';
vi.mock('@vercel/kv', () => ({ kv: { set: vi.fn(), del: vi.fn() } }));
vi.mock('@/lib/send-email', () => ({ sendEmail: vi.fn() }));
import { dueStep, firstNameOf, readTrialFound, renderTrialStep, trialContextFromSubscription } from './trial-onboarding-emails';
import { renderTrialReminder } from './trial-reminder-email';

const ctx = { email: 'a@b.com', firstName: 'Maria', planLabel: 'Mindy Pro', amountUsd: 149, interval: 'month' as const, trialEnd: new Date('2026-11-26T12:00:00Z') };
const START = new Date('2026-11-12T15:00:00Z');
const at = (days: number, hours = 0) => START.getTime() + days * 86_400_000 + hours * 3_600_000;

describe('dueStep', () => {
  it('sends each step on its day, with one catch-up day', () => {
    expect(dueStep(START, at(0, 5))).toBeNull();
    expect(dueStep(START, at(1))).toBe('day1');
    expect(dueStep(START, at(2))).toBe('day1');
    expect(dueStep(START, at(3))).toBe('day3');
    expect(dueStep(START, at(4))).toBe('day3');
    expect(dueStep(START, at(5))).toBeNull();
    expect(dueStep(START, at(7))).toBe('day7');
    expect(dueStep(START, at(8))).toBe('day7');
    expect(dueStep(START, at(9))).toBeNull();
  });
});

describe('renderTrialStep', () => {
  it('day 0 states the end date and the price', () => {
    const m = renderTrialStep('day0', ctx);
    expect(m.subject).toBe('Welcome to your Mindy Pro trial');
    expect(m.text).toContain('Thursday, November 26');
    expect(m.text).toContain('$149/mo');
    expect(m.html).toContain('Hi Maria,');
  });
  it('day 1 is the setup call and uses the booking link', () => {
    process.env.MINDY_SETUP_CALL_URL = 'https://cal.example/mindy';
    const m = renderTrialStep('day1', ctx);
    expect(m.subject).toContain('15-minute');
    expect(m.html).toContain('https://cal.example/mindy');
    delete process.env.MINDY_SETUP_CALL_URL;
  });
  it('escapes a hostile first name', () => {
    expect(renderTrialStep('day3', { ...ctx, firstName: '<b>x</b>' }).html).not.toContain('<b>x</b>');
  });
});

describe('day 11 reminder', () => {
  it('shows what Mindy found and still states the charge', () => {
    const m = renderTrialReminder({ ...ctx, found: { alertsSent: 10, opportunitiesMatched: 143, pursuitsSaved: 2 } });
    expect(m.subject).toContain('143 opportunities');
    expect(m.text).toContain('Pursuits saved: 2');
    expect(m.text).toContain('$149/mo');
  });
  it('unknown or all-zero numbers fall back to the plain reminder (never a fabricated 0)', () => {
    for (const found of [null, undefined, { alertsSent: 0, opportunitiesMatched: 0, pursuitsSaved: 0 }]) {
      const m = renderTrialReminder({ ...ctx, found });
      expect(m.subject).toBe('Your Mindy Pro trial ends Thursday, November 26, 2026');
      expect(m.html).not.toContain('opportunities matched');
    }
  });
});

describe('trialContextFromSubscription', () => {
  const sub = (o: object = {}) => ({ status: 'trialing', trial_end: 1795000000, metadata: {}, items: { data: [{ price: { id: 'price_x', unit_amount: 14900, recurring: { interval: 'month' } } }] }, ...o });
  it('builds Pro and Team contexts', () => {
    expect(trialContextFromSubscription(sub(), 'a@b.com', 'Jo')).toMatchObject({ planLabel: 'Mindy Pro', amountUsd: 149, interval: 'month' });
    expect(trialContextFromSubscription(sub({ metadata: { tier: 'team_monthly' } }), 'a@b.com')?.planLabel).toBe('Mindy Team');
  });
  it('ignores anything that is not a priced trial', () => {
    expect(trialContextFromSubscription(sub({ status: 'active' }), 'a@b.com')).toBeNull();
    expect(trialContextFromSubscription(sub({ items: { data: [{ price: { unit_amount: 0 } }] } }), 'a@b.com')).toBeNull();
  });
  it('first name from a full name', () => {
    expect(firstNameOf('Maria Colon')).toBe('Maria');
    expect(firstNameOf(undefined)).toBeNull();
  });
});

describe('readTrialFound', () => {
  const sb = (alerts: object, pipeline: object) => ({
    from: (t: string) => {
      const q: Record<string, unknown> = {};
      for (const k of ['select', 'eq', 'gte']) q[k] = () => q;
      q.limit = () => Promise.resolve(alerts);
      if (t === 'user_pipeline') return { select: () => ({ eq: () => ({ gte: () => Promise.resolve(pipeline) }) }) };
      return q;
    },
  });
  it('sums the trial alerts and counts saved pursuits', async () => {
    const r = await readTrialFound(sb({ data: [{ opportunities_count: 12 }, { opportunities_count: 3 }], error: null }, { count: 2, error: null }), 'A@B.com', START);
    expect(r).toEqual({ alertsSent: 2, opportunitiesMatched: 15, pursuitsSaved: 2 });
  });
  it('any read failure → null, not zeros', async () => {
    expect(await readTrialFound(sb({ data: null, error: { message: 'x' } }, { count: 2, error: null }), 'a@b.com', START)).toBeNull();
    expect(await readTrialFound(sb({ data: [], error: null }, { count: null, error: null }), 'a@b.com', START)).toBeNull();
  });
});
