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
  generateMarketIntel,
  generatePriorityScorecard,
} from './ai-generator';
import {
  generateFullBriefingEmail,
  generateCondensedBriefingEmail,
} from './email-templates';
import { getBriefingProfile } from '@/lib/smart-profile';

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const profile = await getUserProfile(supabase as any, userEmail);
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

    // Step 4: Generate teaming plays, market intel, scorecard
    console.log('[RecompeteGen] Generating strategic content...');
    const [teamingPlays, marketIntel, priorityScorecard] = await Promise.all([
      generateTeamingPlays(opportunities),
      Promise.resolve(generateMarketIntel(rawData.newsItems, userProfile)),
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
      marketIntel,
      priorityScorecard,
      sourcesUsed: ['USASpending', 'GovConWire', 'ExecutiveBiz', 'SAM.gov'],
      processingTimeMs: processingTime,
      userEmail,
      userNaics: userProfile.naicsCodes,
    };

    const email = generateFullBriefingEmail(fullBriefing);

    console.log(`[RecompeteGen] Full briefing generated in ${processingTime}ms`);
    console.log(`[RecompeteGen] ${opportunities.length} opportunities, ${teamingPlays.length} plays, ${marketIntel.length} intel items`);

    // Step 6: Save to database (unless test mode)
    if (!testMode) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await saveBriefing(supabase as any, userEmail, fullBriefing);
    }

    return { briefing: fullBriefing, email };
  } catch (error) {
    console.error('[RecompeteGen] Error generating briefing:', error);
    return null;
  }
}

/**
 * Get user profile from database (uses smart profile service)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getUserProfile(
  supabase: any,
  email: string
): Promise<RecompeteUserProfile | null> {
  try {
    // Get smart profile first (includes learned preferences)
    const smartProfile = await getBriefingProfile(email);

    if (smartProfile && smartProfile.naicsCodes.length > 0) {
      return {
        email,
        // Use topNaics (weighted by clicks) if available, otherwise explicit NAICS
        naicsCodes: smartProfile.topNaics.length > 0 ? smartProfile.topNaics : smartProfile.naicsCodes,
        agencies: smartProfile.topAgencies.length > 0 ? smartProfile.topAgencies : smartProfile.targetAgencies,
        watchedCompanies: smartProfile.topCompanies.length > 0 ? smartProfile.topCompanies : smartProfile.watchedCompanies,
        businessType: smartProfile.certifications[0] || 'Small Business',
      };
    }

    // Fallback to database queries if no smart profile
    // Try user_briefing_profile first
    const { data: briefingProfile } = await supabase
      .from('user_briefing_profile')
      .select('naics_codes, agencies, watched_companies, keywords')
      .eq('user_email', email)
      .single();

    const bp = briefingProfile as { naics_codes?: string[]; agencies?: string[]; watched_companies?: string[] } | null;

    if (bp && bp.naics_codes && bp.naics_codes.length > 0) {
      return {
        email,
        naicsCodes: bp.naics_codes || [],
        agencies: bp.agencies || [],
        watchedCompanies: bp.watched_companies || [],
        businessType: 'Small Business',
      };
    }

    // Try user_alert_settings as fallback
    const { data: alertSettings } = await supabase
      .from('user_alert_settings')
      .select('naics_codes, business_type, target_agencies')
      .eq('user_email', email)
      .single();

    const as_ = alertSettings as { naics_codes?: string[]; business_type?: string; target_agencies?: string[] } | null;

    if (as_ && as_.naics_codes && as_.naics_codes.length > 0) {
      return {
        email,
        naicsCodes: as_.naics_codes || [],
        agencies: as_.target_agencies || [],
        watchedCompanies: [],
        businessType: as_.business_type || 'Small Business',
      };
    }

    return null;
  } catch (error) {
    console.error('[RecompeteGen] Error getting profile:', error);
    return null;
  }
}

/**
 * Save briefing to database
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function saveBriefing(
  supabase: any,
  email: string,
  briefing: RecompeteBriefing
): Promise<void> {
  try {
    await supabase.from('briefing_log').upsert({
      user_email: email,
      briefing_date: briefing.briefingDate,
      briefing_type: 'weekly',
      briefing_data: briefing,
      generated_at: briefing.generatedAt,
      delivery_status: 'generated',
    }, {
      onConflict: 'user_email,briefing_date,briefing_type',
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
