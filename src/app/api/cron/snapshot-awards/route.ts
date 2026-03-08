/**
 * Snapshot Awards Cron Job
 *
 * Runs daily to fetch recent contract awards from USAspending
 * for each user's watchlist and store snapshots for briefing generation.
 *
 * Schedule: 2:30 AM ET daily
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { fetchAwardsForUser } from '@/lib/briefings/pipelines/contract-awards';

const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization');
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
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
    // Get all users with briefing access and a profile
    const { data: users, error: usersError } = await supabase
      .from('user_briefing_profile')
      .select('user_email, naics_codes, agencies, watched_companies')
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
        // Fetch awards for this user's watchlist
        const result = await fetchAwardsForUser({
          naics_codes: user.naics_codes || [],
          agencies: user.agencies || [],
          watched_companies: user.watched_companies || [],
        });

        // Store snapshot in database
        const { error: insertError } = await supabase
          .from('briefing_snapshots')
          .upsert({
            user_email: user.user_email,
            snapshot_date: today,
            tool: 'market_assassin',
            snapshot_data: {
              awards: result.awards,
              totalCount: result.totalCount,
              totalSpending: result.totalSpending,
              fetchedAt: result.fetchedAt,
            },
          }, {
            onConflict: 'user_email,snapshot_date,tool',
          });

        if (insertError) {
          console.error(`[Cron] Error saving snapshot for ${user.user_email}:`, insertError);
          errors++;
        } else {
          processed++;
          console.log(`[Cron] Saved ${result.awards.length} awards ($${(result.totalSpending / 1000000).toFixed(1)}M) for ${user.user_email}`);
        }

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (err) {
        console.error(`[Cron] Error processing ${user.user_email}:`, err);
        errors++;
      }
    }

    console.log(`[Cron: snapshot-awards] Complete: ${processed} processed, ${errors} errors`);

    return NextResponse.json({
      success: true,
      date: today,
      processed,
      errors,
      totalUsers: users.length,
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
