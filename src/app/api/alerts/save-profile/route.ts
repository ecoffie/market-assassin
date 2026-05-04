import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { expandNAICSCodes, parseNAICSInput } from '@/lib/utils/naics-expansion';
import { getNAICSForPSC } from '@/lib/utils/psc-crosswalk';
import { grantBriefingsAccess } from '@/lib/briefings/access';

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
  businessType: string;
  targetAgencies?: string[];
  locationState?: string;
  locationStates?: string[];
  locationZip?: string;
  alertFrequency?: 'daily' | 'weekly';
  source?: string;            // e.g., "opportunity-hunter-free", "free-signup", "paid_existing"
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
      inviteToken,
      stripeCustomerId,
      businessDescription,
    } = body;

    if (!email) {
      return NextResponse.json(
        { success: false, error: 'Email is required' },
        { status: 400 }
      );
    }

    // Free tier sources don't require MA Premium access
    // paid_existing = subscriber activated via magic link invitation
    // free_signup / free-signup = MI Free signup from /alerts/signup
    const isFreeSource = source === 'opportunity-hunter-free' || source === 'free-signup' || source === 'free_signup' || source === 'paid_existing';

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

    // Expand prefixes to full 6-digit codes (e.g., "236" → all 236xxx codes)
    const expandedNaics = allNaicsCodes.length > 0 ? expandNAICSCodes(allNaicsCodes) : [];
    if (allNaicsCodes.length > 0) {
      console.log(`[Alerts] Expanded ${allNaicsCodes.length} input codes to ${expandedNaics.length} NAICS codes`);
    }

    // For paid features (Pro), verify MA Premium access
    // Free tier from OH can register without paid access
    if (!isFreeSource) {
      const { data: profile } = await getSupabase()
        .from('user_profiles')
        .select('access_assassin_premium')
        .eq('email', email.toLowerCase())
        .single();

      if (!profile?.access_assassin_premium) {
        return NextResponse.json(
          { success: false, error: 'MA Premium access required for alerts' },
          { status: 403 }
        );
      }
    }

    // Build upsert payload
    const upsertPayload: Record<string, unknown> = {
      user_email: email.toLowerCase(),
      naics_codes: expandedNaics.length > 0 ? expandedNaics : [],
      business_type: businessType || null,
      agencies: targetAgencies || [],
      location_state: locationState || null,
      location_states: Array.isArray(locationStates) ? locationStates : [],
      location_zip: locationZip || null,
      is_active: true,
      alerts_enabled: true,
      alert_frequency: alertFrequency === 'weekly' ? 'weekly' : 'daily',
      updated_at: new Date().toISOString(),
    };

    const cleanBusinessDescription = typeof businessDescription === 'string'
      ? businessDescription.trim()
      : '';

    // Production does not have user_notification_settings.business_description yet.
    // Store the description in user_business_profiles below until the migration is applied.

    // free_signup = MI Free tier signup (alerts only, no AI briefings)
    if (source === 'free_signup') {
      upsertPayload.briefings_enabled = false;
      upsertPayload.treatment_type = 'alerts';
      console.log(`[Alerts] MI Free signup: ${email} - Daily Alerts only, no briefings`);
    }

    // paid_existing = subscriber activated via magic link invitation
    // They get FULL Daily Briefings access ($49/mo value), not just Daily Alerts
    if (source === 'paid_existing') {
      // Enable Daily Briefings (includes Daily Market Intel + Weekly Deep Dive + Pursuit Brief)
      upsertPayload.briefings_enabled = true;

      // Track invitation cohort for 90-day analysis
      if (inviteToken) {
        upsertPayload.invitation_sent_at = new Date().toISOString();
        upsertPayload.invitation_source = 'invitation_campaign';
      }
      if (stripeCustomerId) {
        upsertPayload.stripe_customer_id = stripeCustomerId;
      }

      // Grant KV access for briefings (gates actual tool access)
      try {
        await grantBriefingsAccess(email);
        console.log(`[Alerts] Granted briefings access to paid subscriber: ${email}`);
      } catch (kvError) {
        console.warn(`[Alerts] KV error granting briefings to ${email}:`, kvError);
        // Continue anyway - database flag will work as fallback
      }

      console.log(`[Alerts] Paid subscriber activated: ${email} (Stripe: ${stripeCustomerId || 'unknown'}) - Daily Briefings enabled`);
    }

    // Upsert notification settings (unified table)
    const { data, error } = await getSupabase()
      .from('user_notification_settings')
      .upsert(upsertPayload, {
        onConflict: 'user_email',
      })
      .select()
      .single();

    if (error) {
      console.error('[Alerts] Error saving profile:', error);
      const errorMessage = error.message || 'Failed to save alert profile';
      return NextResponse.json(
        { success: false, error: errorMessage },
        { status: 500 }
      );
    }

    console.log(`[Alerts] Saved alert profile for ${email}: ${expandedNaics.length} NAICS codes, ${targetAgencies?.length || 0} agencies`);

    if (businessDescription !== undefined) {
      try {
        await getSupabase()
          .from('user_business_profiles')
          .upsert({
            user_email: email.toLowerCase().trim(),
            business_description: cleanBusinessDescription || null,
            business_description_updated_at: cleanBusinessDescription ? new Date().toISOString() : null,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'user_email' });
      } catch (businessProfileError) {
        console.warn('[Alerts] Could not mirror business description:', businessProfileError);
      }
    }

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
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
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

    const { data, error } = await getSupabase()
      .from('user_notification_settings')
      .select('*')
      .eq('user_email', email.toLowerCase())
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
