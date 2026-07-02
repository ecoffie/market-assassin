import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { verifyUserOwnsEmail } from '@/lib/api-auth';
import { deriveBusinessDescriptionFromKeywords } from '@/lib/alerts/profile-setup';
import { resolveActiveWorkspace, clientNotificationEmail } from '@/lib/app/workspace';

/**
 * Generate MD5 hash of NAICS profile for template matching
 */
function hashNaicsProfile(naicsCodes: string[]): string {
  const sorted = [...naicsCodes].sort();
  return crypto.createHash('md5').update(JSON.stringify(sorted)).digest('hex');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _supabase: any = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _supabase;
}

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

    // SECURITY: Verify user owns this email
    const auth = await verifyUserOwnsEmail(request, email);
    if (!auth.authenticated) {
      return NextResponse.json(
        { success: false, error: auth.error || 'Unauthorized' },
        { status: 401 }
      );
    }

    // Coach Mode: read the CLIENT's notification row when operating as a client.
    const { workspaceId, asClient } = await resolveActiveWorkspace(email.toLowerCase(), request);
    const rowEmail = asClient ? clientNotificationEmail(workspaceId) : email.toLowerCase();

    const { data, error } = await getSupabase()
      .from('user_notification_settings')
      .select('*')
      .eq('user_email', rowEmail)
      .single();

    if (error || !data) {
      return NextResponse.json({
        success: true,
        data: null,
        message: 'No notification settings found',
      });
    }

    const { data: businessProfile } = await getSupabase()
      .from('user_business_profiles')
      .select('business_description')
      .eq('user_email', rowEmail)
      .maybeSingle();

    const businessDescription =
      typeof data.business_description === 'string' && data.business_description.trim()
        ? data.business_description
        : businessProfile?.business_description || null;

    return NextResponse.json({
      success: true,
      data: {
        email: data.user_email,
        // Search criteria
        businessDescription,
        primaryIndustry: data.primary_industry || null,
        naicsCodes: data.naics_codes || [],
        keywords: data.keywords || [],
        businessType: data.business_type,
        setAsides: data.set_aside_preferences || (data.business_type ? [data.business_type] : []),
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
        alertRecipientEmail: data.alert_recipient_email || null, // Coach Mode: client's alert inbox

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
      alertRecipientEmail, // Coach Mode: route this client's alerts to their real inbox

      // Search criteria
      naicsCodes,
      pscCodes,
      keywords,
      businessDescription,
      businessType,
      setAsides,
      targetAgencies,
      locationState,
      locationStates, // Multi-state support
      // Primary industry
      primaryIndustry,
      // Master switch
      isActive,
    } = body;

    if (!email) {
      return NextResponse.json(
        { success: false, error: 'Email is required' },
        { status: 400 }
      );
    }

    // SECURITY: Verify user owns this email
    const auth = await verifyUserOwnsEmail(request, email);
    if (!auth.authenticated) {
      return NextResponse.json(
        { success: false, error: auth.error || 'Unauthorized' },
        { status: 401 }
      );
    }

    const normalizedEmail = auth.email!.toLowerCase();

    // Coach Mode: when operating AS a client, write the CLIENT's notification row
    // (synthetic clientNotificationEmail), not the coach's own. Mirrors target-list.
    const { workspaceId, asClient } = await resolveActiveWorkspace(normalizedEmail, request);
    const rowEmail = asClient ? clientNotificationEmail(workspaceId) : normalizedEmail;

    // Check if user exists. Also read existing agencies so we can auto-seed them
    // from NAICS when they're still empty (the slurpee never populated this field).
    const { data: existing } = await getSupabase()
      .from('user_notification_settings')
      .select('user_email, agencies, keywords')
      .eq('user_email', rowEmail)
      .single();

    // Build upsert object
    const record: Record<string, unknown> = {
      user_email: rowEmail,
      updated_at: new Date().toISOString(),
    };

    // Alert frequency:
    //   daily       — every day
    //   weekdays    — Mon-Fri only
    //   weekends    — Sat-Sun only
    //   mwf         — Mon/Wed/Fri ("every other day", BD-friendly)
    //   tth         — Tue/Thu ("twice a week")
    //   weekly      — Sunday-only digest (handled by separate weekly-alerts cron)
    //   paused      — no sends
    if (frequency !== undefined) {
      const valid = ['daily', 'weekdays', 'weekends', 'mwf', 'tth', 'weekly', 'paused'];
      if (!valid.includes(frequency)) {
        return NextResponse.json(
          { success: false, error: `Invalid frequency. Use one of: ${valid.join(', ')}` },
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
      // Store profile hash for template matching
      record.naics_profile_hash = cleanCodes.length > 0 ? hashNaicsProfile(cleanCodes) : null;
      record.profile_updated_at = new Date().toISOString();
    }

    if (keywords !== undefined) {
      record.keywords = Array.isArray(keywords) ? keywords : [];
    }

    // PSC codes — "what was bought" (the precise product axis). Column exists
    // (20260612 migration). Uppercased + deduped; PSCs are alphanumeric (e.g.
    // R425, 1550, P500). Settings now edits these alongside NAICS.
    if (pscCodes !== undefined) {
      record.psc_codes = Array.isArray(pscCodes)
        ? Array.from(new Set(pscCodes.map((c: unknown) => String(c).trim().toUpperCase()).filter(Boolean))).slice(0, 30)
        : [];
    }

    // Production does not have user_notification_settings.business_description yet.
    // Mirror businessDescription to user_business_profiles after the main settings save.

    if (businessType !== undefined) {
      record.business_type = businessType || null;
    }

    if (setAsides !== undefined) {
      record.set_aside_preferences = Array.isArray(setAsides)
        ? Array.from(new Set(setAsides.map((value: string) => String(value).trim()).filter(Boolean)))
        : [];
    }

    if (targetAgencies !== undefined) {
      record.agencies = Array.isArray(targetAgencies) ? targetAgencies : [];
    }

    // AUTO-SEED target agencies from the profile (Eric 2026-07-02). The slurpee/auto-
    // setup scanned buying agencies but wrote them to user_target_list (Pro), never to
    // notification.agencies — so this field was ALWAYS empty and Decision Makers had
    // nothing to work with. Seed it here, ALL tiers, when the profile has a targeting
    // signal (NAICS or keyword), the caller didn't explicitly set agencies, and stored
    // agencies are empty. KEYWORD-FIRST — keyword is more precise than NAICS and better
    // covered. Best-effort — a scan failure just leaves agencies empty (feature nudges).
    const effectiveKeywords = Array.isArray(record.keywords)
      ? (record.keywords as string[])
      : (Array.isArray(existing?.keywords) ? (existing!.keywords as string[]) : []);
    const effectiveNaics = Array.isArray(record.naics_codes) ? (record.naics_codes as string[]) : [];
    const hasSignal = effectiveKeywords.length > 0 || effectiveNaics.length > 0;
    const callerSetAgencies = targetAgencies !== undefined;
    const existingAgencies = Array.isArray(existing?.agencies) ? (existing!.agencies as string[]) : [];
    if (hasSignal && !callerSetAgencies && existingAgencies.length === 0) {
      try {
        const { deriveAgenciesFromProfile } = await import('@/lib/app/derive-agencies-from-naics');
        const base = new URL(request.url).origin;
        const seeded = await deriveAgenciesFromProfile(
          { keywords: effectiveKeywords, naics: effectiveNaics }, base, 10,
        );
        if (seeded.length > 0) record.agencies = seeded;
      } catch (e) {
        console.warn('[preferences] agency auto-seed skipped:', (e as Error).message);
      }
    }

    // Coach Mode: per-client alert recipient. Only included when explicitly provided
    // so normal saves don't touch the column (which requires the alert_recipient_email
    // migration). Empty string clears it → falls back to user_email in the crons.
    if (alertRecipientEmail !== undefined) {
      const trimmed = typeof alertRecipientEmail === 'string' ? alertRecipientEmail.trim() : '';
      record.alert_recipient_email = trimmed || null;
    }

    if (locationState !== undefined) {
      record.location_state = locationState || null;
    }

    if (locationStates !== undefined) {
      record.location_states = Array.isArray(locationStates) ? locationStates : [];
    }

    if (primaryIndustry !== undefined) {
      record.primary_industry = primaryIndustry || null;
    }

    let data;
    let error;

    if (existing) {
      // Update existing record
      const result = await getSupabase()
        .from('user_notification_settings')
        .update(record)
        .eq('user_email', rowEmail)
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

      const result = await getSupabase()
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

    if (businessDescription !== undefined || keywords !== undefined) {
      let cleanDescription = typeof businessDescription === 'string'
        ? businessDescription.trim()
        : '';
      if (!cleanDescription && Array.isArray(keywords) && keywords.length > 0) {
        cleanDescription = deriveBusinessDescriptionFromKeywords(keywords) || '';
      }

      try {
        await getSupabase()
          .from('user_business_profiles')
          .upsert({
            user_email: rowEmail,
            business_description: cleanDescription || null,
            business_description_updated_at: cleanDescription ? new Date().toISOString() : null,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'user_email' });
      } catch (businessProfileError) {
        console.warn('[Notification Preferences] Could not mirror business description:', businessProfileError);
      }
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
