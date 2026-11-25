// @vitest-environment jsdom
/**
 * Team seat card on /pricing (owner mockup 2026-11-25) — DISPLAY ONLY, PROPOSED, behind
 * NEXT_PUBLIC_TEAM_SEAT_PRICING === 'on'.
 *
 *  1. OFF = unchanged: the rendered page is byte-identical to the component on origin/main
 *     (fixture captured from main before this change, same props as below).
 *  2. Config: two sizes, $249 / $599 display labels equal to the held billing proposal, checkout
 *     EMPTY so the buttons go to contact sales, no credit allowance anywhere.
 *  3. ON: the mockup's header, Team card, toggle (radiogroup), footer; the toggle switches price,
 *     button and first feature, by click and by arrow key.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import SimplePricing, { type CreditPlan } from './SimplePricing';
import { SALES_URL } from './app-plan-links';
import {
  TEAM_SEAT_PRICING, isTeamSeatPricingEnabled, teamSeatCtaHref, teamSeatOption, teamSeatTakesPayment,
} from '@/lib/public-site/team-seat-pricing';
import { teamSeatPlan } from '@/lib/billing/team-seat-plans';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Same props the fixture was captured with.
const creditPlans: CreditPlan[] = [{ id: 'starter', label: 'Starter', credits: 500, monthlyUsd: 49, monthlyHref: 'https://example.test/m', annualPerMonthUsd: 41, annualHref: 'https://example.test/a' }];
const page = () => <SimplePricing proCredits={1500} teamCredits={1000} forecastsLabel="33,000+" faqs={[{ q: 'Q?', a: 'A.' }]} creditPlans={creditPlans} />;
const render = () => renderToStaticMarkup(page());
const parse = (html: string) => {
  const d = document.implementation.createHTMLDocument('t');
  d.body.innerHTML = html;
  return d;
};
const teamCard = (root: ParentNode) => [...root.querySelectorAll('article.card')].find((a) => a.querySelector('h2')?.textContent?.startsWith('Team'))!;
const proCard = (root: ParentNode) => [...root.querySelectorAll('article.card')].find((a) => a.querySelector('h2')?.textContent?.startsWith('Pro'))!;

afterEach(() => { vi.unstubAllEnvs(); });

describe('/pricing with the seat switch OFF renders exactly as today', () => {
  const fixture = readFileSync(join(__dirname, '__fixtures__/simple-pricing-off.main.html'), 'utf8').trimEnd();

  it('is byte-identical to the origin/main component when the variable is unset', () => {
    vi.stubEnv('NEXT_PUBLIC_TEAM_SEAT_PRICING', '');
    expect(isTeamSeatPricingEnabled()).toBe(false);
    expect(render()).toBe(fixture);
  });

  it.each(['true', 'ON', '1', 'yes'])('stays off for %j (only the exact value "on" turns it on)', (v) => {
    vi.stubEnv('NEXT_PUBLIC_TEAM_SEAT_PRICING', v);
    expect(isTeamSeatPricingEnabled()).toBe(false);
    expect(render()).toBe(fixture);
  });
});

describe('team seat display config (PROPOSED, display only)', () => {
  it('offers 2, 3, 4 and 5 users, 2 by default, at $249 / $366 / $482 / $599', () => {
    expect(TEAM_SEAT_PRICING.options.map((o) => [o.id, o.seats, o.label, o.monthlyUsd, o.cta])).toEqual([
      ['2', 2, '2 users', 249, 'Start with 2 seats'],
      ['3', 3, '3 users', 366, 'Start with 3 seats'],
      ['4', 4, '4 users', 482, 'Start with 4 seats'],
      ['5', 5, '5 users', 599, 'Start with 5 seats'],
    ]);
    expect(TEAM_SEAT_PRICING.defaultOption).toBe('2');
    expect(teamSeatOption('nope').id).toBe('2');
  });

  it('keeps the labels equal to the held billing proposal, so the two cannot drift', () => {
    for (const o of TEAM_SEAT_PRICING.options) expect(teamSeatPlan(o.seats)?.monthlyUsd).toBe(o.monthlyUsd);
  });

  it('has no checkout yet: every button goes to contact sales and takes no money', () => {
    for (const o of TEAM_SEAT_PRICING.options) {
      expect(o.checkoutUrl).toBe('');
      expect(teamSeatCtaHref(o)).toBe(SALES_URL);
      expect(teamSeatTakesPayment(o)).toBe(false);
    }
  });

  it('uses a checkout only once one is filled in', () => {
    const o = { ...teamSeatOption('5'), checkoutUrl: '/api/checkout/team-seats?seats=5&billing=monthly' };
    expect(teamSeatCtaHref(o)).toBe('/api/checkout/team-seats?seats=5&billing=monthly');
    expect(teamSeatTakesPayment(o)).toBe(true);
    expect(teamSeatCtaHref({ ...o, checkoutUrl: '   ' })).toBe(SALES_URL);
  });

  it('carries no credit allowance (none is approved)', () => {
    expect(JSON.stringify(TEAM_SEAT_PRICING)).not.toMatch(/credit/i);
  });
});

describe('/pricing with the seat switch ON (server render)', () => {
  let doc: Document;
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_TEAM_SEAT_PRICING', 'on');
    doc = parse(render());
  });

  it('shows the mockup header and footer, monthly only', () => {
    const h = doc.querySelector('[data-testid="seat-pricing-header"]')!;
    expect(h.querySelector('h1')?.textContent).toBe('Pricing');
    expect(h.textContent).toContain('Monthly. Annual plans include training and onboarding.');
    expect(doc.querySelector('[aria-label="Billing period"]')).toBeNull();
    const foot = doc.querySelector('.seat-foot')!;
    expect(foot.textContent).toBe('Questions about a rollout: hello@getmindy.ai');
    expect(foot.querySelector('a')?.getAttribute('href')).toBe('mailto:hello@getmindy.ai');
  });

  it('moves "Most popular" and the highlighted border from Pro to Team', () => {
    expect(teamCard(doc).classList.contains('featured')).toBe(true);
    expect(teamCard(doc).querySelector('.pop')?.textContent).toBe('Most popular');
    expect(proCard(doc).classList.contains('featured')).toBe(false);
    expect(proCard(doc).querySelector('.pop')).toBeNull();
    expect(doc.querySelectorAll('.pop')).toHaveLength(1);
  });

  it('server-renders 2 users in an accessible radio group', () => {
    const group = teamCard(doc).querySelector('[role="radiogroup"]')!;
    expect(group.getAttribute('aria-label')).toBe('Team size');
    const radios = [...group.querySelectorAll('[role="radio"]')];
    expect(radios.map((r) => [r.textContent, r.getAttribute('aria-checked'), r.getAttribute('tabindex')])).toEqual([
      ['2 users', 'true', '0'], ['3 users', 'false', '-1'], ['4 users', 'false', '-1'], ['5 users', 'false', '-1'],
    ]);
  });

  it('renders the 2-user Team card from the mockup, button to sales, no trial or refund line', () => {
    const t = teamCard(doc);
    expect(t.querySelector('.price .now')?.textContent).toBe('$249');
    expect(t.querySelector('.per')?.textContent).toBe('/ mo, billed monthly. Add seats any time.');
    const cta = t.querySelector('a.cta')!;
    expect(cta.textContent).toBe('Start with 2 seats');
    expect(cta.getAttribute('href')).toBe(SALES_URL);
    expect(t.querySelector('.trial')).toBeNull();
    expect(t.querySelector('[data-no-refund-note]')).toBeNull();
    expect(t.querySelector('.lead')?.textContent).toBe('Win more as a team.');
    expect(t.querySelector('.base')?.textContent).toBe('All Pro features, plus');
    expect([...t.querySelectorAll('li b')].map((b) => b.textContent)).toEqual([
      '2 users included', 'Everyone gets their own alerts', 'Shared pipeline', 'Team dashboard and roles',
    ]);
    expect(t.textContent).toContain('Add up to 5 as the team grows, at any time.');
  });

  it('never shows a credit number for Team (unknown is never zero)', () => {
    const t = teamCard(doc);
    expect(t.querySelector('.usage')).toBeNull();
    expect(t.textContent).not.toMatch(/credit/i);
    const table = doc.querySelector('section.cmp table')!;
    const row = [...table.querySelectorAll('tr')].find((r) => r.querySelector('th')?.textContent === 'Monthly credits')!;
    expect([...row.querySelectorAll('td')].map((c) => c.textContent)).toEqual(['1,500', 'To be confirmed', 'Custom']);
  });

  it('keeps Pro and Enterprise copy as live', () => {
    expect(proCard(doc).querySelector('.tag')?.textContent).toBe('For solo contractors and small firms going after federal work.');
    expect(proCard(doc).querySelector('a.cta')?.textContent).toBe('Start free trial');
    expect(doc.body.textContent).toContain('For large prime contractors, APEX Accelerators');
  });

  it('keeps the plain-words rule (no BD / primes jargon)', () => {
    const all = doc.body.textContent ?? '';
    for (const phrase of ['BD team', 'For primes,', 'with the incumbent.', 'for your NAICS, keywords and agencies']) {
      expect(all, phrase).not.toContain(phrase);
    }
  });
});

describe('/pricing seat toggle (client)', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(async () => {
    vi.stubEnv('NEXT_PUBLIC_TEAM_SEAT_PRICING', 'on');
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root.render(page()); });
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); });

  const radio = (label: string) => [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((r) => r.textContent === label)!;
  const state = () => {
    const t = teamCard(host);
    return {
      price: t.querySelector('.price .now')?.textContent,
      cta: t.querySelector('a.cta')?.textContent,
      href: t.querySelector('a.cta')?.getAttribute('href'),
      first: t.querySelector('li b')?.textContent,
      firstDetail: t.querySelector('li small')?.textContent,
      checked: radio('5 users').getAttribute('aria-checked'),
    };
  };

  it('switches price, button and first feature to 5 users and back', async () => {
    expect(state()).toMatchObject({ price: '$249', cta: 'Start with 2 seats', first: '2 users included', checked: 'false' });
    await act(async () => { radio('5 users').click(); });
    expect(state()).toEqual({
      price: '$599', cta: 'Start with 5 seats', href: SALES_URL,
      first: '5 users included', firstDetail: 'Room for the whole business development team on one plan.', checked: 'true',
    });
    expect([...teamCard(host).querySelectorAll('li b')].slice(1).map((b) => b.textContent)).toEqual([
      'Everyone gets their own alerts', 'Shared pipeline', 'Team dashboard and roles',
    ]);
    await act(async () => { radio('2 users').click(); });
    expect(state()).toMatchObject({ price: '$249', cta: 'Start with 2 seats', first: '2 users included', checked: 'false' });
  });

  it('moves with the arrow keys and keeps focus on the selected option', async () => {
    radio('2 users').focus();
    await act(async () => { radio('2 users').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); });
    expect(state().price).toBe('$366');
    expect(document.activeElement?.textContent).toBe('3 users');
    expect(radio('3 users').tabIndex).toBe(0);
    expect(radio('2 users').tabIndex).toBe(-1);
    await act(async () => { radio('3 users').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); });
    expect(state().price).toBe('$249');
    // wraps from first to last
    await act(async () => { radio('2 users').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); });
    expect(state().price).toBe('$599');
  });

  it('only changes the Team card (Pro and Enterprise stay put)', async () => {
    const before = [proCard(host).outerHTML, host.querySelectorAll('article.card')[2].outerHTML];
    await act(async () => { radio('5 users').click(); });
    expect([proCard(host).outerHTML, host.querySelectorAll('article.card')[2].outerHTML]).toEqual(before);
  });
});
