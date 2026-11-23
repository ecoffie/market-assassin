/**
 * Subscriptions with MORE THAN ONE item (owner, 2026-11-23: Pro + a credit add-on in one checkout).
 *
 * Until then every Mindy subscription had exactly one item, and several billing paths read
 * `items.data[0]` as "the plan". A Pro + add-on subscription holds the Pro price AND an
 * Entry/Mid/Growth credit price, so those paths ask these helpers instead:
 *   - appTierItem: the Pro/Team item (by price amount, the same sets the credit grants use);
 *   - primaryItem: that item, else the first one (unchanged behaviour for one-item subscriptions);
 *   - subscriptionTotalCents: what the subscription bills per period, all items together.
 * For a one-item subscription every helper returns exactly what `items.data[0]` gave before.
 */
import type Stripe from 'stripe';
import { appTierForAmount } from '@/lib/mcp/app-tier-subscription';

type PriceLike = { id?: string; unit_amount?: number | null; recurring?: { interval?: string } | null; nickname?: string | null; product?: unknown } | string | null | undefined;
type ItemLike = { price?: PriceLike; quantity?: number | null };
type ItemsLike = { items?: { data?: ItemLike[] } | null };

const unitAmount = (p: PriceLike): number | null => (p && typeof p === 'object' && typeof p.unit_amount === 'number' ? p.unit_amount : null);

export function appTierItem<T extends ItemLike>(sub: { items?: { data?: T[] } | null }): T | null {
  return sub.items?.data?.find((i) => appTierForAmount(unitAmount(i.price)) !== null) ?? null;
}

export function primaryItem<T extends ItemLike>(sub: { items?: { data?: T[] } | null }): T | null {
  return appTierItem(sub) ?? sub.items?.data?.[0] ?? null;
}

/** Sum of unit_amount × quantity over every item, in cents. null when no item has a known amount. */
export function subscriptionTotalCents(sub: ItemsLike): number | null {
  let total = 0;
  let known = false;
  for (const i of sub.items?.data ?? []) {
    const a = unitAmount(i.price);
    if (a === null) continue;
    known = true;
    total += a * (i.quantity ?? 1);
  }
  return known ? total : null;
}

/** Invoice-line form: the Pro/Team line of an invoice (by price amount), else null. */
export function appTierInvoiceLine(invoice: Pick<Stripe.Invoice, 'lines'>): { price?: { unit_amount?: number | null } } | null {
  const lines = (invoice.lines?.data ?? []) as unknown as Array<{ price?: { unit_amount?: number | null } }>;
  return lines.find((l) => appTierForAmount(l.price?.unit_amount ?? null) !== null) ?? null;
}
