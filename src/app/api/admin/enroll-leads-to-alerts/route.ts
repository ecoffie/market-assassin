import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

// Default NAICS for users without specific preferences
const DEFAULT_NAICS = [
  '541511', '541512', '541513', '541519', // IT services
  '541611', '541612', '541613', '541614', '541618', // Management consulting
  '541990', // Other professional services
];

/**
 * GET /api/admin/enroll-leads-to-alerts?password=xxx
 * Enroll all leads (free resource downloaders) into the alert system
 *
 * Modes:
 * - preview: shows who would be enrolled (default)
 * - execute: actually enrolls them
 */
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

  // Get all leads
  const { data: leads, error: leadsError } = await supabase
    .from('leads')
    .select('email, name, company, source, created_at');

  if (leadsError) {
    return NextResponse.json({ error: 'Failed to fetch leads', details: leadsError.message }, { status: 500 });
  }

  // Get existing alert subscribers
  const { data: existingAlerts } = await supabase
    .from('user_alert_settings')
    .select('user_email');

  const existingEmails = new Set((existingAlerts || []).map(a => a.user_email.toLowerCase()));

  // Find leads not yet enrolled in alerts
  const toEnroll = (leads || []).filter(l => !existingEmails.has(l.email.toLowerCase()));

  if (mode === 'preview') {
    return NextResponse.json({
      mode: 'preview',
      total_leads: leads?.length || 0,
      already_enrolled: existingEmails.size,
      to_enroll: toEnroll.length,
      sample_leads: toEnroll.slice(0, 20).map(l => ({
        email: l.email,
        source: l.source,
        created_at: l.created_at,
      })),
      instructions: 'Add ?mode=execute to enroll these leads into free alerts (5 opps/week)',
    });
  }

  // Execute: enroll all missing leads
  const results = { enrolled: 0, errors: [] as string[] };

  for (const lead of toEnroll) {
    const { error: insertError } = await supabase
      .from('user_alert_settings')
      .upsert({
        user_email: lead.email.toLowerCase(),
        naics_codes: DEFAULT_NAICS,
        business_type: 'Small Business',
        target_agencies: [],
        alert_frequency: 'weekly',
        is_active: true,
        source: 'lead-enrollment',
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'user_email',
      });

    if (insertError) {
      results.errors.push(`${lead.email}: ${insertError.message}`);
    } else {
      results.enrolled++;
    }
  }

  return NextResponse.json({
    mode: 'execute',
    total_leads: leads?.length || 0,
    previously_enrolled: existingEmails.size,
    newly_enrolled: results.enrolled,
    errors: results.errors.length,
    error_details: results.errors.slice(0, 20),
    next_step: 'Run /api/admin/send-catch-up-alerts to send welcome emails',
  });
}
