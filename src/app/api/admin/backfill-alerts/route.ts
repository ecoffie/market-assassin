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
 * POST /api/admin/backfill-alerts
 *
 * Backfill users into user_notification_settings for daily alerts.
 *
 * BETA MODE: Everyone gets BOTH alerts AND briefings for free.
 *
 * Sources (processed in order):
 * 1. user_profiles (Tier 1: Paid customers)
 * 2. leads table (Tier 2: Free resource downloads)
 *
 * Options:
 * - mode=preview (default) - show what would be created
 * - mode=execute - actually create the records
 * - tier=1 - only process user_profiles (paid)
 * - tier=2 - only process leads (free)
 * - tier=all (default) - process both
 */
export async function POST(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password');
  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const mode = request.nextUrl.searchParams.get('mode') || 'preview';
  const tierParam = request.nextUrl.searchParams.get('tier') || 'all';

  const supabase = getAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
  }

  try {
    // Get existing alert settings to avoid duplicates
    const { data: existingSettings, error: settingsError } = await supabase
      .from('user_notification_settings')
      .select('user_email');

    if (settingsError) {
      return NextResponse.json({ error: 'Failed to fetch settings', details: settingsError }, { status: 500 });
    }

    const existingEmails = new Set(
      (existingSettings || []).map((s: { user_email: string }) => s.user_email?.toLowerCase()).filter(Boolean)
    );

    // ═══════════════════════════════════════════════════════════════
    // TIER 1: Paid customers from user_profiles
    // ═══════════════════════════════════════════════════════════════
    type ProfileRow = { email: string | null; company_name: string | null; bundle: string | null; naics_codes: string[] | null };
    let tier1Users: Array<ProfileRow & { email: string; tier: 1 }> = [];

    if (tierParam === 'all' || tierParam === '1') {
      const { data: profiles, error: profileError } = await supabase
        .from('user_profiles')
        .select('email, company_name, bundle, naics_codes')
        .order('created_at', { ascending: false });

      if (profileError) {
        return NextResponse.json({ error: 'Failed to fetch profiles', details: profileError }, { status: 500 });
      }

      tier1Users = (profiles as ProfileRow[] || [])
        .filter((p: ProfileRow) => {
          if (!p.email) return false;
          const email = p.email.toLowerCase();
          // Skip test emails
          if (email.startsWith('test') && email.includes('@gmail.com')) return false;
          if (email.includes('healthcheck') || email.includes('@test.')) return false;
          return !existingEmails.has(email);
        })
        .map(p => ({ ...p, email: p.email!, tier: 1 as const }));
    }

    // ═══════════════════════════════════════════════════════════════
    // TIER 2: Free users from leads table
    // ═══════════════════════════════════════════════════════════════
    type LeadRow = { email: string | null; name?: string | null; company?: string | null };
    let tier2Users: Array<{ email: string; company_name: string | null; tier: 2 }> = [];

    if (tierParam === 'all' || tierParam === '2') {
      const { data: leads, error: leadsError } = await supabase
        .from('leads')
        .select('email, name, company')
        .order('created_at', { ascending: false });

      if (leadsError) {
        // Leads table might not exist - that's OK
        console.log('[Backfill] Leads table error (may not exist):', leadsError.message);
      } else {
        // Get unique emails not already in profiles or alert settings
        const profileEmails = new Set(tier1Users.map(u => u.email.toLowerCase()));
        const seenEmails = new Set<string>();

        tier2Users = (leads as LeadRow[] || [])
          .filter((l: LeadRow) => {
            if (!l.email) return false;
            const email = l.email.toLowerCase();
            // Skip test/healthcheck emails
            if (email.includes('healthcheck') || email.includes('@test.')) return false;
            if (email.startsWith('test') && email.includes('@gmail.com')) return false;
            if (existingEmails.has(email)) return false;
            if (profileEmails.has(email)) return false;
            if (seenEmails.has(email)) return false;
            seenEmails.add(email);
            return true;
          })
          .map(l => ({
            email: l.email!,
            company_name: l.company || l.name || null,
            tier: 2 as const
          }));
      }
    }

    // Combine both tiers
    const allUsersToBackfill = [...tier1Users, ...tier2Users];

    if (mode === 'preview') {
      return NextResponse.json({
        success: true,
        mode: 'preview',
        betaMode: true,
        betaNote: 'During beta, ALL users get BOTH daily alerts AND Market Intelligence for free',
        summary: {
          tier1_paid: tier1Users.length,
          tier2_free: tier2Users.length,
          total: allUsersToBackfill.length,
          alreadyHaveSettings: existingEmails.size,
        },
        tier1Users: tier1Users.map(u => ({
          email: u.email,
          company: u.company_name,
          hasNaics: u.naics_codes && u.naics_codes.length > 0
        })),
        tier2Users: tier2Users.slice(0, 30).map(u => ({
          email: u.email,
          company: u.company_name
        })),
        message: 'Use mode=execute to create alert settings for these users'
      });
    }

    // ═══════════════════════════════════════════════════════════════
    // EXECUTE MODE
    // ═══════════════════════════════════════════════════════════════
    const results = {
      tier1Created: 0,
      tier2Created: 0,
      failed: 0,
      errors: [] as string[]
    };

    for (const user of allUsersToBackfill) {
      // Get NAICS codes if available (only Tier 1 has them)
      const naicsCodes = 'naics_codes' in user && user.naics_codes?.length
        ? user.naics_codes
        : [];

      const { error: insertError } = await supabase
        .from('user_notification_settings')
        .insert({
          user_email: user.email.toLowerCase(),
          // BETA: Everyone gets both alerts AND briefings
          alerts_enabled: true,
          alert_frequency: 'daily',
          briefings_enabled: true,  // BETA: Free for everyone
          briefing_frequency: 'daily',
          // Data
          naics_codes: naicsCodes,
          keywords: [],
          agencies: [],
          timezone: 'America/New_York',
          is_active: true,
          sms_enabled: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });

      if (insertError) {
        results.failed++;
        if (results.errors.length < 10) {
          results.errors.push(`${user.email}: ${insertError.message}`);
        }
      } else {
        if (user.tier === 1) {
          results.tier1Created++;
        } else {
          results.tier2Created++;
        }
      }
    }

    return NextResponse.json({
      success: true,
      mode: 'execute',
      betaMode: true,
      results: {
        ...results,
        totalCreated: results.tier1Created + results.tier2Created
      },
      message: `Created alert settings for ${results.tier1Created} paid users and ${results.tier2Created} free users. ${results.failed} failed.`,
      nextSteps: [
        'Users WITH NAICS codes will receive alerts starting tomorrow',
        'Users WITHOUT NAICS codes need to visit /alerts/preferences to set them',
        'Send invite email with /api/admin/send-alert-invite?mode=execute'
      ]
    });

  } catch (error) {
    console.error('[Backfill Alerts POST] Error:', error);
    return NextResponse.json({
      error: 'Server error',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}

/**
 * GET /api/admin/backfill-alerts
 *
 * Show current status of alert settings coverage
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
    // Count profiles (Tier 1)
    const { count: profileCount } = await supabase
      .from('user_profiles')
      .select('*', { count: 'exact', head: true });

    // Count leads (Tier 2) - may not exist
    let leadsCount = 0;
    const { count: leadsCountResult, error: leadsError } = await supabase
      .from('leads')
      .select('*', { count: 'exact', head: true });
    if (!leadsError) {
      leadsCount = leadsCountResult || 0;
    }

    // Count alert settings
    const { count: alertCount } = await supabase
      .from('user_notification_settings')
      .select('*', { count: 'exact', head: true });

    // Count with NAICS codes set
    const { data: withNaics } = await supabase
      .from('user_notification_settings')
      .select('user_email, naics_codes')
      .not('naics_codes', 'eq', '{}');

    const usersWithNaics = (withNaics || []).filter(
      u => u.naics_codes && u.naics_codes.length > 0
    );

    return NextResponse.json({
      success: true,
      betaMode: true,
      betaNote: 'During beta, ALL users get BOTH daily alerts AND Market Intelligence for free',
      stats: {
        tier1_profiles: profileCount || 0,
        tier2_leads: leadsCount,
        totalAlertSettings: alertCount || 0,
        usersWithNaicsCodes: usersWithNaics.length,
        readyToReceiveAlerts: usersWithNaics.length,
      },
      usersWithNaics: usersWithNaics.map(u => ({
        email: u.user_email,
        naicsCount: u.naics_codes?.length || 0
      })),
      nextSteps: [
        'POST with mode=preview to see who needs backfilling',
        'POST with mode=execute to create alert settings',
        'Users still need to set NAICS codes at /alerts/preferences'
      ]
    });

  } catch (error) {
    console.error('[Backfill Alerts GET] Error:', error);
    return NextResponse.json({
      error: 'Server error',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}
