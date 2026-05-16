import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyUserSession } from '@/lib/api-auth';

/**
 * MI Beta Profile API
 * Saves user profile data from onboarding wizard
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, businessDescription, naicsCodes, setAsides, onboardingComplete } = body;

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

    // Update user_notification_settings with profile data
    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    // Only update fields that were provided
    if (naicsCodes && Array.isArray(naicsCodes) && naicsCodes.length > 0) {
      updateData.naics_codes = naicsCodes;
    }

    if (setAsides && Array.isArray(setAsides)) {
      updateData.set_aside_preferences = setAsides;
    }

    if (businessDescription && typeof businessDescription === 'string') {
      updateData.business_type = businessDescription;
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
          extracted_naics_codes: naicsCodes || [],
          extracted_set_asides: setAsides || [],
          updated_at: new Date().toISOString(),
        })
        .eq('user_email', normalizedEmail);
    } else {
      // Create new business profile
      await supabase.from('user_business_profiles').insert({
        user_email: normalizedEmail,
        business_description: businessDescription || null,
        extracted_naics_codes: naicsCodes || [],
        extracted_set_asides: setAsides || [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }

    console.log(`[MI Beta Profile] Updated profile for ${normalizedEmail}`, {
      naicsCodes: naicsCodes?.length || 0,
      setAsides: setAsides?.length || 0,
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
      .select('user_email, naics_codes, business_type, set_aside_preferences, treatment_type')
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
        businessDescription: data.business_type || '',
        setAsides: data.set_aside_preferences || [],
        treatmentType: data.treatment_type || 'free',
      },
    });
  } catch (err) {
    console.error('[MI Beta Profile] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
