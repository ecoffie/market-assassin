/**
 * AI-Powered Briefing Generator
 *
 * Generates actionable market intelligence briefings using AI synthesis.
 * Format: Top 10 Ranked Opportunities + 3 Ghosting/Teaming Plays
 *
 * See ~/docs/briefing-format.md for full specification.
 */

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { RecompeteContract } from '../pipelines/fpds-recompete';
import { ContractAward } from '../pipelines/contract-awards';
import { ContractorRecord } from '../pipelines/contractor-db';
import { WebSignal } from '../web-intel/types';
import { enrichContractsWithIntel, ContractIntelligence } from '../enrichment';

// Types for AI-generated briefings
export interface AIBriefingOpportunity {
  rank: number;
  contractName: string;
  agency: string;
  subAgency?: string;
  incumbent: string;
  value: string;
  window: string;
  displacementAngle: string;
}

export interface AIBriefingTeamingPlay {
  playNumber: number;
  strategyName: string;
  targetPrimes: string[];
  rationale: string;
  suggestedOpener: string;
}

export interface AIGeneratedBriefing {
  id: string;
  userId: string;
  generatedAt: string;
  briefingDate: string;
  opportunities: AIBriefingOpportunity[];
  teamingPlays: AIBriefingTeamingPlay[];
  rawDataSummary: {
    recompetesAnalyzed: number;
    awardsAnalyzed: number;
    contractorsAnalyzed: number;
    webSignalsAnalyzed: number;
  };
  processingTimeMs: number;
}

const SYSTEM_PROMPT = `You are a senior GovCon capture strategist writing a daily market intelligence briefing for federal contractors. Your job is to analyze raw contract data and produce actionable competitive intelligence.

OUTPUT FORMAT (JSON):
{
  "opportunities": [
    {
      "rank": 1,
      "contractName": "descriptive name (not just numbers)",
      "agency": "Department / Sub-agency",
      "incumbent": "current holder(s)",
      "value": "contract ceiling/amount with context",
      "window": "timeline, RFI status, solicitation date",
      "displacementAngle": "the STRATEGIC INSIGHT - why is this winnable NOW"
    }
  ],
  "teamingPlays": [
    {
      "playNumber": 1,
      "strategyName": "descriptive strategy label",
      "targetPrimes": ["specific company names"],
      "rationale": "why this play, why now",
      "suggestedOpener": "copy-paste ready outreach message"
    }
  ]
}

DISPLACEMENT ANGLES TO LOOK FOR:
- Bridge contracts (vulnerability signal)
- Multiple extensions (procurement fatigue)
- 8(a) → unrestricted recompetes (new competition opens)
- Incumbent terminations or scandals
- M&A integration friction (company absorbed another)
- New requirements/technology shifts
- Consolidation vehicles (fresh competition)
- Protest outcomes (incumbent lost)
- Greenfield opportunities (no incumbent)
- Contract performance issues (from news/signals)

RANKING CRITERIA (in order):
1. Active solicitation or RFI (immediate action)
2. Incumbent vulnerability (termination, scandal, extensions)
3. Large value ($100M+)
4. Clear timeline (Q1/Q2 vs. "sometime")
5. Match to user's NAICS and capabilities

TEAMING PLAY CRITERIA:
- Target primes experiencing integration friction
- Target primes who lost incumbency elsewhere (need new wins)
- Target new vehicle winners who need subs for task orders
- Always include a specific, professional outreach opener

VOICE:
- Direct, no fluff
- Insider perspective ("this is what the smart money is watching")
- Action-oriented ("position now", "target", "approach")
- Specific names, specific numbers, specific dates

DO NOT:
- Include generic opportunities with no displacement angle
- Rank by value alone (a $50M winnable > $500M impossible)
- Write fluffy marketing language
- Omit incumbent names
- Give vague timelines`;

/**
 * Generate AI-powered briefing
 */
export async function generateAIBriefing(
  userEmail: string,
  options: {
    maxOpportunities?: number;
    maxTeamingPlays?: number;
  } = {}
): Promise<AIGeneratedBriefing | null> {
  const startTime = Date.now();
  const supabase = getSupabaseClient();

  if (!supabase) {
    console.error('[AIBriefingGen] Supabase not configured');
    return null;
  }

  const anthropic = getAnthropicClient();
  if (!anthropic) {
    console.error('[AIBriefingGen] Anthropic not configured');
    return null;
  }

  const briefingDate = new Date().toISOString().split('T')[0];

  // Fallback NAICS codes for users without profile data
  const FALLBACK_NAICS = ['541512', '541611', '541330', '541990', '561210'];

  try {
    // Step 1: Get user profile from unified table
    const { data: profileData } = await supabase
      .from('user_notification_settings')
      .select('aggregated_profile, naics_codes, agencies, keywords')
      .eq('user_email', userEmail)
      .single();

    // Use fallback if no profile
    const effectiveProfile = profileData || {
      naics_codes: FALLBACK_NAICS,
      agencies: [],
      keywords: [],
      aggregated_profile: null,
    };

    const profile = buildProfile(effectiveProfile);

    // Step 2: Get today's snapshots
    const today = new Date().toISOString().split('T')[0];
    const { data: snapshots } = await supabase
      .from('briefing_snapshots')
      .select('tool, raw_data')
      .eq('user_email', userEmail)
      .eq('snapshot_date', today);

    let organizedData = organizeSnapshots(snapshots || []);

    // FALLBACK: If no snapshots, fetch live data from SAM.gov
    if (organizedData.recompetes.length === 0 && organizedData.awards.length === 0) {
      console.log(`[AIBriefingGen] No snapshots found, fetching live data...`);
      try {
        const liveData = await fetchLiveOpportunityData(profile.naics_codes);
        if (liveData.opportunities.length > 0) {
          // Convert SAM opportunities to recompete-like format for AI processing
          organizedData = {
            recompetes: liveData.opportunities.map((opp: SAMOpportunity) => ({
              piid: opp.noticeId || '',
              incumbentName: opp.organizationName || 'Unknown',
              contractingAgency: opp.department || opp.subtierAgency || 'Federal Agency',
              currentValue: opp.estimatedValue || 0,
              naicsCode: opp.naicsCode || '',
              expirationDate: opp.responseDeadLine || '',
              title: opp.title || '',
              description: opp.description?.slice(0, 500) || '',
              placeOfPerformance: opp.poState || '',
              setAside: opp.setAside || '',
              type: opp.type || 'presolicitation',
            })) as unknown as RecompeteContract[],
            awards: [],
            contractors: [],
            webSignals: [],
          };
          console.log(`[AIBriefingGen] Found ${liveData.opportunities.length} live opportunities`);
        }
      } catch (err) {
        console.warn(`[AIBriefingGen] Live data fetch failed:`, err);
      }
    }

    // Step 3: Enrich top recompetes with Perplexity (real-time web intel)
    let enrichedIntel: Map<string, ContractIntelligence> = new Map();
    if (organizedData.recompetes.length > 0 && process.env.PERPLEXITY_API_KEY) {
      console.log(`[AIBriefingGen] Enriching top contracts with Perplexity...`);
      try {
        enrichedIntel = await enrichContractsWithIntel(
          organizedData.recompetes as RecompeteContract[],
          { maxContracts: 15, delayMs: 500 }
        );
        console.log(`[AIBriefingGen] Enriched ${enrichedIntel.size} contracts`);
      } catch (err) {
        console.warn(`[AIBriefingGen] Perplexity enrichment failed:`, err);
      }
    }

    // Step 4: Build user prompt with raw data + enriched intel
    const userPrompt = buildUserPrompt(profile, organizedData, enrichedIntel);

    // Step 5: Call Claude for synthesis
    console.log(`[AIBriefingGen] Generating AI briefing for ${userEmail}...`);

    const message = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 4000,
      messages: [
        {
          role: 'user',
          content: `${SYSTEM_PROMPT}\n\n${userPrompt}\n\nRespond with valid JSON only.`,
        },
      ],
    });

    const responseText = message.content[0].type === 'text' ? message.content[0].text : null;
    if (!responseText) {
      console.error('[AIBriefingGen] Empty response from OpenAI');
      return null;
    }

    // Step 5: Parse and validate response
    const aiResponse = JSON.parse(responseText) as {
      opportunities: AIBriefingOpportunity[];
      teamingPlays: AIBriefingTeamingPlay[];
    };

    const maxOpps = options.maxOpportunities || 10;
    const maxPlays = options.maxTeamingPlays || 3;

    const briefing: AIGeneratedBriefing = {
      id: `ai-briefing-${userEmail}-${briefingDate}`,
      userId: userEmail,
      generatedAt: new Date().toISOString(),
      briefingDate,
      opportunities: (aiResponse.opportunities || []).slice(0, maxOpps),
      teamingPlays: (aiResponse.teamingPlays || []).slice(0, maxPlays),
      rawDataSummary: {
        recompetesAnalyzed: organizedData.recompetes.length,
        awardsAnalyzed: organizedData.awards.length,
        contractorsAnalyzed: organizedData.contractors.length,
        webSignalsAnalyzed: organizedData.webSignals.length,
      },
      processingTimeMs: Date.now() - startTime,
    };

    console.log(
      `[AIBriefingGen] Generated briefing: ${briefing.opportunities.length} opportunities, ${briefing.teamingPlays.length} plays in ${briefing.processingTimeMs}ms`
    );

    return briefing;
  } catch (error) {
    console.error('[AIBriefingGen] Error:', error);
    return null;
  }
}

/**
 * Build user prompt with profile and data
 */
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
  },
  enrichedIntel?: Map<string, ContractIntelligence>
): string {
  // Build enriched intel section if available
  let enrichedSection = '';
  if (enrichedIntel && enrichedIntel.size > 0) {
    const intelEntries = Array.from(enrichedIntel.entries()).map(([key, intel]) => ({
      incumbent: intel.incumbent,
      agency: intel.agency,
      isBridge: intel.isBridgeContract,
      bridgeDetails: intel.bridgeDetails,
      hasRfi: intel.hasRfiActivity,
      rfiDetails: intel.rfiDetails,
      incumbentIssues: intel.incumbentIssues,
      maActivity: intel.hasMaActivity ? intel.maDetails : null,
      timeline: intel.expectedTimeline,
      displacementAngle: intel.displacementAngle,
      sources: intel.sources,
    }));

    enrichedSection = `

REAL-TIME INTELLIGENCE (from web search - USE THIS for displacement angles):
${JSON.stringify(intelEntries, null, 2)}

IMPORTANT: The "displacementAngle" field in the real-time intelligence contains researched insights.
Incorporate this intelligence into your analysis. If a contract has bridge/extension info, RFI activity,
incumbent issues, or M&A activity - USE IT in your displacement angles.
`;
  }

  return `Generate today's market intelligence briefing based on the following data:

USER PROFILE:
- NAICS Codes: ${profile.naics_codes.join(', ') || 'Any'}
- Target Agencies: ${profile.agencies.join(', ') || 'Any federal agency'}
- Keywords: ${profile.keywords.join(', ') || 'None specified'}
- Watched Companies: ${profile.watched_companies.join(', ') || 'None specified'}

RECOMPETE DATA (${data.recompetes.length} contracts expiring):
${JSON.stringify(data.recompetes.slice(0, 50), null, 2)}

RECENT AWARDS (${data.awards.length} in last 7 days):
${JSON.stringify(data.awards.slice(0, 30), null, 2)}

CONTRACTOR INTELLIGENCE (${data.contractors.length} companies):
${JSON.stringify(data.contractors.slice(0, 20), null, 2)}

WEB SIGNALS (${data.webSignals.length} news items):
${JSON.stringify(data.webSignals.slice(0, 10), null, 2)}
${enrichedSection}
Generate:
1. TOP 10 RECOMPETE OPPORTUNITIES ranked by actionability (not just value)
2. 3 GHOSTING/TEAMING PLAYS with specific outreach openers

Focus on opportunities that match the user's NAICS codes and target agencies. Prioritize actionable displacement opportunities over generic contract listings.

When real-time intelligence is provided, USE IT to craft specific, actionable displacement angles.
Bridge contracts, RFI activity, incumbent issues, and M&A activity are GOLD - highlight them.

Return JSON only.`;
}

/**
 * Build profile from database record
 */
function buildProfile(profileData: Record<string, unknown>): {
  naics_codes: string[];
  agencies: string[];
  keywords: string[];
  watched_companies: string[];
} {
  const aggregated = profileData.aggregated_profile as Record<string, unknown> | null;

  return {
    naics_codes: extractArray(aggregated?.naics_codes || profileData.naics_codes),
    agencies: extractArray(aggregated?.agencies || profileData.agencies),
    keywords: extractArray(aggregated?.keywords || profileData.keywords),
    watched_companies: extractArray(aggregated?.watched_companies || profileData.watched_companies),
  };
}

/**
 * Extract array from unknown value
 */
function extractArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String);
  }
  return [];
}

/**
 * Organize snapshots by type
 */
function organizeSnapshots(
  snapshots: Array<{ tool: string; raw_data: unknown }>
): {
  recompetes: RecompeteContract[];
  awards: ContractAward[];
  contractors: ContractorRecord[];
  webSignals: WebSignal[];
} {
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

  return organized;
}

/**
 * Get Supabase client
 */
function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) return null;
  return createClient(url, key);
}

/**
 * Get Anthropic client
 */
function getAnthropicClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return new Anthropic({ apiKey });
}

/**
 * SAM.gov Opportunity type for live data fetch
 */
interface SAMOpportunity {
  noticeId: string;
  title: string;
  description?: string;
  department?: string;
  subtierAgency?: string;
  organizationName?: string;
  naicsCode?: string;
  setAside?: string;
  type?: string;
  poState?: string;
  responseDeadLine?: string;
  estimatedValue?: number;
}

/**
 * Fetch live opportunity data from SAM.gov API
 */
async function fetchLiveOpportunityData(naicsCodes: string[]): Promise<{ opportunities: SAMOpportunity[] }> {
  const apiKey = process.env.SAM_API_KEY;
  if (!apiKey) {
    console.warn('[AIBriefingGen] No SAM_API_KEY configured');
    return { opportunities: [] };
  }

  const allOpportunities: SAMOpportunity[] = [];
  const effectiveNaics = naicsCodes.length > 0 ? naicsCodes.slice(0, 3) : ['541512', '541611'];

  // Get date 30 days ago in MM/dd/yyyy format
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const postedFrom = `${String(thirtyDaysAgo.getMonth() + 1).padStart(2, '0')}/${String(thirtyDaysAgo.getDate()).padStart(2, '0')}/${thirtyDaysAgo.getFullYear()}`;

  for (const naics of effectiveNaics) {
    try {
      const url = new URL('https://api.sam.gov/opportunities/v2/search');
      url.searchParams.set('api_key', apiKey);
      url.searchParams.set('naicsCode', naics);
      url.searchParams.set('postedFrom', postedFrom);
      url.searchParams.set('limit', '25');

      const response = await fetch(url.toString());
      if (!response.ok) {
        console.warn(`[AIBriefingGen] SAM.gov API error for ${naics}: ${response.status}`);
        continue;
      }

      const data = await response.json();
      const opportunities = (data.opportunitiesData || []).map((opp: Record<string, unknown>) => {
        const placeOfPerformance = opp.placeOfPerformance as Record<string, unknown> | undefined;
        const state = placeOfPerformance?.state as Record<string, unknown> | undefined;
        const award = opp.award as Record<string, unknown> | undefined;
        return {
          noticeId: opp.noticeId as string,
          title: opp.title as string,
          description: opp.description as string | undefined,
          department: opp.fullParentPathName as string | undefined,
          subtierAgency: opp.office as string | undefined,
          organizationName: opp.organizationType as string | undefined,
          naicsCode: naics,
          setAside: opp.typeOfSetAsideDescription as string | undefined,
          type: opp.type as string | undefined,
          poState: state?.code as string | undefined,
          responseDeadLine: opp.responseDeadLine as string | undefined,
          estimatedValue: award?.amount as number | undefined,
        };
      });

      allOpportunities.push(...opportunities);
      console.log(`[AIBriefingGen] Fetched ${opportunities.length} opportunities for NAICS ${naics}`);
    } catch (err) {
      console.warn(`[AIBriefingGen] Failed to fetch NAICS ${naics}:`, err);
    }
  }

  return { opportunities: allOpportunities };
}
