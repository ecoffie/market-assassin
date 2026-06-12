/**
 * Partner referral programs — tagged signups for channel attribution.
 * Each partner gets a code (NCMBC) + slug URL (/ncmbc).
 */

export const DEFAULT_AFFILIATE_PERCENT = 30;

export type PartnerCompensationModel =
  | 'affiliate_recurring'
  | 'channel_partner'
  | 'anchor_retainer';

export interface PartnerReferralProgram {
  /** Uppercase code for ?ref=NCMBC */
  code: string;
  /** URL slug — getmindy.ai/ncmbc */
  slug: string;
  name: string;
  description: string;
  /** Complimentary Mindy Pro trial length for referred contractors */
  trialDays: number;
  /** Stored on user_notification_settings.invitation_source */
  invitationSource: string;
  /** Stored on user_notification_settings.trial_source */
  trialSource: string;
  compensationModel: PartnerCompensationModel;
  /** Recurring affiliate % on Mindy Pro / Team revenue (0 = no affiliate payout) */
  affiliatePercent: number;
  contactEmail?: string;
}

export const PARTNER_REFERRAL_PROGRAMS: PartnerReferralProgram[] = [
  {
    code: 'NCMBC',
    slug: 'ncmbc',
    name: 'NCMBC',
    description: 'North Carolina Minority Business Council partner referrals',
    trialDays: 30,
    invitationSource: 'partner_ncmbc',
    trialSource: 'partner_ncmbc',
    compensationModel: 'affiliate_recurring',
    affiliatePercent: DEFAULT_AFFILIATE_PERCENT,
    contactEmail: 'westover105@gmail.com',
  },
  {
    code: 'MDEAT',
    slug: 'mdeat',
    name: 'MDEAT',
    description: 'Miami-Dade Economic Advocacy Trust — Miami-Dade County small business partner referrals',
    trialDays: 30,
    invitationSource: 'partner_mdeat',
    trialSource: 'partner_mdeat',
    compensationModel: 'affiliate_recurring',
    affiliatePercent: DEFAULT_AFFILIATE_PERCENT,
  },
];

const BY_CODE = new Map(
  PARTNER_REFERRAL_PROGRAMS.map((p) => [p.code.toUpperCase(), p]),
);

const BY_SLUG = new Map(
  PARTNER_REFERRAL_PROGRAMS.map((p) => [p.slug.toLowerCase(), p]),
);

export function normalizePartnerReferralCode(raw: string | null | undefined): string {
  return (raw || '').trim().toUpperCase();
}

export function getPartnerReferralByCode(raw: string | null | undefined): PartnerReferralProgram | null {
  const code = normalizePartnerReferralCode(raw);
  if (!code) return null;
  return BY_CODE.get(code) ?? null;
}

export function getPartnerReferralBySlug(raw: string | null | undefined): PartnerReferralProgram | null {
  const slug = (raw || '').trim().toLowerCase();
  if (!slug) return null;
  return BY_SLUG.get(slug) ?? null;
}

export function getPartnerByInvitationSource(
  raw: string | null | undefined,
): PartnerReferralProgram | null {
  const source = (raw || '').trim().toLowerCase();
  if (!source) return null;
  return PARTNER_REFERRAL_PROGRAMS.find(
    (p) => p.invitationSource === source || p.trialSource === source,
  ) ?? null;
}

export function formatCentsUsd(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

/** Canonical product origin — getmindy.ai only (mi.govcongiants.com redirects here). */
export function getPartnerAppOrigin(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://getmindy.ai').replace(/\/$/, '');
}

export function partnerSignupUrls(program: PartnerReferralProgram, origin?: string) {
  const base = (origin || getPartnerAppOrigin()).replace(/\/$/, '');
  const ref = program.code;
  return {
    landing: `${base}/${program.slug}`,
    alertsSignup: `${base}/alerts/signup?ref=${ref}`,
    appSignup: `${base}/app/signup?ref=${ref}`,
  };
}
