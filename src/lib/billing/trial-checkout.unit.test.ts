/**
 * Mindy's own trial checkout: the session must copy the plan's payment link (price, trial,
 * metadata incl. tier, redirect) so the webhook provisions it exactly like a payment-link checkout.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/stripe', () => ({ getStripe: () => { throw new Error('no stripe in tests'); } }));

import {
  buildSessionParams, fallbackLink, parseCycle, parsePlan, readLinkTerms, returnUrlFor, TRIAL_LINKS, type LinkTerms,
} from './trial-checkout';
import { trialBannerHref } from '@/components/app/TrialOfferBanner';
import { trialCheckoutHref, TRIAL_CHECKOUT_HREFS } from '@/components/public-site/pricing/app-plan-links';

const terms: LinkTerms = {
  paymentLinkId: 'plink_123', priceId: 'price_pro_m', trialDays: 14,
  metadata: { tier: 'briefings' }, subscriptionMetadata: { tier: 'briefings', plan: 'pro' },
  redirectUrl: null, productName: 'Mindy Pro', unitAmount: 14900, currency: 'usd', interval: 'month',
};

describe('session params copy the payment link', () => {
  const p = buildSessionParams(terms, { plan: 'pro', cycle: 'monthly', origin: 'https://getmindy.ai', email: ' Buyer@Example.com ', clientReferenceId: 'attr-1', source: 'app_banner' });
  it('custom UI, subscription, the link price, card always collected', () => {
    expect(p).toMatchObject({ ui_mode: 'custom', mode: 'subscription', payment_method_collection: 'always', line_items: [{ price: 'price_pro_m', quantity: 1 }] });
  });
  it('same trial length and subscription metadata as the link', () => {
    expect(p.subscription_data).toEqual({ trial_period_days: 14, metadata: { tier: 'briefings', plan: 'pro' } });
  });
  it('keeps the link metadata (tier) and labels the source', () => {
    expect(p.metadata).toMatchObject({ tier: 'briefings', checkout_source: 'mindy_trial_checkout', payment_link: 'plink_123', plan: 'pro', cycle: 'monthly', entry: 'app_banner' });
  });
  it('attribution id + normalized email', () => {
    expect(p.client_reference_id).toBe('attr-1');
    expect(p.customer_email).toBe('buyer@example.com');
    expect(buildSessionParams(terms, { plan: 'pro', cycle: 'monthly', origin: 'x', email: 'not-an-email' }).customer_email).toBeUndefined();
  });
  it('no trial on the link → no trial invented', () => {
    expect(buildSessionParams({ ...terms, trialDays: null }, { plan: 'pro', cycle: 'monthly', origin: 'x' }).subscription_data).toEqual({ metadata: terms.subscriptionMetadata });
  });
});

describe('return URL', () => {
  it('our welcome page when the link has no redirect', () => {
    expect(returnUrlFor({ redirectUrl: null }, 'https://getmindy.ai')).toBe('https://getmindy.ai/start-trial/welcome?session_id={CHECKOUT_SESSION_ID}');
  });
  it("the link's own redirect, with the session id", () => {
    expect(returnUrlFor({ redirectUrl: 'https://getmindy.ai/app?welcome=1' }, 'x')).toBe('https://getmindy.ai/app?welcome=1&session_id={CHECKOUT_SESSION_ID}');
    expect(returnUrlFor({ redirectUrl: 'https://getmindy.ai/w?s={CHECKOUT_SESSION_ID}' }, 'x')).toBe('https://getmindy.ai/w?s={CHECKOUT_SESSION_ID}');
  });
});

describe('reading the payment link', () => {
  it('finds the link by URL and reads price, trial, metadata, redirect', async () => {
    const url = TRIAL_LINKS.pro.monthly;
    const stripe = {
      paymentLinks: {
        list: () => (async function* () {
          yield { id: 'plink_other', url: 'https://buy.stripe.com/other' };
          yield { id: 'plink_pro', url, metadata: { tier: 'briefings' }, subscription_data: { trial_period_days: 14, metadata: { tier: 'briefings' } }, after_completion: { type: 'redirect', redirect: { url: 'https://getmindy.ai/app' } } };
        })(),
        listLineItems: async () => ({ data: [{ description: 'Mindy Pro', price: { id: 'price_x', unit_amount: 14900, currency: 'usd', recurring: { interval: 'month' }, product: { name: 'Mindy Pro' } } }] }),
      },
    };
    const t = await readLinkTerms(url, stripe as never);
    expect(t).toMatchObject({ paymentLinkId: 'plink_pro', priceId: 'price_x', trialDays: 14, metadata: { tier: 'briefings' }, redirectUrl: 'https://getmindy.ai/app', productName: 'Mindy Pro', unitAmount: 14900 });
  });
  it('an unknown link → null (caller falls back to the hosted page)', async () => {
    const stripe = { paymentLinks: { list: () => (async function* () { /* none */ })(), listLineItems: async () => ({ data: [] }) } };
    expect(await readLinkTerms('https://buy.stripe.com/none', stripe as never)).toBeNull();
  });
});

describe('links into the checkout', () => {
  it('plan/cycle parsing defaults to Pro monthly', () => {
    expect([parsePlan('team'), parsePlan('x'), parseCycle('annual'), parseCycle(undefined)]).toEqual(['team', 'pro', 'annual', 'monthly']);
    expect(fallbackLink('team', 'annual')).toBe(TRIAL_LINKS.team.annual);
  });
  it('pricing and banner hrefs', () => {
    expect(trialCheckoutHref('pro', 'annual')).toBe('/start-trial?plan=pro&cycle=annual');
    expect(TRIAL_CHECKOUT_HREFS).toHaveLength(4);
    expect(trialBannerHref('a+b@x.com')).toBe('/start-trial?plan=pro&cycle=monthly&src=app_banner&email=a%2Bb%40x.com');
  });
});
