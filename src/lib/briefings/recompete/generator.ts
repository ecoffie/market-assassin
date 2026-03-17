/**
 * Recompete Briefing Generator
 *
 * Orchestrates data aggregation, AI enhancement, and email generation
 * to produce briefings in Eric's format.
 */

import { createClient } from '@supabase/supabase-js';
import {
  RecompeteBriefing,
  CondensedBriefing,
  RecompeteUserProfile,
  RecompeteEmailTemplate,
} from './types';
import { aggregateRecompeteData } from './data-aggregator';
import {
  transformToOpportunities,
  generateTeamingPlays,
  generateContentHooks,
  generatePriorityScorecard,
} from './ai-generator';
import {
  generateFullBriefingEmail,
  generateCondensedBriefingEmail,
} from './email-templates';

/**
 * Generate a full weekly recompete briefing
 */
export async function generateRecompeteBriefing(
  userEmail: string,
  options: {
    format?: 'full' | 'condensed';
    testMode?: boolean;
  } = {}
): Promise<{
  briefing: RecompeteBriefing | CondensedBriefing;
  email: RecompeteEmailTemplate;
} | null> {
  const { format = 'full', testMode = false } = options;
  const startTime = Date.now();

  console.log(`[RecompeteGen] Starting briefing for ${userEmail} (format: ${format})...`);

  const supabase = getSupabaseClient();
  if (!supabase) {
    console.error('[RecompeteGen] Supabase not configured');
    return null;
  }

  try {
    // Step 1: Get user profile
    const profile = await getUserProfile(supabase, userEmail);
    if (!profile) {
      console.log(`[RecompeteGen] No profile found for ${userEmail}, using defaults`);
    }

    const userProfile: RecompeteUserProfile = profile || {
      email: userEmail,
      naicsCodes: ['541511', '541512', '541519'], // Default IT NAICS
      agencies: ['DHS', 'ICE', 'CBP'],
      watchedCompanies: ['CACI', 'Leidos', 'Booz Allen', 'Accenture'],
      businessType: 'Small Business',
    };

    // Step 2: Aggregate data from all sources
    console.log('[RecompeteGen] Aggregating data...');
    const rawData = await aggregateRecompeteData(userProfile);

    if (rawData.expiringContracts.length === 0 && rawData.newsItems.length === 0) {
      console.log('[RecompeteGen] No data found, skipping briefing');
      return null;
    }

    // Step 3: Transform to ranked opportunities with AI
    console.log('[RecompeteGen] Transforming opportunities...');
    const opportunities = await transformToOpportunities(rawData, userProfile);

    if (opportunities.length === 0) {
      console.log('[RecompeteGen] No opportunities after filtering');
      return null;
    }

    // Step 4: Generate teaming plays, content hooks, scorecard
    console.log('[RecompeteGen] Generating strategic content...');
    const [teamingPlays, contentHooks, priorityScorecard] = await Promise.all([
      generateTeamingPlays(opportunities),
      generateContentHooks(opportunities),
      Promise.resolve(generatePriorityScorecard(opportunities)),
    ]);

    const processingTime = Date.now() - startTime;

    // Step 5: Build the appropriate briefing format
    if (format === 'condensed') {
      const condensedBriefing: CondensedBriefing = {
        id: `condensed-${userEmail}-${Date.now()}`,
        generatedAt: new Date().toISOString(),
        briefingDate: new Date().toISOString().split('T')[0],
        timezone: 'ET',
        opportunities: opportunities.slice(0, 10).map(o => ({
          name: o.contractName,
          value: o.contractValue,
          incumbent: o.incumbent,
          displacementAngle: o.whyVulnerable.split('.')[0], // First sentence only
        })),
        teamingPlays: teamingPlays.map(p => ({
          theme: p.playName,
          primes: p.primesToApproach.slice(0, 3),
          whatYouBring: p.theme,
        })),
        userEmail,
      };

      const email = generateCondensedBriefingEmail(condensedBriefing);

      console.log(`[RecompeteGen] Condensed briefing generated in ${processingTime}ms`);

      return { briefing: condensedBriefing, email };
    }

    // Full briefing
    const fullBriefing: RecompeteBriefing = {
      id: `recompete-${userEmail}-${Date.now()}`,
      generatedAt: new Date().toISOString(),
      briefingDate: new Date().toISOString().split('T')[0],
      timezone: 'ET',
      opportunities,
      teamingPlays,
      contentHooks,
      priorityScorecard,
      sourcesUsed: ['USASpending', 'GovConWire', 'ExecutiveBiz', 'SAM.gov'],
      processingTimeMs: processingTime,
      userEmail,
      userNaics: userProfile.naicsCodes,
    };

    const email = generateFullBriefingEmail(fullBriefing);

    console.log(`[RecompeteGen] Full briefing generated in ${processingTime}ms`);
    console.log(`[RecompeteGen] ${opportunities.length} opportunities, ${teamingPlays.length} plays, ${contentHooks.length} hooks`);

    // Step 6: Save to database (unless test mode)
    if (!testMode) {
      await saveBriefing(supabase, userEmail, fullBriefing);
    }

    return { briefing: fullBriefing, email };
  } catch (error) {
    console.error('[RecompeteGen] Error generating briefing:', error);
    return null;
  }
}

/**
 * Get user profile from database
 */
async function getUserProfile(
  supabase: ReturnType<typeof createClient>,
  email: string
): Promise<RecompeteUserProfile | null> {
  // Try user_briefing_profile first
  const { data: briefingProfile } = await supabase
    .from('user_briefing_profile')
    .select('naics_codes, agencies, watched_companies, keywords')
    .eq('user_email', email)
    .single();

  if (briefingProfile && briefingProfile.naics_codes?.length > 0) {
    return {
      email,
      naicsCodes: briefingProfile.naics_codes || [],
      agencies: briefingProfile.agencies || [],
      watchedCompanies: briefingProfile.watched_companies || [],
      businessType: 'Small Business',
    };
  }

  // Try user_alert_settings as fallback
  const { data: alertSettings } = await supabase
    .from('user_alert_settings')
    .select('naics_codes, business_type, target_agencies')
    .eq('user_email', email)
    .single();

  if (alertSettings && alertSettings.naics_codes?.length > 0) {
    return {
      email,
      naicsCodes: alertSettings.naics_codes || [],
      agencies: alertSettings.target_agencies || [],
      watchedCompanies: [],
      businessType: alertSettings.business_type || 'Small Business',
    };
  }

  return null;
}

/**
 * Save briefing to database
 */
async function saveBriefing(
  supabase: ReturnType<typeof createClient>,
  email: string,
  briefing: RecompeteBriefing
): Promise<void> {
  try {
    await supabase.from('briefing_log').upsert({
      user_email: email,
      briefing_date: briefing.briefingDate,
      briefing_data: briefing,
      generated_at: briefing.generatedAt,
      delivery_status: 'generated',
    }, {
      onConflict: 'user_email,briefing_date',
    });

    console.log(`[RecompeteGen] Saved briefing for ${email}`);
  } catch (error) {
    console.error('[RecompeteGen] Error saving briefing:', error);
  }
}

/**
 * Get Supabase client
 */
function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    return null;
  }

  return createClient(url, key, { auth: { persistSession: false } });
}

export { getUserProfile };
