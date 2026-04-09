/**
 * Pre-compute Weekly Deep Dive Briefings
 *
 * ENTERPRISE ARCHITECTURE: Generate 49 weekly templates instead of 928 individual briefings.
 * Same pattern as daily briefings pre-computation.
 *
 * Schedule: Saturday 8 PM UTC (before Sunday 7 AM send)
 *
 * Process:
 * 1. Find all unique NAICS profiles among enabled users
 * 2. Fetch USASpending data ONCE per profile
 * 3. Generate AI analysis ONCE per profile
 * 4. Store in briefing_templates table
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { extractAndParseJSON, generateBriefingJson } from '@/lib/briefings/delivery/llm-router';
import crypto from 'crypto';

const PROFILES_PER_RUN = 10;
const DELAY_BETWEEN_PROFILES_MS = 1000;

// NAICS prefix expansion for 3-digit codes
const NAICS_EXPANSION: Record<string, string[]> = {
  '236': ['236220', '236210', '236115'],
  '237': ['237110', '237120', '237130', '237210'],
  '238': ['238110', '238120', '238140', '238210', '238310'],
  '541': ['541511', '541512', '541513', '541519', '541611', '541612', '541618', '541690', '541710', '541990'],
  '518': ['518210'],
  '561': ['561110', '561210', '561320', '561330', '561499', '561710', '561790', '561990'],
};

function expandNaicsCodes(codes: string[]): string[] {
  const expanded: string[] = [];
  for (const code of codes) {
    if (code.length === 3 && NAICS_EXPANSION[code]) {
      expanded.push(...NAICS_EXPANSION[code]);
    } else if (code.length === 6) {
      expanded.push(code);
    }
  }
  return [...new Set(expanded)].slice(0, 5);
}

interface NaicsProfile {
  naics_profile: string;
  naics_profile_hash: string;
  user_count: number;
  naics_codes: string[];
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

interface WeeklyOpportunity {
  rank: number;
  contractName: string;
  agency: string;
  incumbent: string;
  value: number;
  window: string;
  displacementAngle: string;
  keyDates: { label: string; date: string }[];
  competitiveLandscape: string[];
  recommendedApproach: string;
}

interface WeeklyTeamingPlay {
  playNumber: number;
  strategyName: string;
  targetCompany: string;
  whyTarget: string[];
  whoToContact: string[];
  suggestedOpener: string;
  followUpMessage: string;
}

interface WeeklyBriefing {
  weekOf: string;
  opportunities: WeeklyOpportunity[];
  teamingPlays: WeeklyTeamingPlay[];
  marketSignals: { headline: string; source: string; implication: string; actionRequired: boolean }[];
  calendar: { date: string; event: string; type: string; priority: string }[];
  processingTimeMs: number;
}

function hashNaicsProfile(naicsCodes: string[]): string {
  const sorted = [...naicsCodes].sort();
  return crypto.createHash('md5').update(JSON.stringify(sorted)).digest('hex');
}

function getWeekOfDate(): string {
  const monday = new Date();
  monday.setDate(monday.getDate() - monday.getDay() + 1);
  return monday.toISOString().split('T')[0];
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
        schedule: 'Saturday 8 PM UTC',
        benefit: '95% reduction in LLM calls (928 users → 49 templates)',
      });
    }
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const startTime = Date.now();
  const weekOf = getWeekOfDate();
  let templatesGenerated = 0;
  let templatesFailed = 0;
  const errors: string[] = [];

  console.log('[PrecomputeWeekly] Starting weekly template generation...');

  try {
    // Step 1: Get all unique NAICS profiles
    const { data: users, error: usersError } = await supabase
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
      if (naicsCodes.length === 0) continue;

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
    console.log(`[PrecomputeWeekly] Found ${allProfiles.length} unique NAICS profiles`);

    // Step 2: Check which profiles already have weekly templates
    const { data: existingTemplates } = await supabase
      .from('briefing_templates')
      .select('naics_profile_hash')
      .eq('template_date', weekOf)
      .eq('briefing_type', 'weekly');

    const existingHashes = new Set((existingTemplates || []).map(t => t.naics_profile_hash));

    const profilesToProcess = allProfiles
      .filter(p => !existingHashes.has(p.naics_profile_hash))
      .sort((a, b) => b.user_count - a.user_count)
      .slice(0, PROFILES_PER_RUN);

    console.log(`[PrecomputeWeekly] Processing ${profilesToProcess.length} profiles (${existingHashes.size} already done)`);

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
      const profileStartTime = Date.now();

      try {
        console.log(`[PrecomputeWeekly] Generating template for ${profile.user_count} users...`);

        // Fetch USASpending data for this profile
        const expandedNaics = expandNaicsCodes(profile.naics_codes);
        const contracts = await fetchContractsForNaics(expandedNaics);

        if (contracts.length === 0) {
          console.log(`[PrecomputeWeekly] No contracts found for profile, skipping`);
          continue;
        }

        // Generate AI analysis
        const briefing = await generateWeeklyDeepDive(contracts);
        briefing.processingTimeMs = Date.now() - profileStartTime;

        // Store template
        const { error: insertError } = await supabase.from('briefing_templates').upsert({
          naics_profile: profile.naics_profile,
          naics_profile_hash: profile.naics_profile_hash,
          template_date: weekOf,
          briefing_type: 'weekly',
          briefing_content: briefing,
          opportunities_count: briefing.opportunities.length,
          teaming_plays_count: briefing.teamingPlays.length,
          processing_time_ms: briefing.processingTimeMs,
          llm_provider: 'groq',
          llm_model: 'llama-3.3-70b-versatile',
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
    const remaining = allProfiles.length - existingHashes.size - templatesGenerated;

    console.log(`[PrecomputeWeekly] Complete: ${templatesGenerated} generated, ${templatesFailed} failed, ${remaining} remaining`);

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

async function generateWeeklyDeepDive(contracts: ContractForBriefing[]): Promise<WeeklyBriefing> {
  const monday = new Date();
  monday.setDate(monday.getDate() - monday.getDay() + 1);

  const prompt = `You are a senior GovCon capture strategist. Generate a Weekly Deep Dive briefing with full analysis.

CONTRACT DATA (REAL DATA FROM USASPENDING):
${JSON.stringify(contracts, null, 2)}

Generate JSON with:
1. "opportunities" - Top 10 with FULL analysis. Each needs: rank, contractName, agency, incumbent, value (number), window, displacementAngle, keyDates (array of {label, date}), competitiveLandscape (array of 3-4 insights), recommendedApproach (string)
2. "teamingPlays" - 3 DETAILED plays. Each: playNumber, strategyName, targetCompany, whyTarget (array), whoToContact (array), suggestedOpener, followUpMessage
3. "marketSignals" - 4 news items. Each: headline, source, implication, actionRequired (boolean)
4. "calendar" - 6 key dates. Each: date, event, type (deadline/industry_day/rfi_due/award_expected), priority (high/medium/low)

Focus on contracts with low numberOfBids (1-2 bids = vulnerable incumbent) and near-term expiration.

Return ONLY valid JSON.`;

  const { text } = await generateBriefingJson(
    'weekly',
    'You are a senior GovCon capture strategist.',
    prompt,
    6000
  );

  const data = extractAndParseJSON<{
    opportunities?: WeeklyOpportunity[];
    teamingPlays?: WeeklyTeamingPlay[];
    marketSignals?: { headline: string; source: string; implication: string; actionRequired: boolean }[];
    calendar?: { date: string; event: string; type: string; priority: string }[];
  }>(text);

  return {
    weekOf: monday.toISOString().split('T')[0],
    opportunities: data.opportunities || [],
    teamingPlays: data.teamingPlays || [],
    marketSignals: data.marketSignals || [],
    calendar: data.calendar || [],
    processingTimeMs: 0,
  };
}
