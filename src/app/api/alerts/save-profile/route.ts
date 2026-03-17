import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { expandNAICSCodes, parseNAICSInput } from '@/lib/utils/naics-expansion';
import { getNAICSForPSC } from '@/lib/utils/psc-crosswalk';

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
  locationZip?: string;
  source?: string;            // e.g., "opportunity-hunter-free" for free tier
}

/**
 * POST /api/alerts/save-profile
 * Save or update alert profile for MA Premium user
 * Called after MA report generation
 */
export async function POST(request: NextRequest) {
  try {
    const body: AlertProfileRequest = await request.json();
    const { email, naicsCodes, naicsInput, pscCode, businessType, targetAgencies, locationState, locationZip, source } = body;

    if (!email) {
      return NextResponse.json(
        { success: false, error: 'Email is required' },
        { status: 400 }
      );
    }

    // Free tier sources don't require MA Premium access
    const isFreeSource = source === 'opportunity-hunter-free' || source === 'free-signup';

    // Collect all NAICS codes from various inputs
    let allNaicsCodes: string[] = [];

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

    // Upsert alert settings (note: source is used for access check only, not stored)
    const { data, error } = await getSupabase()
      .from('user_alert_settings')
      .upsert({
        user_email: email.toLowerCase(),
        naics_codes: expandedNaics.length > 0 ? expandedNaics : null,
        business_type: businessType || null,
        target_agencies: targetAgencies || [],
        location_state: locationState || null,
        location_zip: locationZip || null,
        is_active: true,
        alert_frequency: 'weekly',
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'user_email',
      })
      .select()
      .single();

    if (error) {
      console.error('[Alerts] Error saving profile:', error);
      return NextResponse.json(
        { success: false, error: 'Failed to save alert profile' },
        { status: 500 }
      );
    }

    console.log(`[Alerts] Saved alert profile for ${email}: ${expandedNaics.length} NAICS codes, ${targetAgencies?.length || 0} agencies`);

    return NextResponse.json({
      success: true,
      message: 'Alert profile saved. You will receive weekly opportunity alerts.',
      data: {
        email: data.user_email,
        naicsCodes: data.naics_codes,
        naicsCount: data.naics_codes?.length || 0,
        inputCodes: allNaicsCodes.length,
        expandedCodes: expandedNaics.length,
        businessType: data.business_type,
        targetAgencies: data.target_agencies,
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
      .from('user_alert_settings')
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
        targetAgencies: data.target_agencies,
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
