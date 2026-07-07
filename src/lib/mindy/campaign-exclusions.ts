import { isAdvocateAccount } from '@/lib/mindy/advocate-accounts';
import { isPartnerContactEmail } from '@/lib/mindy/partner-referrals';

/** Comp / testimonial demo accounts — free access for marketing, not advocates. */
export const COMP_TESTIMONIAL_EMAILS = new Set([
  // aj@cypherintel.com promoted to advocate (complimentary Pro) — see advocate-accounts.ts
  'pa.joof@pjaygroup.com',
  'dare2dreaminc615@gmail.com',
  'olga@olaexecutiveconsulting.com',
  'tavinalford@gmail.com',
]);

/**
 * The full set of NON-CUSTOMER special accounts that must not be sold to OR
 * counted as customers: comp/testimonial demo accounts + advocates + partner
 * contacts. Per Eric's model, advocates ARE partners and vice-versa, so the two
 * are one class. Adding any of them anywhere flows through here.
 */
export function isSpecialAccount(email: string | null | undefined): boolean {
  const normalized = (email || '').toLowerCase().trim();
  if (!normalized) return false;
  return (
    COMP_TESTIMONIAL_EMAILS.has(normalized) ||
    isAdvocateAccount(normalized) ||
    isPartnerContactEmail(normalized)
  );
}

/** Skip upgrade invites, trial nudges, and conversion campaigns. */
export function isCampaignExcludedEmail(email: string | null | undefined): boolean {
  return isSpecialAccount(email);
}

/**
 * Exclude from ACTIVE-USER / REVENUE / CONVERSION METRICS so comp + advocate +
 * partner accounts don't inflate the numbers (DAU/WAU, MRR, purchaser counts,
 * conversion rate, customer segments). Same set as campaign exclusion — these
 * accounts are not customers and shouldn't be measured as such.
 */
export function isExcludedFromMetrics(email: string | null | undefined): boolean {
  return isSpecialAccount(email);
}
