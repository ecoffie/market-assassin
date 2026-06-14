/**
 * Lazy Stripe client.
 *
 * Several admin/billing routes used to do `const stripe = new Stripe(
 * process.env.STRIPE_SECRET_KEY!, ...)` at MODULE scope. When the Vercel BUILD
 * environment doesn't have STRIPE_SECRET_KEY, that line runs during Next's
 * page-data collection and throws — failing the whole build on an unrelated
 * route (observed repeatedly: backfill-stripe / mi-onboarding).
 *
 * getStripe() defers instantiation to REQUEST time, so the build never executes
 * it. Cached after first use. Throws a clear error (not a cryptic Stripe one)
 * only if actually called without a key.
 */
import Stripe from 'stripe';

const API_VERSION = '2025-01-27.acacia' as Stripe.LatestApiVersion;

let _stripe: Stripe | null = null;

/** Get the shared Stripe client, instantiating lazily on first call. */
export function getStripe(): Stripe {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error('STRIPE_SECRET_KEY is not set — Stripe operations are unavailable.');
  }
  _stripe = new Stripe(key, { apiVersion: API_VERSION });
  return _stripe;
}

/** True if a Stripe key is configured (for routes that want to degrade gracefully). */
export function hasStripe(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}
