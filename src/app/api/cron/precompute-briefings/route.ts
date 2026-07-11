/**
 * Pre-compute Briefings Cron Job
 *
 * ENTERPRISE ARCHITECTURE: Instead of generating 928 individual briefings,
 * we pre-compute ~49 templates (one per unique NAICS profile).
 *
 * Result: 95% reduction in LLM calls, completes in ~45 minutes instead of 13+ hours
 *
 * Schedule: 2 AM UTC daily (5 hours before send-briefings)
 *
 * Process:
 * 1. Find all unique NAICS profiles among enabled users
 * 2. Generate one briefing template per profile
 * 3. Store in briefing_templates table
 * 4. send-briefings cron just matches users to templates and sends
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getReadClient } from '@/lib/supabase/server-clients';
import { generateAIBriefing } from '@/lib/briefings/delivery/ai-briefing-generator';
import { logToolError, ToolNames, ErrorTypes } from '@/lib/tool-errors';
import { DEFAULT_NAICS_CODES } from '@/lib/config/defaults';
import crypto from 'crypto';

// Each (possibly self-chained) invocation needs room to finish one ~52s briefing
// generation. force-dynamic so it never gets statically optimized/cached.
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

// SOFT TIMEOUT: the DISPATCHER aborts a job at 55s, but each profile takes ~52s
// to generate. So we cap the loop at a wall-clock budget BELOW 55s and stop
// cleanly between profiles — the resumable design (we skip profiles whose
// template already exists) means the next hourly dispatcher tick continues the
// backlog instead of being killed mid-generation. PROFILES_PER_RUN is now just a
// safety ceiling; the time budget is the real limit.
const PROFILES_PER_RUN = 10;
const DELAY_BETWEEN_PROFILES_MS = 1000;
// Don't START a profile unless we have runway to FINISH it under the dispatcher's
// 55s abort. Each generation is ~52s (it does an HTTP recompete fallback for
// profiles without snapshots — we can't skip that without emptying the briefing),
// so realistically ~1 profile completes per run. The job is scheduled every 10
// min across the 2-5 AM window so the resumable skip-existing logic drains the
// full profile set (~49) well before the 7 AM send. 4s = require near-fresh start.
const PROFILE_START_BUDGET_MS = 4_000;

interface NaicsProfile {
  naics_profile: string;
  naics_profile_hash: string;
  user_count: number;
  naics_codes: string[];
}

function hashNaicsProfile(naicsCodes: string[]): string {
  const sorted = [...naicsCodes].sort();
  return crypto.createHash('md5').update(JSON.stringify(sorted)).digest('hex');
}

export async function GET(request: NextRequest) {
  // Verify cron secret
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const authHeader = request.headers.get('authorization');
  const hasCronSecret = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isTest = request.nextUrl.searchParams.get('test') === 'true';

  if (!isVercelCron && !hasCronSecret && !isTest) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({
        message: 'Pre-compute Briefings Cron Job',
        description: 'Generates briefing templates by NAICS profile (enterprise architecture)',
        schedule: '2-5 AM UTC daily',
        benefit: '95% reduction in LLM calls (928 users → 49 templates)',
      });
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
let _supabase: any = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _supabase;
}

  const startTime = Date.now();
  const today = new Date().toISOString().split('T')[0];
  let templatesGenerated = 0;
  let templatesFailed = 0;
  const errors: string[] = [];

  console.log('[PrecomputeBriefings] Starting template generation...');

  try {
    // Step 1: Get all unique NAICS profiles from enabled users.
    // Read from the replica: this is a nightly batch read of the whole enabled-user
    // population (no read-after-write dependency), so sub-second replication lag is
    // irrelevant here. All WRITES below stay on getSupabase() (primary).
    const { data: users, error: usersError } = await getReadClient()
      .from('user_notification_settings')
      .select('user_email, naics_codes')
      .eq('briefings_enabled', true);

    if (usersError) {
      throw new Error(`Failed to fetch users: ${usersError.message}`);
    }

    // Group users by NAICS profile
    const profileMap = new Map<string, NaicsProfile>();
    for (const user of users || []) {
      const naicsCodes = user.naics_codes || [];
      const hash = hashNaicsProfile(naicsCodes);
      const key = JSON.stringify([...naicsCodes].sort());

      if (profileMap.has(hash)) {
        profileMap.get(hash)!.user_count++;
      } else {
        profileMap.set(hash, {
          naics_profile: key,
          naics_profile_hash: hash,
          user_count: 1,
          naics_codes: naicsCodes,
        });
      }
    }

    const allProfiles = Array.from(profileMap.values());
    console.log(`[PrecomputeBriefings] Found ${allProfiles.length} unique NAICS profiles for ${users?.length} users`);

    // Step 2: Check which profiles already have templates for today
    const { data: existingTemplates } = await getSupabase()
      .from('briefing_templates')
      .select('naics_profile_hash')
      .eq('template_date', today)
      .eq('briefing_type', 'daily');

    const existingHashes = new Set((existingTemplates || []).map((t: { naics_profile_hash: string }) => t.naics_profile_hash));

    // Filter to profiles that need templates
    const profilesToProcess = allProfiles
      .filter(p => !existingHashes.has(p.naics_profile_hash))
      .sort((a, b) => b.user_count - a.user_count) // Prioritize profiles with more users
      .slice(0, PROFILES_PER_RUN);

    console.log(`[PrecomputeBriefings] Processing ${profilesToProcess.length} profiles (${existingHashes.size} already done)`);

    if (profilesToProcess.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'All templates already generated for today',
        totalProfiles: allProfiles.length,
        templatesExisting: existingHashes.size,
        elapsed: Date.now() - startTime,
      });
    }

    // Step 3: Generate template for each profile (until the time budget runs out)
    let stoppedEarly = false;
    for (const profile of profilesToProcess) {
      // Don't START a profile we can't finish before the dispatcher's 55s abort.
      // Each generation is ~52s, so we require near-zero elapsed → ~1 profile/run;
      // the resumable skip-existing logic lets the next tick continue the rest.
      if (Date.now() - startTime > PROFILE_START_BUDGET_MS) {
        stoppedEarly = true;
        console.log(`[PrecomputeBriefings] Out of runway (${Date.now() - startTime}ms) — stopping; ${templatesGenerated} done this run, rest resume next tick.`);
        break;
      }
      try {
        console.log(`[PrecomputeBriefings] Generating template for profile with ${profile.user_count} users: ${profile.naics_profile.slice(0, 50)}...`);

        // Generate briefing using a synthetic email (template generation).
        // naicsProfileHash threads through so the generator can fetch
        // recent angles for this profile and tell the AI to prefer fresh
        // framings (anti-repetition memory — Content Reaper pattern #3).
        const briefing = await generateAIBriefing('template@govcongiants.com', {
          maxOpportunities: 10,
          maxTeamingPlays: 3,
          skipEnrichment: true, // Skip Perplexity for batch processing
          naicsOverride: profile.naics_codes, // Use this profile's NAICS codes
          naicsProfileHash: profile.naics_profile_hash,
          briefingType: 'daily',
        });

        if (!briefing) {
          throw new Error('Briefing generation returned null');
        }

        // Store template
        const { error: insertError } = await getSupabase().from('briefing_templates').upsert({
          naics_profile: profile.naics_profile,
          naics_profile_hash: profile.naics_profile_hash,
          template_date: today,
          briefing_type: 'daily',
          briefing_content: briefing,
          opportunities_count: briefing.opportunities.length,
          teaming_plays_count: briefing.teamingPlays.length,
          processing_time_ms: briefing.processingTimeMs,
          llm_provider: 'groq', // From LLM router
          llm_model: 'llama-3.3-70b-versatile',
          generated_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString(), // 36 hours
        }, { onConflict: 'naics_profile_hash,template_date,briefing_type' });

        if (insertError) {
          throw new Error(`Failed to store template: ${insertError.message}`);
        }

        templatesGenerated++;
        console.log(`[PrecomputeBriefings] ✅ Template generated for ${profile.user_count} users (${briefing.opportunities.length} opps)`);

      } catch (err) {
        templatesFailed++;
        const errorMsg = err instanceof Error ? err.message : String(err);
        errors.push(`Profile ${profile.naics_profile_hash.slice(0, 8)}: ${errorMsg}`);
        console.error(`[PrecomputeBriefings] ❌ Failed for profile:`, err);
      }

      // Delay between profiles
      await new Promise(r => setTimeout(r, DELAY_BETWEEN_PROFILES_MS));
    }

    const elapsed = Date.now() - startTime;
    const remaining = allProfiles.length - existingHashes.size - templatesGenerated;

    // Log run stats
    await getSupabase().from('briefing_precompute_runs').upsert({
      run_date: today,
      briefing_type: 'daily',
      unique_profiles_found: allProfiles.length,
      templates_generated: existingHashes.size + templatesGenerated,
      templates_failed: templatesFailed,
      total_users_covered: users?.length || 0,
      completed_at: remaining === 0 ? new Date().toISOString() : null,
      total_duration_ms: elapsed,
      error_messages: errors.length > 0 ? errors : null,
    }, { onConflict: 'run_date,briefing_type' });

    console.log(`[PrecomputeBriefings] Complete: ${templatesGenerated} generated, ${templatesFailed} failed, ${remaining} remaining`);

    // SELF-CHAIN: the dispatcher only ticks hourly and each run does ~1 profile,
    // so waiting for the next tick would take ~49 hours to warm the full set.
    // Instead, if we stopped early with work left, fire ourselves again
    // (fire-and-forget) so the backlog drains in a chain of <55s runs that
    // completes minutes after the 2 AM start, well before the 7 AM send. Guard
    // with ?chain=1 depth so a bug can't loop forever (cap at totalProfiles+5).
    if (stoppedEarly && remaining > 0) {
      const chainDepth = parseInt(request.nextUrl.searchParams.get('chain') || '0', 10);
      if (chainDepth < allProfiles.length + 5) {
        const origin = request.nextUrl.origin;
        const nextUrl = `${origin}/api/cron/precompute-briefings?chain=${chainDepth + 1}`;
        // Don't await — let this response return while the next link runs.
        void fetch(nextUrl, {
          headers: { authorization: `Bearer ${process.env.CRON_SECRET || ''}`, 'x-cron-dispatch': '1' },
        }).catch((e) => console.error('[PrecomputeBriefings] self-chain failed:', e));
        console.log(`[PrecomputeBriefings] Chaining next run (depth ${chainDepth + 1}), ${remaining} remaining`);
      } else {
        console.warn(`[PrecomputeBriefings] chain depth cap hit (${chainDepth}) — stopping self-chain`);
      }
    }

    return NextResponse.json({
      success: true,
      stoppedEarly,
      templatesGenerated,
      templatesFailed,
      totalProfiles: allProfiles.length,
      templatesExisting: existingHashes.size,
      templatesRemaining: remaining,
      totalUsers: users?.length,
      errors: errors.length > 0 ? errors : undefined,
      elapsed,
      estimatedCompletion: remaining > 0 ? `~${remaining} more cron ticks needed (1 profile/run)` : 'Done!',
    });

  } catch (error) {
    console.error('[PrecomputeBriefings] Fatal error:', error);
    // Properly serialize errors (handles Supabase errors which are plain objects)
    const errorMessage = error instanceof Error
      ? error.message
      : (typeof error === 'object' && error !== null && 'message' in error)
        ? String((error as { message: unknown }).message)
        : JSON.stringify(error);

    // Log to tool_errors for dashboard visibility
    await logToolError({
      tool: ToolNames.BRIEFINGS,
      errorType: ErrorTypes.INTERNAL,
      errorMessage,
      errorStack: error instanceof Error ? error.stack : undefined,
      requestPath: '/api/cron/precompute-briefings',
    }).catch(() => {});

    return NextResponse.json({
      success: false,
      error: errorMessage,
      templatesGenerated,
      templatesFailed,
      elapsed: Date.now() - startTime,
    }, { status: 500 });
  }
}
