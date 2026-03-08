/**
 * Snapshot Contractors Cron Job
 *
 * Runs daily to snapshot contractor database records
 * for each user's watchlist to detect changes.
 *
 * Schedule: 2:45 AM ET daily
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { fetchContractorsForUser } from '@/lib/briefings/pipelines/contractor-db';

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

  console.log(`[Cron: snapshot-contractors] Starting for ${today}`);

  try {
    // Get all users with briefing access and a profile
    const { data: users, error: usersError } = await supabase
      .from('user_briefing_profile')
      .select('user_email, naics_codes, watched_companies')
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
        // Fetch contractors for this user's watchlist
        const result = await fetchContractorsForUser(
          {
            naics_codes: user.naics_codes || [],
            watched_companies: user.watched_companies || [],
          },
          supabaseUrl,
          supabaseKey
        );

        // Store snapshot in database
        const { error: insertError } = await supabase
          .from('briefing_snapshots')
          .upsert({
            user_email: user.user_email,
            snapshot_date: today,
            tool: 'contractor_db',
            snapshot_data: {
              contractors: result.contractors,
              totalCount: result.totalCount,
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
          console.log(`[Cron] Saved ${result.contractors.length} contractors for ${user.user_email}`);
        }

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));

      } catch (err) {
        console.error(`[Cron] Error processing ${user.user_email}:`, err);
        errors++;
      }
    }

    console.log(`[Cron: snapshot-contractors] Complete: ${processed} processed, ${errors} errors`);

    return NextResponse.json({
      success: true,
      date: today,
      processed,
      errors,
      totalUsers: users.length,
    });

  } catch (error) {
    console.error('[Cron: snapshot-contractors] Fatal error:', error);
    return NextResponse.json(
      { error: 'Snapshot job failed', details: String(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
