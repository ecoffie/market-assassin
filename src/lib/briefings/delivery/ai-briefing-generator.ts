/**
 * AI-Powered Briefing Generator
 *
 * Generates actionable market intelligence briefings using AI synthesis.
 * Format: Top 10 Ranked Opportunities + 3 Ghosting/Teaming Plays
 *
 * See ~/docs/briefing-format.md for full specification.
 */

import { createClient } from '@supabase/supabase-js';
import { RecompeteContract, fetchExpiringContractsFromLocal, fetchExpiringContracts } from '../pipelines/fpds-recompete';
import { ContractAward } from '../pipelines/contract-awards';
import { ContractorRecord } from '../pipelines/contractor-db';
import { WebSignal } from '../web-intel/types';
import { enrichContractsWithIntel, ContractIntelligence } from '../enrichment';
import { prioritizeNaicsByIndustry } from '@/lib/industry-presets';
import { fetchMultisiteForUser, MultisiteOpportunity, ScoredMultisiteOpportunity } from '../pipelines/multisite';
import { extractAndParseJSON, generateBriefingJson } from './llm-router';

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
    multisiteOppsAnalyzed: number;
  };
  processingTimeMs: number;
}

const SYSTEM_PROMPT = `You are a senior GovCon capture strategist writing a daily market intelligence briefing for federal contractors. Your job is to analyze raw contract data and produce actionable competitive intelligence.

MARKET RESEARCH CONTEXT (GAO-15-8):
Federal agencies conduct market research in 3 phases:
1. PRESOLICITATION: Sources Sought, RFIs - before developing requirements
2. PREAWARD: Industry days, capability briefings - before soliciting offers
3. POSTAWARD: Price reasonableness for task orders

KEY INSIGHT: Companies that engage early (respond to RFIs, attend industry days) have 75% higher win rates.
Always highlight opportunities with open market research windows - these are prime positioning moments.

OUTPUT FORMAT (JSON):
{
  "opportunities": [
    {
      "rank": 1,
      "contractName": "descriptive name (not just numbers)",
      "agency": "Department / Sub-agency",
      "incumbent": "current holder(s)",
      "value": "contract ceiling/amount with context",
      "window": "timeline, RFI status, solicitation date, industry day if known",
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
- Sources Sought/RFI open (shape requirements NOW - highest priority)
- Industry day scheduled (relationship building window)
- Bridge contracts (vulnerability signal)
- Multiple extensions (procurement fatigue)
- 8(a) → unrestricted recompetes (new competition opens)
- Incumbent terminations or scandals (ONLY if verified with source)
- M&A integration friction (company absorbed another)
- New requirements/technology shifts
- Consolidation vehicles (fresh competition)
- Protest outcomes (incumbent lost) - ONLY with GAO case numbers
- Greenfield opportunities (no incumbent)
- Contract performance issues (ONLY from verified news sources)

CRITICAL - DO NOT FABRICATE:
- DO NOT claim ASBCA cases, OSHA violations, or GAO protests without case numbers
- DO NOT speculate about incumbent "performance issues" without verified sources
- If real-time intelligence is empty or shows "no verified signals", use contract-based angles only (timeline, value, set-aside changes)
- Better to say "Standard recompete opportunity" than to fabricate issues

RANKING CRITERIA (in order):
1. Active Sources Sought/RFI (market research window open - can shape requirements)
2. Industry day scheduled (relationship building opportunity)
3. Active solicitation (immediate action required)
4. Incumbent vulnerability (termination, scandal, extensions)
5. Large value ($100M+)
6. Clear timeline (Q1/Q2 vs. "sometime")
7. Match to user's NAICS and capabilities

TEAMING PLAY CRITERIA:
- Target primes who need subs for active Sources Sought responses
- Target primes experiencing integration friction
- Target primes who lost incumbency elsewhere (need new wins)
- Target new vehicle winners who need subs for task orders
- Always include a specific, professional outreach opener

VOICE:
- Direct, no fluff
- Insider perspective ("this is what the smart money is watching")
- Action-oriented ("respond to RFI now", "attend industry day", "position now")
- Specific names, specific numbers, specific dates

DO NOT:
- Include generic opportunities with no displacement angle
- Rank by value alone (a $50M winnable > $500M impossible)
- Write fluffy marketing language
- Omit incumbent names
- Give vague timelines
- Miss highlighting open market research windows

R&D OPPORTUNITIES (NIH, DARPA, NSF):
When multisite opportunities are provided, these are HIGH-VALUE R&D opportunities:
- NIH Grants: Research funding with rolling deadlines, multiple award phases
- DARPA BAAs: Cutting-edge technology development with rolling submissions
- NSF SBIR/STTR: Small business research innovation funding
These opportunities are DIFFERENT from standard federal contracts:
- Often have rolling deadlines (not fixed close dates)
- Require white paper/proposal submissions
- Focus on innovation and research capabilities vs. past performance
- Can lead to follow-on production contracts
Include at least 1-2 R&D opportunities in your top 10 if provided.`;

/**
 * Generate AI-powered briefing
 */
export async function generateAIBriefing(
  userEmail: string,
  options: {
    maxOpportunities?: number;
    maxTeamingPlays?: number;
    skipEnrichment?: boolean; // Skip Perplexity enrichment for faster batch processing
    skipDataFetch?: boolean; // Skip HTTP-based data fetches for faster batch processing
    naicsOverride?: string[]; // Override NAICS codes (for pre-computation by profile)
  } = {}
): Promise<AIGeneratedBriefing | null> {
  const startTime = Date.now();
  const timings: Record<string, number> = {};
  const supabase = getSupabaseClient();

  if (!supabase) {
    throw new Error('Supabase not configured - missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  const briefingDate = new Date().toISOString().split('T')[0];

  // Fallback NAICS codes for users without profile data
  const FALLBACK_NAICS = ['541512', '541611', '541330', '541990', '561210'];

  try {
    // Step 1: Get user profile from unified table
    let stepStart = Date.now();
    const { data: profileData } = await supabase
      .from('user_notification_settings')
      .select('aggregated_profile, naics_codes, agencies, keywords, primary_industry')
      .eq('user_email', userEmail)
      .single();
    timings.profileFetch = Date.now() - stepStart;

    // Use naicsOverride if provided (for pre-computation), else use profile data or fallback
    const effectiveProfile = options.naicsOverride
      ? {
          naics_codes: options.naicsOverride,
          agencies: [],
          keywords: [],
          aggregated_profile: null,
          primary_industry: null,
        }
      : profileData || {
          naics_codes: FALLBACK_NAICS,
          agencies: [],
          keywords: [],
          aggregated_profile: null,
          primary_industry: null,
        };

    const profile = buildProfile(effectiveProfile);
    const primaryIndustry = options.naicsOverride ? null : (profileData?.primary_industry as string) || null;

    // Prioritize NAICS codes by primary industry
    const prioritizedNaics = prioritizeNaicsByIndustry(profile.naics_codes, primaryIndustry);
    console.log(`[AIBriefingGen] Primary industry: ${primaryIndustry || 'none'}, prioritized NAICS: ${prioritizedNaics.slice(0, 5).join(', ')}...`);

    // Step 2: Get today's snapshots
    stepStart = Date.now();
    const today = new Date().toISOString().split('T')[0];
    const { data: snapshots } = await supabase
      .from('briefing_snapshots')
      .select('tool, raw_data')
      .eq('user_email', userEmail)
      .eq('snapshot_date', today);
    timings.snapshotsFetch = Date.now() - stepStart;

    let organizedData = organizeSnapshots(snapshots || []);

    console.log(`[AIBriefingGen] Snapshots: ${snapshots?.length || 0}, Recompetes: ${organizedData.recompetes.length}, Awards: ${organizedData.awards.length}`);

    // FALLBACK: If no snapshots, fetch from LOCAL FPDS data first (then USASpending as backup)
    // SKIP HTTP fetches in batch mode - they add ~30-40s per user on Vercel
    if (!options.skipDataFetch && organizedData.recompetes.length === 0 && organizedData.awards.length === 0) {
      stepStart = Date.now();
      console.log(`[AIBriefingGen] No snapshots found, fetching from LOCAL contracts-data.js (FPDS dump)...`);
      try {
        // Use prioritized NAICS codes (primary industry first)
        const naicsToUse = prioritizedNaics.length > 0 ? prioritizedNaics : ['541512', '541611', '541330'];
        // PRIMARY: Use local FPDS data dump (contracts-data.js) - has 529 Construction contracts
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
            multisiteOpps: organizedData.multisiteOpps,
          };
          console.log(`[AIBriefingGen] Found ${recompeteResult.contracts.length} recompete opportunities from LOCAL data`);
        } else {
          // BACKUP: Try USASpending API if no local matches
          console.log(`[AIBriefingGen] No local data matches, trying USASpending API...`);
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
              multisiteOpps: organizedData.multisiteOpps,
            };
            console.log(`[AIBriefingGen] Found ${usaResult.contracts.length} from USASpending API`);
          }
        }
      } catch (err) {
        console.warn(`[AIBriefingGen] Recompete data fetch failed:`, err);
      }
    }

    // FALLBACK: Always try to fetch multisite opportunities (NIH, DARPA, NSF)
    // SKIP in batch mode - adds latency
    if (!options.skipDataFetch && organizedData.multisiteOpps.length === 0) {
      console.log(`[AIBriefingGen] Fetching multisite opportunities (NIH, DARPA, NSF)...`);
      try {
        // Fetch directly from multisite pipeline without NAICS filtering
        // R&D opportunities use different NAICS (541714, 541715) than typical contractors
        const { fetchMultisiteOpportunities } = await import('../pipelines/multisite');
        const multisiteResult = await fetchMultisiteOpportunities({
          postedFrom: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
          limit: 25,
          // No NAICS filter - get all R&D opportunities
        });

        if (multisiteResult.opportunities.length > 0) {
          // Score them based on keywords if available
          const scoredOpps = multisiteResult.opportunities.map(opp => {
            let score = 10; // Base score for R&D opportunities
            const matchReasons: string[] = ['R&D opportunity'];

            // Check for keyword matches in title
            const oppTitle = (opp.title || '').toLowerCase();
            for (const keyword of profile.keywords) {
              if (oppTitle.includes(keyword.toLowerCase())) {
                score += 15;
                matchReasons.push(`Keyword: ${keyword}`);
              }
            }

            // Boost DARPA BAAs (high-value innovation)
            if (opp.source === 'darpa_baa') {
              score += 15;
              matchReasons.push('DARPA BAA');
            }

            return { ...opp, score, matchReasons };
          });

          organizedData.multisiteOpps = scoredOpps
            .sort((a, b) => b.score - a.score)
            .slice(0, 20);

          console.log(`[AIBriefingGen] Found ${organizedData.multisiteOpps.length} multisite opportunities`);
        }
      } catch (err) {
        console.warn(`[AIBriefingGen] Multisite fetch failed:`, err);
      }
    }

    // Step 3: Enrich top recompetes with Perplexity (real-time web intel)
    // SKIP for batch processing (cron runs) - adds ~75-90s per user
    let enrichedIntel: Map<string, ContractIntelligence> = new Map();
    if (!options.skipEnrichment && organizedData.recompetes.length > 0 && process.env.PERPLEXITY_API_KEY) {
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
    } else if (options.skipEnrichment) {
      console.log(`[AIBriefingGen] Skipping Perplexity enrichment (batch mode)`);
    }

    // Step 4: Build user prompt with raw data + enriched intel
    const userPrompt = buildUserPrompt(profile, organizedData, enrichedIntel);

    // Step 5: Call Claude for synthesis
    console.log(`[AIBriefingGen] Generating AI briefing for ${userEmail}...`);

    const { text: responseText, provider, model } = await generateBriefingJson(
      'daily',
      SYSTEM_PROMPT,
      userPrompt,
      4000
    );

    // Step 5: Parse and validate response (with robust JSON extraction)
    const aiResponse = extractAndParseJSON<{
      opportunities: AIBriefingOpportunity[];
      teamingPlays: AIBriefingTeamingPlay[];
    }>(responseText);

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
        multisiteOppsAnalyzed: organizedData.multisiteOpps.length,
      },
      processingTimeMs: Date.now() - startTime,
    };

    console.log(
      `[AIBriefingGen] Generated briefing via ${provider}/${model}: ${briefing.opportunities.length} opportunities, ${briefing.teamingPlays.length} plays in ${briefing.processingTimeMs}ms`
    );

    return briefing;
  } catch (error) {
    console.error('[AIBriefingGen] Error:', error);
    console.error('[AIBriefingGen] Error stack:', error instanceof Error ? error.stack : 'no stack');
    // Re-throw with a more descriptive message
    throw new Error(`AI Briefing generation failed: ${error instanceof Error ? error.message : String(error)}`);
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
    multisiteOpps: ScoredMultisiteOpportunity[];
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

MULTISITE OPPORTUNITIES (${data.multisiteOpps.length} from NIH, DARPA, NSF):
${data.multisiteOpps.length > 0 ? JSON.stringify(data.multisiteOpps.slice(0, 20).map(o => ({
  title: o.title,
  agency: o.agency,
  subAgency: o.subAgency,
  source: o.source,
  type: o.opportunityType,
  closeDate: o.closeDate,
  estimatedValue: o.estimatedValue,
  score: o.score,
  matchReasons: o.matchReasons,
  url: o.sourceUrl
})), null, 2) : 'No multisite opportunities found'}

NOTE: Multisite opportunities include:
- NIH grants and SBIR/STTR research opportunities
- DARPA BAAs (Broad Agency Announcements) - cutting-edge R&D
- NSF SBIR/STTR solicitations
These are HIGH-VALUE R&D opportunities that often have rolling deadlines and multiple award phases.
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
  multisiteOpps: ScoredMultisiteOpportunity[];
} {
  const organized = {
    recompetes: [] as RecompeteContract[],
    awards: [] as ContractAward[],
    contractors: [] as ContractorRecord[],
    webSignals: [] as WebSignal[],
    multisiteOpps: [] as ScoredMultisiteOpportunity[],
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
      case 'multisite':
        if (Array.isArray(data.opportunities)) {
          organized.multisiteOpps.push(...(data.opportunities as ScoredMultisiteOpportunity[]));
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
