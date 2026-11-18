/**
 * The upgrade bonus — the GRANT side.
 *
 * Owner, 2026-11-18: "give the free members incentive to upgrade, 1000 credits — give the trial
 * members the same incentive." (Was: +500 only for ending a trial early, 2026-11-13.)
 *
 * Rule: UPGRADE_BONUS_CREDITS (1,000), ONCE PER PERSON, on their FIRST paid Pro/Team payment:
 *   - a free member who upgrades and pays          → subscription_create
 *   - a trial that ends early ("Upgrade now")       → subscription_update
 *   - a trial that converts on its own at day 14    → subscription_cycle
 * Never on a renewal: a person with an EARLIER paid invoice already made their first payment.
 *
 * Granted only from `invoice.paid` with money actually paid:
 *   - card declined → no invoice.paid → no bonus
 *   - $0 invoice    → not a payment → no bonus
 *   - redelivery    → same key `upgrade_bonus:<email>` → no-op
 *
 * ⚠️ The bonus is a PERSONAL grant to the invoice's email. For a Team whose calls bill an
 * organization POOL, personal credits are not spent by pooled calls (payer.ts never crosses
 * payers). Recorded as a known bound.
 * ⚠️ "First payment" is checked on the paying Stripe customer. A long-time subscriber who comes
 * back on a NEW Stripe customer record looks like a first payment; the per-email key still caps
 * that at one bonus ever.
 */
import type Stripe from 'stripe';
import { applyCreditOnce } from './credits';
import { UPGRADE_BONUS_CREDITS } from './packages';
import { subscriptionIdFromInvoice } from './team-pools';
import { resolveInvoiceEmail, appTierForAmount } from './app-tier-subscription';
import { getStripe } from '@/lib/stripe';

/** Subscription metadata key set by the trial-upgrade endpoint. */
export const EARLY_UPGRADE_FLAG = 'early_upgrade_bonus';
/** Ledger reason (classified in grant-reasons.ts). The old per-subscription +500 used 'trial_upgrade_bonus'. */
export const UPGRADE_BONUS_REASON = 'upgrade_bonus';

/** Once per person, ever. */
export function upgradeBonusKey(email: string): string {
  return `upgrade_bonus:${email.trim().toLowerCase()}`;
}

/** True when subscription metadata carries the early-upgrade flag. */
export function hasEarlyUpgradeFlag(metadata: Record<string, string> | null | undefined): boolean {
  const v = metadata?.[EARLY_UPGRADE_FLAG];
  return typeof v === 'string' && v.trim() !== '' && v.trim() !== '0';
}

export interface TrialUpgradeBonusOutcome {
  handled: boolean;      // false => not a paid Pro/Team invoice
  applied?: boolean;     // true => granted now; false => already granted for this subscription
  credits?: number;
  email?: string;
  subscriptionId?: string;
  newBalance?: number;
  error?: string;        // permanent problem (e.g. no email) — logged, not retried
  skipped?: 'not_first_payment';
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
  /** True when this customer has a paid invoice (money paid) other than this one, created no later. */
  hasEarlierPaidInvoice?: (invoice: Stripe.Invoice) => Promise<boolean>;
  apply?: typeof applyCreditOnce;
}

/** The Pro/Team price on the invoice's first line, else the amount paid. */
function invoiceTier(invoice: Stripe.Invoice): 'pro' | 'team' | null {
  const line = invoice.lines?.data?.[0] as unknown as { price?: { unit_amount?: number | null } } | undefined;
  return appTierForAmount(line?.price?.unit_amount ?? null) ?? appTierForAmount(invoice.amount_paid ?? null);
}

async function stripeHasEarlierPaidInvoice(invoice: Stripe.Invoice): Promise<boolean> {
  const customer = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
  if (!customer) return false;
  for await (const inv of getStripe().invoices.list({ customer, status: 'paid', limit: 100 })) {
    if (inv.id === invoice.id) continue;
    if ((inv.amount_paid ?? 0) > 0 && (inv.created ?? 0) <= (invoice.created ?? Number.MAX_SAFE_INTEGER)) return true;
  }
  return false;
}

/**
 * Grant the upgrade bonus for a PAID invoice that is the person's first Pro/Team payment.
 * Throws on a transient failure (Stripe read or the ledger write) so the webhook returns 500
 * and Stripe retries; the grant is idempotent, so a retry can never double-grant.
 */
export async function handleTrialUpgradeBonusInvoice(
  invoice: Stripe.Invoice,
  deps: TrialUpgradeBonusDeps = {},
): Promise<TrialUpgradeBonusOutcome> {
  if ((invoice.amount_paid ?? 0) <= 0) return { handled: false };
  if (invoice.status && invoice.status !== 'paid') return { handled: false };
  const subscriptionId = subscriptionIdFromInvoice(invoice);
  if (!subscriptionId) return { handled: false };

  // A Pro/Team invoice: by price, or (an early-upgrade invoice whose line is unusual) by the flag.
  if (!invoiceTier(invoice)) {
    let metadata = invoiceSubscriptionMetadata(invoice);
    if (!hasEarlyUpgradeFlag(metadata)) {
      const retrieve = deps.retrieveSubscriptionMetadata
        ?? (async (id: string) => (await getStripe().subscriptions.retrieve(id)).metadata ?? {});
      metadata = await retrieve(subscriptionId);
    }
    if (!hasEarlyUpgradeFlag(metadata)) return { handled: false };
  }

  const email = await (deps.resolveEmail ?? resolveInvoiceEmail)(invoice);
  if (!email) {
    console.error('[upgrade-bonus] no email on invoice', invoice.id);
    return { handled: true, subscriptionId, error: 'no_email' };
  }

  // Renewals never qualify: an earlier paid invoice means the first payment already happened.
  if (await (deps.hasEarlierPaidInvoice ?? stripeHasEarlierPaidInvoice)(invoice)) {
    return { handled: true, subscriptionId, email, skipped: 'not_first_payment' };
  }

  const apply = deps.apply ?? applyCreditOnce;
  const { applied, newBalance } = await apply(upgradeBonusKey(email), email, UPGRADE_BONUS_CREDITS, UPGRADE_BONUS_REASON);
  console.log(`[upgrade-bonus] ${email} +${UPGRADE_BONUS_CREDITS} (applied=${applied}, balance=${newBalance}) sub ${subscriptionId} invoice ${invoice.id}`);
  return { handled: true, applied, credits: UPGRADE_BONUS_CREDITS, email, subscriptionId, newBalance };
}
