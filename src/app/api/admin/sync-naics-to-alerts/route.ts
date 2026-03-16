import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Sync NAICS codes from user_briefing_profile and user_search_history
 * to user_alert_settings for users who currently have default NAICS
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

  // Default NAICS that were assigned during bulk enrollment
  const DEFAULT_NAICS = [
    '541511', '541512', '541513', '541519',
    '541611', '541612', '541613', '541614', '541618',
    '541990',
  ];

  // Get alert settings with default NAICS (candidates for update)
  const { data: alertSettings, error: alertError } = await supabase
    .from('user_alert_settings')
    .select('user_email, naics_codes')
    .eq('is_active', true);

  if (alertError) {
    return NextResponse.json({ error: 'Failed to fetch alert settings', details: alertError.message }, { status: 500 });
  }

  // Find users with default NAICS
  const usersWithDefaults = (alertSettings || []).filter(u => {
    if (!u.naics_codes || u.naics_codes.length === 0) return true;
    // Check if their NAICS matches the default set
    const hasDefault = u.naics_codes.every((n: string) => DEFAULT_NAICS.includes(n));
    return hasDefault && u.naics_codes.length === DEFAULT_NAICS.length;
  });

  // Get briefing profiles with NAICS data
  const { data: briefingProfiles } = await supabase
    .from('user_briefing_profile')
    .select('user_email, naics_codes, aggregated_profile');

  const briefingMap = new Map();
  for (const bp of briefingProfiles || []) {
    const naics = bp.naics_codes?.length > 0
      ? bp.naics_codes
      : bp.aggregated_profile?.naics || [];
    if (naics.length > 0) {
      briefingMap.set(bp.user_email.toLowerCase(), naics);
    }
  }

  // Get search history NAICS for users
  const { data: searchHistory } = await supabase
    .from('user_search_history')
    .select('user_email, search_value')
    .eq('search_type', 'naics')
    .order('created_at', { ascending: false });

  const searchMap = new Map<string, Set<string>>();
  for (const sh of searchHistory || []) {
    const email = sh.user_email.toLowerCase();
    if (!searchMap.has(email)) {
      searchMap.set(email, new Set());
    }
    searchMap.get(email)!.add(sh.search_value);
  }

  // Build update list
  const updates: Array<{
    email: string;
    source: string;
    naics: string[];
  }> = [];

  for (const user of usersWithDefaults) {
    const email = user.user_email.toLowerCase();

    // Check briefing profile first
    if (briefingMap.has(email)) {
      updates.push({
        email,
        source: 'briefing_profile',
        naics: briefingMap.get(email),
      });
      continue;
    }

    // Check search history
    if (searchMap.has(email)) {
      const naicsSet = searchMap.get(email)!;
      if (naicsSet.size > 0) {
        updates.push({
          email,
          source: 'search_history',
          naics: Array.from(naicsSet),
        });
      }
    }
  }

  if (mode === 'preview') {
    return NextResponse.json({
      mode: 'preview',
      users_with_defaults: usersWithDefaults.length,
      users_with_real_naics: updates.length,
      updates: updates.slice(0, 50), // Show first 50
      instructions: 'Add ?mode=execute to apply updates',
    });
  }

  // Execute updates
  const results = { updated: 0, errors: [] as string[] };

  for (const update of updates) {
    const { error } = await supabase
      .from('user_alert_settings')
      .update({
        naics_codes: update.naics,
        updated_at: new Date().toISOString(),
      })
      .eq('user_email', update.email);

    if (error) {
      results.errors.push(`${update.email}: ${error.message}`);
    } else {
      results.updated++;
    }
  }

  return NextResponse.json({
    mode: 'execute',
    users_with_defaults: usersWithDefaults.length,
    updated: results.updated,
    errors: results.errors.length,
    error_details: results.errors,
  });
}
