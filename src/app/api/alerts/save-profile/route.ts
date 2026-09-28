import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { normalizeNAICSForPersist, parseNAICSInput } from '@/lib/utils/naics-expansion';
import { checkAmplification } from '@/lib/data-invariants/amplification';
import { getNAICSForPSC } from '@/lib/utils/psc-crosswalk';
import { grantBriefingsAccess } from '@/lib/briefings/access';
import { sendEmail } from '@/lib/send-email';
import { fetchSamOpportunitiesFromCache } from '@/lib/briefings/pipelines/sam-gov';
import { verifyUserOwnsEmail } from '@/lib/api-auth';
import { resolveSaveProfileIdentity, SIGN_IN_REQUIRED, type InvitationRow } from '@/lib/alerts/save-profile-identity';
import {
  logSignupEvent,
  logSignupCompleted,
  logSignupFailed,
  SignupEventType,
  SignupStep,
  extractIpAddress,
  extractUserAgent,
} from '@/lib/signup-events';
import { applyPartnerReferralIfEligible, partnerReferralSourceLabel } from '@/lib/mindy/apply-partner-referral';
import { defaultAlertModeForNewUser, mergeAlertModeIntoAggregated } from '@/lib/alerts/alert-mode';
import { validateMarketCodesInput } from '@/lib/codes/validate-market-codes';
import { saveProfileAlertDeliveryPatch } from '@/lib/alerts/paused-delivery';
import { buildSaveProfileTargetingPatch } from '@/lib/alerts/save-profile-patch';

// Lazy initialization to avoid build-time errors
function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

interface AlertProfileRequest {
  email: string;
  naicsCodes: string[];       // Can be full codes or prefixes (e.g., ["541511", "236"])
  naicsInput?: string;        // Alternative: comma-separated string (e.g., "541511, 236, 238320")
  pscCode?: string;           // If provided, will expand to related NAICS codes
  businessType?: string | null; // omitted/blank = leave stored business_type untouched
  targetAgencies?: string[];
  locationState?: string;
  locationStates?: string[];
  locationZip?: string;
  alertFrequency?: 'daily' | 'weekly';
  source?: string;            // e.g., "opportunity-hunter-free", "free-signup", "paid_existing"
  referralCode?: string;      // Partner code e.g. NCMBC
  inviteToken?: string;       // Magic link token for paid subscriber activation
  stripeCustomerId?: string;  // Stripe customer ID from invitation verification
  businessDescription?: string | null;
}

/**
 * POST /api/alerts/save-profile
 * Save or update a daily alert profile.
 */
export async function POST(request: NextRequest) {
  try {
    const body: AlertProfileRequest = await request.json();
    const {
      email,
      naicsCodes,
      naicsInput,
      pscCode,
      businessType,
      targetAgencies,
      locationState,
      locationStates,
      locationZip,
      alertFrequency,
      source,
      referralCode,
      inviteToken,
      // stripeCustomerId from the body is deliberately NOT read — the invitation row supplies it.
      businessDescription,
    } = body;

    // Log signup started event (non-blocking)
    const partnerSource = partnerReferralSourceLabel(referralCode);
    const signupSource = partnerSource || source || 'unknown';

    logSignupEvent({
      eventType: SignupEventType.SIGNUP_STARTED,
      source: signupSource,
      userEmail: email,
      ipAddress: extractIpAddress(request),
      userAgent: extractUserAgent(request),
      metadata: { hasNaics: !!naicsCodes?.length, hasPsc: !!pscCode },
    }).catch(() => {}); // Fire and forget

    if (!email) {
      // Log validation failure
      logSignupFailed(source || 'unknown', new Error('Email is required'), undefined, SignupStep.EMAIL).catch(() => {});
      return NextResponse.json(
        { success: false, error: 'Email is required' },
        { status: 400 }
      );
    }

    // Free tier sources don't require MA Premium access
    // paid_existing = subscriber activated via magic link invitation
    // free_signup / free-signup = MI Free signup from /alerts/signup
    const isFreeSource = source === 'opportunity-hunter-free' || source === 'free-signup' || source === 'free_signup' || source === 'paid_existing';

    // SECURITY (P0, 2026-09-28): only a VERIFIED identity may mutate a user's saved state —
    // never the body email, a query email, the plaintext cookie or a claimed staff address.
    // See src/lib/alerts/save-profile-identity.ts. An anonymous caller may only CREATE a row
    // for an email with no saved state (enforced below: existing row → 401, pure INSERT).
    const identity = await resolveSaveProfileIdentity(request, email, {
      source,
      inviteToken,
      lookupInvitation: async (token) => {
        const { data, error } = await getSupabase()
          .from('invitation_tokens')
          .select('email, used_at, expires_at')
          .eq('token', token)
          .maybeSingle();
        return { row: data as InvitationRow | null, error: error ? error.message : null };
      },
    });
    if (identity.kind === 'rejected') {
      logSignupFailed(source || 'unknown', new Error(identity.code), email).catch(() => {});
      return NextResponse.json(
        { success: false, error: identity.error, code: identity.code },
        { status: identity.status }
      );
    }
    // The Pro alert profile (a non-free source) needs a verified identity — it used to accept
    // the weak cookie / staff claim.
    if (!isFreeSource && identity.kind !== 'verified') {
      logSignupFailed(source || 'unknown', new Error('sign_in_required'), email).catch(() => {});
      return NextResponse.json(
        { success: false, error: 'Please sign in to save alerts.', code: 'sign_in_required' },
        { status: 401 }
      );
    }
    const verifiedEmail = identity.email;
    const anonymous = identity.kind === 'anonymous';

    // Collect all NAICS codes from various inputs
    const allNaicsCodes: string[] = [];

    // 1. Direct array of NAICS codes
    if (naicsCodes && naicsCodes.length > 0) {
      allNaicsCodes.push(...naicsCodes);
    }

    // 2. Comma-separated string input
    if (naicsInput) {
      const parsed = parseNAICSInput(naicsInput);
      allNaicsCodes.push(...parsed);
    }

    // 3. PSC code → expand to related NAICS codes
    if (pscCode) {
      const pscMatches = getNAICSForPSC(pscCode, 15); // Top 15 related NAICS
      const pscNaics = pscMatches.map(m => m.naicsCode);
      console.log(`[Alerts] PSC ${pscCode} expanded to ${pscNaics.length} NAICS codes`);
      allNaicsCodes.push(...pscNaics);
    }

    // Free tier can register without NAICS (they'll get general alerts)
    if (allNaicsCodes.length === 0 && !isFreeSource) {
      return NextResponse.json(
        { success: false, error: 'At least one NAICS code or PSC code is required' },
        { status: 400 }
      );
    }

    // Expand short PREFIXES ("236" → all 236xxx) but KEEP fully-specified 6-digit
    // codes EXACT (expandFullCodes=false). Blowing 561710 (pest control) out to its
    // whole 561 family re-buried the user under unrelated office-admin/security/
    // telemarketing codes they never picked, and polluted alert matching. The
    // matcher widens to the 4-digit industry group at query time for recall, so we
    // persist what the user actually chose.
    // Short prefixes now map to a CURATED coverage set rather than the whole
    // family — one "Professional Services" (['541']) click used to persist all 51
    // codes of the 541 subsector. See normalizeNAICSForPersist.
    if (allNaicsCodes.length > 0) {
      const naicsCheck = validateMarketCodesInput(allNaicsCodes, pscCode ? [pscCode] : undefined);
      if (!naicsCheck.ok) {
        return NextResponse.json({ success: false, error: naicsCheck.error }, { status: 400 });
      }
    } else if (pscCode) {
      const pscCheck = validateMarketCodesInput(undefined, [pscCode]);
      if (!pscCheck.ok) {
        return NextResponse.json({ success: false, error: pscCheck.error }, { status: 400 });
      }
    }
    const expandedNaics = allNaicsCodes.length > 0 ? normalizeNAICSForPersist(allNaicsCodes) : [];
    checkAmplification('naics_codes', allNaicsCodes, expandedNaics, {
      route: '/api/alerts/save-profile',
    });
    if (allNaicsCodes.length > 0) {
      console.log(`[Alerts] Normalized ${allNaicsCodes.length} input codes to ${expandedNaics.length} NAICS codes (6-digit kept exact)`);
    }

    // For paid features (Pro), verify MA Premium access
    // Free tier from OH can register without paid access
    if (!isFreeSource) {
      const { data: profile } = await getSupabase()
        .from('user_profiles')
        .select('access_assassin_premium')
        .eq('email', verifiedEmail)
        .single();

      if (!profile?.access_assassin_premium) {
        return NextResponse.json(
          { success: false, error: 'MA Premium access required for alerts' },
          { status: 403 }
        );
      }
    }

    const { data: existingSave, error: existingSaveErr } = await getSupabase()
      .from('user_notification_settings')
      .select('user_email, alerts_enabled, alert_frequency, is_active, briefings_enabled')
      .eq('user_email', verifiedEmail)
      .maybeSingle();
    if (existingSaveErr) {
      console.error('[Alerts] existing settings read failed:', existingSaveErr.message);
      return NextResponse.json(
        { success: false, error: 'Could not read current delivery settings' },
        { status: 500 },
      );
    }
    // An anonymous caller never touches an EXISTING user's state (that was the overwrite hole).
    if (anonymous && existingSave) {
      logSignupFailed(source || 'unknown', new Error(SIGN_IN_REQUIRED.code), email).catch(() => {});
      return NextResponse.json(
        { success: false, error: SIGN_IN_REQUIRED.error, code: SIGN_IN_REQUIRED.code },
        { status: 401 }
      );
    }
    const delivery = saveProfileAlertDeliveryPatch(existingSave, alertFrequency);

    // Build upsert payload
    // PARTIAL update for an existing row: only fields the request actually carries
    // are written — an omitted/blank/defaulted business type, agency list, location
    // or empty NAICS list leaves the stored value untouched. New rows keep defaults.
    const upsertPayload: Record<string, unknown> = {
      user_email: verifiedEmail,
      ...buildSaveProfileTargetingPatch({
        rowExists: !!existingSave,
        expandedNaics,
        businessType,
        targetAgencies,
        locationState,
        locationStates,
        locationZip,
      }),
      is_active: true,
      alerts_enabled: delivery.alerts_enabled,
      alert_frequency: delivery.alert_frequency,
      updated_at: new Date().toISOString(),
    };

    const cleanBusinessDescription = typeof businessDescription === 'string'
      ? businessDescription.trim()
      : '';

    // Production does not have user_notification_settings.business_description yet.
    // Store the description in user_business_profiles below until the migration is applied.

    // Partner referral (e.g. NCMBC) — 30-day Pro trial, tagged cohort
    let partnerReferralApplied = false;
    // A partner referral grants a 30-day Pro trial, so it requires a VERIFIED identity — an
    // anonymous signup cannot grant Pro (P0 2026-09-28). A verified sign-up still gets it via
    // /api/auth/mi-signup or /api/app/profile.
    if (referralCode && anonymous) {
      console.log(`[Alerts] Partner referral not applied to an anonymous signup (sign-in required): ${verifiedEmail}`);
    }
    if (referralCode && !anonymous) {
      try {
        const partnerResult = await applyPartnerReferralIfEligible(
          getSupabase(),
          verifiedEmail,
          referralCode,
        );
        partnerReferralApplied = partnerResult.applied;
        if (partnerResult.applied && partnerResult.partner) {
          upsertPayload.briefings_enabled = true;
          upsertPayload.treatment_type = 'briefings';
          upsertPayload.invitation_source = partnerResult.partner.invitationSource;
          upsertPayload.trial_source = partnerResult.partner.trialSource;
          upsertPayload.trial_ends_at = partnerResult.trialEndsAt;
          console.log(`[Alerts] Partner referral ${partnerResult.partner.code} applied: ${verifiedEmail}`);
        }
      } catch (partnerError) {
        console.warn('[Alerts] Partner referral apply failed:', partnerError);
      }
    }

    // free_signup = MI Free tier signup (alerts only, no AI briefings)
    if (source === 'free_signup' && !partnerReferralApplied) {
      upsertPayload.briefings_enabled = false;
      upsertPayload.treatment_type = 'alerts';
      console.log(`[Alerts] MI Free signup: ${email} - Daily Alerts only, no briefings`);
    }

    // paid_existing = subscriber activated via magic link invitation
    // They get FULL Daily Briefings access ($49/mo value), not just Daily Alerts
    // paid_existing: the invitation is SINGLE-USE. Claim it atomically (used_at IS NULL and
    // unexpired → exactly one row) BEFORE anything is granted, so a replay or a concurrent
    // second request finds it used and gets 401. The Stripe customer comes from the
    // invitation, never the request body. The KV Pro grant runs only after the profile write
    // succeeds; a failed write releases the claim.
    let claimedInviteToken: string | null = null;
    if (source === 'paid_existing') {
      const nowIso = new Date().toISOString();
      // Exact count, never a RETURNING payload (INT-005): a NULL count is unknown, not success.
      const { count: claimedCount, error: claimErr } = await getSupabase()
        .from('invitation_tokens')
        .update({ used_at: nowIso }, { count: 'exact' })
        .eq('token', String(inviteToken))
        .is('used_at', null)
        .gt('expires_at', nowIso);
      if (claimErr || claimedCount !== 1) {
        if (claimErr) console.error('[Alerts] invitation claim failed:', claimErr.message);
        logSignupFailed(source, new Error('invite_already_used'), email).catch(() => {});
        return NextResponse.json(
          { success: false, error: 'This activation link has already been used or has expired.', code: 'invite_required' },
          { status: 401 }
        );
      }
      claimedInviteToken = String(inviteToken);
      // Enable Daily Briefings (includes Daily Market Intel + Weekly Deep Dive + Pursuit Brief)
      upsertPayload.briefings_enabled = true;
      upsertPayload.invitation_sent_at = nowIso;
      upsertPayload.invitation_source = 'invitation_campaign';
      const { data: inviteRow, error: inviteReadErr } = await getSupabase()
        .from('invitation_tokens')
        .select('stripe_customer_id')
        .eq('token', claimedInviteToken)
        .maybeSingle();
      if (inviteReadErr) console.error('[Alerts] invitation customer read failed:', inviteReadErr.message);
      const inviteCustomer = (inviteRow as { stripe_customer_id?: string | null } | null)?.stripe_customer_id;
      if (inviteCustomer) upsertPayload.stripe_customer_id = inviteCustomer;
    }

    if (!existingSave) {
      upsertPayload.aggregated_profile = mergeAlertModeIntoAggregated(
        null,
        defaultAlertModeForNewUser([]),
      );
    }

    // Existing row → UPDATE only the submitted columns (an upsert's insert tuple
    // would need every NOT NULL column). New row → upsert with defaults.
    const { data, error } = existingSave
      ? await getSupabase()
          .from('user_notification_settings')
          // truncation-ok: eq on the unique user_email — this update cannot return 1,000 rows
          .update(upsertPayload)
          .eq('user_email', verifiedEmail)
          .select()
          .single()
      : anonymous
        // Anonymous → pure INSERT: if a row appeared since the read (a race), the unique
        // user_email constraint refuses it instead of overwriting someone's state.
        ? await getSupabase()
            .from('user_notification_settings')
            .insert(upsertPayload)
            .select()
            .single()
        : await getSupabase()
            .from('user_notification_settings')
            // truncation-ok: one user_email conflict target — this upsert cannot return 1,000 rows
            .upsert(upsertPayload, {
              onConflict: 'user_email',
            })
            .select()
            .single();

    if (error && anonymous && (error as { code?: string }).code === '23505') {
      logSignupFailed(source || 'unknown', new Error(SIGN_IN_REQUIRED.code), email).catch(() => {});
      return NextResponse.json(
        { success: false, error: SIGN_IN_REQUIRED.error, code: SIGN_IN_REQUIRED.code },
        { status: 401 }
      );
    }

    if (error && claimedInviteToken) {
      // The profile did not save — give the invitation back so the subscriber can retry.
      const { error: releaseErr } = await getSupabase()
        .from('invitation_tokens')
        .update({ used_at: null })
        .eq('token', claimedInviteToken);
      if (releaseErr) console.error('[Alerts] invitation release failed:', releaseErr.message);
    }

    if (error) {
      console.error('[Alerts] Error saving profile:', error);
      // Log database error
      logSignupFailed(source || 'unknown', error, email, SignupStep.DELIVERY).catch(() => {});
      const errorMessage = error.message || 'Failed to save alert profile';
      return NextResponse.json(
        { success: false, error: errorMessage },
        { status: 500 }
      );
    }

    if (claimedInviteToken) {
      // Grant KV access for briefings (gates actual tool access) — only after the write landed.
      try {
        await grantBriefingsAccess(verifiedEmail);
        console.log(`[Alerts] Paid subscriber activated via invitation: ${verifiedEmail} - Daily Briefings enabled`);
      } catch (kvError) {
        console.warn(`[Alerts] KV error granting briefings to ${verifiedEmail}:`, kvError);
      }
    }

    // Log successful signup completion
    logSignupCompleted(signupSource, verifiedEmail, {
      naicsCount: expandedNaics.length,
      agencyCount: targetAgencies?.length || 0,
      isPaidSource: source === 'paid_existing',
    }).catch(() => {});

    console.log(`[Alerts] Saved alert profile for ${email}: ${expandedNaics.length} NAICS codes, ${targetAgencies?.length || 0} agencies`);

    // PARTIAL update: only a non-blank description is written. The signup form's
    // box is never pre-filled from the stored value and sends `trim() || null`
    // when left empty — that is an untouched box, NOT a clear, so it must not
    // wipe a description a returning user already wrote.
    if (cleanBusinessDescription) {
      try {
        const nowIso = new Date().toISOString();
        const { error: mirrorErr } = await getSupabase()
          .from('user_business_profiles')
          .upsert({
            user_email: verifiedEmail,
            business_description: cleanBusinessDescription,
            business_description_updated_at: nowIso,
            updated_at: nowIso,
            // Anonymous (new-signup) writes are insert-if-absent: never overwrite a business
            // profile that already exists for this email.
          }, { onConflict: 'user_email', ignoreDuplicates: anonymous });
        if (mirrorErr) throw mirrorErr;
      } catch (businessProfileError) {
        console.warn('[Alerts] Could not mirror business description:', businessProfileError);
      }
    }

    // Send welcome email with opportunity preview (async, don't block response)
    sendWelcomeEmailWithOpportunities(
      verifiedEmail,
      expandedNaics,
      targetAgencies || []
    ).catch(err => console.warn('[Alerts] Welcome email failed:', err));

    return NextResponse.json({
      success: true,
      message: 'Alert profile saved. You will receive daily opportunity alerts.',
      data: {
        email: data.user_email,
        naicsCodes: data.naics_codes,
        naicsCount: data.naics_codes?.length || 0,
        inputCodes: allNaicsCodes.length,
        expandedCodes: expandedNaics.length,
        businessDescription: data.business_description || null,
        businessDescriptionStored: cleanBusinessDescription || null,
        businessType: data.business_type,
        targetAgencies: data.agencies,
        frequency: data.alert_frequency,
      },
    });
  } catch (error) {
    console.error('[Alerts] Error:', error);
    // Log catch-all error
    logSignupFailed('unknown', error, undefined).catch(() => {});
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Send welcome email with initial opportunity report
 * Provides immediate value/gratification after signup
 */
async function sendWelcomeEmailWithOpportunities(
  email: string,
  naicsCodes: string[],
  agencies: string[]
): Promise<void> {
  console.log(`[Alerts] Sending welcome email to ${email} with ${naicsCodes.length} NAICS codes`);

  // Fetch opportunities matching their profile (top 8)
  const { opportunities } = await fetchSamOpportunitiesFromCache({
    naicsCodes: naicsCodes.slice(0, 10), // Use top 10 NAICS codes
    agencies: agencies.length > 0 ? agencies : undefined,
    limit: 8,
  });

  const oppCount = opportunities.length;
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
  });

  // Generate opportunity rows HTML
  const opportunityRows = opportunities.slice(0, 8).map(opp => {
    const deadline = opp.responseDeadline
      ? new Date(opp.responseDeadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : 'TBD';
    const daysLeft = opp.responseDeadline
      ? Math.ceil((new Date(opp.responseDeadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
      : null;
    const urgency = daysLeft !== null && daysLeft <= 7
      ? `<span style="color:#dc2626;font-weight:bold;">🔥 ${daysLeft}d</span>`
      : daysLeft !== null && daysLeft <= 14
      ? `<span style="color:#d97706;">⚡ ${daysLeft}d</span>`
      : '';

    return `
      <tr style="border-bottom:1px solid #e5e7eb;">
        <td style="padding:12px 8px;vertical-align:top;">
          <a href="${opp.uiLink}" style="color:#7c3aed;text-decoration:none;font-weight:600;">
            ${opp.title.slice(0, 80)}${opp.title.length > 80 ? '...' : ''}
          </a>
          <div style="font-size:12px;color:#6b7280;margin-top:4px;">
            ${opp.department || 'Federal Agency'} • ${opp.naicsCode || 'N/A'}
            ${opp.setAsideDescription ? ` • <span style="color:#059669;">${opp.setAsideDescription}</span>` : ''}
          </div>
        </td>
        <td style="padding:12px 8px;text-align:right;white-space:nowrap;">
          <div style="font-weight:500;">${deadline}</div>
          ${urgency ? `<div style="font-size:11px;">${urgency}</div>` : ''}
        </td>
      </tr>
    `;
  }).join('');

  const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f3f4f6;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#7c3aed 0%,#6d28d9 100%);padding:32px 24px;text-align:center;">
      <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;">
        🎯 Welcome to Daily Alerts!
      </h1>
      <p style="margin:8px 0 0;color:#e9d5ff;font-size:14px;">
        Your federal contracting opportunities are ready
      </p>
    </div>

    <!-- Main Content -->
    <div style="padding:24px;">
      <p style="margin:0 0 16px;color:#374151;font-size:15px;">
        Great news! We found <strong style="color:#7c3aed;">${oppCount} active opportunities</strong>
        matching your profile. Here's your first preview:
      </p>

      ${oppCount > 0 ? `
      <!-- Opportunities Table -->
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <thead>
          <tr style="background:#f9fafb;">
            <th style="padding:12px 8px;text-align:left;font-size:12px;color:#6b7280;text-transform:uppercase;">Opportunity</th>
            <th style="padding:12px 8px;text-align:right;font-size:12px;color:#6b7280;text-transform:uppercase;">Deadline</th>
          </tr>
        </thead>
        <tbody>
          ${opportunityRows}
        </tbody>
      </table>
      ` : `
      <div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:16px;margin:16px 0;">
        <p style="margin:0;color:#92400e;font-size:14px;">
          We're still indexing opportunities for your NAICS codes. Your first daily alert will arrive tomorrow morning!
        </p>
      </div>
      `}

      <!-- What's Next -->
      <div style="background:#f0fdf4;border:1px solid #10b981;border-radius:8px;padding:16px;margin:24px 0;">
        <h3 style="margin:0 0 8px;color:#065f46;font-size:16px;">📬 What happens next?</h3>
        <ul style="margin:0;padding-left:20px;color:#047857;font-size:14px;">
          <li style="margin-bottom:6px;">You'll receive <strong>daily opportunity alerts</strong> at 7 AM ET</li>
          <li style="margin-bottom:6px;">Each email shows new opportunities matching your NAICS codes</li>
          <li>Deadlines, set-asides, and quick links to SAM.gov</li>
        </ul>
      </div>

      <!-- Upgrade CTA -->
      <div style="background:linear-gradient(135deg,#1e3a8a 0%,#7c3aed 100%);border-radius:12px;padding:24px;margin:24px 0;text-align:center;">
        <h3 style="margin:0 0 8px;color:#ffffff;font-size:18px;">🚀 Want More Intelligence?</h3>
        <p style="margin:0 0 16px;color:#e0e7ff;font-size:14px;">
          Upgrade to <strong>Market Intelligence Pro</strong> for AI briefings, win probability scoring, and weekly deep dives.
        </p>
        <a href="https://getmindy.ai/market-intelligence"
           style="display:inline-block;background:#ffffff;color:#7c3aed;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">
          Learn More →
        </a>
      </div>
    </div>

    <!-- Footer -->
    <div style="background:#f9fafb;padding:24px;text-align:center;border-top:1px solid #e5e7eb;">
      <p style="margin:0 0 8px;color:#6b7280;font-size:12px;">
        You're receiving this because you signed up for Daily Alerts.
      </p>
      <p style="margin:0;color:#9ca3af;font-size:11px;">
        GovCon Giants AI • <a href="mailto:hello@getmindy.ai" style="color:#7c3aed;">hello@getmindy.ai</a>
      </p>
    </div>
  </div>
</body>
</html>
  `;

  const sent = await sendEmail({
    to: email,
    subject: `🎯 Welcome! ${oppCount} Opportunities Match Your Profile`,
    html: emailHtml,
    emailType: 'welcome_alerts',
    tags: {
      type: 'welcome_alerts',
      opportunity_count: oppCount,
    },
  });

  if (sent) {
    console.log(`[Alerts] Welcome email sent to ${email} with ${oppCount} opportunities`);
  } else {
    console.warn(`[Alerts] Welcome email failed for ${email}`);
  }
}

/**
 * GET /api/alerts/save-profile?email=xxx
 * Get current alert profile for a user
 */
export async function GET(request: NextRequest) {
  try {
    const email = request.nextUrl.searchParams.get('email');

    if (!email) {
      return NextResponse.json(
        { success: false, error: 'Email is required' },
        { status: 400 }
      );
    }

    // SECURITY: Verify user owns this email
    // Strong identity only (P0 2026-09-28): the plaintext cookie / claimed staff address used to
    // read any user's saved targeting here.
    const auth = await verifyUserOwnsEmail(request, email, { requireStrongAuth: true });
    if (!auth.authenticated) {
      return NextResponse.json(
        { success: false, error: auth.error || 'Unauthorized' },
        { status: 401 }
      );
    }

    const { data, error } = await getSupabase()
      .from('user_notification_settings')
      .select('*')
      .eq('user_email', auth.email!)
      .single();

    if (error || !data) {
      return NextResponse.json({
        success: true,
        data: null,
        message: 'No alert profile found',
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        email: data.user_email,
        naicsCodes: data.naics_codes,
        businessType: data.business_type,
        targetAgencies: data.agencies,
        locationState: data.location_state,
        locationZip: data.location_zip,
        frequency: data.alert_frequency,
        isActive: data.is_active,
        lastAlertSent: data.last_alert_sent,
        totalAlertsSent: data.total_alerts_sent,
      },
    });
  } catch (error) {
    console.error('[Alerts] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
