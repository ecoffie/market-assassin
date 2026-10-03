/**
 * SEC-5d (P0, 2026-10-03) — the ONLY path that grants a promotional partner trial.
 *
 * INVARIANT: an entitlement can only be granted to a VERIFIED authenticated identity. A
 * client-provided email never decides who receives a trial — `verifiedEmail` here must come from a
 * verified session (POST /api/app/partner-referral/claim), never from a body/query/cookie.
 *
 * Before this, /api/auth/mi-signup applied the trial to whatever email was typed, before the
 * address was verified (4 of 7 historical MDEAT grants went to accounts that never verified), it
 * forced alerts_enabled=true (re-subscribing unsubscribed users), and an expired same-partner
 * trial could be renewed indefinitely by re-posting.
 *
 * Rules, in order:
 *   1. the partner code must be a registered program (server-side registry);
 *   2. the account must already have a settings row — this function NEVER creates one (a new
 *      row would carry alerts ON). No row → 'profile_required', nothing consumed; the browser
 *      keeps the code and the claim lands once onboarding creates the row;
 *   3. an account with ANY legacy partner tag (trial_source / invitation_source 'partner_*') has
 *      already consumed its promotional trial;
 *   4. an account with active Pro (paid, Team or an active trial) gets no stacked promo trial —
 *      nothing is consumed;
 *   5. the claim row INSERT (PRIMARY KEY user_email) is the atomic one-per-account-ever gate;
 *   6. only trial_ends_at / trial_source / invitation_source / updated_at are written to the
 *      settings row. alerts_enabled, alert_frequency, briefings_enabled, paid state: untouched.
 *      A failed write releases the claim row so the user can retry.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getPartnerReferralByCode, type PartnerReferralProgram } from './partner-referrals';

export type PartnerClaimOutcome =
  | { status: 'claimed'; partner: PartnerReferralProgram; trialEndsAt: string }
  | { status: 'invalid_code' }
  | { status: 'profile_required' }
  | { status: 'already_claimed'; partnerCode: string | null }
  | { status: 'not_eligible_active_pro' }
  | { status: 'error'; error: string };

export interface PartnerClaimDeps {
  /** Is this account on active Pro (paid / Team / active trial)? */
  hasActivePro: (email: string) => Promise<boolean>;
  now?: () => number;
}

/** Outcomes after which the browser's pending referral should be cleared (no point retrying). */
export const TERMINAL_CLAIM_STATUSES = new Set(['claimed', 'invalid_code', 'already_claimed', 'not_eligible_active_pro']);

export async function claimPartnerReferral(
  sb: SupabaseClient,
  verifiedEmail: string,
  rawCode: string | null | undefined,
  identityMethod: string,
  deps: PartnerClaimDeps,
): Promise<PartnerClaimOutcome> {
  const email = String(verifiedEmail || '').toLowerCase().trim();
  if (!email || !email.includes('@')) return { status: 'error', error: 'no verified identity' };

  const partner = getPartnerReferralByCode(rawCode);
  if (!partner) return { status: 'invalid_code' };

  const { data: settings, error: readErr } = await sb
    .from('user_notification_settings')
    .select('user_email, trial_source, invitation_source')
    .eq('user_email', email)
    .maybeSingle();
  if (readErr) return { status: 'error', error: readErr.message };
  if (!settings) return { status: 'profile_required' };

  const legacyTag = [settings.trial_source, settings.invitation_source]
    .find((v) => typeof v === 'string' && v.startsWith('partner_'));
  if (legacyTag) return { status: 'already_claimed', partnerCode: String(legacyTag).replace(/^partner_/, '').toUpperCase() };

  const { data: prior, error: priorErr } = await sb
    .from('partner_referral_claims')
    .select('partner_code')
    .eq('user_email', email)
    .maybeSingle();
  if (priorErr) return { status: 'error', error: priorErr.message };
  if (prior) return { status: 'already_claimed', partnerCode: (prior as { partner_code: string }).partner_code };

  if (await deps.hasActivePro(email)) return { status: 'not_eligible_active_pro' };

  const now = (deps.now ?? Date.now)();
  const trialEndsAt = new Date(now + partner.trialDays * 864e5).toISOString();

  // The atomic gate: of two concurrent claims, exactly one INSERT succeeds.
  const { error: claimErr } = await sb
    .from('partner_referral_claims')
    .insert({ user_email: email, partner_code: partner.code, trial_ends_at: trialEndsAt, identity_method: identityMethod });
  if (claimErr) {
    if ((claimErr as { code?: string }).code === '23505') return { status: 'already_claimed', partnerCode: null };
    return { status: 'error', error: claimErr.message };
  }

  const { count, error: writeErr } = await sb
    .from('user_notification_settings')
    .update(
      {
        trial_ends_at: trialEndsAt,
        trial_source: partner.trialSource,
        invitation_source: partner.invitationSource,
        updated_at: new Date(now).toISOString(),
      },
      { count: 'exact' },
    )
    .eq('user_email', email);
  if (writeErr || count !== 1) {
    // Give the claim back so the user can retry; a NULL count is unknown, never success.
    const { error: releaseErr } = await sb.from('partner_referral_claims').delete().eq('user_email', email);
    if (releaseErr) console.error('[partner-claim] release failed:', releaseErr.message);
    return { status: 'error', error: writeErr ? writeErr.message : `trial write affected ${count ?? 'unknown'} rows` };
  }

  return { status: 'claimed', partner, trialEndsAt };
}
