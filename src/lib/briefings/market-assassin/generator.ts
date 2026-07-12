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
import { getBriefingProfile } from '@/lib/smart-profile';

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
          ? { agency: rawData.budgetShifts[0].agency, summary: rawData.budgetShifts[0].amount }
          : null,
        topPainPoint: rawData.painPointUpdates[0]
          ? { agency: rawData.painPointUpdates[0].agency, summary: rawData.painPointUpdates[0].painPoint.substring(0, 80) }
          : null,
        topCompetitorMove: rawData.competitorActivity[0]
          ? { company: rawData.competitorActivity[0].companyName, summary: rawData.competitorActivity[0].description.substring(0, 80) }
          : null,
        topCaptureSignal: rawData.captureSignals[0]
          ? { title: rawData.captureSignals[0].title, agency: rawData.captureSignals[0].agency, deadline: rawData.captureSignals[0].responseDeadline }
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
 * Get MA user profile (uses smart profile service)
 */
async function getMAUserProfile(email: string): Promise<MAUserProfile | null> {
  try {
    // Check MA access via KV
    const maAccess = await kv.get(`ma:${email.toLowerCase()}`);
    const hasMAAccess = !!maAccess;

    // Get tier from KV value if it exists
    let maTier: 'standard' | 'premium' = 'standard';
    if (typeof maAccess === 'object' && maAccess !== null && 'tier' in maAccess) {
      maTier = (maAccess as { tier: string }).tier === 'premium' ? 'premium' : 'standard';
    }

    // Get smart profile first (includes learned preferences)
    const smartProfile = await getBriefingProfile(email);

    if (smartProfile && smartProfile.naicsCodes.length > 0) {
      return {
        email,
        // Use topNaics (weighted by clicks) if available, otherwise explicit NAICS
        naicsCodes: smartProfile.topNaics.length > 0 ? smartProfile.topNaics : smartProfile.naicsCodes,
        targetAgencies: smartProfile.topAgencies.length > 0 ? smartProfile.topAgencies : smartProfile.targetAgencies,
        watchedCompetitors: smartProfile.topCompanies.length > 0 ? smartProfile.topCompanies : smartProfile.watchedCompanies,
        capabilities: smartProfile.capabilityKeywords,
        setAsideTypes: smartProfile.certifications,
        hasMAAccess,
        maTier,
      };
    }

    // Fallback to database queries if no smart profile
    const supabase = getSupabaseClient();
    if (!supabase) return hasMAAccess ? getDefaultMAProfile(email, hasMAAccess, maTier) : null;

    // Read the REAL per-user profile from user_notification_settings — the table
    // where a user's saved NAICS/agencies/keywords actually live. (Previously this
    // fell back through user_briefing_profile → user_alert_settings, BOTH of which
    // do not exist, so every briefing silently ran on generic defaults. See
    // tasks/smart-profile-dead-table-findings.md.)
    const { data: settings, error: settingsErr } = await supabase
      .from('user_notification_settings')
      .select('naics_codes, agencies, watched_companies, keywords, business_type, set_aside_preferences')
      .eq('user_email', email)
      .maybeSingle();
    if (settingsErr) console.error('[MABriefingGen] settings query error:', settingsErr.message);

    if (settings && settings.naics_codes && settings.naics_codes.length > 0) {
      return {
        email,
        naicsCodes: settings.naics_codes,
        targetAgencies: settings.agencies || [],
        watchedCompetitors: (settings.watched_companies && settings.watched_companies.length > 0)
          ? settings.watched_companies
          : ['Leidos', 'CACI', 'Booz Allen', 'Peraton', 'SAIC'],
        capabilities: settings.keywords || [],
        setAsideTypes: settings.set_aside_preferences && settings.set_aside_preferences.length > 0
          ? settings.set_aside_preferences
          : (settings.business_type ? [settings.business_type] : []),
        hasMAAccess,
        maTier,
      };
    }

    // Return default profile if user has MA access but no profile
    return hasMAAccess ? getDefaultMAProfile(email, hasMAAccess, maTier) : null;
  } catch (error) {
    console.error('[MABriefingGen] Error getting profile:', error);
    return null;
  }
}

/**
 * Get default MA profile for users with access but no profile
 */
function getDefaultMAProfile(email: string, hasMAAccess: boolean, maTier: 'standard' | 'premium'): MAUserProfile {
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
