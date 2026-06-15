/**
 * Purchase attribution (Mindy / getmindy.ai side).
 *
 * Writes to the SAME shared Upstash store as govcon-funnels using an IDENTICAL
 * key format, so the unified /admin/purchases dashboard (hosted on
 * govcongiants.com) reads sales from both properties. This copy is backed by
 * @vercel/kv (already a dependency here) instead of @upstash/redis; the wire
 * format and key layout match the govcon-funnels lib exactly.
 *
 * Keep this file's key builder + index-member format in sync with
 * govcon-funnels/src/lib/purchase-attribution.ts.
 */
import { kv } from '@vercel/kv';

const NS = 'gfd:purchase';
export const ATTR_COOKIE = 'gca_attr';

// This deployment represents getmindy.ai.
export const SITE = process.env.PURCHASE_SITE || 'mindy';

export type CheckoutProduct = {
  id: string;
  name: string;
  priceLabel: string;
  amountCents?: number;
  checkoutUrl: string;
  type: 'stripe_payment_link' | 'external';
};

// Mindy Pro + Team checkout targets. Pro monthly/annual are live Stripe payment
// links; the IDs match the govcon-funnels map so cross-site product rollups
// aggregate cleanly.
export const CHECKOUT_PRODUCTS: Record<string, CheckoutProduct> = {
  'mindy-pro-monthly': {
    id: 'mindy-pro-monthly',
    name: 'Mindy Pro Monthly',
    priceLabel: '$149/mo',
    amountCents: 14900,
    checkoutUrl: 'https://buy.stripe.com/dRmfZi9UO3MS20RdpefnO0C',
    type: 'stripe_payment_link',
  },
  'mindy-pro-annual': {
    id: 'mindy-pro-annual',
    name: 'Mindy Pro Annual',
    priceLabel: '$1,490/yr',
    amountCents: 149000,
    checkoutUrl: 'https://buy.stripe.com/eVqfZi5Eydns0WNgBqfnO0D',
    type: 'stripe_payment_link',
  },
  // Founders Lifetime $4,997 — capped founding cohort (100 seats). Same product
  // as bootcamp lifetime; grants briefings_lifetime. Matches historical course
  // lifetime price ($4,997). Stripe setup: see STRIPE-PRODUCTS.md.
  'founders-lifetime': {
    id: 'founders-lifetime',
    name: 'Mindy Founders Lifetime',
    priceLabel: '$4,997 one-time',
    amountCents: 499700,
    checkoutUrl: 'https://buy.stripe.com/28E00k6IC5V0fRH5WMfnO0G',
    type: 'stripe_payment_link',
  },
  // Bootcamp special $2,997 — time-boxed (Jun 27 bootcamp). Mindy lifetime only
  // (Ultimate Giant Bundle retired). Create Stripe Payment Link with
  // metadata tier=briefings_lifetime — see STRIPE-PRODUCTS.md.
  'bootcamp-lifetime': {
    id: 'bootcamp-lifetime',
    name: 'Mindy Lifetime — Bootcamp Special',
    priceLabel: '$2,997 one-time',
    amountCents: 299700,
    checkoutUrl: 'https://buy.stripe.com/8x29AU4Au0AG34VfxmfnO0H',
    type: 'stripe_payment_link',
  },
  // Alias — older /lifetime page links and docs.
  'mindy-lifetime': {
    id: 'bootcamp-lifetime',
    name: 'Mindy Lifetime — Bootcamp Special',
    priceLabel: '$2,997 one-time',
    amountCents: 299700,
    checkoutUrl: 'https://buy.stripe.com/8x29AU4Au0AG34VfxmfnO0H',
    type: 'stripe_payment_link',
  },
};

export type AttributionTouch = {
  url?: string;
  path?: string;
  referrer?: string;
  captured_at?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  gclid?: string;
  fbclid?: string;
  msclkid?: string;
};

export type AttributionState = {
  first_touch?: AttributionTouch;
  last_touch?: AttributionTouch;
  visit_count?: number;
  /** Partner referral code e.g. NCMBC — flows to Stripe checkout attribution */
  partner_code?: string;
  partner_slug?: string;
};

export type CheckoutStart = {
  id: string;
  product_id: string;
  product_name: string;
  product_price: string;
  amount_cents?: number;
  checkout_type: CheckoutProduct['type'];
  status: 'started' | 'completed' | 'failed';
  created_at: string;
  updated_at: string;
  source_url: string;
  attribution: AttributionState;
};

export type PurchaseRecord = {
  id: string;
  site?: string;
  event_id: string;
  event_type: string;
  status: 'paid' | 'failed' | 'open' | 'unknown';
  product_id: string;
  product_name: string;
  product_price?: string;
  amount_cents?: number;
  currency?: string;
  customer_email?: string;
  customer_name?: string;
  stripe_checkout_session_id?: string;
  stripe_payment_intent_id?: string;
  stripe_customer_id?: string;
  attribution_id?: string;
  attribution?: AttributionState;
  created_at: string;
  raw_created?: number;
};

const key = {
  checkout: (id: string) => `${NS}:${SITE}:checkout:${id}`,
  purchase: (site: string, id: string) => `${NS}:${site}:purchase:${id}`,
  purchases: () => `${NS}:purchases`,
};

export function parseAttributionCookie(raw: string | undefined | null): AttributionState {
  if (!raw) return {};
  try {
    return JSON.parse(decodeURIComponent(raw)) as AttributionState;
  } catch {
    try {
      return JSON.parse(raw) as AttributionState;
    } catch {
      return {};
    }
  }
}

export function buildStripeRedirectUrl(product: CheckoutProduct, attributionId: string): string {
  const url = new URL(product.checkoutUrl);
  url.searchParams.set('client_reference_id', attributionId);
  url.searchParams.set('gcaid', attributionId);
  return url.toString();
}

export async function createCheckoutStart(args: {
  product: CheckoutProduct;
  sourceUrl: string;
  attribution: AttributionState;
}): Promise<CheckoutStart> {
  const now = new Date().toISOString();
  const record: CheckoutStart = {
    id: crypto.randomUUID(),
    product_id: args.product.id,
    product_name: args.product.name,
    product_price: args.product.priceLabel,
    amount_cents: args.product.amountCents,
    checkout_type: args.product.type,
    status: 'started',
    created_at: now,
    updated_at: now,
    source_url: args.sourceUrl,
    attribution: args.attribution,
  };

  await kv.set(key.checkout(record.id), record, { ex: 180 * 24 * 60 * 60 });
  return record;
}

export async function getCheckoutStart(id: string | undefined | null): Promise<CheckoutStart | null> {
  if (!id) return null;
  return kv.get<CheckoutStart>(key.checkout(id));
}

export async function savePurchase(record: PurchaseRecord): Promise<void> {
  const site = record.site || SITE;
  const stamped: PurchaseRecord = { ...record, site };
  await kv.set(key.purchase(site, stamped.id), stamped);
  await kv.sadd(key.purchases(), `${site}:${stamped.id}`);
}
