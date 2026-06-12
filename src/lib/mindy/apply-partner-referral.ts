import type { SupabaseClient } from '@supabase/supabase-js';
import { isAdvocateAccount } from '@/lib/mindy/advocate-accounts';
import {
  getPartnerReferralByCode,
  normalizePartnerReferralCode,
  type PartnerReferralProgram,
} from '@/lib/mindy/partner-referrals';

export interface ApplyPartnerReferralResult {
  applied: boolean;
  skipped?: string;
  partner?: PartnerReferralProgram;
  trialEndsAt?: string;
}

function trialEndFromDays(days: number): string {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() + days);
  end.setUTCHours(23, 59, 59, 999);
  return end.toISOString();
}

/**
 * Grant partner-tagged 30-day Pro trial. Idempotent — won't shorten an
 * existing longer trial or override paid/advocate access.
 */
export async function applyPartnerReferralIfEligible(
  supabase: SupabaseClient,
  email: string,
  rawCode: string | null | undefined,
): Promise<ApplyPartnerReferralResult> {
  const normalizedEmail = email.toLowerCase().trim();
  const partner = getPartnerReferralByCode(rawCode);
  if (!partner) {
    return { applied: false, skipped: 'invalid_code' };
  }

  if (isAdvocateAccount(normalizedEmail)) {
    return { applied: false, skipped: 'advocate_account', partner };
  }

  const { data: existing } = await supabase
    .from('user_notification_settings')
    .select('user_email, briefings_enabled, trial_ends_at, trial_source, invitation_source, paid_status')
    .eq('user_email', normalizedEmail)
    .maybeSingle();

  if (existing?.paid_status === true || existing?.briefings_enabled === true) {
    const existingTrial = existing.trial_ends_at ? new Date(existing.trial_ends_at).getTime() : 0;
    const alreadyTagged = existing.invitation_source === partner.invitationSource
      || existing.trial_source === partner.trialSource;
    if (alreadyTagged && existingTrial > Date.now()) {
      return {
        applied: false,
        skipped: 'already_tagged',
        partner,
        trialEndsAt: existing.trial_ends_at ?? undefined,
      };
    }
    if (existing?.briefings_enabled && !alreadyTagged) {
      return { applied: false, skipped: 'already_paid_pro', partner };
    }
  }

  const trialEndsAt = trialEndFromDays(partner.trialDays);
  const patch = {
    user_email: normalizedEmail,
    briefings_enabled: true,
    alerts_enabled: true,
    is_active: true,
    treatment_type: 'briefings',
    invitation_source: partner.invitationSource,
    trial_source: partner.trialSource,
    trial_ends_at: trialEndsAt,
    paid_status: false,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('user_notification_settings')
    .upsert(patch, { onConflict: 'user_email' });

  if (error) {
    throw error;
  }

  return { applied: true, partner, trialEndsAt };
}

export function partnerReferralSourceLabel(rawCode: string | null | undefined): string | null {
  const partner = getPartnerReferralByCode(rawCode);
  if (!partner) return null;
  return `partner-${partner.slug}`;
}

export { normalizePartnerReferralCode };
