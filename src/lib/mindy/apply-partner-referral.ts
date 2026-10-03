/**
 * Partner referral helpers that do NOT grant anything.
 *
 * SEC-5d (P0, 2026-10-03): the former `applyPartnerReferralIfEligible` granted a 30-day Pro trial
 * to whatever email a caller passed — /api/auth/mi-signup called it BEFORE the address was
 * verified — forced alerts_enabled=true, and let an expired same-partner trial be renewed
 * indefinitely. It is removed. The ONLY grant path is claimPartnerReferral()
 * (src/lib/mindy/partner-referral-claim.ts) behind POST /api/app/partner-referral/claim, which
 * takes the identity from a verified session and allows one promotional trial per account, ever.
 */
import { getPartnerReferralByCode, normalizePartnerReferralCode } from './partner-referrals';

/** Attribution label for signup analytics (never an entitlement). */
export function partnerReferralSourceLabel(rawCode: string | null | undefined): string | null {
  const partner = getPartnerReferralByCode(rawCode);
  if (!partner) return null;
  return `partner-${partner.slug}`;
}

export { normalizePartnerReferralCode };
