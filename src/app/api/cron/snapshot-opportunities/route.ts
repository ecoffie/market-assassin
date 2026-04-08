/**
 * Snapshot Opportunities Cron Job
 *
 * Runs daily to fetch SAM.gov opportunities for each user's watchlist
 * and store snapshots for briefing generation.
 *
 * Schedule: 2 AM ET daily (before briefing generation at 4 AM)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { fetchOpportunitiesForUser } from '@/lib/briefings/pipelines/sam-gov';

// Vercel cron jobs send a secret to verify the request
const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization');
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const samApiKey = process.env.SAM_API_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: 'Missing Supabase config' }, { status: 500 });
  }

  if (!samApiKey) {
    return NextResponse.json({ error: 'Missing SAM.gov API key' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const today = new Date().toISOString().split('T')[0];

  console.log(`[Cron: snapshot-opportunities] Starting for ${today}`);

  try {
    // Get all users with briefing access and a profile
    const { data: users, error: usersError } = await supabase
      .from('user_notification_settings')
      .select('user_email, naics_codes, agencies, keywords, zip_codes, location_state, location_states')
      .not('naics_codes', 'eq', '{}'); // Only users with watchlist data

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
        // Fetch opportunities for this user's watchlist
        const result = await fetchOpportunitiesForUser(
          {
            naics_codes: user.naics_codes || [],
            agencies: user.agencies || [],
            keywords: user.keywords || [],
            zip_codes: user.zip_codes || [],
            location_state: user.location_state || null,
            location_states: user.location_states || [],
          },
          samApiKey
        );

        // Store snapshot in database
        const { error: insertError } = await supabase
          .from('briefing_snapshots')
          .upsert({
            user_email: user.user_email,
            snapshot_date: today,
            tool: 'opportunity_hunter',
            raw_data: {
              opportunities: result.opportunities,
              totalRecords: result.totalRecords,
              fetchedAt: result.fetchedAt,
            },
            item_count: result.opportunities.length,
            // diff_data will be computed when generating briefings
          }, {
            onConflict: 'user_email,snapshot_date,tool',
          });

        if (insertError) {
          console.error(`[Cron] Error saving snapshot for ${user.user_email}:`, insertError);
          errors++;
        } else {
          processed++;
          console.log(`[Cron] Saved ${result.opportunities.length} opportunities for ${user.user_email}`);
        }

        // Rate limiting: small delay between users
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (err) {
        console.error(`[Cron] Error processing ${user.user_email}:`, err);
        errors++;
      }
    }

    console.log(`[Cron: snapshot-opportunities] Complete: ${processed} processed, ${errors} errors`);

    return NextResponse.json({
      success: true,
      date: today,
      processed,
      errors,
      totalUsers: users.length,
    });

  } catch (error) {
    console.error('[Cron: snapshot-opportunities] Fatal error:', error);
    return NextResponse.json(
      { error: 'Snapshot job failed', details: String(error) },
      { status: 500 }
    );
  }
}

// Also support POST for manual triggers
export async function POST(request: NextRequest) {
  return GET(request);
}
