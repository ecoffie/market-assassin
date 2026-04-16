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
import { generateAIBriefing } from '@/lib/briefings/delivery/ai-briefing-generator';
import crypto from 'crypto';

// Process up to 10 profiles per cron run (52s each = ~9 minutes)
// Multiple runs from 2-5 AM will process all profiles
const PROFILES_PER_RUN = 10;
const DELAY_BETWEEN_PROFILES_MS = 1000;

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
    // Step 1: Get all unique NAICS profiles from enabled users
    const { data: users, error: usersError } = await getSupabase()
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

    // Step 3: Generate template for each profile
    for (const profile of profilesToProcess) {
      try {
        console.log(`[PrecomputeBriefings] Generating template for profile with ${profile.user_count} users: ${profile.naics_profile.slice(0, 50)}...`);

        // Generate briefing using a synthetic email (template generation)
        const briefing = await generateAIBriefing('template@govcongiants.com', {
          maxOpportunities: 10,
          maxTeamingPlays: 3,
          skipEnrichment: true, // Skip Perplexity for batch processing
          naicsOverride: profile.naics_codes, // Use this profile's NAICS codes
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

    return NextResponse.json({
      success: true,
      templatesGenerated,
      templatesFailed,
      totalProfiles: allProfiles.length,
      templatesExisting: existingHashes.size,
      templatesRemaining: remaining,
      totalUsers: users?.length,
      errors: errors.length > 0 ? errors : undefined,
      elapsed,
      estimatedCompletion: remaining > 0 ? `${Math.ceil(remaining / PROFILES_PER_RUN)} more cron runs needed` : 'Done!',
    });

  } catch (error) {
    console.error('[PrecomputeBriefings] Fatal error:', error);
    return NextResponse.json({
      success: false,
      error: String(error),
      templatesGenerated,
      templatesFailed,
      elapsed: Date.now() - startTime,
    }, { status: 500 });
  }
}
