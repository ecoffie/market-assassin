import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Valid timezones for delivery
const VALID_TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'Pacific/Honolulu',
  'America/Anchorage',
];

/**
 * GET /api/alerts/preferences?email=xxx
 * Get alert preferences for a user
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

    const { data, error } = await supabase
      .from('user_alert_settings')
      .select('*')
      .eq('user_email', email.toLowerCase())
      .single();

    if (error || !data) {
      return NextResponse.json({
        success: true,
        data: null,
        message: 'No alert settings found',
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        email: data.user_email,
        naicsCodes: data.naics_codes,
        keywords: data.keywords || [],
        businessType: data.business_type,
        targetAgencies: data.target_agencies,
        locationState: data.location_state,
        frequency: data.alert_frequency,
        timezone: data.timezone || 'America/New_York',
        isActive: data.is_active,
        lastAlertSent: data.last_alert_sent,
        totalAlertsSent: data.total_alerts_sent,
      },
      availableTimezones: [
        { value: 'America/New_York', label: 'Eastern Time (ET)' },
        { value: 'America/Chicago', label: 'Central Time (CT)' },
        { value: 'America/Denver', label: 'Mountain Time (MT)' },
        { value: 'America/Los_Angeles', label: 'Pacific Time (PT)' },
        { value: 'America/Phoenix', label: 'Arizona (no DST)' },
        { value: 'Pacific/Honolulu', label: 'Hawaii Time (HT)' },
        { value: 'America/Anchorage', label: 'Alaska Time (AK)' },
      ],
    });
  } catch (error) {
    console.error('[Alert Preferences] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/alerts/preferences
 * Update alert preferences
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      email,
      frequency,
      timezone,
      isActive,
      naicsCodes,
      keywords,
      businessType,
      targetAgencies,
      locationState,
    } = body;

    if (!email) {
      return NextResponse.json(
        { success: false, error: 'Email is required' },
        { status: 400 }
      );
    }

    // Check if user exists
    const { data: existing } = await supabase
      .from('user_alert_settings')
      .select('user_email')
      .eq('user_email', email.toLowerCase())
      .single();

    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'No alert profile found for this email' },
        { status: 404 }
      );
    }

    // Build update object with only provided fields
    const updates: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (frequency !== undefined) {
      // Now accepts 'daily', 'weekly', or 'paused'
      if (!['daily', 'weekly', 'paused'].includes(frequency)) {
        return NextResponse.json(
          { success: false, error: 'Invalid frequency. Use "daily", "weekly", or "paused"' },
          { status: 400 }
        );
      }
      updates.alert_frequency = frequency;
    }

    if (timezone !== undefined) {
      if (!VALID_TIMEZONES.includes(timezone)) {
        return NextResponse.json(
          { success: false, error: `Invalid timezone. Valid options: ${VALID_TIMEZONES.join(', ')}` },
          { status: 400 }
        );
      }
      updates.timezone = timezone;
    }

    if (isActive !== undefined) {
      updates.is_active = Boolean(isActive);
    }

    if (naicsCodes !== undefined) {
      // Only save numeric codes
      const cleanCodes = Array.isArray(naicsCodes)
        ? naicsCodes.filter((c: string) => /^\d+$/.test(c))
        : [];
      updates.naics_codes = cleanCodes;
    }

    if (keywords !== undefined) {
      updates.keywords = Array.isArray(keywords) ? keywords : [];
    }

    if (businessType !== undefined) {
      updates.business_type = businessType || null;
    }

    if (targetAgencies !== undefined) {
      updates.target_agencies = Array.isArray(targetAgencies) ? targetAgencies : [];
    }

    if (locationState !== undefined) {
      updates.location_state = locationState || null;
    }

    const { data, error } = await supabase
      .from('user_alert_settings')
      .update(updates)
      .eq('user_email', email.toLowerCase())
      .select()
      .single();

    if (error) {
      console.error('[Alert Preferences] Update error:', error);
      return NextResponse.json(
        { success: false, error: 'Failed to update preferences' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Preferences updated',
      data: {
        email: data.user_email,
        frequency: data.alert_frequency,
        timezone: data.timezone,
        isActive: data.is_active,
      },
    });
  } catch (error) {
    console.error('[Alert Preferences] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
