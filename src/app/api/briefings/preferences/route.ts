/**
 * Briefing Preferences API
 *
 * GET: Fetch user's briefing preferences
 * POST: Update user's briefing preferences (timezone, SMS, frequency)
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

interface BriefingPreferences {
  timezone: string;
  email_frequency: 'daily' | 'weekly';
  preferred_delivery_hour: number;
  sms_enabled: boolean;
  phone_number: string | null;
}

/**
 * GET /api/briefings/preferences?email=user@example.com
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const email = searchParams.get('email');

  if (!email) {
    return NextResponse.json({ error: 'Email required' }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data, error } = await supabase
    .from('user_briefing_profile')
    .select('timezone, email_frequency, preferred_delivery_hour, sms_enabled, phone_number')
    .eq('user_email', email)
    .single();

  if (error && error.code !== 'PGRST116') {
    // PGRST116 = no rows returned (user has no profile yet)
    console.error('[BriefingPrefs] Error fetching preferences:', error);
    return NextResponse.json({ error: 'Failed to fetch preferences' }, { status: 500 });
  }

  // Return defaults if no profile exists
  const preferences: BriefingPreferences = {
    timezone: data?.timezone || 'America/New_York',
    email_frequency: data?.email_frequency || 'daily',
    preferred_delivery_hour: data?.preferred_delivery_hour || 7,
    sms_enabled: data?.sms_enabled || false,
    phone_number: data?.phone_number || null,
  };

  return NextResponse.json({ preferences });
}

/**
 * POST /api/briefings/preferences
 * Body: { email, timezone?, email_frequency?, preferred_delivery_hour?, sms_enabled?, phone_number? }
 */
export async function POST(request: Request) {
  const body = await request.json();
  const { email, ...updates } = body;

  if (!email) {
    return NextResponse.json({ error: 'Email required' }, { status: 400 });
  }

  // Validate phone number if provided and SMS is being enabled
  if (updates.sms_enabled && updates.phone_number) {
    const normalizedPhone = normalizePhoneNumber(updates.phone_number);
    if (!normalizedPhone) {
      return NextResponse.json(
        { error: 'Invalid phone number format. Please use a valid US phone number.' },
        { status: 400 }
      );
    }
    updates.phone_number = normalizedPhone;
  }

  // If disabling SMS, clear phone number
  if (updates.sms_enabled === false) {
    updates.phone_number = null;
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Upsert user briefing profile
  const { data, error } = await supabase
    .from('user_briefing_profile')
    .upsert(
      {
        user_email: email,
        ...updates,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_email' }
    )
    .select('timezone, email_frequency, preferred_delivery_hour, sms_enabled, phone_number')
    .single();

  if (error) {
    console.error('[BriefingPrefs] Error updating preferences:', error);
    return NextResponse.json({ error: 'Failed to update preferences' }, { status: 500 });
  }

  console.log(`[BriefingPrefs] Updated preferences for ${email}:`, updates);

  return NextResponse.json({
    success: true,
    preferences: {
      timezone: data.timezone,
      email_frequency: data.email_frequency,
      preferred_delivery_hour: data.preferred_delivery_hour,
      sms_enabled: data.sms_enabled,
      phone_number: data.phone_number,
    },
  });
}

/**
 * Normalize phone number to E.164 format
 */
function normalizePhoneNumber(phone: string): string | null {
  // Remove all non-digit characters except leading +
  const cleaned = phone.replace(/[^\d+]/g, '');

  // Already in E.164 format
  if (cleaned.startsWith('+1') && cleaned.length === 12) {
    return cleaned;
  }

  // Has + but not +1 (international)
  if (cleaned.startsWith('+')) {
    return cleaned.length >= 10 ? cleaned : null;
  }

  // US number without country code
  if (cleaned.length === 10) {
    return `+1${cleaned}`;
  }

  // US number with leading 1
  if (cleaned.length === 11 && cleaned.startsWith('1')) {
    return `+${cleaned}`;
  }

  return null;
}
