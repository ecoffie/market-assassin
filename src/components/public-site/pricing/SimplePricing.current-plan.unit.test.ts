import { describe, expect, it } from 'vitest';
import { applyCurrentPlan } from './SimplePricing';

type P = Parameters<typeof applyCurrentPlan>[0][number];
const plan = (name: string, extra: Partial<P> = {}): P => ({
  name, tag: '', price: '$1', per: '', trial: name !== 'Enterprise', cta: 'Start 14-day trial',
  href: `https://buy.stripe.com/${name}`, lead: '', base: '', features: [], usage: ['', ''], ...extra,
} as P);
const plans = [plan('Pro'), plan('Team'), plan('Enterprise', { cta: 'Speak to sales', href: '/contact-sales' })];

describe('applyCurrentPlan', () => {
  it('leaves the page unchanged for signed-out and free users', () => {
    expect(applyCurrentPlan(plans, null)).toEqual(plans);
    expect(applyCurrentPlan(plans, 'free')).toEqual(plans);
  });
  it('marks Pro as current and offers an upgrade to Team, never a trial', () => {
    const [pro, team, ent] = applyCurrentPlan(plans, 'pro');
    expect(pro.current).toBe(true);
    expect(team.cta).toBe('Upgrade to Team');
    expect(team.trial).toBe(false);
    expect(team.href).not.toMatch(/stripe/);
    expect(ent.cta).toBe('Speak to sales');
  });
  it('marks Team as current; Pro becomes Manage your plan', () => {
    const [pro, team] = applyCurrentPlan(plans, 'team');
    expect(team.current).toBe(true);
    expect(pro.cta).toBe('Manage your plan');
    expect(pro.href).not.toMatch(/stripe/);
  });
});
