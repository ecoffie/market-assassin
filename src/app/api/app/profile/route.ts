import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyUserSession } from '@/lib/api-auth';
import { expandNAICSCodes } from '@/lib/utils/naics-expansion';

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
      setAsides,
      businessType,
      targetAgencies,
      locationState,
      locationStates,
      locationZip,
      alertFrequency,
      onboardingComplete,
    } = body;

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
      console.error('[MI Beta Profile] Supabase not configured');
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const rawNaicsCodes = Array.isArray(naicsCodes)
      ? naicsCodes.map(code => String(code).trim()).filter(Boolean)
      : [];
    const expandedNaicsCodes = rawNaicsCodes.length > 0 ? expandNAICSCodes(rawNaicsCodes) : [];
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

    // Only update fields that were provided
    if (expandedNaicsCodes.length > 0) {
      updateData.naics_codes = expandedNaicsCodes;
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

    if (alertFrequency === 'daily' || alertFrequency === 'weekly') {
      updateData.alert_frequency = alertFrequency;
    }

    const { data: existingSettings } = await supabase
      .from('user_notification_settings')
      .select('user_email')
      .eq('user_email', normalizedEmail)
      .maybeSingle();

    const settingsWrite = existingSettings
      ? supabase
          .from('user_notification_settings')
          .update(updateData)
          .eq('user_email', normalizedEmail)
      : supabase.from('user_notification_settings').insert({
          user_email: normalizedEmail,
          treatment_type: 'free',
          alerts_enabled: true,
          briefings_enabled: false,
          alert_frequency: 'daily',
          timezone: 'America/New_York',
          created_at: new Date().toISOString(),
          ...updateData,
        });

    const { error: updateError } = await settingsWrite;

    if (updateError) {
      console.error('[MI Beta Profile] Update error:', updateError.message);
      return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 });
    }

    // Also update user_business_profiles if it exists
    const { data: existingProfile } = await supabase
      .from('user_business_profiles')
      .select('user_email')
      .eq('user_email', normalizedEmail)
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
        .eq('user_email', normalizedEmail);
    } else {
      // Create new business profile
      await supabase.from('user_business_profiles').insert({
        user_email: normalizedEmail,
        business_description: businessDescription || null,
        extracted_naics_codes: expandedNaicsCodes,
        extracted_set_asides: safeSetAsides,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
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
