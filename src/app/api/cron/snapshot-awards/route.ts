/**
 * Snapshot Awards Cron Job
 *
 * Runs daily to fetch recent contract awards from USAspending
 * for each user's watchlist and store snapshots for briefing generation.
 *
 * UPDATED Mar 28, 2026: Now queries BOTH user tables + includes fallback NAICS
 *
 * Schedule: 7:30 AM UTC daily
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  fetchAwardsForNaicsCode,
  assembleAwardsForUser,
  type ContractAward,
} from '@/lib/briefings/pipelines/contract-awards';

// NAICS-deduped run needs headroom under Vercel's ceiling.
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

  console.log(`[Cron: snapshot-awards] Starting for ${today}`);

  try {
    // Get all users from BOTH tables (same pattern as send-briefings)
    const allUsers: BriefingUser[] = [];
    const seenEmails = new Set<string>();

    // Source 1: user_notification_settings
    const { data: notificationSettings, error: notifError } = await supabase
      .from('user_notification_settings')
      .select('user_email, naics_codes, agencies, watched_companies')
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
        if (naics.length === 0) {
          naics = FALLBACK_NAICS;
        }

        allUsers.push({
          user_email: email,
          naics_codes: naics,
          agencies: u.agencies || [],
          watched_companies: u.watched_companies || [],
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
    // The awards query is deduped by NAICS: many users share codes, so we fetch
    // each unique NAICS once instead of one combined query per user (~700 calls
    // that trip USAspending's per-IP rate limit under any concurrency).
    const uniqueCodes = new Set<string>();
    for (const user of allUsers) {
      (user.naics_codes || []).slice(0, 10).forEach(c => { if (c) uniqueCodes.add(c); });
    }
    const codeList = [...uniqueCodes];
    console.log(`[Cron] ${allUsers.length} users → ${codeList.length} unique NAICS codes to fetch`);

    // ── Phase 2: fetch each unique NAICS ONCE (bounded concurrency) ───────────
    const cache = new Map<string, ContractAward[]>();
    const FETCH_BATCH = 6;
    for (let i = 0; i < codeList.length; i += FETCH_BATCH) {
      const batch = codeList.slice(i, i + FETCH_BATCH);
      const results = await Promise.all(
        batch.map(async (code): Promise<[string, ContractAward[]]> => {
          try {
            return [code, await fetchAwardsForNaicsCode(code)];
          } catch (err) {
            console.error(`[Cron] Error fetching NAICS ${code}:`, err);
            return [code, []];
          }
        })
      );
      for (const [code, awards] of results) cache.set(code, awards);
      await new Promise(resolve => setTimeout(resolve, 150));
    }

    // ── Phase 3: assemble + upsert each user's snapshot (no API calls) ────────
    const UPSERT_BATCH = 10;
    for (let i = 0; i < allUsers.length; i += UPSERT_BATCH) {
      const batch = allUsers.slice(i, i + UPSERT_BATCH);
      await Promise.all(batch.map(async (user) => {
        try {
          const result = assembleAwardsForUser(
            { naics_codes: user.naics_codes || [], agencies: user.agencies || [] },
            cache,
            200
          );
          const { error: insertError } = await supabase
            .from('briefing_snapshots')
            .upsert({
              user_email: user.user_email,
              snapshot_date: today,
              tool: 'market_assassin',
              raw_data: {
                awards: result.awards,
                totalCount: result.totalCount,
                totalSpending: result.totalSpending,
                fetchedAt: result.fetchedAt,
              },
              item_count: result.awards.length,
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

    console.log(`[Cron: snapshot-awards] Complete: ${processed} processed, ${errors} errors, ${codeList.length} NAICS fetched`);

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
    console.error('[Cron: snapshot-awards] Fatal error:', error);
    return NextResponse.json(
      { error: 'Snapshot job failed', details: String(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
