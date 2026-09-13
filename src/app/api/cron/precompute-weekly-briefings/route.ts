/**
 * Pre-compute Weekly Deep Dive Briefings
 *
 * ENTERPRISE ARCHITECTURE: Generate 49 weekly templates instead of 928 individual briefings.
 * Same pattern as daily briefings pre-computation.
 *
 * Schedule: Thursday 8 PM UTC (before Friday 7 AM send)
 *
 * Process:
 * 1. Find all unique NAICS profiles among enabled users
 * 2. Fetch USASpending data ONCE per profile
 * 3. Generate AI analysis ONCE per profile
 * 4. Store in briefing_templates table
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getReadClient } from '@/lib/supabase/server-clients';
import { expandNaicsForBriefing as expandNaicsCodes } from '@/lib/briefings/naics-briefing-expansion';
import { fetchSamOpportunityNoticeSummaryFromCache } from '@/lib/briefings/pipelines/sam-gov';
import { generateWeeklyDeepDiveFromContracts } from '@/lib/briefings/delivery/weekly-briefing-generator';
import { fetchContractsForProfile } from '@/lib/briefings/weekly-contracts';
import { getPSCsForNAICS } from '@/lib/utils/psc-crosswalk';
import { hashNaicsProfile, naicsProfileKey } from '@/lib/briefings/naics-profile-hash';

const PROFILES_PER_RUN = 25; // Upper bound; soft time budget stops safely before platform timeout.
const MAX_RUN_MS = 210_000;
const DELAY_BETWEEN_PROFILES_MS = 1000;

// NAICS query-time expansion is the SHARED curated table now (naics-briefing-expansion.ts). This
// route's private copy had the per-code fallback bug (checked total accumulated length, not this
// code's) — fixed in the shared version. Aliased so the call site doesn't churn.

interface NaicsProfile {
  naics_profile: string;
  naics_profile_hash: string;
  user_count: number;
  naics_codes: string[];
}

// Enhanced profile with aggregated search criteria from all users in the group
interface EnhancedNaicsProfile extends NaicsProfile {
  aggregated_psc_codes: string[];
  aggregated_keywords: string[];
  aggregated_agencies: string[];
}

function getWeekOfDate(): string {
  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // 0=Sunday, 1=Monday, etc.
  const daysToAdd = dayOfWeek === 1 ? 0 : dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
  const monday = new Date(now);
  monday.setUTCDate(monday.getUTCDate() + daysToAdd);
  return monday.toISOString().split('T')[0];
}

function getProfilesPerRun(request: NextRequest): number {
  const limitParam = Number(request.nextUrl.searchParams.get('limit'));
  if (!Number.isFinite(limitParam) || limitParam <= 0) {
    return PROFILES_PER_RUN;
  }
  return Math.min(Math.floor(limitParam), PROFILES_PER_RUN);
}

function shouldStopForTimeBudget(startTime: number): boolean {
  return Date.now() - startTime >= MAX_RUN_MS;
}

export async function GET(request: NextRequest) {
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const authHeader = request.headers.get('authorization');
  const hasCronSecret = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isTest = request.nextUrl.searchParams.get('test') === 'true';

  if (!isVercelCron && !hasCronSecret && !isTest) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({
        message: 'Pre-compute Weekly Deep Dive Templates',
        description: 'Generates weekly templates by NAICS profile (enterprise architecture)',
        schedule: 'Thursday 8 PM UTC',
        benefit: '95% reduction in LLM calls (928 users → 49 templates)',
      });
    }
  }

  // DAY-OF-WEEK GUARD: Weekly precompute only runs on Thursday (UTC)
  const today = new Date();
  const dayOfWeek = today.getUTCDay(); // 4 = Thursday

  if (dayOfWeek !== 4 && !isTest) {
    console.log(`[PrecomputeWeekly] Skipped - not Thursday (day ${dayOfWeek})`);
    return NextResponse.json({
      success: true,
      message: `Weekly precompute only runs on Thursday. Today is day ${dayOfWeek}.`,
      skipped: true,
      dayOfWeek,
    });
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
  const weekOf = getWeekOfDate();
  const maxProfilesThisRun = getProfilesPerRun(request);
  let templatesGenerated = 0;
  let templatesFailed = 0;
  let profilesAttempted = 0;
  let stoppedForTimeBudget = false;
  const errors: string[] = [];

  console.log('[PrecomputeWeekly] Starting weekly template generation...');

  try {
    // Step 1: Get all unique NAICS profiles with full profile data
    // Note: table has keywords and agencies columns (no psc_codes column yet)
    // Read from the replica: nightly batch read of the whole enabled-user population,
    // no read-after-write dependency, so replication lag is irrelevant. Writes below
    // (briefing_templates) stay on getSupabase() (primary).
    const { data: users, error: usersError } = await getReadClient()
      .from('user_notification_settings')
      .select('user_email, naics_codes, keywords, agencies') // truncation-ok: briefings_enabled=true; measured 2026-08-23 at 187 rows (table 10,669). Templates are per-NAICS-PROFILE. Revisit if adoption approaches ~1,000 users.
      .eq('briefings_enabled', true);

    if (usersError) {
      throw new Error(`Failed to fetch users: ${usersError.message}`);
    }

    // Group users by NAICS profile and aggregate PSC/keywords/agencies
    const profileMap = new Map<string, EnhancedNaicsProfile>();
    for (const user of users || []) {
      const naicsCodes = user.naics_codes || [];
      if (naicsCodes.length === 0) continue;

      const hash = hashNaicsProfile(naicsCodes);
      const key = naicsProfileKey(naicsCodes);

      if (profileMap.has(hash)) {
        const existing = profileMap.get(hash)!;
        existing.user_count++;
        // Aggregate keywords from this user
        for (const kw of user.keywords || []) {
          if (!existing.aggregated_keywords.includes(kw)) {
            existing.aggregated_keywords.push(kw);
          }
        }
        // Aggregate target agencies from this user
        for (const agency of user.agencies || []) {
          if (!existing.aggregated_agencies.includes(agency)) {
            existing.aggregated_agencies.push(agency);
          }
        }
      } else {
        profileMap.set(hash, {
          naics_profile: key,
          naics_profile_hash: hash,
          user_count: 1,
          naics_codes: naicsCodes,
          aggregated_psc_codes: [],  // PSC codes not in table yet - will derive from NAICS
          aggregated_keywords: [...(user.keywords || [])],
          aggregated_agencies: [...(user.agencies || [])],
        });
      }
    }

    // Derive PSC codes from NAICS using crosswalk
    for (const profile of profileMap.values()) {
      const pscSet = new Set<string>();
      for (const naics of profile.naics_codes.slice(0, 5)) {
        const pscMatches = getPSCsForNAICS(naics, 5);
        for (const match of pscMatches) {
          pscSet.add(match.pscCode);
        }
      }
      profile.aggregated_psc_codes = Array.from(pscSet).slice(0, 10);
    }

    console.log(`[PrecomputeWeekly] Sample profile aggregation: ${profileMap.size > 0 ?
      `PSC: ${Array.from(profileMap.values())[0]?.aggregated_psc_codes?.length || 0}, ` +
      `Keywords: ${Array.from(profileMap.values())[0]?.aggregated_keywords?.length || 0}, ` +
      `Agencies: ${Array.from(profileMap.values())[0]?.aggregated_agencies?.length || 0}`
      : 'none'}`);

    const allProfiles = Array.from(profileMap.values());
    console.log(`[PrecomputeWeekly] Found ${allProfiles.length} unique NAICS profiles`);

    // Step 2: Check which profiles already have weekly templates
    const { data: existingTemplates } = await getSupabase()
      .from('briefing_templates')
      // truncation-ok: scoped to ONE (template_date, briefing_type). Templates are per-NAICS-PROFILE,
      // not per-user — measured 2026-08-23 at a peak of 17 rows (table 1,820). Predicate is the population.
      .select('naics_profile_hash')
      .eq('template_date', weekOf)
      .eq('briefing_type', 'weekly');

    const existingHashes = new Set((existingTemplates || []).map((t: { naics_profile_hash: string }) => t.naics_profile_hash));

    const profilesToProcess = allProfiles
      .filter(p => !existingHashes.has(p.naics_profile_hash))
      .sort((a, b) => b.user_count - a.user_count)
      .slice(0, maxProfilesThisRun);

    console.log(`[PrecomputeWeekly] Processing up to ${profilesToProcess.length} profiles (${existingHashes.size} already done)`);

    if (profilesToProcess.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'All weekly templates already generated',
        totalProfiles: allProfiles.length,
        templatesExisting: existingHashes.size,
        elapsed: Date.now() - startTime,
      });
    }

    // Step 3: Generate template for each profile
    for (const profile of profilesToProcess) {
      if (shouldStopForTimeBudget(startTime)) {
        stoppedForTimeBudget = true;
        console.log(`[PrecomputeWeekly] Stopping early to avoid timeout after ${Date.now() - startTime}ms`);
        break;
      }

      profilesAttempted++;
      const profileStartTime = Date.now();

      try {
        console.log(`[PrecomputeWeekly] Generating template for ${profile.user_count} users...`);

        // Fetch USASpending data using expanded criteria (NAICS + PSC + keywords)
        const expandedNaics = expandNaicsCodes(profile.naics_codes);
        const contracts = await fetchContractsForProfile({
          savedNaics: profile.naics_codes,
          expandedNaics,
          pscCodes: profile.aggregated_psc_codes.slice(0, 10),
          keywords: profile.aggregated_keywords.slice(0, 20),
          agencies: profile.aggregated_agencies.slice(0, 10),
        });

        if (contracts.length === 0) {
          console.log(`[PrecomputeWeekly] No in-market contracts found for profile, skipping`);
          continue;
        }

        const noticeSummary = await fetchSamOpportunityNoticeSummaryFromCache({
          naicsCodes: expandedNaics,
          pscCodes: profile.aggregated_psc_codes.slice(0, 10),
          keywords: profile.aggregated_keywords.slice(0, 20),
        });

        const briefing = await generateWeeklyDeepDiveFromContracts(contracts, noticeSummary, {
          naicsProfileHash: profile.naics_profile_hash,
          savedNaics: profile.naics_codes,
        });
        briefing.processingTimeMs = Date.now() - profileStartTime;

        if (briefing.opportunities.length === 0) {
          console.log(`[PrecomputeWeekly] No source-grounded opportunities for profile, skipping`);
          continue;
        }

        // Store template
        const { error: insertError } = await getSupabase().from('briefing_templates').upsert({
          naics_profile: profile.naics_profile,
          naics_profile_hash: profile.naics_profile_hash,
          template_date: weekOf,
          briefing_type: 'weekly',
          briefing_content: briefing,
          opportunities_count: briefing.opportunities.length,
          teaming_plays_count: briefing.teamingPlays.length,
          processing_time_ms: briefing.processingTimeMs,
          llm_provider: briefing.llmProvider || 'unknown',
          llm_model: briefing.llmModel || 'unknown',
          generated_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
        }, { onConflict: 'naics_profile_hash,template_date,briefing_type' });

        if (insertError) {
          throw new Error(`Failed to store template: ${insertError.message}`);
        }

        templatesGenerated++;
        console.log(`[PrecomputeWeekly] ✅ Template generated (${briefing.opportunities.length} opps)`);

      } catch (err) {
        templatesFailed++;
        const errorMsg = err instanceof Error ? err.message : String(err);
        errors.push(`Profile ${profile.naics_profile_hash.slice(0, 8)}: ${errorMsg}`);
        console.error(`[PrecomputeWeekly] ❌ Failed:`, err);
      }

      await new Promise(r => setTimeout(r, DELAY_BETWEEN_PROFILES_MS));
    }

    const elapsed = Date.now() - startTime;
    const templatesExistingAfterRun = existingHashes.size + templatesGenerated;
    const remaining = Math.max(0, allProfiles.length - templatesExistingAfterRun);

    console.log(`[PrecomputeWeekly] Complete: ${templatesGenerated} generated, ${templatesFailed} failed, ${remaining} remaining`);

    return NextResponse.json({
      success: true,
      templatesGenerated,
      templatesFailed,
      profilesAttempted,
      stoppedForTimeBudget,
      maxProfilesThisRun,
      totalProfiles: allProfiles.length,
      templatesExisting: templatesExistingAfterRun,
      templatesRemaining: remaining,
      totalUsers: users?.length,
      errors: errors.length > 0 ? errors : undefined,
      elapsed,
    });

  } catch (error) {
    console.error('[PrecomputeWeekly] Fatal error:', error);
    return NextResponse.json({
      success: false,
      error: String(error),
      templatesGenerated,
      templatesFailed,
      elapsed: Date.now() - startTime,
    }, { status: 500 });
  }
}
