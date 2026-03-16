import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

// Default NAICS codes for users without specific preferences
// Covers: IT services, professional services, construction, admin services
const DEFAULT_NAICS = [
  '541511', '541512', '541513', '541519', // IT services
  '541611', '541612', '541613', '541614', '541618', // Management consulting
  '541990', // Other professional services
];

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  const mode = searchParams.get('mode') || 'preview';

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
  }

  // Get all MA users (Standard or Premium)
  const { data: maUsers, error: maError } = await supabase
    .from('user_profiles')
    .select('email, access_assassin_standard, access_assassin_premium')
    .or('access_assassin_standard.eq.true,access_assassin_premium.eq.true')
    .order('created_at', { ascending: false });

  if (maError) {
    return NextResponse.json({ error: 'Failed to fetch MA users', details: maError.message }, { status: 500 });
  }

  // Get existing alert subscribers
  const { data: existingAlerts } = await supabase
    .from('user_alert_settings')
    .select('user_email');

  const existingEmails = new Set((existingAlerts || []).map(a => a.user_email.toLowerCase()));

  // Find MA users not yet enrolled
  const toEnroll = (maUsers || []).filter(u => !existingEmails.has(u.email.toLowerCase()));

  if (mode === 'preview') {
    return NextResponse.json({
      mode: 'preview',
      total_ma_users: maUsers?.length || 0,
      already_enrolled: existingEmails.size,
      to_enroll: toEnroll.length,
      users_to_add: toEnroll.map(u => ({
        email: u.email,
        tier: u.access_assassin_premium ? 'Premium' : 'Standard',
      })),
      instructions: 'Add ?mode=execute to enroll these users',
    });
  }

  // Execute: enroll all missing MA users
  const results: { enrolled: string[]; errors: string[] } = { enrolled: [], errors: [] };

  for (const user of toEnroll) {
    const { error: insertError } = await supabase
      .from('user_alert_settings')
      .upsert({
        user_email: user.email.toLowerCase(),
        naics_codes: DEFAULT_NAICS,
        business_type: 'Small Business',
        target_agencies: [],
        alert_frequency: 'weekly',
        is_active: true,
        source: 'admin-bulk-enroll',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'user_email',
      });

    if (insertError) {
      results.errors.push(`${user.email}: ${insertError.message}`);
    } else {
      results.enrolled.push(user.email);
    }
  }

  return NextResponse.json({
    mode: 'execute',
    total_ma_users: maUsers?.length || 0,
    previously_enrolled: existingEmails.size,
    newly_enrolled: results.enrolled.length,
    errors: results.errors.length,
    enrolled_users: results.enrolled,
    error_details: results.errors,
    default_naics: DEFAULT_NAICS,
  });
}
