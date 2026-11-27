/**
 * Trial credits (owner, 2026-11-18: "give trial users monthly credits", 500 picked).
 *
 * A Pro/Team 14-day card trial is Pro inside the app, but the monthly credit grant only counts
 * fully paid (`active`) subscriptions, so a trial user who connected Claude or ChatGPT had only
 * the 100 one-time signup credits and could run dry mid-trial. Now a trial start grants
 * TRIAL_CREDITS once.
 *
 *   - granted from checkout.session.completed, when the new subscription is a Mindy app
 *     subscription in `trialing`
 *   - ONCE PER PERSON, ever: the key is the email, not the subscription, so cancelling and
 *     starting another trial never grants again
 *   - promotional: ledger reason `trial_credits` does not reset the ChatGPT attribution
 *     window (grant-reasons.ts), so it can never make a card charge look eligible
 *   - the +500 early-upgrade bonus (trial-upgrade-bonus.ts) and the paid monthly allowance
 *     are unchanged and stack on top
 */
import { applyCreditOnce } from './credits';

export const TRIAL_CREDITS = 500;
export const TRIAL_CREDITS_REASON = 'trial_credits';

export function trialCreditsKey(email: string): string {
  return `trial_credits:${email.trim().toLowerCase()}`;
}

export interface TrialSubscriptionLike {
  id: string;
  status: string;
}

export interface TrialCreditsOutcome {
  granted: boolean;
  /** false when this person already had trial credits (a repeat delivery or a second trial). */
  applied?: boolean;
  newBalance?: number;
  skipped?: 'not_trialing' | 'no_email';
}

/**
 * Grant the trial credits for a subscription that has just started its trial. The caller checks
 * that it is a Mindy app subscription. Throws only if the ledger write fails.
 */
export async function grantTrialCredits(
  sub: TrialSubscriptionLike,
  email: string | null | undefined,
  apply: typeof applyCreditOnce = applyCreditOnce,
): Promise<TrialCreditsOutcome> {
  if (sub.status !== 'trialing') return { granted: false, skipped: 'not_trialing' };
  const who = (email || '').trim().toLowerCase();
  if (!who) return { granted: false, skipped: 'no_email' };
  const { applied, newBalance } = await apply(trialCreditsKey(who), who, TRIAL_CREDITS, TRIAL_CREDITS_REASON);
  console.log(`[trial-credits] ${who} +${TRIAL_CREDITS} (applied=${applied}, balance=${newBalance}) sub ${sub.id}`);
  return { granted: true, applied, newBalance };
}
