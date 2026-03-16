import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { kv } from '@vercel/kv';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

// Default NAICS codes for users without specific preferences
// Covers: IT services, professional services, construction, admin services
const DEFAULT_NAICS = [
  '541511', '541512', '541513', '541519', // IT services
  '541611', '541612', '541613', '541614', '541618', // Management consulting
  '541990', // Other professional services
];

interface MAAccessRecord {
  email: string;
  tier: 'standard' | 'premium';
  customerName?: string;
  createdAt: string;
}

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

  // Get all MA users from KV store (ma:all list)
  const allEmails = await kv.lrange('ma:all', 0, -1) as string[];
  const uniqueEmails = [...new Set(allEmails || [])];

  // Fetch full records for each MA user
  const maUsers: MAAccessRecord[] = [];
  for (const email of uniqueEmails) {
    const access = await kv.get<MAAccessRecord>(`ma:${email}`);
    if (access) {
      maUsers.push(access);
    }
  }

  // Get existing alert subscribers
  const { data: existingAlerts } = await supabase
    .from('user_alert_settings')
    .select('user_email');

  const existingEmails = new Set((existingAlerts || []).map(a => a.user_email.toLowerCase()));

  // Find MA users not yet enrolled
  const toEnroll = maUsers.filter(u => !existingEmails.has(u.email.toLowerCase()));

  if (mode === 'preview') {
    return NextResponse.json({
      mode: 'preview',
      total_ma_users: maUsers.length,
      already_enrolled: existingEmails.size,
      to_enroll: toEnroll.length,
      users_to_add: toEnroll.map(u => ({
        email: u.email,
        name: u.customerName,
        tier: u.tier,
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
