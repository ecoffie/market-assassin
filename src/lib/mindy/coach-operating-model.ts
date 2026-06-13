/**
 * Coach operating model — single source of truth for Ryan, Zach, Randie, Tavin.
 *
 * Per COACH-ENTERPRISE-BD-PLAN + MI-INTERNAL-COMMAND-CENTER-PRD:
 * - Coaches STOP weekly FHC trainings and profile-nudge support tickets.
 * - Coaches START partner BD (APEX/SBDC/Chambers), signal capture, referrals.
 * - Profile nudges + activation rescue = Annelle / Sikander (customer validation).
 */

export const COACH_OWNERS = ['Ryan', 'Zach', 'Randie', 'Tavin'] as const;
export const CUSTOMER_VALIDATION_OWNERS = 'Annelle / Sikander';

export const COACH_ACTIVITY_TYPES = [
  'partner_bd',
  'livestream_validation',
  'customer_success_checkin',
  'enterprise_referral',
  'proof_story',
  'white_glove_referral',
] as const;

export type CoachActivityType = (typeof COACH_ACTIVITY_TYPES)[number];

export const COACH_ACTIVITY_LABELS: Record<CoachActivityType, string> = {
  partner_bd: 'Partner BD (APEX/SBDC/Chamber)',
  livestream_validation: 'Livestream validation',
  customer_success_checkin: 'Customer success check-in',
  enterprise_referral: 'Enterprise referral',
  proof_story: 'Proof story candidate',
  white_glove_referral: 'White-glove referral',
};

export const COACH_ACTIVITY_STATUSES = [
  'queued',
  'contacted',
  'meeting_set',
  'active',
  'won',
  'lost',
  'escalated',
] as const;

/** Weekly coach targets from COACH-ENTERPRISE-BD-PLAN Month 1. */
export const COACH_WEEKLY_TARGETS = {
  outreachCallsPerCoach: 20,
  partnershipMeetingsPerCoach: 5,
  partnershipsSignedPerCoachPerMonth: 2,
  newSignupsPerPartnership: 5000,
} as const;

export const COACH_TERRITORIES: Record<string, string> = {
  Ryan: 'Southeast + military orgs (FL/GA APEX, NDIA)',
  Zach: 'Northeast + tech orgs (VA/MD/DC APEX, AFCEA)',
  Randie: 'Midwest/West + W/MBE orgs (TX/CA APEX, NAWBO)',
  Tavin: 'Coach signals + overflow partner BD',
};
