/**
 * Mindy's own trial checkout (2026-11-17) — a branded page on getmindy.ai instead of Stripe's hosted
 * page, built on Stripe Checkout Sessions with `ui_mode: 'custom'` (Stripe's Payment Element on our
 * page). Card data never touches our servers: it goes from Stripe's iframe straight to Stripe.
 *
 * The EXISTING trial payment links stay the single source of truth. Each session copies, from the
 * link the pricing page already uses:
 *   - the price (line item),
 *   - the trial length (`subscription_data.trial_period_days`),
 *   - the link's metadata (it carries `tier`, which the webhook reads on a $0 trial checkout) and
 *     the subscription metadata,
 *   - the after-payment redirect (so the post-purchase flow does not change).
 * So `checkout.session.completed` arrives with the same line item, metadata and customer email as a
 * payment-link checkout, and the webhook provisions it the same way. When anything here is missing
 * (no publishable key, the link cannot be read) the caller falls back to the payment link itself.
 */
import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';
import {
  PRO_TRIAL_ANNUAL, PRO_TRIAL_MONTHLY, TEAM_TRIAL_ANNUAL, TEAM_TRIAL_MONTHLY,
} from '@/components/public-site/pricing/app-plan-links';

export type TrialPlan = 'pro' | 'team';
export type TrialCycle = 'monthly' | 'annual';

/** The API version Stripe's browser SDK (@stripe/stripe-js 8.x) speaks for custom checkout. */
export const CUSTOM_CHECKOUT_API_VERSION = '2025-12-15.clover' as Stripe.LatestApiVersion;

export const TRIAL_LINKS: Readonly<Record<TrialPlan, Record<TrialCycle, string>>> = {
  pro: { monthly: PRO_TRIAL_MONTHLY, annual: PRO_TRIAL_ANNUAL },
  team: { monthly: TEAM_TRIAL_MONTHLY, annual: TEAM_TRIAL_ANNUAL },
};

export function parsePlan(v: unknown): TrialPlan { return v === 'team' ? 'team' : 'pro'; }
export function parseCycle(v: unknown): TrialCycle { return v === 'annual' ? 'annual' : 'monthly'; }

/** The hosted payment link for a plan — the fallback whenever our own page cannot run. */
export function fallbackLink(plan: TrialPlan, cycle: TrialCycle): string {
  return TRIAL_LINKS[plan][cycle];
}

export interface LinkTerms {
  paymentLinkId: string;
  priceId: string;
  trialDays: number | null;
  metadata: Record<string, string>;
  subscriptionMetadata: Record<string, string>;
  redirectUrl: string | null;
  productName: string;
  unitAmount: number | null;
  currency: string;
  interval: string | null;
}

const CACHE_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; terms: LinkTerms }>();

/** Read a payment link's terms (price, trial, metadata, redirect) by its public URL. Cached 10 min. */
export async function readLinkTerms(url: string, stripe: Stripe = getStripe()): Promise<LinkTerms | null> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.terms;

  let found: Stripe.PaymentLink | null = null;
  for await (const pl of stripe.paymentLinks.list({ active: true, limit: 100 })) {
    if (pl.url === url) { found = pl; break; }
  }
  if (!found) return null;

  const items = await stripe.paymentLinks.listLineItems(found.id, { limit: 1, expand: ['data.price.product'] });
  const item = items.data[0];
  const price = item?.price;
  if (!price?.id) return null;
  const product = typeof price.product === 'object' && price.product && !('deleted' in price.product && price.product.deleted)
    ? (price.product as Stripe.Product) : null;

  const terms: LinkTerms = {
    paymentLinkId: found.id,
    priceId: price.id,
    trialDays: found.subscription_data?.trial_period_days ?? null,
    metadata: { ...(found.metadata || {}) },
    subscriptionMetadata: { ...(found.subscription_data?.metadata || {}) },
    redirectUrl: found.after_completion?.type === 'redirect' ? found.after_completion.redirect?.url || null : null,
    productName: product?.name || item?.description || 'Mindy',
    unitAmount: price.unit_amount ?? null,
    currency: price.currency || 'usd',
    interval: price.recurring?.interval ?? null,
  };
  cache.set(url, { at: Date.now(), terms });
  return terms;
}

export interface TrialSessionInput {
  plan: TrialPlan;
  cycle: TrialCycle;
  origin: string;
  email?: string | null;
  clientReferenceId?: string | null;
  source?: string | null;
}

/** Stripe's return URL: the link's own redirect when it has one, else our welcome page. */
export function returnUrlFor(terms: Pick<LinkTerms, 'redirectUrl'>, origin: string): string {
  const own = `${origin}/start-trial/welcome?session_id={CHECKOUT_SESSION_ID}`;
  const r = terms.redirectUrl;
  if (!r) return own;
  if (r.includes('{CHECKOUT_SESSION_ID}')) return r;
  return `${r}${r.includes('?') ? '&' : '?'}session_id={CHECKOUT_SESSION_ID}`;
}

/** The session params — pure, so the mapping from the link is unit-tested. */
export function buildSessionParams(terms: LinkTerms, input: TrialSessionInput): Stripe.Checkout.SessionCreateParams {
  const rawEmail = (input.email || '').trim().toLowerCase();
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail) ? rawEmail : undefined;
  return {
    ui_mode: 'custom',
    mode: 'subscription',
    line_items: [{ price: terms.priceId, quantity: 1 }],
    payment_method_collection: 'always',
    subscription_data: {
      ...(terms.trialDays ? { trial_period_days: terms.trialDays } : {}),
      metadata: { ...terms.subscriptionMetadata },
    },
    metadata: {
      ...terms.metadata,
      checkout_source: 'mindy_trial_checkout',
      payment_link: terms.paymentLinkId,
      plan: input.plan,
      cycle: input.cycle,
      ...(input.source ? { entry: input.source.slice(0, 60) } : {}),
    },
    ...(input.clientReferenceId ? { client_reference_id: input.clientReferenceId.slice(0, 200) } : {}),
    ...(email ? { customer_email: email } : {}),
    return_url: returnUrlFor(terms, input.origin),
  };
}

export interface TrialSessionResult {
  clientSecret: string;
  summary: {
    plan: TrialPlan;
    cycle: TrialCycle;
    productName: string;
    amount: number | null; // in dollars
    currency: string;
    interval: string | null;
    trialDays: number | null;
  };
}

export async function createTrialSession(input: TrialSessionInput, stripe: Stripe = getStripe()): Promise<TrialSessionResult | null> {
  const terms = await readLinkTerms(fallbackLink(input.plan, input.cycle), stripe);
  if (!terms) return null;
  const session = await stripe.checkout.sessions.create(buildSessionParams(terms, input), { apiVersion: CUSTOM_CHECKOUT_API_VERSION });
  if (!session.client_secret) return null;
  return {
    clientSecret: session.client_secret,
    summary: {
      plan: input.plan,
      cycle: input.cycle,
      productName: terms.productName,
      amount: terms.unitAmount != null ? terms.unitAmount / 100 : null,
      currency: terms.currency,
      interval: terms.interval,
      trialDays: terms.trialDays,
    },
  };
}
