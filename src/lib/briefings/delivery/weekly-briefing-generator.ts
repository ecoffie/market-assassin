/**
 * Weekly Deep Dive Briefing Generator
 *
 * Generates comprehensive weekly market intelligence briefings.
 * Format: Full analysis per opportunity + detailed teaming plays + market signals
 *
 * See ~/docs/briefing-format.md for full specification.
 */

import { createClient } from '@supabase/supabase-js';
import { RecompeteContract, fetchExpiringContractsFromDb, fetchExpiringContracts } from '../pipelines/fpds-recompete';
import { ContractAward } from '../pipelines/contract-awards';
import { ContractorRecord } from '../pipelines/contractor-db';
import { WebSignal } from '../web-intel/types';
import { prioritizeNaicsByIndustry } from '@/lib/industry-presets';
import { SAMNoticeSummary } from '../pipelines/sam-gov';
import { extractAndParseJSON, generateBriefingJson } from './llm-router';
import { extractAnglesFromBriefing, persistAngles, getRecentAngles, formatAnglesForPrompt } from '../angle-history';
import { pickBriefingLenses, formatLensesForPrompt, seedFromString } from '../lenses';
import { calendarEntriesFromSources, verifiedSourcesFromContracts, verifiedSourcesFromWeeklyData } from '../calendar-sanitize';
import {
  opportunitiesFromSources,
  opportunitySourceFromContract,
  overlayOpportunityAnalysis,
  sanitizeWeeklyOpportunities,
} from '../opportunity-sanitize';
import type { WeeklyContract } from '../weekly-contracts';

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
  sourceId: string;
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

export interface PrecomputedWeeklyBriefing {
  weekOf: string;
  opportunities: Array<{
    rank: number;
    sourceId: string;
    title: string;
    contractName: string;
    status: string;
    marketMatchReason: string;
    agency: string;
    incumbent: string;
    value: number;
    window: string;
    naicsCode?: string;
    displacementAngle: string;
    keyDates: { label: string; date: string }[];
    competitiveLandscape: string[];
    recommendedApproach: string;
  }>;
  teamingPlays: WeeklyTeamingPlay[];
  marketSignals: WeeklyMarketSignal[];
  calendar: Array<{ sourceId: string; date: string; event: string; type: string; priority: string }>;
  processingTimeMs: number;
  llmProvider?: string;
  llmModel?: string;
}

function getWeekOfDate(): string {
  const now = new Date();
  const dayOfWeek = now.getUTCDay();
  let daysToAdd: number;
  if (dayOfWeek === 6) {
    daysToAdd = 2;
  } else if (dayOfWeek === 0) {
    daysToAdd = 1;
  } else {
    daysToAdd = 1 - dayOfWeek;
  }

  const monday = new Date(now);
  monday.setUTCDate(monday.getUTCDate() + daysToAdd);
  return monday.toISOString().split('T')[0];
}

function buildWeeklyNoticeSignals(summary?: SAMNoticeSummary): WeeklyMarketSignal[] {
  if (!summary || summary.totalMatched === 0) {
    return [];
  }

  const signals: WeeklyMarketSignal[] = [
    {
      headline: `${summary.totalMatched} matched active SAM notices in this market`,
      source: 'SAM.gov',
      implication: 'The weekly deep dive is grounded in an active federal market, not just expiring-contract data.',
      actionRequired: false,
    },
  ];

  if (summary.sourcesSought > 0) {
    signals.push({
      headline: `${summary.sourcesSought} Sources Sought / RFI notices are open`,
      source: 'SAM.gov',
      implication: 'Market research windows are open now. Shape requirements early and request capability conversations before solicitation.',
      actionRequired: true,
    });
  }

  if (summary.preSol > 0) {
    signals.push({
      headline: `${summary.preSol} presolicitation notices signal upcoming bids`,
      source: 'SAM.gov',
      implication: 'This is the positioning phase for teaming, agency outreach, and forecast monitoring before the RFP lands.',
      actionRequired: true,
    });
  }

  if (summary.rfp + summary.rfq + summary.combined > 0) {
    signals.push({
      headline: `${summary.rfp + summary.rfq + summary.combined} active solicitation-stage notices are already live`,
      source: 'SAM.gov',
      implication: 'Balance long-range positioning with nearer-term bids already in motion.',
      actionRequired: summary.rfp + summary.rfq + summary.combined >= 5,
    });
  }

  return signals.slice(0, 4);
}

const SYSTEM_PROMPT = `You are a senior GovCon capture strategist writing a weekly market intelligence deep dive for federal contractors. This is the comprehensive weekly briefing that enables strategic planning.

MARKET RESEARCH CONTEXT (GAO-15-8):
The weekly deep dive focuses on FUTURE opportunities - contracts in the presolicitation phase where early positioning matters most.

Federal market research phases:
1. PRESOLICITATION (6-18 months out): Government conducts Sources Sought, RFIs before developing requirements
2. PREAWARD: Industry days, capability briefings before soliciting offers
3. POSTAWARD: Task order competitions on existing vehicles

KEY INSIGHT: Companies that engage during presolicitation (respond to Sources Sought, attend industry days, request capability briefings) have 75% higher win rates. The weekly brief identifies contracts ENTERING market research phase.

For each opportunity, recommend specific market research actions:
- "Respond to Sources Sought by [date]"
- "Monitor for industry day announcement"
- "Request capability briefing with [agency] PM"
- "Check acquisitiongateway.gov for forecast"

OUTPUT FORMAT (JSON):
{
  "opportunities": [
    {
      "rank": 1,
      "contractName": "descriptive name",
      "agency": "Department / Sub-agency",
      "incumbent": "current holder(s)",
      "value": "contract value with context",
      "window": "timeline details + market research phase",
      "displacementAngle": "strategic insight - why winnable",
      "keyDates": [
        { "label": "Sources Sought Response", "date": "March 30, 2026" },
        { "label": "Expected Industry Day", "date": "April 15, 2026" },
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
        "recommendedApproach": "Respond to Sources Sought + teaming with established prime"
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
    },
    {
      "date": "April 15, 2026",
      "event": "DLA Industry Day - IT Modernization",
      "type": "industry_day",
      "priority": "high"
    }
  ]
}

ANALYSIS DEPTH:
- Provide 3-5 competitive landscape points per opportunity
- Include specific dates when available, especially market research milestones
- Assess user's position based on their NAICS and agency experience
- Give concrete market research + teaming recommendations
- Flag contracts entering presolicitation phase (prime positioning window)

RANKING BY:
1. Active Sources Sought/RFI (market research window OPEN - highest priority)
2. Industry day scheduled (relationship building opportunity)
3. Active solicitation (immediate action needed)
4. Incumbent vulnerability (terminations, M&A friction, extensions)
5. Contract entering market research phase (6-18 months to RFP)
6. Value ($100M+)
7. Timeline clarity
8. Match to user profile

VOICE: Strategic advisor, data-driven, specific and actionable. Emphasize early positioning through market research engagement.`;

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

  // Get Monday of current week
  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - today.getDay() + 1);
  const weekOf = monday.toISOString().split('T')[0];

  // Fallback NAICS codes for users without profile data
  const FALLBACK_NAICS = ['541512', '541611', '541330', '541990', '561210'];

  try {
    // Get user profile from unified table. maybeSingle + surface { error }: a
    // column drift here nulls the whole query → silent FALLBACK_NAICS generic
    // weekly for every user (swallowed-error class).
    const { data: profileData, error: profileErr } = await supabase
      .from('user_notification_settings')
      .select('aggregated_profile, naics_codes, agencies, keywords, primary_industry')
      .eq('user_email', userEmail)
      .maybeSingle();
    if (profileErr) console.error(`[WeeklyBriefingGen] profile query error for ${userEmail}:`, profileErr.message);

    // Use fallback if no profile
    const effectiveProfile = profileData || {
      naics_codes: FALLBACK_NAICS,
      agencies: [],
      keywords: [],
      business_description: null,
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
    const { data: snapshots, error: snapErr } = await supabase
      .from('briefing_snapshots')
      .select('tool, raw_data, snapshot_date')
      .eq('user_email', userEmail)
      .gte('snapshot_date', weekAgo);
    if (snapErr) console.error(`[WeeklyBriefingGen] snapshot query error for ${userEmail}:`, snapErr.message);

    let organizedData = organizeSnapshots(snapshots || []);

    console.log(`[WeeklyBriefing] Snapshots: ${snapshots?.length || 0}, Recompetes: ${organizedData.recompetes.length}`);

    // FALLBACK: If no snapshots, fetch from LOCAL FPDS data first (then USASpending as backup)
    if (organizedData.recompetes.length === 0 && organizedData.awards.length === 0) {
      console.log(`[WeeklyBriefing] No snapshots found, fetching from LIVE recompete_opportunities...`);
      try {
        // Use prioritized NAICS codes (primary industry first)
        const naicsToUse = prioritizedNaics.length > 0 ? prioritizedNaics : ['541512', '541611', '541330'];
        // PRIMARY: live recompete_opportunities (hourly USASpending sync, carries incumbent UEI)
        const recompeteResult = await fetchExpiringContractsFromDb({
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
          console.log(`[WeeklyBriefing] Found ${recompeteResult.contracts.length} recompete opportunities from recompete_opportunities`);
        } else {
          // BACKUP: Try USASpending API if no local matches
          console.log(`[WeeklyBriefing] No rows in recompete_opportunities, trying USASpending API...`);
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

    const { text: responseText, provider, model } = await generateBriefingJson(
      'weekly',
      SYSTEM_PROMPT,
      userPrompt,
      6000
    );
    const aiResponse = extractAndParseJSON<{
      opportunities?: WeeklyOpportunityAnalysis[];
      teamingPlays?: WeeklyTeamingPlay[];
      marketSignals?: WeeklyMarketSignal[];
      calendar?: WeeklyCalendarItem[];
    }>(responseText);

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
      calendar: calendarEntriesFromSources(verifiedSourcesFromWeeklyData(organizedData)),
      rawDataSummary: {
        recompetesAnalyzed: organizedData.recompetes?.length || 0,
        awardsAnalyzed: organizedData.awards?.length || 0,
        contractorsAnalyzed: organizedData.contractors?.length || 0,
        webSignalsAnalyzed: organizedData.webSignals?.length || 0,
      },
      processingTimeMs: Date.now() - startTime,
    };

    console.log(
      `[WeeklyBriefing] Generated via ${provider}/${model}: ${briefing.opportunities.length} opps, ${briefing.teamingPlays.length} plays in ${briefing.processingTimeMs}ms`
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
3. MARKET HIGHLIGHTS - key news affecting the pipeline
4. CALENDAR - important dates in next 30 days

Focus on strategic planning value. Be specific with dates, names, and recommendations.

Return JSON only.`;
}

export async function generateWeeklyDeepDiveFromContracts(
  contracts: WeeklyContract[],
  noticeSummary?: SAMNoticeSummary,
  options: {
    /** Profile hash for anti-repetition memory (Content Reaper pattern #3) */
    naicsProfileHash?: string;
    /** Saved 6-digit NAICS for this template. Required for market-match. */
    savedNaics?: string[];
  } = {}
): Promise<PrecomputedWeeklyBriefing> {
  const weekOfDate = getWeekOfDate();
  const savedNaics = options.savedNaics || [];
  const sources = contracts
    .map((contract) => opportunitySourceFromContract(contract, savedNaics))
    .filter((row): row is NonNullable<typeof row> => row !== null);
  const grounded = opportunitiesFromSources(sources, 10);
  const catalogContracts = contracts.filter((contract) =>
    sources.some((source) => source.sourceId === String(contract.contractNumber || '').trim()),
  );

  let recentAngles: string[] = [];
  if (options.naicsProfileHash) {
    try {
      recentAngles = await getRecentAngles({
        naicsProfileHash: options.naicsProfileHash,
        briefingType: 'weekly',
        limit: 6,
      });
    } catch (err) {
      console.warn('[WeeklyBriefingGen] recent-angles lookup failed (non-fatal):', err);
    }
  }
  const recentAnglesBlock = formatAnglesForPrompt(recentAngles);

  const lensSeed = options.naicsProfileHash
    ? seedFromString(`${options.naicsProfileHash}:${weekOfDate}`)
    : undefined;
  const lenses = pickBriefingLenses(2, lensSeed);
  const lensBlock = formatLensesForPrompt(lenses);

  const identityPayload = grounded.map((row) => ({
    sourceId: row.sourceId,
    title: row.title,
    agency: row.agency,
    incumbent: row.incumbent,
    value: row.value,
    status: row.status,
    marketMatchReason: row.marketMatchReason,
    naicsCode: row.naicsCode,
  }));

  let provider = 'none';
  let model = 'source-records';
  let teamingPlays: WeeklyTeamingPlay[] = [];
  let llmSignals: WeeklyMarketSignal[] = [];
  let analyzed = grounded;

  if (grounded.length > 0) {
    const prompt = `You are a senior GovCon capture strategist. Analyze ONLY the opportunities below. Do not invent contracts, titles, dates, or a calendar.

${lensBlock ? lensBlock + '\n' : ''}${recentAnglesBlock ? recentAnglesBlock + '\n\n' : ''}GROUNDED OPPORTUNITIES (REAL USASPENDING RECORDS):
${JSON.stringify(identityPayload, null, 2)}

Return JSON with:
1. "opportunities" - analysis keyed by sourceId. Each: sourceId, displacementAngle, competitiveLandscape (3-4 insights), recommendedApproach. Do not change titles.
2. "teamingPlays" - up to 3 plays. Each: playNumber, strategyName, targetCompany, whyTarget (array), whoToContact (array), suggestedOpener, followUpMessage
3. "marketSignals" - up to 4 news items. Each: headline, source, implication, actionRequired (boolean)

Do not return a calendar. Empty teamingPlays/marketSignals is acceptable when the records do not support them.

Return ONLY valid JSON.`;

    try {
      const generated = await generateBriefingJson(
        'weekly',
        'You are a senior GovCon capture strategist.',
        prompt,
        6000,
      );
      provider = generated.provider;
      model = generated.model;
      const data = extractAndParseJSON<{
        opportunities?: Array<{
          sourceId?: string;
          displacementAngle?: string;
          competitiveLandscape?: string[];
          recommendedApproach?: string;
        }>;
        teamingPlays?: WeeklyTeamingPlay[];
        marketSignals?: WeeklyMarketSignal[];
      }>(generated.text);
      analyzed = overlayOpportunityAnalysis(
        grounded,
        Array.isArray(data.opportunities) ? data.opportunities : [],
      );
      teamingPlays = data.teamingPlays || [];
      llmSignals = data.marketSignals || [];
    } catch (err) {
      console.warn('[WeeklyBriefingGen] LLM analysis failed; keeping source-grounded opportunities:', err);
    }
  }

  const opportunities = sanitizeWeeklyOpportunities(analyzed, sources).kept.map((row, index) => ({
    rank: index + 1,
    sourceId: String(row.sourceId),
    title: String(row.title),
    contractName: String(row.contractName || row.title),
    status: String(row.status),
    marketMatchReason: String(row.marketMatchReason),
    agency: String(row.agency || ''),
    incumbent: String(row.incumbent || ''),
    value: Number(row.value) || 0,
    window: String(row.window || row.status),
    naicsCode: row.naicsCode || undefined,
    displacementAngle: String(row.displacementAngle || ''),
    keyDates: row.keyDates || [],
    competitiveLandscape: row.competitiveLandscape || [],
    recommendedApproach: String(row.recommendedApproach || ''),
  }));

  const briefing: PrecomputedWeeklyBriefing = {
    weekOf: weekOfDate,
    opportunities,
    teamingPlays,
    marketSignals: [
      ...buildWeeklyNoticeSignals(noticeSummary),
      ...llmSignals,
    ].slice(0, 6),
    calendar: calendarEntriesFromSources(verifiedSourcesFromContracts(catalogContracts)),
    processingTimeMs: 0,
    llmProvider: provider,
    llmModel: model,
  };

  if (options.naicsProfileHash) {
    const angles = briefing.opportunities
      .slice(0, 5)
      .map((o) => o.sourceId || o.title || '')
      .filter(Boolean);
    if (angles.length > 0) {
      persistAngles({
        naicsProfileHash: options.naicsProfileHash,
        briefingType: 'weekly',
        briefingDate: weekOfDate,
        angles,
      }).catch(() => { /* logged inside */ });
    }
    void extractAnglesFromBriefing;
  }

  return briefing;
}

function buildProfile(profileData: Record<string, unknown>) {
  const aggregated = profileData.aggregated_profile as Record<string, unknown> | null;
  return {
    naics_codes: extractArray(aggregated?.naics_codes || profileData.naics_codes),
    agencies: extractArray(aggregated?.agencies || profileData.agencies),
    keywords: extractArray(aggregated?.keywords || profileData.keywords),
    business_description: typeof profileData.business_description === 'string' ? profileData.business_description : null,
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
