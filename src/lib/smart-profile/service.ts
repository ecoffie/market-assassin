/**
 * Smart Profile Service
 *
 * Manages user profiles for personalized briefings:
 * - Get/update profile
 * - Learn from interactions
 * - Calculate engagement scores
 * - Get profile for briefing generation
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  SmartUserProfile,
  BriefingUserProfile,
  ProfileUpdatePayload,
  BriefingInteraction,
  ProfileCompletenessBreakdown,
} from './types';

// Default profile values
const DEFAULT_PROFILE: Partial<SmartUserProfile> = {
  naicsCodes: [],
  targetAgencies: [],
  watchedCompanies: [],
  keywords: [],
  geographicPreference: 'national',
  certifications: [],
  setAsidePreferences: [],
  verifiedCerts: { '8a': false, sdvosb: false, wosb: false, hubzone: false },
  capabilityKeywords: [],
  pastPerformanceAgencies: [],
  contractVehicles: [],
  engagementScore: 50,
  briefingsOpened: 0,
  briefingsClicked: 0,
  clickedNaics: [],
  clickedAgencies: [],
  clickedContractors: [],
  clickedOpportunities: [],
  naicsWeights: {},
  agencyWeights: {},
  companyWeights: {},
  preferredContentTypes: [],
  mutedAgencies: [],
  mutedNaics: [],
  minContractValue: 0,
  profileCompleteness: 10,
  onboardingCompleted: false,
  timezone: 'America/New_York',
  emailFrequency: 'daily',
  preferredDeliveryHour: 7,
};

/**
 * Get Supabase client
 */
function getSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Get full smart profile for a user
 */
export async function getSmartProfile(email: string): Promise<SmartUserProfile | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  try {
    const { data, error } = await supabase
      .from('user_briefing_profile')
      .select('*')
      .eq('user_email', email)
      .single();

    if (error || !data) {
      console.log(`[SmartProfile] No profile found for ${email}`);
      return null;
    }

    // Map database columns to TypeScript interface
    return mapDbToProfile(data);
  } catch (error) {
    console.error('[SmartProfile] Error getting profile:', error);
    return null;
  }
}

/**
 * Get or create profile (creates default if not exists)
 */
export async function getOrCreateProfile(email: string): Promise<SmartUserProfile> {
  const existing = await getSmartProfile(email);
  if (existing) return existing;

  // Create default profile
  const supabase = getSupabase();
  if (!supabase) {
    return { email, ...DEFAULT_PROFILE } as SmartUserProfile;
  }

  try {
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('user_briefing_profile')
      .insert({
        user_email: email,
        naics_codes: [],
        agencies: [],
        watched_companies: [],
        keywords: [],
        timezone: 'America/New_York',
        email_frequency: 'daily',
        preferred_delivery_hour: 7,
        engagement_score: 50,
        profile_completeness: 10,
        created_at: now,
        updated_at: now,
      })
      .select()
      .single();

    if (error) {
      console.error('[SmartProfile] Error creating profile:', error);
      return { email, ...DEFAULT_PROFILE } as SmartUserProfile;
    }

    return mapDbToProfile(data);
  } catch (error) {
    console.error('[SmartProfile] Error creating profile:', error);
    return { email, ...DEFAULT_PROFILE } as SmartUserProfile;
  }
}

/**
 * Update profile with new data
 */
export async function updateProfile(
  email: string,
  updates: ProfileUpdatePayload
): Promise<SmartUserProfile | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  try {
    // Map TypeScript fields to database columns
    const dbUpdates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
      last_profile_update: new Date().toISOString(),
    };

    if (updates.naicsCodes !== undefined) dbUpdates.naics_codes = updates.naicsCodes;
    if (updates.targetAgencies !== undefined) dbUpdates.agencies = updates.targetAgencies;
    if (updates.watchedCompanies !== undefined) dbUpdates.watched_companies = updates.watchedCompanies;
    if (updates.keywords !== undefined) dbUpdates.keywords = updates.keywords;

    if (updates.state !== undefined) dbUpdates.state = updates.state;
    if (updates.zipCode !== undefined) dbUpdates.zip_code = updates.zipCode;
    if (updates.geographicPreference !== undefined) dbUpdates.geographic_preference = updates.geographicPreference;

    if (updates.companyName !== undefined) dbUpdates.company_name = updates.companyName;
    if (updates.cageCode !== undefined) dbUpdates.cage_code = updates.cageCode;
    if (updates.companySize !== undefined) dbUpdates.company_size = updates.companySize;
    if (updates.annualRevenue !== undefined) dbUpdates.annual_revenue = updates.annualRevenue;
    if (updates.employeeCount !== undefined) dbUpdates.employee_count = updates.employeeCount;

    if (updates.certifications !== undefined) dbUpdates.certifications = updates.certifications;
    if (updates.setAsidePreferences !== undefined) dbUpdates.set_aside_preferences = updates.setAsidePreferences;

    if (updates.capabilityKeywords !== undefined) dbUpdates.capability_keywords = updates.capabilityKeywords;
    if (updates.pastPerformanceAgencies !== undefined) dbUpdates.past_performance_agencies = updates.pastPerformanceAgencies;
    if (updates.contractVehicles !== undefined) dbUpdates.contract_vehicles = updates.contractVehicles;
    if (updates.maxContractSize !== undefined) dbUpdates.max_contract_size = updates.maxContractSize;

    if (updates.timezone !== undefined) dbUpdates.timezone = updates.timezone;
    if (updates.emailFrequency !== undefined) dbUpdates.email_frequency = updates.emailFrequency;
    if (updates.preferredDeliveryHour !== undefined) dbUpdates.preferred_delivery_hour = updates.preferredDeliveryHour;

    if (updates.mutedAgencies !== undefined) dbUpdates.muted_agencies = updates.mutedAgencies;
    if (updates.mutedNaics !== undefined) dbUpdates.muted_naics = updates.mutedNaics;
    if (updates.minContractValue !== undefined) dbUpdates.min_contract_value = updates.minContractValue;
    if (updates.maxDistanceMiles !== undefined) dbUpdates.max_distance_miles = updates.maxDistanceMiles;

    // Upsert
    const { data, error } = await supabase
      .from('user_briefing_profile')
      .upsert(
        { user_email: email, ...dbUpdates },
        { onConflict: 'user_email' }
      )
      .select()
      .single();

    if (error) {
      console.error('[SmartProfile] Error updating profile:', error);
      return null;
    }

    // Recalculate completeness
    await calculateProfileCompleteness(email);

    return mapDbToProfile(data);
  } catch (error) {
    console.error('[SmartProfile] Error updating profile:', error);
    return null;
  }
}

/**
 * Get simplified profile for briefing generation
 */
export async function getBriefingProfile(email: string): Promise<BriefingUserProfile | null> {
  const profile = await getSmartProfile(email);
  if (!profile) return null;

  // Get top items by weight
  const topNaics = getTopByWeight(profile.naicsWeights, profile.naicsCodes, 5);
  const topAgencies = getTopByWeight(profile.agencyWeights, profile.targetAgencies, 5);
  const topCompanies = getTopByWeight(profile.companyWeights, profile.watchedCompanies, 5);

  return {
    email: profile.email,
    naicsCodes: profile.naicsCodes,
    targetAgencies: profile.targetAgencies,
    watchedCompanies: profile.watchedCompanies,
    keywords: profile.keywords,
    capabilityKeywords: profile.capabilityKeywords,
    state: profile.state,
    zipCode: profile.zipCode,
    geographicPreference: profile.geographicPreference,
    certifications: profile.certifications,
    setAsidePreferences: profile.setAsidePreferences,
    companySize: profile.companySize,
    maxContractSize: profile.maxContractSize,
    topNaics,
    topAgencies,
    topCompanies,
    mutedAgencies: profile.mutedAgencies,
    mutedNaics: profile.mutedNaics,
    minContractValue: profile.minContractValue,
    engagementScore: profile.engagementScore,
  };
}

/**
 * Record a briefing interaction (open, click, etc.)
 */
export async function recordInteraction(interaction: BriefingInteraction): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;

  try {
    // Insert interaction
    await supabase.from('briefing_interactions').insert({
      user_email: interaction.userEmail,
      briefing_id: interaction.briefingId,
      briefing_date: interaction.briefingDate,
      interaction_type: interaction.interactionType,
      item_type: interaction.itemType,
      item_id: interaction.itemId,
      item_naics: interaction.itemNaics,
      item_agency: interaction.itemAgency,
      item_value: interaction.itemValue,
      section: interaction.section,
      position: interaction.position,
      device_type: interaction.deviceType,
    });

    // If it's a click, learn from it
    if (interaction.interactionType === 'click') {
      await learnFromClick(
        interaction.userEmail,
        interaction.itemType || '',
        interaction.itemNaics,
        interaction.itemAgency,
        interaction.itemId
      );
    }

    // Update engagement score periodically
    if (interaction.interactionType === 'open') {
      await updateEngagementScore(interaction.userEmail);
    }
  } catch (error) {
    console.error('[SmartProfile] Error recording interaction:', error);
  }
}

/**
 * Learn from a click and update profile
 */
async function learnFromClick(
  email: string,
  itemType: string,
  itemNaics?: string,
  itemAgency?: string,
  itemId?: string
): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;

  try {
    // Get current profile
    const { data: profile } = await supabase
      .from('user_briefing_profile')
      .select('clicked_naics, clicked_agencies, clicked_contractors, clicked_opportunities, naics_weights, agency_weights')
      .eq('user_email', email)
      .single();

    if (!profile) return;

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

    // Add to clicked arrays (if not already present)
    if (itemNaics && !profile.clicked_naics?.includes(itemNaics)) {
      updates.clicked_naics = [...(profile.clicked_naics || []), itemNaics];
      // Increase NAICS weight
      const weights = profile.naics_weights || {};
      weights[itemNaics] = (weights[itemNaics] || 0) + 1;
      updates.naics_weights = weights;
    }

    if (itemAgency && !profile.clicked_agencies?.includes(itemAgency)) {
      updates.clicked_agencies = [...(profile.clicked_agencies || []), itemAgency];
      // Increase agency weight
      const weights = profile.agency_weights || {};
      weights[itemAgency] = (weights[itemAgency] || 0) + 1;
      updates.agency_weights = weights;
    }

    if (itemType === 'contractor' && itemId && !profile.clicked_contractors?.includes(itemId)) {
      updates.clicked_contractors = [...(profile.clicked_contractors || []), itemId];
    }

    if (itemType === 'opportunity' && itemId && !profile.clicked_opportunities?.includes(itemId)) {
      updates.clicked_opportunities = [...(profile.clicked_opportunities || []), itemId];
    }

    updates.last_click_at = new Date().toISOString();

    await supabase
      .from('user_briefing_profile')
      .update(updates)
      .eq('user_email', email);
  } catch (error) {
    console.error('[SmartProfile] Error learning from click:', error);
  }
}

/**
 * Update engagement score based on recent activity
 */
async function updateEngagementScore(email: string): Promise<number> {
  const supabase = getSupabase();
  if (!supabase) return 50;

  try {
    // Get recent opens and clicks (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data: interactions } = await supabase
      .from('briefing_interactions')
      .select('interaction_type, created_at')
      .eq('user_email', email)
      .gte('created_at', thirtyDaysAgo);

    const opens = interactions?.filter(i => i.interaction_type === 'open').length || 0;
    const clicks = interactions?.filter(i => i.interaction_type === 'click').length || 0;

    // Get days since last open
    const { data: lastOpen } = await supabase
      .from('briefing_interactions')
      .select('created_at')
      .eq('user_email', email)
      .eq('interaction_type', 'open')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    let daysSinceLastOpen = 30;
    if (lastOpen) {
      daysSinceLastOpen = Math.floor(
        (Date.now() - new Date(lastOpen.created_at).getTime()) / (24 * 60 * 60 * 1000)
      );
    }

    // Calculate score
    let score = 50; // Base
    score += Math.min(opens * 2, 20); // +2 per open, max +20
    score += Math.min(clicks * 5, 30); // +5 per click, max +30

    if (daysSinceLastOpen > 7) {
      score -= Math.min((daysSinceLastOpen - 7) * 2, 30); // -2 per inactive day after 7
    }

    score = Math.max(0, Math.min(100, score)); // Clamp 0-100

    // Update profile
    await supabase
      .from('user_briefing_profile')
      .update({
        engagement_score: score,
        briefings_opened: opens,
        briefings_clicked: clicks,
        last_briefing_opened_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('user_email', email);

    return score;
  } catch (error) {
    console.error('[SmartProfile] Error updating engagement score:', error);
    return 50;
  }
}

/**
 * Calculate profile completeness
 */
export async function calculateProfileCompleteness(email: string): Promise<ProfileCompletenessBreakdown> {
  const profile = await getSmartProfile(email);

  const breakdown = {
    hasNaics: (profile?.naicsCodes?.length || 0) > 0,
    hasAgencies: (profile?.targetAgencies?.length || 0) > 0,
    hasLocation: !!(profile?.state || profile?.zipCode),
    hasCompanyName: !!profile?.companyName,
    hasCertifications: (profile?.certifications?.length || 0) > 0,
    hasCapabilities: (profile?.capabilityKeywords?.length || 0) > 0,
    hasPastPerformance: (profile?.pastPerformanceAgencies?.length || 0) > 0,
    hasWatchedCompanies: (profile?.watchedCompanies?.length || 0) > 0,
    hasCompanySize: !!profile?.companySize,
    hasContractVehicles: (profile?.contractVehicles?.length || 0) > 0,
  };

  const missingFields: string[] = [];
  if (!breakdown.hasNaics) missingFields.push('NAICS codes');
  if (!breakdown.hasAgencies) missingFields.push('Target agencies');
  if (!breakdown.hasLocation) missingFields.push('Location (state/zip)');
  if (!breakdown.hasCompanyName) missingFields.push('Company name');
  if (!breakdown.hasCertifications) missingFields.push('Certifications');
  if (!breakdown.hasCapabilities) missingFields.push('Capabilities');

  let total = 10; // Email exists
  if (breakdown.hasNaics) total += 15;
  if (breakdown.hasAgencies) total += 10;
  if (breakdown.hasLocation) total += 10;
  if (breakdown.hasCompanyName) total += 5;
  if (breakdown.hasCertifications) total += 15;
  if (breakdown.hasCapabilities) total += 10;
  if (breakdown.hasPastPerformance) total += 10;
  if (breakdown.hasWatchedCompanies) total += 5;
  if (breakdown.hasCompanySize) total += 5;
  if (breakdown.hasContractVehicles) total += 5;

  // Update in database
  const supabase = getSupabase();
  if (supabase) {
    await supabase
      .from('user_briefing_profile')
      .update({ profile_completeness: total, updated_at: new Date().toISOString() })
      .eq('user_email', email);
  }

  return { total, breakdown, missingFields };
}

/**
 * Mark onboarding as complete
 */
export async function completeOnboarding(email: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;

  await supabase
    .from('user_briefing_profile')
    .update({
      onboarding_completed: true,
      updated_at: new Date().toISOString(),
    })
    .eq('user_email', email);
}

// Helper: Get top items by weight
function getTopByWeight(
  weights: Record<string, number>,
  items: string[],
  limit: number
): string[] {
  // Combine explicit items with weighted items
  const allItems = new Set([...items, ...Object.keys(weights)]);
  const scored = Array.from(allItems).map(item => ({
    item,
    weight: weights[item] || 0,
    isExplicit: items.includes(item),
  }));

  // Sort by: explicit first, then by weight
  scored.sort((a, b) => {
    if (a.isExplicit && !b.isExplicit) return -1;
    if (!a.isExplicit && b.isExplicit) return 1;
    return b.weight - a.weight;
  });

  return scored.slice(0, limit).map(s => s.item);
}

// Helper: Map database row to TypeScript interface
function mapDbToProfile(data: Record<string, unknown>): SmartUserProfile {
  return {
    email: data.user_email as string,
    naicsCodes: (data.naics_codes as string[]) || [],
    targetAgencies: (data.agencies as string[]) || [],
    watchedCompanies: (data.watched_companies as string[]) || [],
    keywords: (data.keywords as string[]) || [],

    state: data.state as string | null,
    zipCode: data.zip_code as string | null,
    metroArea: data.metro_area as string | null,
    geographicPreference: (data.geographic_preference as 'local' | 'regional' | 'national') || 'national',

    companyName: data.company_name as string | null,
    cageCode: data.cage_code as string | null,
    dunsNumber: data.duns_number as string | null,
    companySize: data.company_size as SmartUserProfile['companySize'],
    annualRevenue: data.annual_revenue as SmartUserProfile['annualRevenue'],
    employeeCount: data.employee_count as SmartUserProfile['employeeCount'],

    certifications: (data.certifications as string[]) || [],
    setAsidePreferences: (data.set_aside_preferences as string[]) || [],
    verifiedCerts: {
      '8a': data.is_verified_8a as boolean || false,
      sdvosb: data.is_verified_sdvosb as boolean || false,
      wosb: data.is_verified_wosb as boolean || false,
      hubzone: data.is_verified_hubzone as boolean || false,
    },

    capabilityKeywords: (data.capability_keywords as string[]) || [],
    pastPerformanceAgencies: (data.past_performance_agencies as string[]) || [],
    contractVehicles: (data.contract_vehicles as string[]) || [],
    maxContractSize: data.max_contract_size as string | null,

    engagementScore: (data.engagement_score as number) || 50,
    briefingsOpened: (data.briefings_opened as number) || 0,
    briefingsClicked: (data.briefings_clicked as number) || 0,
    lastBriefingOpenedAt: data.last_briefing_opened_at as string | null,
    lastClickAt: data.last_click_at as string | null,

    clickedNaics: (data.clicked_naics as string[]) || [],
    clickedAgencies: (data.clicked_agencies as string[]) || [],
    clickedContractors: (data.clicked_contractors as string[]) || [],
    clickedOpportunities: (data.clicked_opportunities as string[]) || [],

    naicsWeights: (data.naics_weights as Record<string, number>) || {},
    agencyWeights: (data.agency_weights as Record<string, number>) || {},
    companyWeights: (data.company_weights as Record<string, number>) || {},

    preferredContentTypes: (data.preferred_content_types as string[]) || [],
    mutedAgencies: (data.muted_agencies as string[]) || [],
    mutedNaics: (data.muted_naics as string[]) || [],
    minContractValue: (data.min_contract_value as number) || 0,
    maxDistanceMiles: data.max_distance_miles as number | null,

    profileCompleteness: (data.profile_completeness as number) || 10,
    onboardingCompleted: (data.onboarding_completed as boolean) || false,
    timezone: (data.timezone as string) || 'America/New_York',
    emailFrequency: (data.email_frequency as 'daily' | 'weekly' | 'none') || 'daily',
    preferredDeliveryHour: (data.preferred_delivery_hour as number) || 7,

    createdAt: data.created_at as string,
    updatedAt: data.updated_at as string,
    lastProfileUpdate: data.last_profile_update as string | null,
  };
}
