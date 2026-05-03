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
import { fetchSamOpportunityNoticeSummaryFromCache } from '@/lib/briefings/pipelines/sam-gov';
import { generateWeeklyDeepDiveFromContracts } from '@/lib/briefings/delivery/weekly-briefing-generator';
import { getPSCsForNAICS } from '@/lib/utils/psc-crosswalk';
import crypto from 'crypto';

const PROFILES_PER_RUN = 25; // Upper bound; soft time budget stops safely before platform timeout.
const MAX_RUN_MS = 210_000;
const DELAY_BETWEEN_PROFILES_MS = 1000;

// NAICS prefix expansion for 3-digit codes (comprehensive version)
const NAICS_EXPANSION: Record<string, string[]> = {
  '236': ['236220', '236210', '236115', '236116', '236117', '236118'], // Construction of Buildings
  '237': ['237110', '237120', '237130', '237210', '237310', '237990'], // Heavy & Civil Engineering
  '238': ['238110', '238120', '238130', '238140', '238150', '238160', '238170', '238190', '238210', '238220', '238290', '238310', '238320', '238330', '238340', '238350', '238390', '238910', '238990'], // Specialty Trade Contractors
  '541': ['541511', '541512', '541513', '541519', '541611', '541612', '541613', '541614', '541618', '541620', '541690', '541710', '541720', '541810', '541820', '541830', '541840', '541850', '541860', '541870', '541890', '541910', '541921', '541922', '541930', '541940', '541990'], // Professional Services
  '518': ['518210'], // Data Processing, Hosting
  '519': ['519130', '519190'], // Other Information Services
  '561': ['561110', '561210', '561311', '561312', '561320', '561330', '561410', '561421', '561422', '561431', '561439', '561440', '561450', '561491', '561492', '561499', '561510', '561520', '561591', '561599', '561611', '561612', '561613', '561621', '561622', '561710', '561720', '561730', '561740', '561790', '561910', '561920', '561990'], // Administrative and Support Services
};

function expandNaicsCodes(codes: string[]): string[] {
  const expanded: string[] = [];
  for (const code of codes) {
    if (code.length === 3 && NAICS_EXPANSION[code]) {
      expanded.push(...NAICS_EXPANSION[code]);
    } else if (code.length === 6) {
      expanded.push(code);
    } else {
      // Try prefix matching for partial codes
      for (const [prefix, fullCodes] of Object.entries(NAICS_EXPANSION)) {
        if (code.startsWith(prefix)) {
          expanded.push(...fullCodes);
          break;
        }
      }
      // If still no match and it's a valid-looking code, keep it as-is
      if (expanded.length === 0 && code.length >= 3) {
        expanded.push(code);
      }
    }
  }
  return [...new Set(expanded)].slice(0, 10);
}

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

interface ContractForBriefing {
  contractNumber: string;
  contractName: string;
  agency: string;
  incumbent: string;
  value: number;
  naicsCode: string;
  expirationDate: string;
  daysUntilExpiration: number;
  setAside: string;
  description: string;
  numberOfBids?: number;
  competitionLevel?: string;
}

function hashNaicsProfile(naicsCodes: string[]): string {
  const sorted = [...naicsCodes].sort();
  return crypto.createHash('md5').update(JSON.stringify(sorted)).digest('hex');
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
    const { data: users, error: usersError } = await getSupabase()
      .from('user_notification_settings')
      .select('user_email, naics_codes, keywords, agencies')
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
      const key = JSON.stringify([...naicsCodes].sort());

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
        const contracts = await fetchContractsForProfile(
          expandedNaics,
          profile.aggregated_psc_codes.slice(0, 10), // Limit to top 10 PSC codes
          profile.aggregated_keywords.slice(0, 20),   // Limit to top 20 keywords
          profile.aggregated_agencies.slice(0, 10)    // Limit to top 10 agencies
        );

        if (contracts.length === 0) {
          console.log(`[PrecomputeWeekly] No contracts found for profile, skipping`);
          continue;
        }

        // Generate AI analysis
        const noticeSummary = await fetchSamOpportunityNoticeSummaryFromCache({
          naicsCodes: expandedNaics,
          pscCodes: profile.aggregated_psc_codes.slice(0, 10),
          keywords: profile.aggregated_keywords.slice(0, 20),
        });

        const briefing = await generateWeeklyDeepDiveFromContracts(contracts, noticeSummary);
        briefing.processingTimeMs = Date.now() - profileStartTime;

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

// Scored contract interface for ranking
interface ScoredContract extends ContractForBriefing {
  relevanceScore: number;
  matchFactors: string[];
}

/**
 * Two-Stage Opportunity Fetch + Score
 * Stage 1: Cast wide net using NAICS + PSC + keywords + agencies
 * Stage 2: Score and rank each opportunity
 */
async function fetchContractsForProfile(
  naicsCodes: string[],
  pscCodes: string[],
  keywords: string[],
  agencies: string[]
): Promise<ContractForBriefing[]> {
  const rawContracts: ContractForBriefing[] = [];
  const seenIds = new Set<string>();

  console.log(`[PrecomputeWeekly] Fetching with wide net: ${naicsCodes.length} NAICS, ${pscCodes.length} PSC, ${keywords.length} keywords, ${agencies.length} agencies`);

  // Stage 1A: Fetch by NAICS codes (primary)
  for (const naics of naicsCodes.slice(0, 5)) {
    try {
      const contracts = await fetchUSASpendingContracts({ naics_code: naics });
      for (const c of contracts) {
        if (!seenIds.has(c.contractNumber)) {
          seenIds.add(c.contractNumber);
          rawContracts.push(c);
        }
      }
    } catch {
      // Continue on error
    }
  }

  // Stage 1B: Fetch by PSC codes (secondary - different contracts)
  for (const psc of pscCodes.slice(0, 3)) {
    try {
      const contracts = await fetchUSASpendingContracts({ psc_code: psc });
      for (const c of contracts) {
        if (!seenIds.has(c.contractNumber)) {
          seenIds.add(c.contractNumber);
          rawContracts.push(c);
        }
      }
    } catch {
      // Continue on error
    }
  }

  // Stage 1C: Fetch by keywords (catch mislabeled opportunities)
  for (const keyword of keywords.slice(0, 5)) {
    if (keyword.length < 3) continue; // Skip short keywords
    try {
      const contracts = await fetchUSASpendingContracts({ keyword });
      for (const c of contracts) {
        if (!seenIds.has(c.contractNumber)) {
          seenIds.add(c.contractNumber);
          rawContracts.push(c);
        }
      }
    } catch {
      // Continue on error
    }
  }

  console.log(`[PrecomputeWeekly] Stage 1 complete: ${rawContracts.length} unique contracts fetched`);

  // Stage 2: Score each contract
  const scoredContracts: ScoredContract[] = rawContracts.map(contract => {
    let score = 0;
    const matchFactors: string[] = [];

    // NAICS match (+25 points)
    if (naicsCodes.some(n => contract.naicsCode?.startsWith(n) || n.startsWith(contract.naicsCode || ''))) {
      score += 25;
      matchFactors.push('NAICS');
    }

    // PSC match (+15 points) - check description for PSC mentions
    const descLower = (contract.description || '').toLowerCase();
    if (pscCodes.some(psc => descLower.includes(psc.toLowerCase()))) {
      score += 15;
      matchFactors.push('PSC');
    }

    // Keyword in title (+20 points) or description (+10 points)
    const titleLower = (contract.contractName || '').toLowerCase();
    for (const kw of keywords) {
      const kwLower = kw.toLowerCase();
      if (titleLower.includes(kwLower)) {
        score += 20;
        matchFactors.push(`Keyword:${kw}`);
        break; // Only count once
      } else if (descLower.includes(kwLower)) {
        score += 10;
        matchFactors.push(`KeywordDesc:${kw}`);
        break;
      }
    }

    // Target agency match (+15 points)
    const agencyLower = (contract.agency || '').toLowerCase();
    if (agencies.some(a => agencyLower.includes(a.toLowerCase()) || a.toLowerCase().includes(agencyLower))) {
      score += 15;
      matchFactors.push('Agency');
    }

    // Expiring soon bonus (+10 points for <180 days, +5 for <365 days)
    if (contract.daysUntilExpiration < 180) {
      score += 10;
      matchFactors.push('Expiring<6mo');
    } else if (contract.daysUntilExpiration < 365) {
      score += 5;
      matchFactors.push('Expiring<1yr');
    }

    // Low competition bonus (+15 points for 1-2 bids)
    if (contract.numberOfBids && contract.numberOfBids <= 2) {
      score += 15;
      matchFactors.push('LowBids');
    }

    // High value bonus (+5 points for $1M+, +10 for $10M+)
    if (contract.value >= 10000000) {
      score += 10;
      matchFactors.push('Value$10M+');
    } else if (contract.value >= 1000000) {
      score += 5;
      matchFactors.push('Value$1M+');
    }

    return {
      ...contract,
      relevanceScore: score,
      matchFactors,
    };
  });

  // Sort by score descending, then by value
  scoredContracts.sort((a, b) => {
    if (b.relevanceScore !== a.relevanceScore) {
      return b.relevanceScore - a.relevanceScore;
    }
    return b.value - a.value;
  });

  console.log(`[PrecomputeWeekly] Stage 2 complete: Top scores: ${scoredContracts.slice(0, 5).map(c => c.relevanceScore).join(', ')}`);

  // Return top 15 (strips relevanceScore/matchFactors for clean interface)
  return scoredContracts.slice(0, 15).map(({ relevanceScore, matchFactors, ...contract }) => contract);
}

/**
 * Unified USASpending fetch helper
 */
async function fetchUSASpendingContracts(params: {
  naics_code?: string;
  psc_code?: string;
  keyword?: string;
}): Promise<ContractForBriefing[]> {
  const contracts: ContractForBriefing[] = [];

  // Build filters
  const filters: Record<string, unknown> = {
    time_period: [{ start_date: '2022-01-01', end_date: '2027-12-31' }],
    award_type_codes: ['A', 'B', 'C', 'D'],
  };

  if (params.naics_code) {
    filters.naics_codes = { require: [params.naics_code] };
  }
  if (params.psc_code) {
    filters.psc_codes = { require: [params.psc_code] };
  }
  if (params.keyword) {
    filters.keywords = [params.keyword];
  }

  try {
    const response = await fetch(`https://api.usaspending.gov/api/v2/search/spending_by_award/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filters,
        fields: ['Award ID', 'Recipient Name', 'Start Date', 'End Date', 'Award Amount', 'Awarding Agency', 'generated_internal_id'],
        page: 1,
        limit: 8,
        sort: 'Award Amount',
        order: 'desc',
      }),
    });

    if (!response.ok) return contracts;

    const data = await response.json();
    const awards = data.results || [];

    for (const award of awards.slice(0, 4)) {
      const awardId = award.generated_internal_id || award['Award ID'];
      try {
        const detailRes = await fetch(`https://api.usaspending.gov/api/v2/awards/${awardId}/`);
        if (detailRes.ok) {
          const detail = await detailRes.json();
          const contractData = detail.latest_transaction_contract_data || {};
          const periodPerf = detail.period_of_performance || {};
          const endDate = periodPerf.end_date || award['End Date'] || '';
          const daysUntil = endDate ? Math.ceil((new Date(endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : 180;
          const numberOfBids = parseInt(contractData.number_of_offers_received || '0', 10) || 0;

          contracts.push({
            contractNumber: detail.piid || award['Award ID'],
            contractName: detail.description || 'Contract',
            agency: detail.awarding_agency?.toptier_agency?.name || award['Awarding Agency'] || '',
            incumbent: detail.recipient?.recipient_name || award['Recipient Name'] || '',
            value: detail.total_obligation || Number(award['Award Amount']) || 0,
            naicsCode: detail.latest_transaction_contract_data?.naics || params.naics_code || '',
            expirationDate: endDate,
            daysUntilExpiration: daysUntil,
            setAside: contractData.extent_competed_description || 'Full & Open',
            description: detail.description || '',
            numberOfBids,
            competitionLevel: numberOfBids <= 2 ? 'low' : numberOfBids <= 5 ? 'medium' : 'high',
          });
        }
      } catch {
        // Skip individual award errors
      }
    }
  } catch {
    // Skip fetch errors
  }

  return contracts;
}

// Legacy function kept for compatibility
async function fetchContractsForNaics(naicsCodes: string[]): Promise<ContractForBriefing[]> {
  const allContracts: ContractForBriefing[] = [];

  for (const naics of naicsCodes.slice(0, 3)) {
    try {
      const response = await fetch(`https://api.usaspending.gov/api/v2/search/spending_by_award/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filters: {
            time_period: [{ start_date: '2022-01-01', end_date: '2027-12-31' }],
            award_type_codes: ['A', 'B', 'C', 'D'],
            naics_codes: { require: [naics] },
          },
          fields: ['Award ID', 'Recipient Name', 'Start Date', 'End Date', 'Award Amount', 'Awarding Agency', 'generated_internal_id'],
          page: 1,
          limit: 10,
          sort: 'Award Amount',
          order: 'desc',
        }),
      });

      if (!response.ok) continue;

      const data = await response.json();
      const awards = data.results || [];

      for (const award of awards.slice(0, 3)) {
        const awardId = award.generated_internal_id || award['Award ID'];
        try {
          const detailRes = await fetch(`https://api.usaspending.gov/api/v2/awards/${awardId}/`);
          if (detailRes.ok) {
            const detail = await detailRes.json();
            const contractData = detail.latest_transaction_contract_data || {};
            const periodPerf = detail.period_of_performance || {};
            const endDate = periodPerf.end_date || award['End Date'] || '';
            const daysUntil = endDate ? Math.ceil((new Date(endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : 180;
            const numberOfBids = parseInt(contractData.number_of_offers_received || '0', 10) || 0;

            allContracts.push({
              contractNumber: detail.piid || award['Award ID'],
              contractName: detail.description || `${naics} Contract`,
              agency: detail.awarding_agency?.toptier_agency?.name || award['Awarding Agency'] || '',
              incumbent: detail.recipient?.recipient_name || award['Recipient Name'] || '',
              value: detail.total_obligation || Number(award['Award Amount']) || 0,
              naicsCode: naics,
              expirationDate: endDate,
              daysUntilExpiration: daysUntil,
              setAside: contractData.extent_competed_description || 'Full & Open',
              description: detail.description || '',
              numberOfBids,
              competitionLevel: numberOfBids <= 2 ? 'low' : numberOfBids <= 5 ? 'medium' : 'high',
            });
          }
        } catch {
          // Skip individual award errors
        }
      }
    } catch {
      // Skip NAICS errors
    }
  }

  return allContracts.sort((a, b) => b.value - a.value).slice(0, 10);
}
