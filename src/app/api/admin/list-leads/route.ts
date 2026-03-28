import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

function getAdminClient() {
  if (!supabaseUrl || !supabaseServiceKey) return null;
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false }
  });
}

/**
 * GET /api/admin/list-leads
 *
 * List all leads from free resource downloads
 */
export async function GET(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password');
  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
  }

  try {
    // Get all leads
    const { data: leads, error, count } = await supabase
      .from('leads')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: 'Failed to fetch leads', details: error }, { status: 500 });
    }

    // Get unique emails
    const uniqueEmails = new Set((leads || []).map(l => l.email?.toLowerCase()).filter(Boolean));

    // Check which are already in user_profiles
    const { data: profiles } = await supabase
      .from('user_profiles')
      .select('email');

    const profileEmails = new Set((profiles || []).map(p => p.email?.toLowerCase()).filter(Boolean));

    // Check which are already in user_notification_settings
    const { data: alertSettings } = await supabase
      .from('user_notification_settings')
      .select('user_email');

    const alertEmails = new Set((alertSettings || []).map(s => s.user_email?.toLowerCase()).filter(Boolean));

    // Find leads NOT in either table (truly new free users)
    const newFreeUsers = Array.from(uniqueEmails).filter(
      email => !profileEmails.has(email) && !alertEmails.has(email)
    );

    return NextResponse.json({
      success: true,
      stats: {
        totalLeads: count || 0,
        uniqueEmails: uniqueEmails.size,
        alreadyInProfiles: Array.from(uniqueEmails).filter(e => profileEmails.has(e)).length,
        alreadyInAlerts: Array.from(uniqueEmails).filter(e => alertEmails.has(e)).length,
        newFreeUsers: newFreeUsers.length,
      },
      newFreeUsers: newFreeUsers.slice(0, 50), // Show first 50
      recentLeads: (leads || []).slice(0, 20).map(l => ({
        email: l.email,
        resource: l.resource_id,
        created: l.created_at,
        source: l.source
      }))
    });

  } catch (error) {
    console.error('[List Leads] Error:', error);
    return NextResponse.json({
      error: 'Server error',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}
