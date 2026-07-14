/**
 * Re-point a customer's Stripe email old→new as part of a change-email.
 *
 * Billing must follow the login, or the user's receipts + the webhook's
 * email-keyed provisioning drift onto the dead address. Called by the
 * change-email confirm route AFTER reKeyAccountEmail moves the app data.
 *
 * Gotcha (observed on the Keidra/Egan Rose ticket 2026-07-13): a single email
 * can map to MORE THAN ONE Stripe customer (she had two on hello@ — one with the
 * active sub, one legacy). So we update ALL customers on the old email, not the
 * first. Fail-soft: a Stripe hiccup must not abort the whole re-key (the app
 * data already moved); the caller logs + can retry this step alone.
 */

import { getStripe, hasStripe } from '@/lib/stripe';

export interface StripeReKeyResult {
  ok: boolean;
  updated: string[]; // customer ids re-pointed
  error?: string;
  skipped?: boolean;
}

function normalize(email: string): string {
  return (email || '').toLowerCase().trim();
}

export async function updateStripeCustomerEmail(
  oldEmailRaw: string,
  newEmailRaw: string
): Promise<StripeReKeyResult> {
  const oldEmail = normalize(oldEmailRaw);
  const newEmail = normalize(newEmailRaw);

  if (!hasStripe()) {
    return { ok: true, updated: [], skipped: true, error: 'Stripe not configured' };
  }
  if (!oldEmail || !newEmail || oldEmail === newEmail) {
    return { ok: false, updated: [], error: 'Both emails required and must differ' };
  }

  try {
    const stripe = getStripe();
    // ALL customers on the old email (not limit:1 — dup customers are real).
    const customers = await stripe.customers.list({ email: oldEmail, limit: 100 });
    const updated: string[] = [];
    for (const c of customers.data) {
      // Idempotent: skip any already on the new email (resume-safe).
      if (normalize(c.email || '') === newEmail) continue;
      await stripe.customers.update(c.id, { email: newEmail });
      updated.push(c.id);
    }
    return { ok: true, updated };
  } catch (err) {
    return { ok: false, updated: [], error: err instanceof Error ? err.message : 'stripe error' };
  }
}
