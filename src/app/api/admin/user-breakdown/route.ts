/**
 * Admin: Get full user breakdown across all tables
 *
 * GET /api/admin/user-breakdown?password=...
 *
 * Returns:
 * - leads (free resource downloads)
 * - user_profiles (purchases)
 * - user_briefing_profile (alert configs)
 * - user_alert_settings (MA Premium alerts)
 * - user_search_history (OH searches)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Get leads (free users)
  const { data: leads, error: leadsError } = await supabase
    .from('leads')
    .select('email, name, company, source, resources_accessed, created_at')
    .order('created_at', { ascending: false });

  // Get user_profiles (paying customers)
  const { data: profiles, error: profilesError } = await supabase
    .from('user_profiles')
    .select('email, access_hunter_pro, access_assassin_standard, access_assassin_premium, access_recompete, access_contractor_db, access_content_standard, access_content_full_fix, access_briefings, created_at')
    .order('created_at', { ascending: false });

  // Get user_briefing_profile (alert configurations)
  const { data: briefingProfiles, error: bpError } = await supabase
    .from('user_briefing_profile')
    .select('user_email, naics_codes, agencies, created_at')
    .order('created_at', { ascending: false });

  // Get user_alert_settings (MA Premium weekly alerts)
  const { data: alertSettings, error: asError } = await supabase
    .from('user_alert_settings')
    .select('user_email, naics_codes, business_type, is_active, total_alerts_sent, created_at')
    .order('created_at', { ascending: false });

  // Get unique users from search history (OH users who searched)
  const { data: searchUsers, error: suError } = await supabase
    .from('user_search_history')
    .select('user_email, tool, search_type')
    .order('created_at', { ascending: false });

  // Dedupe search users
  const uniqueSearchUsers = new Map<string, { tools: Set<string>, searches: number }>();
  searchUsers?.forEach(s => {
    if (!s.user_email) return;
    if (!uniqueSearchUsers.has(s.user_email)) {
      uniqueSearchUsers.set(s.user_email, { tools: new Set(), searches: 0 });
    }
    const u = uniqueSearchUsers.get(s.user_email)!;
    u.tools.add(s.tool);
    u.searches++;
  });

  // Build summary
  const leadEmails = new Set(leads?.map(l => l.email?.toLowerCase()).filter(Boolean) || []);
  const profileEmails = new Set(profiles?.map(p => p.email?.toLowerCase()).filter(Boolean) || []);
  const searchEmails = new Set([...uniqueSearchUsers.keys()].map(e => e.toLowerCase()));

  // Free users = leads who are NOT in profiles (haven't purchased)
  const freeUsers = [...leadEmails].filter(e => !profileEmails.has(e));

  // OH users = searched but not purchased
  const ohFreeUsers = [...searchEmails].filter(e => !profileEmails.has(e));

  // Paying customers breakdown
  const withHunterPro = profiles?.filter(p => p.access_hunter_pro) || [];
  const withMAStandard = profiles?.filter(p => p.access_assassin_standard) || [];
  const withMAPremium = profiles?.filter(p => p.access_assassin_premium) || [];
  const withRecompete = profiles?.filter(p => p.access_recompete) || [];
  const withContractorDB = profiles?.filter(p => p.access_contractor_db) || [];
  const withContentStandard = profiles?.filter(p => p.access_content_standard) || [];
  const withContentFullFix = profiles?.filter(p => p.access_content_full_fix) || [];
  const withAnyPaidTool = profiles?.filter(p =>
    p.access_hunter_pro || p.access_assassin_standard || p.access_assassin_premium ||
    p.access_recompete || p.access_contractor_db || p.access_content_standard || p.access_content_full_fix
  ) || [];

  return NextResponse.json({
    summary: {
      total_leads: leads?.length || 0,
      total_profiles: profiles?.length || 0,
      free_users: freeUsers.length,
      oh_free_users: ohFreeUsers.length,
      users_with_searches: uniqueSearchUsers.size,
      users_with_alert_config: briefingProfiles?.length || 0,
      users_with_ma_alerts: alertSettings?.length || 0,
    },
    paying_customers: {
      any_paid_tool: withAnyPaidTool.length,
      hunter_pro: withHunterPro.length,
      ma_standard: withMAStandard.length,
      ma_premium: withMAPremium.length,
      recompete: withRecompete.length,
      contractor_db: withContractorDB.length,
      content_standard: withContentStandard.length,
      content_full_fix: withContentFullFix.length,
    },
    tier_assignment: {
      oh_free: {
        description: 'Free users - 5 SAM opps/week',
        count: ohFreeUsers.length,
        emails: ohFreeUsers.slice(0, 20),
      },
      oh_pro_eligible: {
        description: 'Hunter Pro buyers - 15 SAM opps/week',
        count: withHunterPro.length,
        emails: withHunterPro.map(p => p.email),
      },
      ma_standard: {
        description: 'MA Standard - Free 15 SAM opps, $29/mo briefings available',
        count: withMAStandard.length,
        emails: withMAStandard.map(p => p.email),
      },
      ma_premium: {
        description: 'MA Premium - Free 15 SAM opps + briefings, $49/mo AI recs available',
        count: withMAPremium.length,
        emails: withMAPremium.map(p => p.email),
      },
      other_paid: {
        description: 'Other paid tools (Recompete, ContractorDB, Content) - 15 SAM opps/week',
        count: withAnyPaidTool.length - withHunterPro.length - withMAStandard.length - withMAPremium.length,
        emails: withAnyPaidTool
          .filter(p => !p.access_hunter_pro && !p.access_assassin_standard && !p.access_assassin_premium)
          .map(p => p.email),
      },
    },
    raw: {
      leads: leads?.slice(0, 50),
      profiles: profiles?.slice(0, 50),
      briefing_profiles: briefingProfiles?.slice(0, 20),
      alert_settings: alertSettings,
      search_users: [...uniqueSearchUsers.entries()].slice(0, 30).map(([email, data]) => ({
        email,
        tools: [...data.tools],
        total_searches: data.searches,
      })),
    },
    errors: {
      leads: leadsError?.message,
      profiles: profilesError?.message,
      briefing_profiles: bpError?.message,
      alert_settings: asError?.message,
      search_history: suError?.message,
    },
  });
}
