/**
 * Weekly Deep Dive Briefing Generator
 *
 * Generates comprehensive weekly market intelligence briefings.
 * Format: Full analysis per opportunity + detailed teaming plays + market signals
 *
 * See ~/docs/briefing-format.md for full specification.
 */

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { RecompeteContract, fetchExpiringContractsFromLocal, fetchExpiringContracts } from '../pipelines/fpds-recompete';
import { ContractAward } from '../pipelines/contract-awards';
import { ContractorRecord } from '../pipelines/contractor-db';
import { WebSignal } from '../web-intel/types';
import { prioritizeNaicsByIndustry } from '@/lib/industry-presets';

export interface WeeklyOpportunityAnalysis {
  rank: number;
  contractName: string;
  agency: string;
  subAgency?: string;
  incumbent: string;
  value: string;
  window: string;
  displacementAngle: string;
  keyDates: {
    label: string;
    date: string;
  }[];
  competitiveLandscape: string[];
  yourPosition: {
    naicsMatch: boolean;
    agencyExperience: 'strong' | 'moderate' | 'limited';
    recommendedApproach: string;
  };
}

export interface WeeklyTeamingPlay {
  playNumber: number;
  strategyName: string;
  targetCompany: string;
  whyTarget: string[];
  whoToContact: string[];
  suggestedOpener: string;
  followUpMessage: string;
}

export interface WeeklyMarketSignal {
  headline: string;
  source: string;
  implication: string;
  actionRequired: boolean;
}

export interface WeeklyCalendarItem {
  date: string;
  event: string;
  type: 'deadline' | 'industry_day' | 'rfi_due' | 'award_expected';
  priority: 'high' | 'medium' | 'low';
}

export interface WeeklyBriefing {
  id: string;
  userId: string;
  generatedAt: string;
  weekOf: string;
  opportunities: WeeklyOpportunityAnalysis[];
  teamingPlays: WeeklyTeamingPlay[];
  marketSignals: WeeklyMarketSignal[];
  calendar: WeeklyCalendarItem[];
  rawDataSummary: {
    recompetesAnalyzed: number;
    awardsAnalyzed: number;
    contractorsAnalyzed: number;
    webSignalsAnalyzed: number;
  };
  processingTimeMs: number;
}

const SYSTEM_PROMPT = `You are a senior GovCon capture strategist writing a weekly market intelligence deep dive for federal contractors. This is the comprehensive weekly briefing that enables strategic planning.

OUTPUT FORMAT (JSON):
{
  "opportunities": [
    {
      "rank": 1,
      "contractName": "descriptive name",
      "agency": "Department / Sub-agency",
      "incumbent": "current holder(s)",
      "value": "contract value with context",
      "window": "timeline details",
      "displacementAngle": "strategic insight - why winnable",
      "keyDates": [
        { "label": "RFI Response", "date": "March 30, 2026" },
        { "label": "Expected Solicitation", "date": "Q2 2026" }
      ],
      "competitiveLandscape": [
        "Current holders have 5+ years incumbency",
        "Peraton integration issues documented",
        "BAE focusing on other programs"
      ],
      "yourPosition": {
        "naicsMatch": true,
        "agencyExperience": "limited|moderate|strong",
        "recommendedApproach": "Teaming with established prime"
      }
    }
  ],
  "teamingPlays": [
    {
      "playNumber": 1,
      "strategyName": "Target Peraton for Navy Cyber",
      "targetCompany": "Peraton",
      "whyTarget": [
        "Absorbed Perspecta + Northrop IT — integration complexity",
        "Likely stretched across multiple recompetes",
        "Need specialized cyber talent"
      ],
      "whoToContact": [
        "BD Director, Navy Programs",
        "Capture Manager for NIWC",
        "Small Business Liaison Officer"
      ],
      "suggestedOpener": "Saw the NIWC recompete going unrestricted...",
      "followUpMessage": "Following up on NIWC cyber. We have X cleared staff..."
    }
  ],
  "marketSignals": [
    {
      "headline": "Treasury terminates all Booz Allen contracts",
      "source": "Federal News Network",
      "implication": "Creates $200M+ vacuum in IRS modernization work",
      "actionRequired": true
    }
  ],
  "calendar": [
    {
      "date": "March 30, 2026",
      "event": "NIWC Cyber RFI Response Due",
      "type": "rfi_due",
      "priority": "high"
    }
  ]
}

ANALYSIS DEPTH:
- Provide 3-5 competitive landscape points per opportunity
- Include specific dates when available
- Assess user's position based on their NAICS and agency experience
- Give concrete teaming recommendations

RANKING BY:
1. Active solicitation/RFI (immediate action needed)
2. Incumbent vulnerability (terminations, M&A friction, extensions)
3. Value ($100M+)
4. Timeline clarity
5. Match to user profile

VOICE: Strategic advisor, data-driven, specific and actionable.`;

/**
 * Generate weekly deep dive briefing
 */
export async function generateWeeklyBriefing(
  userEmail: string,
  options: {
    maxOpportunities?: number;
    maxTeamingPlays?: number;
  } = {}
): Promise<WeeklyBriefing | null> {
  const startTime = Date.now();
  const supabase = getSupabaseClient();

  if (!supabase) {
    throw new Error('Supabase not configured - missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  const anthropic = getAnthropicClient();
  if (!anthropic) {
    throw new Error('Anthropic not configured - missing ANTHROPIC_API_KEY');
  }

  // Get Monday of current week
  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - today.getDay() + 1);
  const weekOf = monday.toISOString().split('T')[0];

  // Fallback NAICS codes for users without profile data
  const FALLBACK_NAICS = ['541512', '541611', '541330', '541990', '561210'];

  try {
    // Get user profile from unified table
    const { data: profileData } = await supabase
      .from('user_notification_settings')
      .select('aggregated_profile, naics_codes, agencies, keywords, primary_industry')
      .eq('user_email', userEmail)
      .single();

    // Use fallback if no profile
    const effectiveProfile = profileData || {
      naics_codes: FALLBACK_NAICS,
      agencies: [],
      keywords: [],
      aggregated_profile: null,
      primary_industry: null,
    };

    const profile = buildProfile(effectiveProfile);
    const primaryIndustry = (profileData?.primary_industry as string) || null;

    // Prioritize NAICS codes by primary industry
    const prioritizedNaics = prioritizeNaicsByIndustry(profile.naics_codes, primaryIndustry);
    console.log(`[WeeklyBriefing] Primary industry: ${primaryIndustry || 'none'}, prioritized NAICS: ${prioritizedNaics.slice(0, 5).join(', ')}...`);

    // Get last 7 days of snapshots
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
    const { data: snapshots } = await supabase
      .from('briefing_snapshots')
      .select('tool, raw_data, snapshot_date')
      .eq('user_email', userEmail)
      .gte('snapshot_date', weekAgo);

    let organizedData = organizeSnapshots(snapshots || []);

    console.log(`[WeeklyBriefing] Snapshots: ${snapshots?.length || 0}, Recompetes: ${organizedData.recompetes.length}`);

    // FALLBACK: If no snapshots, fetch from LOCAL FPDS data first (then USASpending as backup)
    if (organizedData.recompetes.length === 0 && organizedData.awards.length === 0) {
      console.log(`[WeeklyBriefing] No snapshots found, fetching from LOCAL contracts-data.js (FPDS dump)...`);
      try {
        // Use prioritized NAICS codes (primary industry first)
        const naicsToUse = prioritizedNaics.length > 0 ? prioritizedNaics : ['541512', '541611', '541330'];
        // PRIMARY: Use local FPDS data dump (contracts-data.js) - comprehensive data including Construction
        const recompeteResult = await fetchExpiringContractsFromLocal({
          naicsCodes: naicsToUse,
          monthsToExpiration: 12,
          limit: 50,
        });
        if (recompeteResult.contracts.length > 0) {
          organizedData = {
            recompetes: recompeteResult.contracts,
            awards: [],
            contractors: [],
            webSignals: [],
          };
          console.log(`[WeeklyBriefing] Found ${recompeteResult.contracts.length} recompete opportunities from LOCAL data`);
        } else {
          // BACKUP: Try USASpending API if no local matches
          console.log(`[WeeklyBriefing] No local data matches, trying USASpending API...`);
          const usaResult = await fetchExpiringContracts({
            naicsCodes: naicsToUse,
            monthsToExpiration: 12,
            limit: 50,
          });
          if (usaResult.contracts.length > 0) {
            organizedData = {
              recompetes: usaResult.contracts,
              awards: [],
              contractors: [],
              webSignals: [],
            };
            console.log(`[WeeklyBriefing] Found ${usaResult.contracts.length} from USASpending API`);
          }
        }
      } catch (err) {
        console.warn(`[WeeklyBriefing] Recompete data fetch failed:`, err);
      }
    }

    // Build user prompt
    const userPrompt = buildUserPrompt(profile, organizedData);

    console.log(`[WeeklyBriefing] Generating for ${userEmail}...`);

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 6000,
      messages: [
        {
          role: 'user',
          content: `${SYSTEM_PROMPT}\n\n${userPrompt}\n\nRespond with valid JSON only.`,
        },
      ],
    });

    const responseText = message.content[0].type === 'text' ? message.content[0].text : null;
    if (!responseText) {
      console.error('[WeeklyBriefing] Empty response from Claude');
      return null;
    }

    // Strip markdown code fences if present
    let jsonText = responseText.trim();
    if (jsonText.startsWith('```json')) {
      jsonText = jsonText.slice(7);
    } else if (jsonText.startsWith('```')) {
      jsonText = jsonText.slice(3);
    }
    if (jsonText.endsWith('```')) {
      jsonText = jsonText.slice(0, -3);
    }
    jsonText = jsonText.trim();

    const aiResponse = JSON.parse(jsonText);

    const maxOpps = options.maxOpportunities || 10;
    const maxPlays = options.maxTeamingPlays || 3;

    const briefing: WeeklyBriefing = {
      id: `weekly-${userEmail}-${weekOf}`,
      userId: userEmail,
      generatedAt: new Date().toISOString(),
      weekOf,
      opportunities: (aiResponse.opportunities || []).slice(0, maxOpps),
      teamingPlays: (aiResponse.teamingPlays || []).slice(0, maxPlays),
      marketSignals: aiResponse.marketSignals || [],
      calendar: aiResponse.calendar || [],
      rawDataSummary: {
        recompetesAnalyzed: organizedData.recompetes?.length || 0,
        awardsAnalyzed: organizedData.awards?.length || 0,
        contractorsAnalyzed: organizedData.contractors?.length || 0,
        webSignalsAnalyzed: organizedData.webSignals?.length || 0,
      },
      processingTimeMs: Date.now() - startTime,
    };

    console.log(
      `[WeeklyBriefing] Generated: ${briefing.opportunities.length} opps, ${briefing.teamingPlays.length} plays in ${briefing.processingTimeMs}ms`
    );

    return briefing;
  } catch (error) {
    console.error('[WeeklyBriefing] Error:', error);
    throw error;
  }
}

function buildUserPrompt(
  profile: {
    naics_codes: string[];
    agencies: string[];
    keywords: string[];
    watched_companies: string[];
  },
  data: {
    recompetes: RecompeteContract[];
    awards: ContractAward[];
    contractors: ContractorRecord[];
    webSignals: WebSignal[];
  }
): string {
  return `Generate a weekly deep dive briefing based on the following data:

USER PROFILE:
- NAICS Codes: ${profile.naics_codes.join(', ') || 'Any'}
- Target Agencies: ${profile.agencies.join(', ') || 'Any federal agency'}
- Keywords: ${profile.keywords.join(', ') || 'None specified'}
- Watched Companies: ${profile.watched_companies.join(', ') || 'None specified'}

RECOMPETE DATA (${data.recompetes.length} contracts):
${JSON.stringify(data.recompetes.slice(0, 50), null, 2)}

RECENT AWARDS (${data.awards.length} this week):
${JSON.stringify(data.awards.slice(0, 30), null, 2)}

CONTRACTOR INTELLIGENCE (${data.contractors.length} companies):
${JSON.stringify(data.contractors.slice(0, 20), null, 2)}

WEB SIGNALS (${data.webSignals.length} news items):
${JSON.stringify(data.webSignals.slice(0, 15), null, 2)}

Generate:
1. TOP 10 OPPORTUNITIES with full analysis (competitive landscape, key dates, position assessment)
2. 3 TEAMING PLAYS with detailed outreach templates
3. MARKET SIGNALS - key news affecting the pipeline
4. CALENDAR - important dates in next 30 days

Focus on strategic planning value. Be specific with dates, names, and recommendations.

Return JSON only.`;
}

function buildProfile(profileData: Record<string, unknown>) {
  const aggregated = profileData.aggregated_profile as Record<string, unknown> | null;
  return {
    naics_codes: extractArray(aggregated?.naics_codes || profileData.naics_codes),
    agencies: extractArray(aggregated?.agencies || profileData.agencies),
    keywords: extractArray(aggregated?.keywords || profileData.keywords),
    watched_companies: extractArray(aggregated?.watched_companies || profileData.watched_companies),
  };
}

function extractArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  return [];
}

function organizeSnapshots(
  snapshots: Array<{ tool: string; raw_data: unknown; snapshot_date: string }>
) {
  const organized = {
    recompetes: [] as RecompeteContract[],
    awards: [] as ContractAward[],
    contractors: [] as ContractorRecord[],
    webSignals: [] as WebSignal[],
  };

  for (const snap of snapshots) {
    const data = snap.raw_data as Record<string, unknown> | null;
    if (!data) continue;

    switch (snap.tool) {
      case 'recompete':
        if (Array.isArray(data.contracts)) {
          organized.recompetes.push(...(data.contracts as RecompeteContract[]));
        }
        break;
      case 'market_assassin':
      case 'usaspending':
        if (Array.isArray(data.awards)) {
          organized.awards.push(...(data.awards as ContractAward[]));
        }
        break;
      case 'contractor_db':
        if (Array.isArray(data.contractors)) {
          organized.contractors.push(...(data.contractors as ContractorRecord[]));
        }
        break;
      case 'web_intelligence':
        if (Array.isArray(data.signals)) {
          organized.webSignals.push(...(data.signals as WebSignal[]));
        }
        break;
    }
  }

  // Dedupe by ID
  organized.recompetes = dedupeById(organized.recompetes, 'contractNumber');
  organized.awards = dedupeById(organized.awards, 'awardId');

  return organized;
}

function dedupeById<T>(items: T[], idField: keyof T): T[] {
  const seen = new Set();
  return items.filter(item => {
    const id = item[idField];
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

function getAnthropicClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return new Anthropic({ apiKey });
}
