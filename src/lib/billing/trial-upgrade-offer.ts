/**
 * "Upgrade now, get +500 credits" — client-safe copy + display rules (owner, 2026-11-13).
 *
 * Pure: no Stripe, no fetch. Used by the in-app "Your subscriptions" card and /pricing so both
 * surfaces say exactly the same thing. The server decides eligibility (trial-upgrade.ts); these
 * helpers only format what it returned.
 */
import { TRIAL_UPGRADE_BONUS_CREDITS } from '@/lib/mcp/packages';

export const TRIAL_UPGRADE_ENDPOINT = '/api/app/billing/trial-upgrade';

/** What the server returns for a subscription that may be upgraded early. */
export interface TrialUpgradeOffer {
  subscriptionId: string;
  tier: 'pro' | 'team';
  planName: string;
  amount: number | null;      // dollars charged today
  interval: string | null;    // 'month' | 'year'
  trialEnd: string | null;    // ISO
  billedTo: string;
}

export const TRIAL_UPGRADE_TITLE = `Upgrade now and get ${TRIAL_UPGRADE_BONUS_CREDITS.toLocaleString('en-US')} bonus credits`;

export const TRIAL_UPGRADE_SUCCESS_TEXT =
  `Upgraded — ${TRIAL_UPGRADE_BONUS_CREDITS.toLocaleString('en-US')} bonus credits will be added once payment clears.`;

/** "$149/mo", "$1,490/yr", or null when the amount is unknown. */
export function formatPlanPrice(amount: number | null, interval: string | null): string | null {
  if (amount == null || !Number.isFinite(amount)) return null;
  const dollars = Number.isInteger(amount)
    ? amount.toLocaleString('en-US')
    : amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const per = interval === 'month' ? '/mo' : interval === 'year' ? '/yr' : '';
  return `$${dollars}${per}`;
}

/**
 * The line shown before the customer confirms. Never claims an amount we don't know: without
 * one it still says the card is charged today.
 */
export function trialUpgradeChargeNote(amount: number | null, interval: string | null): string {
  const price = formatPlanPrice(amount, interval);
  const charge = price ? `Your card is charged today (${price})` : 'Your card is charged today';
  return `${charge} and your trial ends now. No refunds.`;
}

/** Row shape the subscriptions card already has, plus the server's eligibility flag. */
export interface TrialUpgradeRowLike {
  kind: 'mcp' | 'app';
  status: string;
  cancelAtPeriodEnd: boolean;
  trialUpgradeEligible?: boolean;
}

/** Show the offer only where the server said it is eligible and the trial is live. */
export function canOfferTrialUpgrade(row: TrialUpgradeRowLike): boolean {
  return row.kind === 'app' && row.status === 'trialing' && !row.cancelAtPeriodEnd && row.trialUpgradeEligible === true;
}
