/**
 * Snapshot Recompetes Cron Job
 *
 * Runs daily to fetch expiring contracts from FPDS for each user's watchlist
 * and store snapshots for briefing generation.
 *
 * Schedule: 2:15 AM ET daily
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { fetchRecompetesForUser } from '@/lib/briefings/pipelines/fpds-recompete';

const CRON_SECRET = process.env.CRON_SECRET;

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
    // Get all users with briefing access and a profile
    const { data: users, error: usersError } = await supabase
      .from('user_notification_settings')
      .select('user_email, naics_codes, agencies, watched_companies, watched_contracts')
      .not('naics_codes', 'eq', '{}');

    if (usersError) {
      console.error('[Cron] Error fetching users:', usersError);
      return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
    }

    if (!users || users.length === 0) {
      console.log('[Cron] No users with briefing profiles found');
      return NextResponse.json({
        success: true,
        message: 'No users to process',
        processed: 0,
      });
    }

    console.log(`[Cron] Processing ${users.length} users`);

    let processed = 0;
    let errors = 0;

    for (const user of users) {
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
      totalUsers: users.length,
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
