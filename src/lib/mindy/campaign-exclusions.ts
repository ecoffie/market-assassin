import { isAdvocateAccount } from '@/lib/mindy/advocate-accounts';
import { isPartnerContactEmail } from '@/lib/mindy/partner-referrals';

/** Comp / testimonial demo accounts — free access for marketing, not advocates. */
export const COMP_TESTIMONIAL_EMAILS = new Set([
  'aj@cypherintel.com', // Andre Jerry — comp/testimonial, 500 one-time (Eric, 2026-07-19)
  'pa.joof@pjaygroup.com',
  'dare2dreaminc615@gmail.com',
  'olga@olaexecutiveconsulting.com',
  'tavinalford@gmail.com',
  'ryan@radiumgovcon.com', // internal team — comp Pro, not a customer (Eric, Jul 2026)
  'faldekurt@gmail.com', // friends & family try-it (Kurt Falde) — comp Pro, not a customer (Eric, Jul 2026)
  'edwinhm@gmail.com', // Edwin — recruited builder, comped 5,000 MCP credits to build sellable features (Eric, 2026-08-01)
  // Cassy Heneault — Eric's client. Connected MCP 2026-09-14, spent the 100 signup
  // credits the same day; comped 1,500 (the PRO_MONTHLY_CREDITS figure) by hand.
  // ⚠️ Spelling is hen-E-ault — 'cassy.henault@gmail.com' is a DIFFERENT string and
  // would orphan the balance on an address with no Mindy account.
  'cassy.heneault@gmail.com',
]);

/**
 * Internal synthetic accounts of the permanent production billing canary
 * ("Mindy Billing Acceptance (INTERNAL CANARY)", Stripe sub_1ULJM4K5zyiZ50PBRFojExdX,
 * a real Growth subscription at 100% off). Its mirror row carries the $399 list price,
 * so without this the MRR goal chart would count $399 of revenue that does not exist.
 * See docs/engineering/billing-canary.md.
 */
export const INTERNAL_CANARY_EMAILS = new Set([
  'billing-canary-owner@getmindy.ai',
  'billing-canary-member@getmindy.ai',
  'billing-canary-outsider@getmindy.ai',
]);

/**
 * The full set of NON-CUSTOMER special accounts that must not be sold to OR
 * counted as customers: comp/testimonial demo accounts + advocates + partner
 * contacts + internal billing-canary accounts. Per Eric's model, advocates ARE partners and vice-versa, so the two
 * are one class. Adding any of them anywhere flows through here.
 */
export function isSpecialAccount(email: string | null | undefined): boolean {
  const normalized = (email || '').toLowerCase().trim();
  if (!normalized) return false;
  return (
    COMP_TESTIMONIAL_EMAILS.has(normalized) ||
    INTERNAL_CANARY_EMAILS.has(normalized) ||
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
