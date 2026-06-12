import { isAdvocateAccount } from '@/lib/mindy/advocate-accounts';

/** Comp / testimonial demo accounts — free access for marketing, not advocates. */
export const COMP_TESTIMONIAL_EMAILS = new Set([
  'aj@cypherintel.com',
  'pa.joof@pjaygroup.com',
  'dare2dreaminc615@gmail.com',
  'olga@olaexecutiveconsulting.com',
  'tavinalford@gmail.com',
]);

/** Skip upgrade invites, trial nudges, and conversion campaigns. */
export function isCampaignExcludedEmail(email: string | null | undefined): boolean {
  const normalized = (email || '').toLowerCase().trim();
  if (!normalized) return false;
  return COMP_TESTIMONIAL_EMAILS.has(normalized) || isAdvocateAccount(normalized);
}
