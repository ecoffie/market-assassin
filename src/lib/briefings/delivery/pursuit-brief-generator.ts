/**
 * Pursuit Brief Generator
 *
 * Generates 1-page deep dive analysis for a single opportunity.
 * Used for capture decision support - should we pursue this?
 *
 * See ~/docs/briefing-format.md for full specification.
 */

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { RecompeteContract, fetchExpiringContractsFromLocal } from '../pipelines/fpds-recompete';
import { ContractAward } from '../pipelines/contract-awards';
import { prioritizeNaicsByIndustry } from '@/lib/industry-presets';

export interface PursuitOutreachTarget {
  priority: number;
  name: string;
  role: string;
  company?: string;
  approach: string;
}

export interface PursuitActionItem {
  day: number;
  action: string;
  owner: string;
}

export interface PursuitRisk {
  risk: string;
  likelihood: 'high' | 'medium' | 'low';
  impact: 'high' | 'medium' | 'low';
  mitigation: string;
}

export interface PursuitBrief {
  id: string;
  generatedAt: string;
  userId: string;

  // Opportunity identifiers
  contractName: string;
  contractNumber?: string;
  agency: string;
  value: string;
  opportunityScore: number;

  // Analysis sections
  whyWorthPursuing: string;
  workingHypothesis: string;
  priorityIntel: string[];
  outreachTargets: PursuitOutreachTarget[];
  actionPlan: PursuitActionItem[];
  risks: PursuitRisk[];
  immediateNextMove: {
    action: string;
    owner: string;
    deadline: string;
  };

  // Metadata
  processingTimeMs: number;
}

const SYSTEM_PROMPT = `You are a senior GovCon capture manager creating a 1-page pursuit brief for a specific opportunity. This brief enables a capture team to make a bid/no-bid decision and start positioning immediately.

OUTPUT FORMAT (JSON):
{
  "contractName": "descriptive name",
  "agency": "Department / Sub-agency",
  "value": "$500M+ (MAC vehicle)",
  "opportunityScore": 75,

  "whyWorthPursuing": "2-3 sentence strategic rationale for pursuing. Include NAICS fit, market position, and win factors.",

  "workingHypothesis": "Our theory of the case for winning. What's our differentiation? What's the winning strategy?",

  "priorityIntel": [
    "Confirm RFI response deadline and requirements",
    "Identify which incumbent team members are open to switching",
    "Validate labor rate competitiveness",
    "Assess incumbent re-compete strategy",
    "Map subcontracting opportunities if prime not viable"
  ],

  "outreachTargets": [
    {
      "priority": 1,
      "name": "[Likely role/title]",
      "role": "BD Director, Navy Programs",
      "company": "Peraton",
      "approach": "Teaming inquiry"
    }
  ],

  "actionPlan": [
    { "day": 1, "action": "Download RFI, analyze requirements", "owner": "Capture" },
    { "day": 2, "action": "Draft teaming outreach", "owner": "BD" },
    { "day": 3, "action": "Identify cleared staff availability", "owner": "HR" },
    { "day": 4, "action": "Research incumbent past performance", "owner": "Intel" },
    { "day": 5, "action": "Bid/No-Bid decision meeting", "owner": "Leadership" }
  ],

  "risks": [
    {
      "risk": "Can't secure teaming agreement",
      "likelihood": "medium",
      "impact": "high",
      "mitigation": "Parallel outreach to 3 primes"
    }
  ],

  "immediateNextMove": {
    "action": "Send teaming inquiry to [Prime] BD",
    "owner": "Eric",
    "deadline": "EOD Wednesday"
  }
}

SCORING CRITERIA (opportunityScore 0-100):
- 90-100: Must pursue - perfect fit, high win probability
- 75-89: Strong pursuit - good fit, competitive position
- 60-74: Conditional pursuit - pursue with caveats
- 45-59: Selective pursuit - only if strategic
- Below 45: No-bid likely - poor fit or low win probability

BE SPECIFIC:
- Use real role titles (BD Director, not "someone at the company")
- Give concrete 5-day action plan
- Include 4-5 priority intel items
- List 3-4 outreach targets
- Identify 3-4 risks with mitigations

VOICE: Direct, actionable, capture-manager perspective. Every section should enable immediate action.`;

/**
 * Generate pursuit brief for a specific opportunity
 */
export async function generatePursuitBrief(
  userEmail: string,
  opportunity: {
    contractNumber?: string;
    contractName?: string;
    agency?: string;
    incumbent?: string;
    value?: number;
    naicsCode?: string;
    description?: string;
    deadline?: string;
    // Can pass raw recompete or award data
    rawData?: RecompeteContract | ContractAward | Record<string, unknown>;
  }
): Promise<PursuitBrief | null> {
  const startTime = Date.now();
  const supabase = getSupabaseClient();

  if (!supabase) {
    throw new Error('Supabase not configured - missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  const anthropic = getAnthropicClient();
  if (!anthropic) {
    throw new Error('Anthropic not configured - missing ANTHROPIC_API_KEY');
  }

  // Fallback NAICS codes
  const FALLBACK_NAICS = ['541512', '541611', '541330', '541990', '561210'];

  try {
    // Get user profile from unified table
    const { data: profileData } = await supabase
      .from('user_notification_settings')
      .select('aggregated_profile, naics_codes, agencies, keywords, primary_industry')
      .eq('user_email', userEmail)
      .single();

    const profile = profileData ? buildProfile(profileData) : {
      naics_codes: FALLBACK_NAICS,
      agencies: [],
      keywords: [],
      watched_companies: [],
    };

    const primaryIndustry = (profileData?.primary_industry as string) || null;

    // Prioritize NAICS codes by primary industry
    const prioritizedNaics = prioritizeNaicsByIndustry(profile.naics_codes, primaryIndustry);
    console.log(`[PursuitBrief] Primary industry: ${primaryIndustry || 'none'}, prioritized NAICS: ${prioritizedNaics.slice(0, 5).join(', ')}...`);

    // Update profile with prioritized codes for the AI prompt
    profile.naics_codes = prioritizedNaics;

    // Build user prompt with opportunity details
    const userPrompt = buildUserPrompt(profile, opportunity);

    console.log(`[PursuitBrief] Generating for ${opportunity.contractName || opportunity.contractNumber}...`);

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
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
      console.error('[PursuitBrief] Empty response from Claude');
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

    const brief: PursuitBrief = {
      id: `pursuit-${userEmail}-${Date.now()}`,
      generatedAt: new Date().toISOString(),
      userId: userEmail,

      contractName: aiResponse.contractName || opportunity.contractName || 'Unknown',
      contractNumber: opportunity.contractNumber,
      agency: aiResponse.agency || opportunity.agency || 'Unknown',
      value: aiResponse.value || formatValue(opportunity.value),
      opportunityScore: aiResponse.opportunityScore || 50,

      whyWorthPursuing: aiResponse.whyWorthPursuing || '',
      workingHypothesis: aiResponse.workingHypothesis || '',
      priorityIntel: aiResponse.priorityIntel || [],
      outreachTargets: aiResponse.outreachTargets || [],
      actionPlan: aiResponse.actionPlan || [],
      risks: aiResponse.risks || [],
      immediateNextMove: aiResponse.immediateNextMove || {
        action: 'Review opportunity details',
        owner: 'Capture Lead',
        deadline: 'Tomorrow',
      },

      processingTimeMs: Date.now() - startTime,
    };

    console.log(
      `[PursuitBrief] Generated: Score ${brief.opportunityScore}/100 in ${brief.processingTimeMs}ms`
    );

    return brief;
  } catch (error) {
    console.error('[PursuitBrief] Error:', error);
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
  opportunity: Record<string, unknown>
): string {
  return `Generate a 1-page pursuit brief for this opportunity:

USER PROFILE (the company considering this pursuit):
- NAICS Codes: ${profile.naics_codes.join(', ') || 'Not specified'}
- Target Agencies: ${profile.agencies.join(', ') || 'Any federal agency'}
- Keywords/Capabilities: ${profile.keywords.join(', ') || 'Not specified'}
- Watched Competitors: ${profile.watched_companies.join(', ') || 'None'}

OPPORTUNITY DETAILS:
${JSON.stringify(opportunity, null, 2)}

Generate a complete pursuit brief with:
1. Why Worth Pursuing (strategic rationale)
2. Working Hypothesis (theory of the case for winning)
3. Priority Intel Needed (5 items to learn before bid/no-bid)
4. First Outreach Targets (4 people/roles to contact)
5. 5-Day Action Plan
6. Risks & Mitigations (3-4 risks)
7. Immediate Next Move (single most important action)

Score the opportunity 0-100 based on fit and win probability.

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

function formatValue(value?: number): string {
  if (!value) return 'TBD';
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value}`;
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
