/**
 * Perplexity Enrichment Pipeline
 *
 * Enriches raw contract data with real-time web intelligence
 * using Perplexity's sonar model (online search-enabled).
 *
 * Used by briefing generators to add displacement angles,
 * incumbent intelligence, and timing signals.
 */

import { RecompeteContract } from '../pipelines/fpds-recompete';
import { ContractAward } from '../pipelines/contract-awards';
import { searchRelatedOpportunities, type RelatedOpportunityResult } from '../pipelines/sam-gov';

const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;
const PERPLEXITY_API_URL = 'https://api.perplexity.ai/chat/completions';

export interface EnrichedContract extends RecompeteContract {
  intelContext?: string;
  displacementAngle?: string;
  incumbentIssues?: string[];
  timelineSignals?: string[];
  teamingOpportunities?: string[];
  sources?: string[];
}

export interface ContractIntelligence {
  contractId: string;
  incumbent: string;
  agency: string;

  // Enriched intel
  isBridgeContract: boolean;
  bridgeDetails?: string;
  extensionCount?: number;

  hasRfiActivity: boolean;
  rfiDetails?: string;

  hasIncumbentIssues: boolean;
  incumbentIssues?: string[];

  hasMaActivity: boolean;
  maDetails?: string;

  expectedTimeline?: string;
  displacementAngle: string;

  sources: string[];
  fetchedAt: string;

  // SAM.gov VERIFIED data (not from Perplexity)
  samVerified?: {
    hasRelatedOpportunities: boolean;
    sourcesSoughtCount: number;
    presolicitationCount: number;
    rfiCount: number;
    relatedOpportunities?: Array<{
      noticeId: string;
      title: string;
      noticeType: string;
      postedDate: string;
      responseDeadline?: string;
      uiLink: string;
    }>;
    searchedAt: string;
    lookbackDays: number;
  };
}

/**
 * System prompt for contract intelligence extraction
 */
const CONTRACT_INTEL_SYSTEM_PROMPT = `You are a federal contracting intelligence analyst researching recompete opportunities.

Your task is to find VERIFIABLE, FACTUAL intelligence about the contract and incumbent. Focus on:

1. **Bridge/Extension Status**: Is this contract on a bridge? How many extensions?
2. **RFI/Pre-Sol Activity**: Any recent RFI, sources sought, or pre-solicitation notices on SAM.gov?
3. **Incumbent Issues**: ONLY report issues with verifiable sources - protests filed with GAO, ASBCA cases with case numbers, news articles with URLs. DO NOT speculate.
4. **M&A Impact**: Only publicly announced mergers/acquisitions with dates and sources.
5. **Timeline Signals**: Expected recompete timeline? Industry days announced?

CRITICAL RULES:
- DO NOT fabricate ASBCA cases, GAO protests, CPARS issues, or OSHA violations
- If you cannot find a verifiable source (URL, case number, or news article), set the field to false/null/empty
- Quality over quantity - better to return empty fields than unverified claims
- For incumbent issues, you MUST provide a source URL or case number
- Do not guess or speculate about performance problems

Respond in this exact JSON format:
{
  "isBridgeContract": true/false,
  "bridgeDetails": "string or null (include source URL if available)",
  "extensionCount": number or null,
  "hasRfiActivity": true/false,
  "rfiDetails": "string or null (include SAM.gov notice ID if found)",
  "hasIncumbentIssues": true/false,
  "incumbentIssues": ["VERIFIED issue with source: URL or case number"] or [],
  "hasMaActivity": true/false,
  "maDetails": "string or null (include news source URL)",
  "expectedTimeline": "string or null",
  "displacementAngle": "One sentence based ONLY on verified facts. If no facts found, say 'Standard recompete opportunity - no verified displacement signals'",
  "sources": ["source1 URL", "source2 URL"] (REQUIRED for any claimed issues)
}

Be specific with dates. If you can't find VERIFIED information on a topic, set the field to false/null/empty.
DO NOT provide speculative displacement angles. Only factual ones.`;

/**
 * Enrich a single contract with Perplexity intelligence + SAM.gov verification
 *
 * IMPORTANT: SAM.gov data is VERIFIED and should be trusted.
 * Perplexity data is web-scraped and should be treated with caution.
 */
export async function enrichContractWithIntel(
  contract: RecompeteContract
): Promise<ContractIntelligence | null> {
  const SAM_API_KEY = process.env.SAM_API_KEY;

  // Step 1: Search SAM.gov for VERIFIED RFI/Sources Sought activity
  let samVerified: ContractIntelligence['samVerified'] = undefined;

  if (SAM_API_KEY && contract.naicsCode) {
    try {
      console.log(`[Enrichment] Searching SAM.gov for related opps: NAICS ${contract.naicsCode}, Agency: ${contract.agency}`);

      const samResult = await searchRelatedOpportunities({
        naicsCode: contract.naicsCode,
        agency: contract.agency || contract.department || '',
        incumbentName: contract.incumbentName,
        lookbackDays: 180, // 6 months
      }, SAM_API_KEY);

      if (samResult.found) {
        samVerified = {
          hasRelatedOpportunities: true,
          sourcesSoughtCount: samResult.summary.sourcesSought,
          presolicitationCount: samResult.summary.presolicitation,
          rfiCount: samResult.summary.rfis,
          relatedOpportunities: samResult.opportunities.slice(0, 5).map(opp => ({
            noticeId: opp.noticeId,
            title: opp.title,
            noticeType: opp.noticeType,
            postedDate: opp.postedDate,
            responseDeadline: opp.responseDeadline,
            uiLink: opp.uiLink,
          })),
          searchedAt: samResult.searchedAt,
          lookbackDays: samResult.lookbackDays,
        };
        console.log(`[Enrichment] SAM.gov found ${samResult.summary.totalFound} related opportunities`);
      } else {
        samVerified = {
          hasRelatedOpportunities: false,
          sourcesSoughtCount: 0,
          presolicitationCount: 0,
          rfiCount: 0,
          searchedAt: samResult.searchedAt,
          lookbackDays: samResult.lookbackDays,
        };
        console.log(`[Enrichment] SAM.gov: No related opportunities found in last 180 days`);
      }
    } catch (err) {
      console.warn(`[Enrichment] SAM.gov search failed:`, err);
    }
  }

  // Step 2: If no Perplexity API key, return just SAM.gov data
  if (!PERPLEXITY_API_KEY) {
    console.warn('[Perplexity] API key not configured, returning SAM.gov data only');

    // Build displacement angle from SAM.gov data
    let displacementAngle = 'Standard recompete opportunity - no verified displacement signals';
    if (samVerified?.hasRelatedOpportunities) {
      const parts = [];
      if (samVerified.sourcesSoughtCount > 0) parts.push(`${samVerified.sourcesSoughtCount} sources sought`);
      if (samVerified.presolicitationCount > 0) parts.push(`${samVerified.presolicitationCount} presolicitation`);
      if (samVerified.rfiCount > 0) parts.push(`${samVerified.rfiCount} RFI`);
      displacementAngle = `Active acquisition signals on SAM.gov: ${parts.join(', ')}`;
    }

    return {
      contractId: contract.contractNumber || contract.piid,
      incumbent: contract.incumbentName,
      agency: contract.agency,
      isBridgeContract: false,
      hasRfiActivity: samVerified?.hasRelatedOpportunities || false,
      rfiDetails: samVerified?.relatedOpportunities?.[0]?.title || undefined,
      hasIncumbentIssues: false,
      incumbentIssues: [],
      hasMaActivity: false,
      displacementAngle,
      sources: samVerified?.relatedOpportunities?.map(o => o.uiLink) || [],
      samVerified,
      fetchedAt: new Date().toISOString(),
    };
  }

  // Step 3: Call Perplexity for additional web intelligence
  const query = buildContractQuery(contract, samVerified);

  try {
    const response = await fetch(PERPLEXITY_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [
          { role: 'system', content: CONTRACT_INTEL_SYSTEM_PROMPT },
          { role: 'user', content: query },
        ],
        temperature: 0.3,
        max_tokens: 1500,
      }),
    });

    if (!response.ok) {
      console.error(`[Perplexity] API error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      console.error('[Perplexity] Empty response');
      return null;
    }

    // Parse JSON from response
    const intel = parseIntelResponse(content, contract);

    // OVERRIDE Perplexity RFI data with SAM.gov verified data
    if (samVerified) {
      intel.hasRfiActivity = samVerified.hasRelatedOpportunities;
      if (samVerified.hasRelatedOpportunities && samVerified.relatedOpportunities?.length) {
        intel.rfiDetails = `VERIFIED on SAM.gov: ${samVerified.relatedOpportunities[0].title} (${samVerified.relatedOpportunities[0].noticeType})`;
        intel.sources = [...(intel.sources || []), ...samVerified.relatedOpportunities.map(o => o.uiLink)];
      } else {
        intel.rfiDetails = `SAM.gov searched (${samVerified.lookbackDays} days): No RFI/Sources Sought found`;
      }
    }

    return {
      contractId: contract.contractNumber || contract.piid,
      incumbent: contract.incumbentName,
      agency: contract.agency,
      ...intel,
      samVerified,
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error('[Perplexity] Error enriching contract:', error);
    return null;
  }
}

/**
 * Batch enrich multiple contracts (with rate limiting)
 */
export async function enrichContractsWithIntel(
  contracts: RecompeteContract[],
  options: {
    maxContracts?: number;
    delayMs?: number;
  } = {}
): Promise<Map<string, ContractIntelligence>> {
  const { maxContracts = 10, delayMs = 1000 } = options;
  const results = new Map<string, ContractIntelligence>();

  // Sort by urgency (soonest expiration first) and take top N
  const prioritized = [...contracts]
    .sort((a, b) => a.daysUntilExpiration - b.daysUntilExpiration)
    .slice(0, maxContracts);

  console.log(`[Perplexity] Enriching ${prioritized.length} contracts...`);

  for (const contract of prioritized) {
    const intel = await enrichContractWithIntel(contract);

    if (intel) {
      const key = contract.contractNumber || contract.piid || `${contract.incumbentName}-${contract.naicsCode}`;
      results.set(key, intel);
      console.log(`[Perplexity] Enriched: ${contract.incumbentName} - ${intel.displacementAngle?.slice(0, 50)}...`);
    }

    // Rate limiting
    if (delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  console.log(`[Perplexity] Enrichment complete: ${results.size}/${prioritized.length} succeeded`);

  return results;
}

/**
 * Build the query for a contract
 */
function buildContractQuery(
  contract: RecompeteContract,
  samVerified?: ContractIntelligence['samVerified']
): string {
  // Build SAM.gov verified section if available
  let samSection = '';
  if (samVerified) {
    if (samVerified.hasRelatedOpportunities) {
      samSection = `
**VERIFIED SAM.gov Activity (DO NOT OVERRIDE - this data is authoritative):**
- Sources Sought: ${samVerified.sourcesSoughtCount}
- Presolicitation: ${samVerified.presolicitationCount}
- RFI Notices: ${samVerified.rfiCount}
${samVerified.relatedOpportunities?.slice(0, 3).map(o =>
  `- "${o.title}" (${o.noticeType}, posted ${o.postedDate})`
).join('\n') || ''}

NOTE: RFI/pre-solicitation data is ALREADY VERIFIED from SAM.gov. Focus your research on:
- Bridge/extension status
- Incumbent issues (ONLY with verifiable sources)
- M&A activity
- Timeline signals`;
    } else {
      samSection = `
**SAM.gov Search Result (VERIFIED):**
- No RFI, Sources Sought, or Presolicitation found in last ${samVerified.lookbackDays} days
- Set hasRfiActivity to FALSE in your response

Focus your research on:
- Bridge/extension status
- Incumbent issues (ONLY with verifiable sources)
- M&A activity
- Timeline signals`;
    }
  }

  return `
Federal contract intelligence request:

**Agency:** ${contract.agency} / ${contract.department}
**Incumbent:** ${contract.incumbentName}
**NAICS:** ${contract.naicsCode} - ${contract.naicsDescription}
**Contract Value:** $${contract.obligatedAmount.toLocaleString()}
**Expiration:** ${contract.daysUntilExpiration} days (${contract.currentCompletionDate || 'date unknown'})
${contract.contractNumber ? `**Contract Number:** ${contract.contractNumber}` : ''}
${contract.contractingOfficeName ? `**Contracting Office:** ${contract.contractingOfficeName}` : ''}
${samSection}

Please research and provide intelligence on:
1. Is this contract on a bridge or extension?
2. ${samVerified ? 'SKIP - RFI data already verified above' : 'Any RFI or pre-solicitation activity?'}
3. Incumbent performance issues or vulnerabilities? (ONLY report with verifiable sources)
4. M&A activity affecting ${contract.incumbentName}?
5. Expected recompete timeline?

Respond with JSON as specified.
`;
}

/**
 * Parse the intelligence response from Perplexity
 */
function parseIntelResponse(
  content: string,
  contract: RecompeteContract
): Omit<ContractIntelligence, 'contractId' | 'incumbent' | 'agency' | 'fetchedAt'> {
  try {
    // Try to extract JSON from the response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        isBridgeContract: parsed.isBridgeContract || false,
        bridgeDetails: parsed.bridgeDetails || undefined,
        extensionCount: parsed.extensionCount || undefined,
        hasRfiActivity: parsed.hasRfiActivity || false,
        rfiDetails: parsed.rfiDetails || undefined,
        hasIncumbentIssues: parsed.hasIncumbentIssues || false,
        incumbentIssues: parsed.incumbentIssues || [],
        hasMaActivity: parsed.hasMaActivity || false,
        maDetails: parsed.maDetails || undefined,
        expectedTimeline: parsed.expectedTimeline || undefined,
        displacementAngle: parsed.displacementAngle || generateFallbackAngle(contract),
        sources: parsed.sources || [],
      };
    }
  } catch (e) {
    console.warn('[Perplexity] Failed to parse JSON, using fallback');
  }

  // Fallback: try to extract key insights from plain text
  return {
    isBridgeContract: content.toLowerCase().includes('bridge') || content.toLowerCase().includes('extension'),
    bridgeDetails: undefined,
    hasRfiActivity: content.toLowerCase().includes('rfi') || content.toLowerCase().includes('sources sought'),
    rfiDetails: undefined,
    hasIncumbentIssues: content.toLowerCase().includes('issue') || content.toLowerCase().includes('problem'),
    incumbentIssues: [],
    hasMaActivity: content.toLowerCase().includes('acquisition') || content.toLowerCase().includes('merger'),
    maDetails: undefined,
    expectedTimeline: undefined,
    displacementAngle: extractDisplacementAngle(content) || generateFallbackAngle(contract),
    sources: [],
  };
}

/**
 * Extract displacement angle from plain text response
 */
function extractDisplacementAngle(content: string): string | undefined {
  // Look for key vulnerability indicators
  const indicators = [
    /bridge contract/i,
    /multiple extensions/i,
    /performance issues/i,
    /protest/i,
    /acquisition.*integration/i,
    /merger.*challenges/i,
    /terminated/i,
    /recompete.*open/i,
  ];

  for (const indicator of indicators) {
    const match = content.match(new RegExp(`.{0,100}${indicator.source}.{0,100}`, 'i'));
    if (match) {
      return match[0].trim();
    }
  }

  return undefined;
}

/**
 * Generate fallback displacement angle from contract data
 */
function generateFallbackAngle(contract: RecompeteContract): string {
  const angles: string[] = [];

  if (contract.daysUntilExpiration <= 90) {
    angles.push('critical timeline pressure');
  } else if (contract.daysUntilExpiration <= 180) {
    angles.push('near-term recompete window');
  }

  if (contract.obligatedAmount >= 50000000) {
    angles.push('high-value opportunity');
  }

  if (contract.setAsideType) {
    angles.push(`${contract.setAsideType} set-aside eligible`);
  }

  return angles.length > 0
    ? `Potential displacement opportunity: ${angles.join(', ')}`
    : 'Standard recompete - research incumbent vulnerabilities';
}

/**
 * Get company intelligence (for teaming plays)
 */
export async function getCompanyIntel(
  companyName: string,
  focus: 'ma_activity' | 'contract_wins' | 'performance_issues' | 'all' = 'all'
): Promise<string | null> {
  if (!PERPLEXITY_API_KEY) return null;

  const query = `Federal contractor intelligence for ${companyName}:
${focus === 'all' || focus === 'ma_activity' ? '- Recent M&A activity (mergers, acquisitions)\n' : ''}
${focus === 'all' || focus === 'contract_wins' ? '- Major federal contract wins or losses in past 12 months\n' : ''}
${focus === 'all' || focus === 'performance_issues' ? '- Performance issues, protests, or negative press\n' : ''}
Provide specific dates and dollar amounts where available.`;

  try {
    const response = await fetch(PERPLEXITY_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [
          {
            role: 'system',
            content: 'You are a federal contracting intelligence analyst. Provide concise, actionable intelligence with sources.',
          },
          { role: 'user', content: query },
        ],
        temperature: 0.3,
        max_tokens: 1000,
      }),
    });

    if (!response.ok) return null;

    const data = await response.json();
    return data.choices?.[0]?.message?.content || null;
  } catch {
    return null;
  }
}
