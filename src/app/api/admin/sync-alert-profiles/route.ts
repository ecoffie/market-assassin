/**
 * Admin: Sync user_alert_settings with actual search history from user_briefing_profile
 *
 * GET /api/admin/sync-alert-profiles?password=...&mode=preview
 * GET /api/admin/sync-alert-profiles?password=...&mode=execute
 *
 * Updates alert profiles with real NAICS codes, zip codes, and business types
 * from user's actual MA Premium searches instead of generic defaults.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

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

// Default NAICS codes for users without search history
const DEFAULT_NAICS_CODES = [
  '541611', '541612', '541618', '541511', '541512',
  '541519', '561110', '561210', '541990', '611430',
];

// Map keywords to business types for set-aside matching
const KEYWORD_TO_BUSINESS_TYPE: Record<string, string> = {
  'Small Business': 'Small Business',
  'SBA': 'Small Business',
  'Women Owned': 'WOSB',
  'WOSB': 'WOSB',
  'EDWOSB': 'EDWOSB',
  '8(a)': '8a',
  '8(a) Certified': '8a',
  '8A': '8a',
  'SDVOSB': 'SDVOSB',
  'Service-Disabled Veteran': 'SDVOSB',
  'VOSB': 'VOSB',
  'Veteran Owned': 'VOSB',
  'HUBZone': 'HUBZone',
  'hubzone': 'HUBZone',
};

interface BriefingProfile {
  user_email: string;
  naics_codes: string[] | null;
  zip_codes: string[] | null;
  keywords: string[] | null;
}

interface AlertSettings {
  user_email: string;
  naics_codes: string[] | null;
  business_type: string | null;
  location_state: string | null;
  location_zip: string | null;
}

// Simple zip to state mapping for common zips
function getStateFromZip(zip: string): string | null {
  if (!zip) return null;
  const prefix = zip.slice(0, 3);

  // Common zip prefix → state mappings
  const zipToState: Record<string, string> = {
    // Florida
    '330': 'FL', '331': 'FL', '332': 'FL', '333': 'FL', '334': 'FL',
    '335': 'FL', '336': 'FL', '337': 'FL', '338': 'FL', '339': 'FL',
    '340': 'FL', '341': 'FL', '342': 'FL', '344': 'FL', '346': 'FL', '347': 'FL',
    // Rhode Island
    '028': 'RI', '029': 'RI',
    // Massachusetts
    '010': 'MA', '011': 'MA', '012': 'MA', '013': 'MA', '014': 'MA',
    '015': 'MA', '016': 'MA', '017': 'MA', '018': 'MA', '019': 'MA',
    '020': 'MA', '021': 'MA', '022': 'MA', '023': 'MA', '024': 'MA',
    // Virginia
    '220': 'VA', '221': 'VA', '222': 'VA', '223': 'VA', '224': 'VA',
    '225': 'VA', '226': 'VA', '227': 'VA', '228': 'VA', '229': 'VA',
    '230': 'VA', '231': 'VA', '232': 'VA', '233': 'VA', '234': 'VA',
    // Maryland
    '206': 'MD', '207': 'MD', '208': 'MD', '209': 'MD', '210': 'MD',
    '211': 'MD', '212': 'MD', '214': 'MD', '215': 'MD', '216': 'MD',
    '217': 'MD', '218': 'MD', '219': 'MD',
    // DC
    '200': 'DC', '202': 'DC', '203': 'DC', '204': 'DC', '205': 'DC',
    // Texas
    '750': 'TX', '751': 'TX', '752': 'TX', '753': 'TX', '754': 'TX',
    '755': 'TX', '756': 'TX', '757': 'TX', '758': 'TX', '759': 'TX',
    '760': 'TX', '761': 'TX', '762': 'TX', '763': 'TX', '764': 'TX',
    '765': 'TX', '766': 'TX', '767': 'TX', '768': 'TX', '769': 'TX',
    '770': 'TX', '771': 'TX', '772': 'TX', '773': 'TX', '774': 'TX',
    '775': 'TX', '776': 'TX', '777': 'TX', '778': 'TX', '779': 'TX',
    '780': 'TX', '781': 'TX', '782': 'TX', '783': 'TX', '784': 'TX',
    '785': 'TX', '786': 'TX', '787': 'TX', '788': 'TX', '789': 'TX',
    '790': 'TX', '791': 'TX', '792': 'TX', '793': 'TX', '794': 'TX',
    '795': 'TX', '796': 'TX', '797': 'TX', '798': 'TX', '799': 'TX',
    // California
    '900': 'CA', '901': 'CA', '902': 'CA', '903': 'CA', '904': 'CA',
    '905': 'CA', '906': 'CA', '907': 'CA', '908': 'CA', '910': 'CA',
    '911': 'CA', '912': 'CA', '913': 'CA', '914': 'CA', '915': 'CA',
    '916': 'CA', '917': 'CA', '918': 'CA', '919': 'CA', '920': 'CA',
    '921': 'CA', '922': 'CA', '923': 'CA', '924': 'CA', '925': 'CA',
    '926': 'CA', '927': 'CA', '928': 'CA', '930': 'CA', '931': 'CA',
    '932': 'CA', '933': 'CA', '934': 'CA', '935': 'CA', '936': 'CA',
    '937': 'CA', '938': 'CA', '939': 'CA', '940': 'CA', '941': 'CA',
    '942': 'CA', '943': 'CA', '944': 'CA', '945': 'CA', '946': 'CA',
    '947': 'CA', '948': 'CA', '949': 'CA', '950': 'CA', '951': 'CA',
    '952': 'CA', '953': 'CA', '954': 'CA', '955': 'CA', '956': 'CA',
    '957': 'CA', '958': 'CA', '959': 'CA', '960': 'CA', '961': 'CA',
  };

  return zipToState[prefix] || null;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  const mode = searchParams.get('mode') || 'preview';

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Get all alert settings
  const { data: alertSettings, error: alertError } = await getSupabase()
    .from('user_alert_settings')
    .select('user_email, naics_codes, business_type, location_state, location_zip')
    .eq('is_active', true);

  if (alertError) {
    return NextResponse.json({ error: alertError.message }, { status: 500 });
  }

  // Get all briefing profiles (actual search history)
  const { data: briefingProfiles, error: profileError } = await getSupabase()
    .from('user_briefing_profile')
    .select('user_email, naics_codes, zip_codes, keywords');

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  // Create lookup map for briefing profiles
  const profileMap = new Map<string, BriefingProfile>();
  for (const profile of (briefingProfiles || [])) {
    profileMap.set(profile.user_email.toLowerCase(), profile);
  }

  // Analyze what needs updating
  const updates: Array<{
    email: string;
    current: { naics: number; businessType: string | null };
    proposed: { naics: string[]; businessType: string | null; state: string | null; zip: string | null };
    source: 'search_history' | 'defaults';
  }> = [];

  for (const alert of (alertSettings || []) as AlertSettings[]) {
    const email = alert.user_email.toLowerCase();
    const profile = profileMap.get(email);

    if (profile && profile.naics_codes && profile.naics_codes.length > 0) {
      // User has actual search history - use it
      const proposedNaics = profile.naics_codes.slice(0, 15); // Max 15 NAICS codes

      // Determine business type from keywords
      let businessType: string | null = null;
      if (profile.keywords && profile.keywords.length > 0) {
        for (const keyword of profile.keywords) {
          if (KEYWORD_TO_BUSINESS_TYPE[keyword]) {
            businessType = KEYWORD_TO_BUSINESS_TYPE[keyword];
            break;
          }
        }
      }

      // Get state and zip from search history
      const primaryZip = profile.zip_codes?.[0] || null;
      const state = primaryZip ? getStateFromZip(primaryZip) : null;

      // Check if update is needed
      const currentNaicsSet = new Set(alert.naics_codes || []);
      const proposedNaicsSet = new Set(proposedNaics);
      const naicsChanged = proposedNaics.some(n => !currentNaicsSet.has(n)) ||
                          (alert.naics_codes || []).some(n => !proposedNaicsSet.has(n));

      if (naicsChanged || businessType !== alert.business_type || state !== alert.location_state) {
        updates.push({
          email,
          current: {
            naics: (alert.naics_codes || []).length,
            businessType: alert.business_type,
          },
          proposed: {
            naics: proposedNaics,
            businessType,
            state,
            zip: primaryZip,
          },
          source: 'search_history',
        });
      }
    }
  }

  if (mode === 'preview') {
    return NextResponse.json({
      mode: 'preview',
      total_alert_users: (alertSettings || []).length,
      users_with_search_history: profileMap.size,
      updates_needed: updates.length,
      updates: updates.map(u => ({
        email: u.email,
        currentNaicsCount: u.current.naics,
        proposedNaicsCount: u.proposed.naics.length,
        proposedNaics: u.proposed.naics,
        businessType: u.proposed.businessType,
        state: u.proposed.state,
        source: u.source,
      })),
      instructions: 'Add ?mode=execute to apply updates',
    });
  }

  // Execute mode - apply updates
  const results = {
    success: [] as string[],
    failed: [] as { email: string; error: string }[],
  };

  for (const update of updates) {
    try {
      const { error } = await getSupabase()
        .from('user_alert_settings')
        .update({
          naics_codes: update.proposed.naics,
          business_type: update.proposed.businessType,
          location_state: update.proposed.state,
          location_zip: update.proposed.zip,
        })
        .eq('user_email', update.email);

      if (error) {
        results.failed.push({ email: update.email, error: error.message });
      } else {
        results.success.push(update.email);
      }
    } catch (err) {
      results.failed.push({
        email: update.email,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  return NextResponse.json({
    mode: 'execute',
    total_updates: updates.length,
    success: results.success.length,
    failed: results.failed.length,
    success_emails: results.success,
    failures: results.failed,
  });
}
