/**
 * "Mindy Teams Lifetime" — a one-time purchase that must grant TEAM access, not Pro.
 *
 * THE BUG THIS FIXES (found 2026-11-19): the product is sold on a manual Stripe invoice
 * (billing_reason 'manual', no subscription, no checkout session). checkout.session.completed
 * never fires, and invoice.paid only recorded affiliate commission, so no access flag was ever
 * written. The entitlement classifier then filed the buyer under `lifetime_mindy`, which grants
 * PRO capabilities only. Nothing set access_team for the one buyer ($6,000, 2026-06-15), and the
 * Team panel's invite needs it. All 1,515 Stripe invoices were scanned; that is
 * the only Teams Lifetime invoice.
 *
 * Matched by Stripe PRODUCT id (stable), never by line description (editable free text).
 */

export const TEAM_LIFETIME_PRODUCT_IDS: ReadonlySet<string> = new Set([
  'prod_Ui72gVmD5xD4H3', // Mindy Teams Lifetime ($6,000, live)
]);

/** The tier passed to updateAccessFlags for a Teams Lifetime purchase. */
export const TEAM_LIFETIME_TIER = 'team_lifetime';

type ProductRef = string | { id?: string | null } | null | undefined;

interface InvoiceLineLike {
  price?: { product?: ProductRef } | null;
  pricing?: { price_details?: { product?: ProductRef } | null } | null;
}

interface InvoiceLike {
  status?: string | null;
  amount_paid?: number | null;
  lines?: { data?: InvoiceLineLike[] | null } | null;
}

function productId(p: ProductRef): string | null {
  if (!p) return null;
  return typeof p === 'string' ? p : p.id || null;
}

/** Product ids on an invoice. Handles both the legacy `price` field and the newer `pricing` shape. */
export function invoiceProductIds(invoice: InvoiceLike): string[] {
  const out: string[] = [];
  for (const line of invoice.lines?.data || []) {
    const id = productId(line.price?.product) || productId(line.pricing?.price_details?.product);
    if (id) out.push(id);
  }
  return out;
}

/** True when a PAID invoice (money actually collected) contains a Teams Lifetime product. */
export function invoiceGrantsLifetimeTeam(invoice: InvoiceLike): boolean {
  if ((invoice.amount_paid ?? 0) <= 0) return false;
  if (invoice.status && invoice.status !== 'paid') return false;
  return invoiceProductIds(invoice).some((id) => TEAM_LIFETIME_PRODUCT_IDS.has(id));
}
