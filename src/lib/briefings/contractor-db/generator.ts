/**
 * Contractor DB Briefing Generator
 *
 * Orchestrates data aggregation and email generation for Contractor Database users.
 */

import { createClient } from '@supabase/supabase-js';
import { kv } from '@vercel/kv';
import {
  ContractorDBBriefing,
  CondensedContractorDBBriefing,
  ContractorDBUserProfile,
  ContractorDBEmailTemplate,
} from './types';
import { aggregateContractorDBData } from './data-aggregator';
import { generateContractorDBBriefingEmail, generateCondensedContractorDBBriefingEmail } from './email-templates';

/**
 * Generate a Contractor DB briefing
 */
export async function generateContractorDBBriefing(
  userEmail: string,
  options: {
    format?: 'full' | 'condensed';
    testMode?: boolean;
    adminBypass?: boolean;
  } = {}
): Promise<{
  briefing: ContractorDBBriefing | CondensedContractorDBBriefing;
  email: ContractorDBEmailTemplate;
} | null> {
  const { format = 'full', testMode = false, adminBypass = false } = options;
  const startTime = Date.now();

  console.log(`[ContractorDBBriefingGen] Starting briefing for ${userEmail} (format: ${format})...`);

  try {
    // Step 1: Get user profile and check DB access
    let profile = await getContractorDBUserProfile(userEmail);

    // Admin bypass: create default profile if none exists
    if (adminBypass && !profile) {
      console.log(`[ContractorDBBriefingGen] Admin bypass: creating default profile for ${userEmail}`);
      profile = {
        email: userEmail,
        naicsCodes: ['541511', '541512', '541519'],
        targetAgencies: ['DHS', 'DOD', 'VA', 'GSA', 'HHS'],
        watchedCompanies: ['Lockheed Martin', 'Boeing', 'Northrop Grumman', 'Raytheon', 'General Dynamics'],
        certifications: ['8(a)', 'SDVOSB', 'WOSB', 'HUBZone'],
        hasDBAccess: true,
      };
    }

    if (!profile) {
      console.log(`[ContractorDBBriefingGen] No profile found for ${userEmail}`);
      return null;
    }

    // Admin bypass skips access check
    if (!adminBypass && !profile.hasDBAccess) {
      console.log(`[ContractorDBBriefingGen] User ${userEmail} does not have Contractor DB access`);
      return null;
    }

    // Step 2: Aggregate data
    console.log('[ContractorDBBriefingGen] Aggregating data...');
    const rawData = await aggregateContractorDBData(profile);

    const totalItems = rawData.teamingOpportunities.length +
      rawData.sbloUpdates.length +
      rawData.newSubcontractingPlans.length +
      rawData.partnershipSignals.length;

    if (totalItems === 0) {
      console.log('[ContractorDBBriefingGen] No data found, skipping briefing');
      return null;
    }

    const processingTime = Date.now() - startTime;

    // Step 3: Build briefing
    if (format === 'condensed') {
      const topTeaming = rawData.teamingOpportunities[0];
      const topSblo = rawData.sbloUpdates[0];
      const topSubk = rawData.newSubcontractingPlans[0];
      const topSignal = rawData.partnershipSignals[0];

      const condensedBriefing: CondensedContractorDBBriefing = {
        id: `cdb-condensed-${userEmail}-${Date.now()}`,
        generatedAt: new Date().toISOString(),
        briefingDate: new Date().toISOString().split('T')[0],
        timezone: 'ET',
        topTeamingOpp: topTeaming
          ? {
              company: topTeaming.company,
              value: topTeaming.contractValue,
              score: topTeaming.teamingScore,
              reason: topTeaming.teamingReasons[0] || 'High-value teaming opportunity',
            }
          : null,
        topSbloUpdate: topSblo
          ? {
              company: topSblo.company,
              contact: `${topSblo.newContact.name} (${topSblo.newContact.email})`,
            }
          : null,
        topSubkPlan: topSubk
          ? {
              company: topSubk.company,
              goals: `SB: ${topSubk.goals.smallBusiness || 0}%, SDVOSB: ${topSubk.goals.sdvosb || 0}%`,
            }
          : null,
        topPartnershipSignal: topSignal
          ? {
              headline: topSignal.headline,
              source: topSignal.source,
            }
          : null,
        teamingOppsCount: rawData.teamingOpportunities.length,
        sbloUpdatesCount: rawData.sbloUpdates.length,
        userEmail,
      };

      const email = generateCondensedContractorDBBriefingEmail(condensedBriefing);
      console.log(`[ContractorDBBriefingGen] Condensed briefing generated in ${processingTime}ms`);

      return { briefing: condensedBriefing, email };
    }

    // Full briefing
    const naicsesCovered = Array.from(new Set(
      rawData.teamingOpportunities.flatMap(t => t.naicsCodes)
    )).slice(0, 10);

    const fullBriefing: ContractorDBBriefing = {
      id: `cdb-${userEmail}-${Date.now()}`,
      generatedAt: new Date().toISOString(),
      briefingDate: new Date().toISOString().split('T')[0],
      timezone: 'ET',
      teamingOpportunities: rawData.teamingOpportunities,
      sbloUpdates: rawData.sbloUpdates,
      newSubcontractingPlans: rawData.newSubcontractingPlans,
      partnershipSignals: rawData.partnershipSignals,
      summary: {
        totalOpportunities: rawData.teamingOpportunities.length,
        newSbloContacts: rawData.sbloUpdates.length,
        newSubkPlans: rawData.newSubcontractingPlans.length,
        partnershipSignals: rawData.partnershipSignals.length,
        naicsesCovered,
      },
      sourcesUsed: ['Federal Contractor Database', 'GovCon RSS Feeds', 'USASpending API'],
      processingTimeMs: processingTime,
      userEmail,
      userNaics: profile.naicsCodes,
    };

    const email = generateContractorDBBriefingEmail(fullBriefing);

    console.log(`[ContractorDBBriefingGen] Full briefing generated in ${processingTime}ms`);
    console.log(`[ContractorDBBriefingGen] Teaming: ${rawData.teamingOpportunities.length}, SBLO: ${rawData.sbloUpdates.length}, SubK: ${rawData.newSubcontractingPlans.length}, Signals: ${rawData.partnershipSignals.length}`);

    // Step 4: Save to database (unless test mode)
    if (!testMode) {
      await saveContractorDBBriefing(userEmail, fullBriefing);
    }

    return { briefing: fullBriefing, email };
  } catch (error) {
    console.error('[ContractorDBBriefingGen] Error generating briefing:', error);
    return null;
  }
}

/**
 * Get Contractor DB user profile
 */
async function getContractorDBUserProfile(email: string): Promise<ContractorDBUserProfile | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  try {
    // Check DB access via KV
    const dbAccess = await kv.get(`dbaccess:${email.toLowerCase()}`);
    const hasDBAccess = !!dbAccess;

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
        watchedCompanies: briefingProfile.watched_companies || [],
        certifications: briefingProfile.keywords || [],
        hasDBAccess,
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
        watchedCompanies: ['Lockheed Martin', 'Boeing', 'Northrop Grumman', 'Raytheon', 'General Dynamics'],
        certifications: alertSettings.business_type ? [alertSettings.business_type] : [],
        hasDBAccess,
      };
    }

    // Return default profile if user has DB access but no profile
    if (hasDBAccess) {
      return {
        email,
        naicsCodes: ['541511', '541512', '541519'],
        targetAgencies: ['DHS', 'DOD', 'VA', 'GSA', 'HHS'],
        watchedCompanies: ['Lockheed Martin', 'Boeing', 'Northrop Grumman', 'Raytheon', 'General Dynamics'],
        certifications: [],
        hasDBAccess,
      };
    }

    return null;
  } catch (error) {
    console.error('[ContractorDBBriefingGen] Error getting profile:', error);
    return null;
  }
}

/**
 * Save Contractor DB briefing to database
 */
async function saveContractorDBBriefing(email: string, briefing: ContractorDBBriefing): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) return;

  try {
    await supabase.from('briefing_log').upsert({
      user_email: email,
      briefing_date: briefing.briefingDate,
      briefing_type: 'contractor_db',
      briefing_data: briefing,
      generated_at: briefing.generatedAt,
      delivery_status: 'generated',
    }, {
      onConflict: 'user_email,briefing_date,briefing_type',
    });

    console.log(`[ContractorDBBriefingGen] Saved briefing for ${email}`);
  } catch (error) {
    console.error('[ContractorDBBriefingGen] Error saving briefing:', error);
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

export { getContractorDBUserProfile };
