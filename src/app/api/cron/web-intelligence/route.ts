/**
 * Web Intelligence Cron Job
 *
 * Runs after data snapshots to gather web intelligence for all active users.
 * Schedule: 8 AM UTC daily (after other snapshots complete)
 *
 * Process:
 * 1. Get all users with active briefing profiles
 * 2. For each user: generate queries → search → filter → store
 * 3. Store results in briefing_snapshots as tool='web_intelligence'
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  runWebIntelPipeline,
  runRSSOnlyPipeline,
  isSerperConfigured,
  cleanExpiredCache,
  WebIntelUserProfile,
} from '@/lib/briefings/web-intel';

const BATCH_SIZE = 10; // Process users in batches
const MAX_USERS_PER_RUN = 100; // Safety limit

export async function GET(request: Request) {
  // Verify cron secret for Vercel
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    // Allow in development
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const startTime = Date.now();
  let usersProcessed = 0;
  let totalSignals = 0;
  let errors: string[] = [];

  console.log('[WebIntel Cron] Starting...');
  console.log(`[WebIntel Cron] Serper configured: ${isSerperConfigured()}`);

  try {
    // Step 1: Clean expired cache entries
    const cleaned = await cleanExpiredCache();
    if (cleaned > 0) {
      console.log(`[WebIntel Cron] Cleaned ${cleaned} expired cache entries`);
    }

    // Step 2: Get active briefing profiles
    const { data: profiles, error: profileError } = await supabase
      .from('user_briefing_profile')
      .select('user_email, aggregated_profile')
      .not('aggregated_profile', 'is', null)
      .limit(MAX_USERS_PER_RUN);

    if (profileError) {
      throw new Error(`Failed to fetch profiles: ${profileError.message}`);
    }

    if (!profiles || profiles.length === 0) {
      console.log('[WebIntel Cron] No active profiles found');
      return NextResponse.json({
        success: true,
        message: 'No active profiles',
        usersProcessed: 0,
        totalSignals: 0,
        elapsed: Date.now() - startTime,
      });
    }

    console.log(`[WebIntel Cron] Processing ${profiles.length} profiles`);

    // Step 3: Process users in batches
    for (let i = 0; i < profiles.length; i += BATCH_SIZE) {
      const batch = profiles.slice(i, i + BATCH_SIZE);

      const batchPromises = batch.map(async (profile) => {
        try {
          const userProfile = buildWebIntelProfile(profile.aggregated_profile);

          // Run appropriate pipeline
          const result = isSerperConfigured()
            ? await runWebIntelPipeline(userProfile)
            : await runRSSOnlyPipeline(userProfile);

          // Store results in briefing_snapshots
          if (result.signals.length > 0) {
            await supabase.from('briefing_snapshots').insert({
              user_email: profile.user_email,
              tool: 'web_intelligence',
              data_hash: generateDataHash(result),
              raw_data: result,
              snapshot_date: new Date().toISOString().split('T')[0],
            });

            totalSignals += result.signals.length;
          }

          usersProcessed++;
          console.log(
            `[WebIntel Cron] ${profile.user_email}: ${result.signals.length} signals`
          );
        } catch (err) {
          const errorMsg = `Error processing ${profile.user_email}: ${err}`;
          console.error(`[WebIntel Cron] ${errorMsg}`);
          errors.push(errorMsg);
        }
      });

      await Promise.all(batchPromises);
    }

    const elapsed = Date.now() - startTime;
    console.log(
      `[WebIntel Cron] Complete: ${usersProcessed} users, ${totalSignals} signals, ${elapsed}ms`
    );

    return NextResponse.json({
      success: true,
      usersProcessed,
      totalSignals,
      errors: errors.length > 0 ? errors : undefined,
      serperEnabled: isSerperConfigured(),
      elapsed,
    });
  } catch (error) {
    console.error('[WebIntel Cron] Fatal error:', error);
    return NextResponse.json(
      {
        success: false,
        error: String(error),
        usersProcessed,
        totalSignals,
        elapsed: Date.now() - startTime,
      },
      { status: 500 }
    );
  }
}

/**
 * Build WebIntelUserProfile from aggregated profile
 */
function buildWebIntelProfile(
  aggregatedProfile: Record<string, unknown>
): WebIntelUserProfile {
  return {
    naics_codes: extractArray(aggregatedProfile.naics_codes),
    agencies: extractArray(aggregatedProfile.agencies),
    watched_companies: extractArray(aggregatedProfile.watched_companies),
    watched_contracts: extractArray(aggregatedProfile.watched_contracts),
    keywords: extractArray(aggregatedProfile.keywords),
  };
}

/**
 * Extract array from unknown value
 */
function extractArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String);
  }
  return [];
}

/**
 * Generate a hash for deduplication
 */
function generateDataHash(data: unknown): string {
  const str = JSON.stringify(data);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}
