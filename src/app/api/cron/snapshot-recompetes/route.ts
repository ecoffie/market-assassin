/**
 * Snapshot Recompetes Cron Job
 *
 * Runs daily to fetch expiring contracts for each user's watchlist
 * and store snapshots for briefing generation.
 *
 * UPDATED Mar 28, 2026: Now queries BOTH user tables + includes fallback NAICS
 *
 * Schedule: 7:15 AM UTC daily
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { fetchRecompetesForUser } from '@/lib/briefings/pipelines/fpds-recompete';

const CRON_SECRET = process.env.CRON_SECRET;

// Fallback NAICS for users without codes
const FALLBACK_NAICS = [
  '541512', // Computer Systems Design
  '541611', // Management Consulting
  '541330', // Engineering Services
  '236220', // Commercial and Institutional Building Construction
  '238210', // Electrical Contractors
];

interface BriefingUser {
  user_email: string;
  naics_codes: string[];
  agencies: string[];
  watched_companies?: string[];
  watched_contracts?: string[];
  source: 'notification_settings' | 'alert_settings';
}

export async function GET(request: NextRequest) {
  // Verify cron authorization (Vercel cron header OR Bearer token)
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const authHeader = request.headers.get('authorization');
  const hasCronSecret = authHeader === `Bearer ${CRON_SECRET}`;

  if (!isVercelCron && !hasCronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: 'Missing Supabase config' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const today = new Date().toISOString().split('T')[0];

  console.log(`[Cron: snapshot-recompetes] Starting for ${today}`);

  try {
    // Get all users from BOTH tables (same pattern as send-briefings)
    const allUsers: BriefingUser[] = [];
    const seenEmails = new Set<string>();

    // Source 1: user_notification_settings
    const { data: notificationSettings, error: notifError } = await supabase
      .from('user_notification_settings')
      .select('user_email, naics_codes, agencies, watched_companies, watched_contracts')
      .eq('is_active', true)
      .eq('briefings_enabled', true);

    if (notifError) {
      console.error('[Cron] Error fetching notification_settings:', notifError);
    }

    if (notificationSettings) {
      for (const u of notificationSettings) {
        const email = u.user_email?.toLowerCase();
        if (!email || seenEmails.has(email)) continue;
        seenEmails.add(email);

        let naics = Array.isArray(u.naics_codes) ? u.naics_codes : [];
        // Add fallback if no NAICS
        if (naics.length === 0) {
          naics = FALLBACK_NAICS;
          console.log(`[Cron] Using fallback NAICS for ${email} (notification_settings)`);
        }

        allUsers.push({
          user_email: email,
          naics_codes: naics,
          agencies: u.agencies || [],
          watched_companies: u.watched_companies || [],
          watched_contracts: u.watched_contracts || [],
          source: 'notification_settings',
        });
      }
    }

    // Source 2: user_alert_settings (Stripe webhook enrollments)
    const { data: alertSettings, error: alertError } = await supabase
      .from('user_alert_settings')
      .select('user_email, naics_codes, target_agencies')
      .eq('is_active', true)
      .eq('briefings_enabled', true);

    if (alertError) {
      console.error('[Cron] Error fetching alert_settings:', alertError);
    }

    if (alertSettings) {
      for (const u of alertSettings) {
        const email = u.user_email?.toLowerCase();
        if (!email || seenEmails.has(email)) continue; // Skip duplicates
        seenEmails.add(email);

        let naics = Array.isArray(u.naics_codes) ? u.naics_codes : [];
        // Add fallback if no NAICS
        if (naics.length === 0) {
          naics = FALLBACK_NAICS;
          console.log(`[Cron] Using fallback NAICS for ${email} (alert_settings)`);
        }

        allUsers.push({
          user_email: email,
          naics_codes: naics,
          agencies: Array.isArray(u.target_agencies) ? u.target_agencies : [],
          watched_companies: [],
          watched_contracts: [],
          source: 'alert_settings',
        });
      }
    }

    if (allUsers.length === 0) {
      console.log('[Cron] No users with briefing profiles found');
      return NextResponse.json({
        success: true,
        message: 'No users to process',
        processed: 0,
      });
    }

    const fromNotif = allUsers.filter(u => u.source === 'notification_settings').length;
    const fromAlert = allUsers.filter(u => u.source === 'alert_settings').length;
    console.log(`[Cron] Processing ${allUsers.length} users (${fromNotif} from notification_settings, ${fromAlert} from alert_settings)`);

    let processed = 0;
    let errors = 0;

    for (const user of allUsers) {
      try {
        // Fetch recompetes for this user's watchlist
        const result = await fetchRecompetesForUser({
          naics_codes: user.naics_codes || [],
          agencies: user.agencies || [],
          watched_companies: user.watched_companies || [],
          watched_contracts: user.watched_contracts || [],
        });

        // Store snapshot in database
        const { error: insertError } = await supabase
          .from('briefing_snapshots')
          .upsert({
            user_email: user.user_email,
            snapshot_date: today,
            tool: 'recompete',
            raw_data: {
              contracts: result.contracts,
              totalCount: result.totalCount,
              fetchedAt: result.fetchedAt,
            },
            item_count: result.contracts.length,
          }, {
            onConflict: 'user_email,snapshot_date,tool',
          });

        if (insertError) {
          console.error(`[Cron] Error saving snapshot for ${user.user_email}:`, insertError);
          errors++;
        } else {
          processed++;
          console.log(`[Cron] Saved ${result.contracts.length} recompetes for ${user.user_email}`);
        }

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (err) {
        console.error(`[Cron] Error processing ${user.user_email}:`, err);
        errors++;
      }
    }

    console.log(`[Cron: snapshot-recompetes] Complete: ${processed} processed, ${errors} errors`);

    return NextResponse.json({
      success: true,
      date: today,
      processed,
      errors,
      totalUsers: allUsers.length,
      fromNotificationSettings: fromNotif,
      fromAlertSettings: fromAlert,
    });

  } catch (error) {
    console.error('[Cron: snapshot-recompetes] Fatal error:', error);
    return NextResponse.json(
      { error: 'Snapshot job failed', details: String(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
