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
import {
  fetchExpiringForNaicsCode,
  recompeteCodesForUser,
  assembleRecompetesFromCache,
  type RecompeteContract,
} from '@/lib/briefings/pipelines/fpds-recompete';

// Batched, NAICS-deduped run needs headroom under Vercel's ceiling.
export const maxDuration = 300;

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

    // (Removed: Source 2 smart_user_profiles — table was dropped; querying it
    // returned PGRST205 on every tick. user_notification_settings above is the
    // sole audience source now, matching daily-alerts.)

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

    // ── Phase 1: collect the UNIQUE NAICS codes across all users ──────────────
    // The expiring-contracts query depends only on NAICS (not the user), so many
    // users share the same codes. Precompute each user's queried codes once.
    const userCodes = new Map<string, string[]>();
    const uniqueCodes = new Set<string>();
    for (const user of allUsers) {
      const codes = recompeteCodesForUser(user.naics_codes || []);
      userCodes.set(user.user_email, codes);
      codes.forEach(c => uniqueCodes.add(c));
    }
    const codeList = [...uniqueCodes];
    console.log(`[Cron] ${allUsers.length} users → ${codeList.length} unique NAICS codes to fetch`);

    // ── Phase 2: fetch each unique NAICS ONCE (bounded concurrency) ───────────
    // This is where all the API cost lives now: ~hundreds of calls total instead
    // of one-per-user-per-NAICS (thousands). USASpending is the primary source
    // (searchContractAwards), so this stays well under any per-key rate limit.
    const cache = new Map<string, RecompeteContract[]>();
    const FETCH_BATCH = 6;
    for (let i = 0; i < codeList.length; i += FETCH_BATCH) {
      const batch = codeList.slice(i, i + FETCH_BATCH);
      const results = await Promise.all(
        batch.map(async (code): Promise<[string, RecompeteContract[]]> => {
          try {
            return [code, await fetchExpiringForNaicsCode(code, 12)];
          } catch (err) {
            console.error(`[Cron] Error fetching NAICS ${code}:`, err);
            return [code, []];
          }
        })
      );
      for (const [code, contracts] of results) cache.set(code, contracts);
      await new Promise(resolve => setTimeout(resolve, 150));
    }

    // ── Phase 3: assemble + upsert each user's snapshot (no API calls) ────────
    const UPSERT_BATCH = 10;
    for (let i = 0; i < allUsers.length; i += UPSERT_BATCH) {
      const batch = allUsers.slice(i, i + UPSERT_BATCH);
      await Promise.all(batch.map(async (user) => {
        try {
          const result = assembleRecompetesFromCache(userCodes.get(user.user_email) || [], cache, 200);
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
          }
        } catch (err) {
          console.error(`[Cron] Error processing ${user.user_email}:`, err);
          errors++;
        }
      }));
    }

    console.log(`[Cron: snapshot-recompetes] Complete: ${processed} processed, ${errors} errors, ${codeList.length} NAICS fetched`);

    return NextResponse.json({
      success: true,
      date: today,
      processed,
      errors,
      totalUsers: allUsers.length,
      naicsFetched: codeList.length,
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
