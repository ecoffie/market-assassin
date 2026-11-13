/**
 * "Upgrade now, get +500 credits" — the GRANT side (owner, 2026-11-13).
 *
 * A Pro/Team subscriber in a 14-day card trial can end the trial early and pay today
 * (POST /api/app/billing/trial-upgrade). That endpoint stamps the subscription with
 * `metadata.early_upgrade_bonus` IN THE SAME Stripe update that ends the trial. Nothing is
 * granted there: the bonus is granted HERE, from `invoice.paid`, because the paid invoice is
 * the only proof the customer actually paid.
 *
 *   - no paid invoice (card declined)  → no `invoice.paid` → no bonus
 *   - $0 invoice                        → not a payment → no bonus
 *   - Stripe redelivery / a later renewal invoice on the same flagged subscription
 *                                       → same key `trial_upgrade_bonus:<sub_id>` → no-op
 *
 * The amount is the server constant TRIAL_UPGRADE_BONUS_CREDITS, never the metadata value
 * (metadata only says "this subscription was upgraded early").
 *
 * ⚠️ The bonus is a PERSONAL grant to the invoice's email. For a Team whose calls bill an
 * organization POOL, personal credits are not spent by pooled calls (payer.ts never crosses
 * payers). There is no fixed-amount pool grant RPC today, so a pooled Team owner's bonus sits
 * on their personal balance. Recorded as a known bound.
 */
import type Stripe from 'stripe';
import { applyCreditOnce } from './credits';
import { TRIAL_UPGRADE_BONUS_CREDITS } from './packages';
import { subscriptionIdFromInvoice } from './team-pools';
import { resolveInvoiceEmail } from './app-tier-subscription';
import { getStripe } from '@/lib/stripe';

/** Subscription metadata key set by the trial-upgrade endpoint. */
export const EARLY_UPGRADE_FLAG = 'early_upgrade_bonus';
/** Ledger reason (classified in grant-reasons.ts). */
export const TRIAL_UPGRADE_BONUS_REASON = 'trial_upgrade_bonus';

export function trialUpgradeBonusKey(subscriptionId: string): string {
  return `trial_upgrade_bonus:${subscriptionId}`;
}

/** True when subscription metadata carries the early-upgrade flag. */
export function hasEarlyUpgradeFlag(metadata: Record<string, string> | null | undefined): boolean {
  const v = metadata?.[EARLY_UPGRADE_FLAG];
  return typeof v === 'string' && v.trim() !== '' && v.trim() !== '0';
}

export interface TrialUpgradeBonusOutcome {
  handled: boolean;      // false => not an early-upgrade paid invoice
  applied?: boolean;     // true => granted now; false => already granted for this subscription
  credits?: number;
  email?: string;
  subscriptionId?: string;
  newBalance?: number;
  error?: string;        // permanent problem (e.g. no email) — logged, not retried
}

/** The invoice's snapshot of subscription metadata, when Stripe included one. */
function invoiceSubscriptionMetadata(invoice: Stripe.Invoice): Record<string, string> | undefined {
  const inv = invoice as unknown as {
    parent?: { subscription_details?: { metadata?: Record<string, string> | null } | null } | null;
    subscription_details?: { metadata?: Record<string, string> | null } | null;
  };
  return inv.parent?.subscription_details?.metadata ?? inv.subscription_details?.metadata ?? undefined;
}

export interface TrialUpgradeBonusDeps {
  retrieveSubscriptionMetadata?: (id: string) => Promise<Record<string, string>>;
  resolveEmail?: (invoice: Stripe.Invoice) => Promise<string | null>;
  apply?: typeof applyCreditOnce;
}

/**
 * Grant the early-upgrade bonus for a PAID invoice. Throws on a transient failure (Stripe
 * read or the ledger write) so the webhook can return 500 and Stripe retries; the grant is
 * idempotent, so a retry can never double-grant.
 */
export async function handleTrialUpgradeBonusInvoice(
  invoice: Stripe.Invoice,
  deps: TrialUpgradeBonusDeps = {},
): Promise<TrialUpgradeBonusOutcome> {
  if ((invoice.amount_paid ?? 0) <= 0) return { handled: false };
  if (invoice.status && invoice.status !== 'paid') return { handled: false };
  const subscriptionId = subscriptionIdFromInvoice(invoice);
  if (!subscriptionId) return { handled: false };

  // The invoice usually carries the subscription's metadata. When it doesn't — or when this
  // is the subscription_update invoice that ending a trial creates — read the subscription.
  let metadata = invoiceSubscriptionMetadata(invoice);
  if (!hasEarlyUpgradeFlag(metadata) && (metadata === undefined || invoice.billing_reason === 'subscription_update')) {
    const retrieve = deps.retrieveSubscriptionMetadata
      ?? (async (id: string) => (await getStripe().subscriptions.retrieve(id)).metadata ?? {});
    metadata = await retrieve(subscriptionId);
  }
  if (!hasEarlyUpgradeFlag(metadata)) return { handled: false };

  const email = await (deps.resolveEmail ?? resolveInvoiceEmail)(invoice);
  if (!email) {
    console.error('[trial-upgrade-bonus] no email on invoice', invoice.id);
    return { handled: true, subscriptionId, error: 'no_email' };
  }

  const apply = deps.apply ?? applyCreditOnce;
  const { applied, newBalance } = await apply(
    trialUpgradeBonusKey(subscriptionId), email, TRIAL_UPGRADE_BONUS_CREDITS, 'trial_upgrade_bonus',
  );
  console.log(`[trial-upgrade-bonus] ${email} +${TRIAL_UPGRADE_BONUS_CREDITS} (applied=${applied}, balance=${newBalance}) sub ${subscriptionId} invoice ${invoice.id}`);
  return { handled: true, applied, credits: TRIAL_UPGRADE_BONUS_CREDITS, email, subscriptionId, newBalance };
}
