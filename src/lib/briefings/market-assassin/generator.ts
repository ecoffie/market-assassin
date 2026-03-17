/**
 * MA Briefing Generator
 *
 * Orchestrates data aggregation and email generation for Market Assassin users.
 */

import { createClient } from '@supabase/supabase-js';
import { kv } from '@vercel/kv';
import {
  MABriefing,
  CondensedMABriefing,
  MAUserProfile,
  MAEmailTemplate,
} from './types';
import { aggregateMABriefingData } from './data-aggregator';
import { generateMABriefingEmail, generateCondensedMABriefingEmail } from './email-templates';

/**
 * Generate a full MA briefing
 */
export async function generateMABriefing(
  userEmail: string,
  options: {
    format?: 'full' | 'condensed';
    testMode?: boolean;
    adminBypass?: boolean;
  } = {}
): Promise<{
  briefing: MABriefing | CondensedMABriefing;
  email: MAEmailTemplate;
} | null> {
  const { format = 'full', testMode = false, adminBypass = false } = options;
  const startTime = Date.now();

  console.log(`[MABriefingGen] Starting briefing for ${userEmail} (format: ${format})...`);

  try {
    // Step 1: Get user profile and check MA access
    let profile = await getMAUserProfile(userEmail);

    // Admin bypass: create default profile if none exists
    if (adminBypass && !profile) {
      console.log(`[MABriefingGen] Admin bypass: creating default profile for ${userEmail}`);
      profile = {
        email: userEmail,
        naicsCodes: ['541511', '541512', '541519'],
        targetAgencies: ['DHS', 'DOD', 'VA'],
        watchedCompetitors: ['Leidos', 'CACI', 'Booz Allen', 'Peraton', 'SAIC'],
        capabilities: [],
        setAsideTypes: [],
        hasMAAccess: true,
        maTier: 'premium',
      };
    }

    if (!profile) {
      console.log(`[MABriefingGen] No profile found for ${userEmail}`);
      return null;
    }

    // Admin bypass skips access check
    if (!adminBypass && !profile.hasMAAccess) {
      console.log(`[MABriefingGen] User ${userEmail} does not have MA access`);
      return null;
    }

    // Step 2: Aggregate data
    console.log('[MABriefingGen] Aggregating data...');
    const rawData = await aggregateMABriefingData(profile);

    const totalItems = rawData.budgetShifts.length +
      rawData.painPointUpdates.length +
      rawData.competitorActivity.length +
      rawData.captureSignals.length;

    if (totalItems === 0) {
      console.log('[MABriefingGen] No data found, skipping briefing');
      return null;
    }

    const processingTime = Date.now() - startTime;

    // Step 3: Build briefing
    if (format === 'condensed') {
      const condensedBriefing: CondensedMABriefing = {
        id: `ma-condensed-${userEmail}-${Date.now()}`,
        generatedAt: new Date().toISOString(),
        briefingDate: new Date().toISOString().split('T')[0],
        timezone: 'ET',
        topBudgetShift: rawData.budgetShifts[0]
          ? { agency: rawData.budgetShifts[0].agencyAcronym, summary: rawData.budgetShifts[0].amount }
          : null,
        topPainPoint: rawData.painPointUpdates[0]
          ? { agency: rawData.painPointUpdates[0].agencyAcronym, summary: rawData.painPointUpdates[0].painPoint.substring(0, 80) }
          : null,
        topCompetitorMove: rawData.competitorActivity[0]
          ? { company: rawData.competitorActivity[0].companyName, summary: rawData.competitorActivity[0].description.substring(0, 80) }
          : null,
        topCaptureSignal: rawData.captureSignals[0]
          ? { title: rawData.captureSignals[0].title.substring(0, 60), agency: rawData.captureSignals[0].agency, deadline: rawData.captureSignals[0].responseDeadline }
          : null,
        newSignalsCount: rawData.captureSignals.length,
        competitorMovesCount: rawData.competitorActivity.length,
        userEmail,
      };

      const email = generateCondensedMABriefingEmail(condensedBriefing);
      console.log(`[MABriefingGen] Condensed briefing generated in ${processingTime}ms`);

      return { briefing: condensedBriefing, email };
    }

    // Full briefing
    const agenciesCovered = Array.from(new Set([
      ...rawData.budgetShifts.map(b => b.agencyAcronym),
      ...rawData.painPointUpdates.map(p => p.agencyAcronym),
      ...rawData.captureSignals.map(s => s.agencyAcronym),
    ])).filter(Boolean);

    const fullBriefing: MABriefing = {
      id: `ma-${userEmail}-${Date.now()}`,
      generatedAt: new Date().toISOString(),
      briefingDate: new Date().toISOString().split('T')[0],
      timezone: 'ET',
      budgetShifts: rawData.budgetShifts,
      painPointUpdates: rawData.painPointUpdates,
      competitorActivity: rawData.competitorActivity,
      captureSignals: rawData.captureSignals,
      summary: {
        totalAlerts: totalItems,
        urgentItems: rawData.captureSignals.filter(s => s.fitScore >= 70).length,
        newOpportunities: rawData.captureSignals.length,
        agenciesCovered,
      },
      sourcesUsed: ['Agency Budget Data', 'Agency Pain Points', 'USASpending', 'GovCon RSS Feeds'],
      processingTimeMs: processingTime,
      userEmail,
      userNaics: profile.naicsCodes,
      userAgencies: profile.targetAgencies,
    };

    const email = generateMABriefingEmail(fullBriefing);

    console.log(`[MABriefingGen] Full briefing generated in ${processingTime}ms`);
    console.log(`[MABriefingGen] Budget: ${rawData.budgetShifts.length}, Pain: ${rawData.painPointUpdates.length}, Competitor: ${rawData.competitorActivity.length}, Signals: ${rawData.captureSignals.length}`);

    // Step 4: Save to database (unless test mode)
    if (!testMode) {
      await saveMABriefing(userEmail, fullBriefing);
    }

    return { briefing: fullBriefing, email };
  } catch (error) {
    console.error('[MABriefingGen] Error generating briefing:', error);
    return null;
  }
}

/**
 * Get MA user profile
 */
async function getMAUserProfile(email: string): Promise<MAUserProfile | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  try {
    // Check MA access via KV
    const maAccess = await kv.get(`ma:${email.toLowerCase()}`);
    const hasMAAccess = !!maAccess;

    // Get tier from KV value if it exists
    let maTier: 'standard' | 'premium' = 'standard';
    if (typeof maAccess === 'object' && maAccess !== null && 'tier' in maAccess) {
      maTier = (maAccess as { tier: string }).tier === 'premium' ? 'premium' : 'standard';
    }

    // Try user_briefing_profile first
    const { data: briefingProfile } = await supabase
      .from('user_briefing_profile')
      .select('naics_codes, agencies, watched_companies, keywords')
      .eq('user_email', email)
      .single();

    if (briefingProfile && briefingProfile.naics_codes && briefingProfile.naics_codes.length > 0) {
      return {
        email,
        naicsCodes: briefingProfile.naics_codes,
        targetAgencies: briefingProfile.agencies || [],
        watchedCompetitors: briefingProfile.watched_companies || [],
        capabilities: briefingProfile.keywords || [],
        setAsideTypes: [],
        hasMAAccess,
        maTier,
      };
    }

    // Fallback to user_alert_settings
    const { data: alertSettings } = await supabase
      .from('user_alert_settings')
      .select('naics_codes, business_type, target_agencies')
      .eq('user_email', email)
      .single();

    if (alertSettings && alertSettings.naics_codes && alertSettings.naics_codes.length > 0) {
      return {
        email,
        naicsCodes: alertSettings.naics_codes,
        targetAgencies: alertSettings.target_agencies || [],
        watchedCompetitors: ['Leidos', 'CACI', 'Booz Allen', 'Peraton', 'SAIC'], // Default competitors
        capabilities: [],
        setAsideTypes: alertSettings.business_type ? [alertSettings.business_type] : [],
        hasMAAccess,
        maTier,
      };
    }

    // Return default profile if user has MA access but no profile
    if (hasMAAccess) {
      return {
        email,
        naicsCodes: ['541511', '541512', '541519'],
        targetAgencies: ['DHS', 'DOD', 'VA'],
        watchedCompetitors: ['Leidos', 'CACI', 'Booz Allen', 'Peraton', 'SAIC'],
        capabilities: [],
        setAsideTypes: [],
        hasMAAccess,
        maTier,
      };
    }

    return null;
  } catch (error) {
    console.error('[MABriefingGen] Error getting profile:', error);
    return null;
  }
}

/**
 * Save MA briefing to database
 */
async function saveMABriefing(email: string, briefing: MABriefing): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) return;

  try {
    await supabase.from('briefing_log').upsert({
      user_email: email,
      briefing_date: briefing.briefingDate,
      briefing_type: 'market_assassin',
      briefing_data: briefing,
      generated_at: briefing.generatedAt,
      delivery_status: 'generated',
    }, {
      onConflict: 'user_email,briefing_date,briefing_type',
    });

    console.log(`[MABriefingGen] Saved briefing for ${email}`);
  } catch (error) {
    console.error('[MABriefingGen] Error saving briefing:', error);
  }
}

/**
 * Get Supabase client
 */
function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) return null;

  return createClient(url, key, { auth: { persistSession: false } });
}

export { getMAUserProfile };
