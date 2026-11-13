/**
 * /mcp/pricing hero. Headline (2026-11-13) + the 14-day trial as the hero offer (2026-11-13).
 * Pins: copy, hero order, the CTA reusing the Pro card's existing trial links, a paying account
 * never being sent to checkout, accurate trial terms, and plan cards rendering unchanged.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import UnifiedPricing, { PLANS_FALLBACK, accountPanelUpgrade, heroTrialOffer, suppressTrialCardsForPaid } from './UnifiedPricing';
import { PRO_TRIAL_ANNUAL, PRO_TRIAL_MONTHLY, TEAM_TRIAL_ANNUAL } from './app-plan-links';

const html = renderToStaticMarkup(
  <UnifiedPricing initialTab="mcp" proCredits={1500} teamCredits={7000} signupCredits={100} forecastsLabel="33,000+" faqs={[]} />,
);
const doc = new JSDOM(`<!doctype html><body>${html}</body>`).window.document;
const hero = doc.querySelector('section.promo')!;
const heroText = (hero.textContent ?? '').replace(/ /g, ' ');

describe('/mcp/pricing hero copy', () => {
  it('keeps the approved headline and supporting copy', () => {
    expect(doc.querySelectorAll('h1')).toHaveLength(1);
    expect((doc.querySelector('h1')!.textContent ?? '').replace(/ /g, ' ')).toBe('Federal market intelligence for you and your AI agents.');
    expect(heroText).toContain(
      "Find opportunities, research competitors, track recompetes, and put Mindy's intelligence to work inside Claude, Cursor, and your favorite AI tools.",
    );
  });

  it('shows AI-agent compatibility without overclaiming', () => {
    expect([...hero.querySelectorAll('.agent')].map((a) => a.textContent)).toEqual(['Claude', 'Cursor', 'Any MCP-compatible agent']);
  });

  it('orders the hero: headline, value prop, trial offer, compatibility', () => {
    const order = ['h1', 'p', '.offer', '.agents'].map((sel) => [...hero.children].findIndex((c) => c.matches(sel)));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('removes the duplicate trial line and chips, keeps the referral chip', () => {
    expect(heroText).not.toContain('14-day free trial. No sales call.');
    expect(heroText).not.toContain('14-day free trial on Pro and Team');
    expect(hero.querySelectorAll('.chip')).toHaveLength(1);
    expect(heroText).toContain('Refer a friend — you both get 100 credits');
  });
});

describe('hero trial offer (signed-out render)', () => {
  const offer = hero.querySelector('.offer')!;
  it('renders with the approved copy', () => {
    expect(offer.textContent).toContain('Your federal intelligence team. Free for 14 days.');
    expect(offer.querySelector('.offer-cta')!.textContent).toBe('Start your 14-day free trial');
    expect(offer.textContent).toContain('14 days free · Cancel anytime · No sales call');
  });

  it('CTA is the same existing Pro trial link the Pro card uses (annual is the default view)', () => {
    expect(offer.querySelector('.offer-cta')!.getAttribute('href')).toBe(PRO_TRIAL_ANNUAL);
  });

  it('states the real trial terms', () => {
    expect(heroText).toContain("Mindy Pro. Card required; no charge for 14 days, then $1,490/yr. We remind you before you're charged.");
  });
});

describe('heroTrialOffer eligibility', () => {
  it('signed-out and free accounts get the existing Pro trial link for the selected billing', () => {
    for (const plan of [null, 'free']) {
      expect(heroTrialOffer(plan, true)).toMatchObject({ href: PRO_TRIAL_ANNUAL });
      expect(heroTrialOffer(plan, false)).toMatchObject({ href: PRO_TRIAL_MONTHLY });
    }
    expect(heroTrialOffer(null, false)!.fine).toContain('then $149/mo');
  });

  it('a Pro, Team or Enterprise account gets no trial offer and no checkout link', () => {
    for (const plan of ['pro', 'team', 'enterprise']) {
      expect(heroTrialOffer(plan, true)).toBeNull();
      expect(heroTrialOffer(plan, false)).toBeNull();
    }
  });
});

describe('/mcp/pricing plans unchanged by the hero edit', () => {
  it('cards keep their credits and checkout links', () => {
    const credits = [...doc.querySelectorAll('.credits .main b')].map((b) => b.textContent);
    for (const n of ['500 credits', '3,000 credits', '5,000 credits']) expect(credits).toContain(n);
    const hrefs = new Set([...doc.querySelectorAll('a')].map((a) => a.getAttribute('href')));
    for (const p of PLANS_FALLBACK.filter((x) => x.id !== 'agency')) {
      expect(hrefs.has(p.annual!.checkoutUrl) || hrefs.has(p.monthly.checkoutUrl)).toBe(true);
    }
  });
});

describe('account panel: no competing first-month discount for Free users', () => {
  it('Free (and signed-out) get no upgrade button, so no "25% off first month" on this page', () => {
    expect(accountPanelUpgrade('free')).toBeNull();
    expect(accountPanelUpgrade(null)).toBeNull();
  });
  it('other plans keep their existing panel action', () => {
    expect(accountPanelUpgrade('pro')).toMatchObject({ label: 'Upgrade to Teams', offer: true });
    expect(accountPanelUpgrade('team')).toEqual({ label: 'Add credits', href: '/app?panel=settings&section=credits&tab=billing', offer: false });
    expect(accountPanelUpgrade('enterprise')).toMatchObject({ label: 'Add credits', offer: false });
  });
});

describe('app plan cards: paying accounts are never offered another trial', () => {
  const cards = () => [
    { name: 'Pro', href: PRO_TRIAL_ANNUAL, cta: 'Start for free', pill: '-17%', note: '14 days free…' },
    { name: 'Teams', href: TEAM_TRIAL_ANNUAL, cta: 'Start for free', note: '14 days free…' },
  ];
  it('signed-out and Free keep the trial CTAs untouched', () => {
    expect(suppressTrialCardsForPaid(cards(), null)).toEqual(cards());
    expect(suppressTrialCardsForPaid(cards(), 'free')).toEqual(cards());
  });
  it('Team: the Pro card no longer links to a trial checkout; the current Teams card is untouched', () => {
    const c = cards(); c[1] = { ...c[1], current: true } as typeof c[1];
    const out = suppressTrialCardsForPaid(c, 'team');
    expect(out[0]).toMatchObject({ href: '/app?panel=settings&section=credits&tab=billing', cta: 'Manage your plan', pill: undefined });
    expect(out[1]).toBe(c[1]);
  });
  it('Enterprise and Pro: no card keeps a trial checkout link', () => {
    for (const plan of ['enterprise', 'pro']) {
      const out = suppressTrialCardsForPaid(cards(), plan);
      expect(out.some((x) => /buy\.stripe\.com/.test(x.href))).toBe(false);
    }
  });
});
