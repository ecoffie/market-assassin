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
 * Get notification preferences for a user (alerts + briefings)
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
      .from('user_notification_settings')
      .select('*')
      .eq('user_email', email.toLowerCase())
      .single();

    if (error || !data) {
      return NextResponse.json({
        success: true,
        data: null,
        message: 'No notification settings found',
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        email: data.user_email,
        // Search criteria
        naicsCodes: data.naics_codes || [],
        keywords: data.keywords || [],
        businessType: data.business_type,
        targetAgencies: data.agencies || [],
        locationState: data.location_state,
        locationStates: data.location_states || (data.location_state ? [data.location_state] : []),
        // Alerts
        alertsEnabled: data.alerts_enabled,
        frequency: data.alert_frequency,
        // Briefings
        briefingsEnabled: data.briefings_enabled,
        briefingFrequency: data.briefing_frequency,
        // Delivery
        timezone: data.timezone || 'America/New_York',
        smsEnabled: data.sms_enabled,
        phoneNumber: data.phone_number,
        // Status
        isActive: data.is_active,
        lastAlertSent: data.last_alert_sent,
        lastBriefingSent: data.last_briefing_sent,
        totalAlertsSent: data.total_alerts_sent,
        totalBriefingsSent: data.total_briefings_sent,
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
    console.error('[Notification Preferences] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/alerts/preferences
 * Create or update notification preferences (alerts + briefings)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      email,
      // Alerts
      frequency,
      alertsEnabled,
      // Briefings
      briefingsEnabled,
      briefingFrequency,
      // Delivery
      timezone,
      smsEnabled,
      phoneNumber,
      // Search criteria
      naicsCodes,
      keywords,
      businessType,
      targetAgencies,
      locationState,
      locationStates, // Multi-state support
      // Master switch
      isActive,
    } = body;

    if (!email) {
      return NextResponse.json(
        { success: false, error: 'Email is required' },
        { status: 400 }
      );
    }

    const normalizedEmail = email.toLowerCase();

    // Check if user exists
    const { data: existing } = await supabase
      .from('user_notification_settings')
      .select('user_email')
      .eq('user_email', normalizedEmail)
      .single();

    // Build upsert object
    const record: Record<string, unknown> = {
      user_email: normalizedEmail,
      updated_at: new Date().toISOString(),
    };

    // Alert frequency
    if (frequency !== undefined) {
      if (!['daily', 'weekly', 'paused'].includes(frequency)) {
        return NextResponse.json(
          { success: false, error: 'Invalid frequency. Use "daily", "weekly", or "paused"' },
          { status: 400 }
        );
      }
      record.alert_frequency = frequency;
      // Also set alerts_enabled based on frequency
      record.alerts_enabled = frequency !== 'paused';
    }

    if (alertsEnabled !== undefined) {
      record.alerts_enabled = Boolean(alertsEnabled);
    }

    // Briefings
    if (briefingsEnabled !== undefined) {
      record.briefings_enabled = Boolean(briefingsEnabled);
    }

    if (briefingFrequency !== undefined) {
      if (!['daily', 'weekly', 'paused'].includes(briefingFrequency)) {
        return NextResponse.json(
          { success: false, error: 'Invalid briefing frequency' },
          { status: 400 }
        );
      }
      record.briefing_frequency = briefingFrequency;
    }

    // Timezone
    if (timezone !== undefined) {
      if (!VALID_TIMEZONES.includes(timezone)) {
        return NextResponse.json(
          { success: false, error: `Invalid timezone. Valid options: ${VALID_TIMEZONES.join(', ')}` },
          { status: 400 }
        );
      }
      record.timezone = timezone;
    }

    // SMS
    if (smsEnabled !== undefined) {
      record.sms_enabled = Boolean(smsEnabled);
    }

    if (phoneNumber !== undefined) {
      record.phone_number = phoneNumber || null;
    }

    // Master switch
    if (isActive !== undefined) {
      record.is_active = Boolean(isActive);
    }

    // Search criteria
    if (naicsCodes !== undefined) {
      // Only save numeric codes (allow prefixes like '236')
      const cleanCodes = Array.isArray(naicsCodes)
        ? naicsCodes.filter((c: string) => /^\d+$/.test(c))
        : [];
      record.naics_codes = cleanCodes;
    }

    if (keywords !== undefined) {
      record.keywords = Array.isArray(keywords) ? keywords : [];
    }

    if (businessType !== undefined) {
      record.business_type = businessType || null;
    }

    if (targetAgencies !== undefined) {
      record.agencies = Array.isArray(targetAgencies) ? targetAgencies : [];
    }

    if (locationState !== undefined) {
      record.location_state = locationState || null;
    }

    if (locationStates !== undefined) {
      // Store as JSON array of state codes
      record.location_states = Array.isArray(locationStates) ? locationStates : [];
    }

    let data;
    let error;

    if (existing) {
      // Update existing record
      const result = await supabase
        .from('user_notification_settings')
        .update(record)
        .eq('user_email', normalizedEmail)
        .select()
        .single();
      data = result.data;
      error = result.error;
    } else {
      // Insert new record with defaults
      record.created_at = new Date().toISOString();
      record.alerts_enabled = record.alerts_enabled ?? true;
      record.briefings_enabled = record.briefings_enabled ?? true;
      record.alert_frequency = record.alert_frequency ?? 'daily';
      record.briefing_frequency = record.briefing_frequency ?? 'daily';
      record.timezone = record.timezone ?? 'America/New_York';
      record.is_active = record.is_active ?? true;

      const result = await supabase
        .from('user_notification_settings')
        .insert(record)
        .select()
        .single();
      data = result.data;
      error = result.error;
    }

    if (error) {
      console.error('[Notification Preferences] Upsert error:', error);
      return NextResponse.json(
        { success: false, error: 'Failed to save preferences' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: existing ? 'Preferences updated' : 'Preferences created',
      data: {
        email: data.user_email,
        alertsEnabled: data.alerts_enabled,
        alertFrequency: data.alert_frequency,
        briefingsEnabled: data.briefings_enabled,
        briefingFrequency: data.briefing_frequency,
        timezone: data.timezone,
        isActive: data.is_active,
      },
    });
  } catch (error) {
    console.error('[Notification Preferences] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
