import type Stripe from 'stripe';

/**
 * Resolve THE Stripe customer for an email, when several customer records share it.
 *
 * WHY THIS EXISTS — measured 2026-07-29 across 832 live Stripe customers:
 *   • 109 emails (13%) have MORE THAN ONE customer record
 *   • 13 of those sets have the active subscription on only ONE of the records
 *   • 2 customers are actively double-billed for the same product
 *
 * Duplicate customer records are created by Stripe Payment Links: we never call
 * `customers.create` ourselves, so every checkout that doesn't match an existing record
 * mints a new one. That is the source of the duplicates, and it is not something this
 * helper can prevent — but the READ side must not compound it.
 *
 * The bug this replaces: `stripe.customers.list({ email, limit: 1 })`. Stripe returns
 * customers newest-first, so `limit: 1` takes the MOST RECENTLY CREATED record — which for
 * those 13 users is frequently the EMPTY one. Real symptom: a paying subscriber opens
 * billing and is told they have no subscription, or the billing portal opens an account
 * with no plan in it.
 *
 * Resolution order (first match wins):
 *   1. a customer with an ACTIVE / TRIALING subscription   ← the one that matters
 *   2. a customer with a subscription in ANY state (past_due, canceled — still their history)
 *   3. the oldest record (their original account) as a stable, non-arbitrary fallback
 *
 * Fetches up to 100 records rather than 1, so the choice is made over the whole set.
 *
 * KNOWN LIMIT — Stripe's `customers.list({ email })` is an EXACT match. Records whose email
 * differs only by case or surrounding whitespace are invisible to it, so this helper cannot
 * unify those. Found while verifying: enroll@itmasterkey.com returns 1 record via the email
 * filter but has siblings visible in a full customer scan. Catching those needs a normalized
 * sweep (lower+trim across all customers), which belongs in the identity work
 * (docs/PRD-identity-model.md), not in a per-request lookup.
 */

export interface ResolvedCustomer {
  customer: Stripe.Customer | null;
  /** Every customer record sharing this email — length > 1 means duplicates exist. */
  all: Stripe.Customer[];
  /** How the winner was chosen; surfaced in logs so duplicate users are diagnosable. */
  reason: 'active-sub' | 'any-sub' | 'oldest' | 'none';
}

const LIVE_STATUSES: Stripe.Subscription.Status[] = ['active', 'trialing'];

export async function resolveStripeCustomerByEmail(
  stripe: Stripe,
  email: string,
): Promise<ResolvedCustomer> {
  const normalized = (email || '').toLowerCase().trim();
  if (!normalized) return { customer: null, all: [], reason: 'none' };

  // limit:100 — NEVER limit:1. The whole point is to see the duplicates.
  const { data: all } = await stripe.customers.list({ email: normalized, limit: 100 });
  if (!all.length) return { customer: null, all: [], reason: 'none' };

  // Fast path: the common case is still one record.
  if (all.length === 1) return { customer: all[0], all, reason: 'oldest' };

  console.warn(
    `[stripe/resolve-customer] ${all.length} customer records share ${normalized} — ` +
    `resolving to the one holding the subscription (ids: ${all.map((c) => c.id).join(', ')})`,
  );

  // Look for a live subscription across ALL of the records, not just the newest.
  let anySubCustomer: Stripe.Customer | null = null;
  for (const c of all) {
    const subs = await stripe.subscriptions.list({ customer: c.id, status: 'all', limit: 10 });
    if (!subs.data.length) continue;
    if (subs.data.some((s) => LIVE_STATUSES.includes(s.status))) {
      return { customer: c, all, reason: 'active-sub' };
    }
    // Remember the first record with ANY subscription, but keep looking for a live one.
    if (!anySubCustomer) anySubCustomer = c;
  }
  if (anySubCustomer) return { customer: anySubCustomer, all, reason: 'any-sub' };

  // No subscriptions anywhere → the ORIGINAL record. Deterministic, unlike Stripe's
  // newest-first default, so repeated calls don't bounce between records.
  const oldest = [...all].sort((a, b) => a.created - b.created)[0];
  return { customer: oldest, all, reason: 'oldest' };
}

/**
 * Get the Stripe customer for an email, creating one ONLY if none exists.
 *
 * WHY THIS EXISTS — this is the CREATE-side dedup guard. `resolveStripeCustomerByEmail` above
 * stops a duplicate from breaking lookups; this stops the duplicate being made at all.
 *
 * MEASURED 2026-07-29: 109 of 832 live customer emails (13%) have more than one customer record.
 * Proven source for one class of them — `createSetupCheckout` in lib/mcp/autorecharge.ts called
 * `stripe.customers.create()` whenever its OWN stored id was missing, without ever asking Stripe
 * whether a customer for that email already existed. Result: eric@govcongiants.com ended up with
 * THREE customers (cus_UtXlzhTShlKhHX / cus_UtXjm5LD4rIIWy / cus_UtXWsiTa7wk9sx), all tagged
 * `source: mcp_autorecharge`, created 08:14, 08:27 and 08:29 on 2026-07-16 — one per click of the
 * setup button. Nothing was broken loudly; the account just fragmented.
 *
 * Any future code that needs a customer id MUST come through here rather than calling
 * customers.create directly.
 */
export async function getOrCreateStripeCustomerId(
  stripe: Stripe,
  email: string,
  opts: { metadata?: Record<string, string> } = {},
): Promise<{ customerId: string; created: boolean }> {
  const normalized = (email || '').toLowerCase().trim();
  if (!normalized) throw new Error('getOrCreateStripeCustomerId: email required');

  // Reuse whatever already exists, preferring the record that holds a live subscription.
  const { customer, all } = await resolveStripeCustomerByEmail(stripe, normalized);
  if (customer) {
    if (all.length > 1) {
      console.warn(
        `[stripe/get-or-create] reusing ${customer.id} for ${normalized} — ${all.length} records already exist; NOT creating another`,
      );
    }
    return { customerId: customer.id, created: false };
  }

  const fresh = await stripe.customers.create({
    email: normalized,
    metadata: { user_email: normalized, ...(opts.metadata || {}) },
  });
  return { customerId: fresh.id, created: true };
}
