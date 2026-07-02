import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyUserSession } from '@/lib/api-auth';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { expandNAICSCodes } from '@/lib/utils/naics-expansion';
import { applyPartnerReferralIfEligible } from '@/lib/mindy/apply-partner-referral';
import { resolveActiveWorkspace, clientNotificationEmail } from '@/lib/app/workspace';

/**
 * MI Beta Profile API
 * Saves user profile data from onboarding wizard
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      email,
      businessDescription,
      naicsCodes,
      pscCodes,
      keywords,
      setAsides,
      businessType,
      targetAgencies,
      locationState,
      locationStates,
      locationZip,
      alertFrequency,
      onboardingComplete,
      referralCode,
      // precise=true → save the codes EXACTLY as given, no prefix expansion at all.
      // Onboarding's keyword-derived path already returns the tight ~8-code coverage
      // set; expanding even prefixes there bloats it to 31 (Eric QC 2026-06-17:
      // "construction" saved 31 codes + NAICS-title keywords). Tight by default;
      // breadth is an explicit opt-in elsewhere, not an accident here.
      precise,
    } = body;

    if (!email) {
      return NextResponse.json({ error: 'Email required' }, { status: 400 });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Auth via the MI session (x-mi-auth-token), matching the rest of /api/app/*
    // and what the client actually sends. The previous verifyUserSession() required
    // an Authorization: Bearer <supabase token> the Market Research save never sent,
    // so every "Save this market to my profile" 401'd with "Missing or invalid
    // authorization header" and nothing persisted (Eric, Jun 22 2026).
    const authSession = requireMIAuthSession(request, normalizedEmail);
    if (!authSession.ok) return authSession.response;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      console.error('[MI Beta Profile] Supabase not configured');
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const rawNaicsCodes = Array.isArray(naicsCodes)
      ? naicsCodes.map(code => String(code).trim()).filter(Boolean)
      : [];
    // expandFullCodes=false: persist precise 6-digit codes EXACTLY (the keyword-
    // first coverage set the onboarding banner showed — e.g. demolition's 6 codes),
    // never blown out to whole families (562910 → all 562x). Short prefixes a user
    // types ("238") still expand. Keyword search does the broadening now, not NAICS.
    // precise=true: keep codes exactly (no expansion, even prefixes). Otherwise
    // expandFullCodes=false (6-digit stay exact; short prefixes expand to family).
    const expandedNaicsCodes = rawNaicsCodes.length === 0
      ? []
      : precise
        ? Array.from(new Set(rawNaicsCodes))
        : expandNAICSCodes(rawNaicsCodes, false);
    const safeSetAsides = Array.isArray(setAsides)
      ? setAsides.map(value => String(value).trim()).filter(Boolean)
      : [];
    const safeAgencies = Array.isArray(targetAgencies)
      ? targetAgencies.map(value => String(value).trim()).filter(Boolean)
      : [];
    const safeStates = Array.isArray(locationStates)
      ? locationStates.map(value => String(value).trim()).filter(Boolean)
      : [];

    // Update user_notification_settings with profile data
    const updateData: Record<string, unknown> = {
      alerts_enabled: true,
      updated_at: new Date().toISOString(),
    };

    // The user's OWN words (from the describe-your-business step) are the best
    // search signal — far better than back-deriving keywords from NAICS. Persist
    // them directly so onboarding stops throwing them away (the keyword-empty
    // profile bug). Dedup + lowercase + cap to keep the array sane.
    const safeKeywords = Array.isArray(keywords)
      ? Array.from(new Set(
          keywords.map((k) => String(k).trim().toLowerCase()).filter(Boolean),
        )).slice(0, 30)
      : [];

    // Only update fields that were provided
    let deriveKw: string[] = [];
    if (safeKeywords.length > 0) {
      updateData.keywords = safeKeywords;
    }
    if (expandedNaicsCodes.length > 0) {
      updateData.naics_codes = expandedNaicsCodes;
      // Auto-derive search keywords from the NAICS so search widens beyond NAICS
      // (Eric's "drone problem"). Applied AFTER the update below, only when the
      // user supplied NO keywords AND has none yet — never clobbers tuned keywords.
      if (safeKeywords.length === 0) {
        try {
          const { deriveKeywordsFromNaics } = await import('@/lib/utils/derive-keywords');
          deriveKw = deriveKeywordsFromNaics(expandedNaicsCodes);
        } catch { /* non-fatal */ }
      }
    }

    // PSC codes — what was actually BOUGHT (the most precise opportunity signal).
    // Written into updateData; if the psc_codes column doesn't exist yet, the
    // write below retries without it (see the column-guard around settingsWrite).
    const safePscCodes = Array.isArray(pscCodes)
      ? Array.from(new Set(pscCodes.map((c: unknown) => String(c).trim().toUpperCase()).filter(Boolean))).slice(0, 30)
      : null;
    if (safePscCodes) {
      updateData.psc_codes = safePscCodes;
    }

    if (Array.isArray(setAsides)) {
      updateData.set_aside_preferences = safeSetAsides;
    }

    if (businessType !== undefined) {
      updateData.business_type = typeof businessType === 'string' && businessType.trim()
        ? businessType.trim()
        : null;
    }

    if (Array.isArray(targetAgencies)) {
      updateData.agencies = safeAgencies;
    }

    if (Array.isArray(locationStates)) {
      updateData.location_states = safeStates;
      updateData.location_state = safeStates[0] || null;
    } else if (typeof locationState === 'string') {
      updateData.location_state = locationState.trim() || null;
    }

    if (typeof locationZip === 'string') {
      updateData.location_zip = locationZip.trim() || null;
    }

    if (
      alertFrequency === 'daily' ||
      alertFrequency === 'weekdays' ||
      alertFrequency === 'weekends' ||
      alertFrequency === 'weekly' ||
      alertFrequency === 'paused'
    ) {
      updateData.alert_frequency = alertFrequency;
      // Keep alerts_enabled in sync with paused so the daily-alerts cron
      // doesn't keep emailing users who chose Paused at onboarding.
      if (alertFrequency === 'paused') {
        updateData.alerts_enabled = false;
      }
    }

    // Coach Mode: a "save to profile" from Market Research while operating AS a
    // client must persist to the CLIENT's row, not the coach's. rowEmail is the
    // client's synthetic notification email when asClient, else the user's own.
    const { workspaceId, asClient } = await resolveActiveWorkspace(normalizedEmail, request);
    const rowEmail = asClient ? clientNotificationEmail(workspaceId) : normalizedEmail;

    const { data: existingSettings } = await supabase
      .from('user_notification_settings')
      .select('user_email, invitation_source, trial_source, agencies, keywords')
      .eq('user_email', rowEmail)
      .maybeSingle();

    if (referralCode && !existingSettings?.invitation_source?.startsWith('partner_')) {
      try {
        await applyPartnerReferralIfEligible(supabase, normalizedEmail, referralCode);
      } catch (partnerError) {
        console.warn('[Mindy Profile] Partner referral apply failed:', partnerError);
      }
    }

    // AUTO-SEED target agencies from the profile (Eric 2026-07-02) — the OTHER slurpee
    // save path (this route == /api/mindy/profile). Mirror the keyword-first seed added
    // to /api/alerts/preferences so agencies populate no matter which onboarding branch
    // a new user takes. Seed when the profile has a targeting signal (NAICS or keyword),
    // the caller didn't set agencies, and stored agencies are empty. KEYWORD-FIRST —
    // keyword is more precise + better covered than NAICS. ALL tiers. Best-effort.
    const effectiveKeywords = Array.isArray(updateData.keywords)
      ? (updateData.keywords as string[])
      : (Array.isArray(existingSettings?.keywords) ? (existingSettings!.keywords as string[]) : []);
    const effectiveNaics = Array.isArray(updateData.naics_codes) ? (updateData.naics_codes as string[]) : [];
    const hasSignal = effectiveKeywords.length > 0 || effectiveNaics.length > 0;
    const callerSetAgencies = Array.isArray(targetAgencies);
    const existingAgencies = Array.isArray(existingSettings?.agencies) ? (existingSettings!.agencies as string[]) : [];
    if (hasSignal && !callerSetAgencies && existingAgencies.length === 0) {
      try {
        const { deriveAgenciesFromProfile } = await import('@/lib/app/derive-agencies-from-naics');
        const base = new URL(request.url).origin;
        const seeded = await deriveAgenciesFromProfile(
          { keywords: effectiveKeywords, naics: effectiveNaics }, base, 10,
        );
        if (seeded.length > 0) updateData.agencies = seeded;
      } catch (e) {
        console.warn('[app/profile] agency auto-seed skipped:', (e as Error).message);
      }
    }

    const baseInsert = {
      user_email: rowEmail,
      treatment_type: 'free',
      alerts_enabled: true,
      briefings_enabled: false,
      alert_frequency: 'daily',
      timezone: 'America/New_York',
      created_at: new Date().toISOString(),
    };
    const runWrite = (payload: Record<string, unknown>) => existingSettings
      ? supabase.from('user_notification_settings').update(payload).eq('user_email', rowEmail)
      : supabase.from('user_notification_settings').insert({ ...baseInsert, ...payload });

    let { error: updateError } = await runWrite(updateData);
    // Column-guard: if psc_codes doesn't exist yet, retry without it so the rest
    // of the profile still saves (PSC starts working once the migration is run).
    if (updateError && /psc_codes/.test(updateError.message)) {
      const { psc_codes: _drop, ...withoutPsc } = updateData;
      void _drop;
      ({ error: updateError } = await runWrite(withoutPsc));
    }

    // Fill auto-derived keywords ONLY if the user has none (never clobber tuned).
    if (!updateError && deriveKw.length > 0) {
      try {
        const { data: cur } = await supabase
          .from('user_notification_settings')
          .select('keywords')
          .eq('user_email', rowEmail)
          .maybeSingle();
        const hasKw = Array.isArray(cur?.keywords) && cur!.keywords.length > 0;
        if (!hasKw) {
          await supabase.from('user_notification_settings')
            .update({ keywords: deriveKw })
            .eq('user_email', rowEmail);
        }
      } catch { /* non-fatal */ }
    }

    if (updateError) {
      console.error('[Mindy Profile] Update error:', updateError);
      // Surface the Supabase error message so the client can show a useful
      // hint instead of just a red "Failed to update profile" banner. The
      // generic copy made it impossible for affected users (and support) to
      // know whether the failure was auth, RLS, schema mismatch, etc.
      return NextResponse.json(
        {
          success: false,
          error: `Could not save profile: ${updateError.message || 'unknown database error'}`,
          code: updateError.code,
          details: updateError.details || undefined,
        },
        { status: 500 }
      );
    }

    // Also update user_business_profiles if it exists
    const { data: existingProfile } = await supabase
      .from('user_business_profiles')
      .select('user_email')
      .eq('user_email', rowEmail)
      .maybeSingle();

    if (existingProfile) {
      await supabase
        .from('user_business_profiles')
        .update({
          business_description: businessDescription || null,
          extracted_naics_codes: expandedNaicsCodes,
          extracted_set_asides: safeSetAsides,
          updated_at: new Date().toISOString(),
        })
        .eq('user_email', rowEmail);
    } else {
      // Create new business profile
      await supabase.from('user_business_profiles').insert({
        user_email: rowEmail,
        business_description: businessDescription || null,
        extracted_naics_codes: expandedNaicsCodes,
        extracted_set_asides: safeSetAsides,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }

    // Auto-seed My Target List from the user's CHOSEN target agencies (add-only,
    // non-blocking). Closes the gap where picked agencies drove filters but never
    // appeared in My Target List. Pro-gated like the rest of Target List. Hybrid:
    // enriched buying offices that match each chosen agency, else a bare row.
    if (safeAgencies.length > 0) {
      try {
        const { verifyMIAccess } = await import('@/lib/api-auth');
        const access = await verifyMIAccess(normalizedEmail);
        if (access.tier !== 'free' || access.isStaff) {
          // Use the user's CURRENT saved codes (this save may be agencies-only).
          const { data: prof } = await supabase
            .from('user_notification_settings')
            .select('naics_codes, location_states')
            .eq('user_email', rowEmail)
            .maybeSingle();
          const { internalBaseUrl } = await import('@/lib/utils/internal-base-url');
          const { seedTargetListFromAgencies } = await import('@/lib/app/seed-target-list');
          const seeded = await seedTargetListFromAgencies({
            supabase,
            base: internalBaseUrl(request),
            rowEmail,
            workspaceId,
            asClient,
            naicsCodes: (prof?.naics_codes || []).map(String).filter(Boolean),
            states: (prof?.location_states || []).map(String).filter(Boolean),
            chosenAgencies: safeAgencies,
          });
          console.log(`[Mindy Profile] Target-list seed for ${rowEmail}:`, seeded);
        }
      } catch (seedErr) {
        console.warn('[Mindy Profile] Target-list seed failed (non-fatal):', seedErr);
      }
    }

    console.log(`[MI Beta Profile] Updated profile for ${normalizedEmail}`, {
      naicsCodes: expandedNaicsCodes.length,
      setAsides: safeSetAsides.length,
      agencies: safeAgencies.length,
      states: safeStates.length,
      hasDescription: !!businessDescription,
      onboardingComplete,
    });

    return NextResponse.json({
      success: true,
      message: 'Profile updated successfully',
    });
  } catch (err) {
    console.error('[MI Beta Profile] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * GET - Fetch user profile
 */
export async function GET(request: NextRequest) {
  try {
    const email = request.nextUrl.searchParams.get('email');

    if (!email) {
      return NextResponse.json({ error: 'Email required' }, { status: 400 });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const auth = await verifyUserSession(request);
    if (!auth.authenticated || auth.email !== normalizedEmail) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data, error } = await supabase
      .from('user_notification_settings')
      .select('user_email, naics_codes, business_type, set_aside_preferences, agencies, location_state, location_states, alert_frequency, treatment_type')
      .eq('user_email', normalizedEmail)
      .maybeSingle();

    if (error) {
      console.error('[MI Beta Profile] Fetch error:', error.message);
      return NextResponse.json({ error: 'Failed to fetch profile' }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      profile: {
        email: data.user_email,
        naicsCodes: data.naics_codes || [],
        businessType: data.business_type || '',
        setAsides: data.set_aside_preferences || [],
        targetAgencies: data.agencies || [],
        locationState: data.location_state || '',
        locationStates: data.location_states || [],
        alertFrequency: data.alert_frequency || 'daily',
        treatmentType: data.treatment_type || 'free',
      },
    });
  } catch (err) {
    console.error('[MI Beta Profile] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
