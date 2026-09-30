/**
 * Stripe → Supabase subscription mirror, one subscription at a time.
 *
 * WHY THIS EXISTS: `resolvePayer` decides whether a pooled team may spend by reading
 * `stripe_subscriptions` (unknown state charges nothing). The mirror was written ONLY by
 * the daily `sync-stripe-cache` job (05:00 UTC) — the real-time writer lives on a Stripe
 * endpoint that is disabled — so a newly created pooled subscription was unusable for up
 * to a day. Found by the internal billing canary (2026-09-30), whose row had to be
 * written by hand.
 *
 * Now the paths that learn about a subscription call `mirrorSubscription` directly:
 * the Stripe webhook (invoice.paid, customer.subscription.updated/deleted) and pooled-org
 * provisioning. The daily job remains, as RECONCILIATION only.
 *
 * It always RE-READS the subscription from Stripe (the source of truth) instead of
 * trusting an event payload, so out-of-order or replayed events converge on the current
 * state, and the upsert on `id` makes every call idempotent.
 */
import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';
import { getWriteClient } from '@/lib/supabase/server-clients';

const iso = (t?: number | null) => (t ? new Date(t * 1000).toISOString() : null);

/** A `stripe_subscriptions` row. Period dates fall back to the first item (newer Stripe API versions moved them there). */
export function subscriptionMirrorRow(sub: Stripe.Subscription): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = sub as any;
  const item = s.items?.data?.[0];
  const plan = item?.plan ?? item?.price;
  return {
    id: s.id,
    customer_id: typeof s.customer === 'string' ? s.customer : s.customer?.id,
    status: s.status,
    current_period_start: iso(s.current_period_start ?? item?.current_period_start),
    current_period_end: iso(s.current_period_end ?? item?.current_period_end),
    cancel_at_period_end: s.cancel_at_period_end,
    canceled_at: iso(s.canceled_at),
    ended_at: iso(s.ended_at),
    trial_start: iso(s.trial_start),
    trial_end: iso(s.trial_end),
    metadata: s.metadata || {},
    created_at: iso(s.created),
    livemode: s.livemode,
    plan_id: plan?.id ?? null,
    plan_amount: plan?.amount ?? plan?.unit_amount ?? null,
    plan_interval: plan?.interval ?? plan?.recurring?.interval ?? null,
  };
}

/** The minimal `stripe_customers` row that satisfies the mirror's foreign key. */
export function customerMirrorRow(customer: Stripe.Customer | Stripe.DeletedCustomer | string): Record<string, unknown> {
  if (typeof customer === 'string') return { id: customer, email: '', metadata: {}, livemode: true, deleted: false };
  if ('deleted' in customer && customer.deleted) return { id: customer.id, email: '', metadata: {}, livemode: true, deleted: true };
  const c = customer as Stripe.Customer;
  return {
    id: c.id, email: c.email || '', name: c.name ?? null, phone: c.phone ?? null, metadata: c.metadata || {},
    created_at: iso(c.created), livemode: c.livemode, deleted: false,
  };
}

export type MirrorResult =
  | { ok: true; subscriptionId: string; status: string }
  | { ok: false; subscriptionId: string; skipped?: 'test_mode'; error?: string };

/**
 * Re-read one subscription from Stripe and upsert its customer + subscription rows.
 * Never throws: callers on payment paths log the failure and carry on (the daily
 * reconciliation still catches it). The failure is RETURNED, never swallowed.
 */
export async function mirrorSubscription(subscriptionId: string): Promise<MirrorResult> {
  try {
    const sub = await getStripe().subscriptions.retrieve(subscriptionId, { expand: ['customer'] });
    // The mirror holds live data only (same rule as the daily sync).
    if (sub.livemode === false) return { ok: false, subscriptionId, skipped: 'test_mode' };
    const db = getWriteClient();
    // A full customer object refreshes the row; a bare id or deleted customer only fills
    // the foreign key and never overwrites an existing row's email with ''.
    const full = typeof sub.customer === 'object' && !('deleted' in sub.customer && sub.customer.deleted);
    const { error: cErr } = await db
      .from('stripe_customers')
      .upsert(customerMirrorRow(sub.customer), { onConflict: 'id', ignoreDuplicates: !full });
    if (cErr) return { ok: false, subscriptionId, error: `customer mirror failed: ${cErr.message}` };
    const { error: sErr } = await db.from('stripe_subscriptions').upsert(subscriptionMirrorRow(sub), { onConflict: 'id' });
    if (sErr) return { ok: false, subscriptionId, error: `subscription mirror failed: ${sErr.message}` };
    return { ok: true, subscriptionId, status: sub.status };
  } catch (e) {
    return { ok: false, subscriptionId, error: (e as Error).message || 'stripe retrieve failed' };
  }
}
