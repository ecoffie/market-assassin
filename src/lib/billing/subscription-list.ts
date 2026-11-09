/**
 * Every live subscription a user holds, across the Stripe customers behind their signed-in
 * email AND their verified linked emails (buying with one address and signing in with another
 * is normal — see linked-emails.ts). Powers the "Your subscriptions" card on the MCP account
 * page and app Settings, so a user can see each plan they pay for (Mindy Pro/Team, an MCP
 * credits plan) and reach the cancel button for each one.
 *
 * Read-only. Cancel / change plan / card updates go through Stripe's hosted Billing Portal
 * (/api/app/billing/portal), opened on the customer that holds the subscription.
 */
import type Stripe from 'stripe';
import { resolveStripeCustomerByEmail } from '@/lib/stripe/resolve-customer';
import { subscriptionGrantForPriceId } from '@/lib/mcp/packages';
import { MCP_SUBSCRIPTION_TYPE } from '@/lib/mcp/stripe-subscription';

export type SubscriptionKind = 'mcp' | 'app';

export interface SubscriptionRow {
  id: string;
  kind: SubscriptionKind;
  planName: string;
  status: string;
  amount: number | null;
  currency: string;
  interval: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  /** The email whose Stripe customer holds this plan (the portal must open on it). */
  billedTo: string;
}

const LIVE = new Set(['active', 'trialing', 'past_due', 'unpaid']);

/** MCP credit plans are recognised by their Stripe price id, else by checkout metadata. */
export function subscriptionKind(sub: Pick<Stripe.Subscription, 'metadata' | 'items'>): SubscriptionKind {
  if (sub.metadata?.type === MCP_SUBSCRIPTION_TYPE) return 'mcp';
  for (const item of sub.items?.data ?? []) {
    const priceId = typeof item.price === 'string' ? item.price : item.price?.id;
    if (subscriptionGrantForPriceId(priceId)) return 'mcp';
  }
  return 'app';
}

export function describeSubscription(
  sub: Stripe.Subscription,
  productName: string | null,
  billedTo: string,
): SubscriptionRow {
  const item = sub.items?.data?.[0];
  const price = item && typeof item.price === 'object' ? item.price : null;
  const periodEndUnix =
    (item as unknown as { current_period_end?: number } | undefined)?.current_period_end ??
    (sub as unknown as { current_period_end?: number }).current_period_end ??
    null;
  const kind = subscriptionKind(sub);
  return {
    id: sub.id,
    kind,
    planName: productName || price?.nickname || (kind === 'mcp' ? 'MCP credits plan' : 'Mindy subscription'),
    status: sub.status,
    amount: typeof price?.unit_amount === 'number' ? price.unit_amount / 100 : null,
    currency: (price?.currency || 'usd').toUpperCase(),
    interval: price?.recurring?.interval || null,
    currentPeriodEnd: periodEndUnix ? new Date(periodEndUnix * 1000).toISOString() : null,
    cancelAtPeriodEnd: !!sub.cancel_at_period_end,
    billedTo,
  };
}

export async function listLiveSubscriptions(stripe: Stripe, emails: string[]): Promise<SubscriptionRow[]> {
  const rows: SubscriptionRow[] = [];
  const seen = new Set<string>();
  const productNames = new Map<string, string | null>();

  for (const email of emails) {
    const { customer } = await resolveStripeCustomerByEmail(stripe, email);
    if (!customer) continue;
    const subs = await stripe.subscriptions.list({
      customer: customer.id,
      status: 'all',
      limit: 20,
      expand: ['data.items.data.price'],
    });
    for (const sub of subs.data) {
      if (!LIVE.has(sub.status) || seen.has(sub.id)) continue;
      seen.add(sub.id);
      const price = sub.items.data[0]?.price;
      const productId = price && typeof price.product === 'string' ? price.product : null;
      let name: string | null = null;
      if (productId) {
        if (!productNames.has(productId)) {
          try {
            const p = await stripe.products.retrieve(productId);
            productNames.set(productId, p.deleted ? null : p.name);
          } catch {
            productNames.set(productId, null);
          }
        }
        name = productNames.get(productId) ?? null;
      }
      rows.push(describeSubscription(sub, name, email));
    }
  }
  return rows;
}
