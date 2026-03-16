import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  const email = searchParams.get('email');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
  }

  // Get recent alert_log entries
  let alertLogQuery = supabase
    .from('alert_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  if (email) {
    alertLogQuery = alertLogQuery.eq('user_email', email.toLowerCase());
  }

  const { data: alertLogs, error: logError } = await alertLogQuery;

  // Get user_alert_settings with last_alert_sent
  let settingsQuery = supabase
    .from('user_alert_settings')
    .select('user_email, last_alert_sent, last_alert_count, total_alerts_sent, alert_frequency, is_active')
    .order('last_alert_sent', { ascending: false, nullsFirst: false })
    .limit(100);

  if (email) {
    settingsQuery = settingsQuery.eq('user_email', email.toLowerCase());
  }

  const { data: settings, error: settingsError } = await settingsQuery;

  // Stats
  const sentRecently = settings?.filter(s => {
    if (!s.last_alert_sent) return false;
    const sentDate = new Date(s.last_alert_sent);
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return sentDate > dayAgo;
  }) || [];

  return NextResponse.json({
    stats: {
      total_users: settings?.length || 0,
      sent_last_24h: sentRecently.length,
      never_sent: settings?.filter(s => !s.last_alert_sent).length || 0,
    },
    recent_sends: sentRecently.map(s => ({
      email: s.user_email,
      last_alert_sent: s.last_alert_sent,
      alert_count: s.last_alert_count,
      total_sent: s.total_alerts_sent,
    })),
    user_settings: email ? settings : undefined,
    alert_logs: alertLogs?.slice(0, 20),
    errors: {
      logError: logError?.message,
      settingsError: settingsError?.message,
    },
  });
}
