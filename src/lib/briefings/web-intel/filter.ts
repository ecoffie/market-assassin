/**
 * AI Filter / Scorer
 *
 * Uses Groq Llama 8B to filter and score web search results.
 * Implements PROMPT 6 from the Daily Briefings spec.
 */

import { SearchResult, WebSignal, WebIntelUserProfile, SignalType, Urgency } from './types';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.1-8b-instant';

const MAX_SIGNALS = 15; // Cap per spec
const MIN_RELEVANCE_SCORE = 30; // Filter out low-relevance items

/**
 * Filter and score search results using Groq
 */
export async function filterAndScoreResults(
  results: SearchResult[],
  userProfile: WebIntelUserProfile
): Promise<WebSignal[]> {
  if (results.length === 0) {
    return [];
  }

  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    console.log('[Filter] Groq not configured, using fallback scoring');
    return fallbackScoring(results, userProfile);
  }

  // Process in batches to stay within context limits
  const batchSize = 10;
  const allSignals: WebSignal[] = [];

  for (let i = 0; i < results.length; i += batchSize) {
    const batch = results.slice(i, i + batchSize);
    const signals = await processBatch(batch, userProfile, apiKey);
    allSignals.push(...signals);
  }

  // Filter by minimum score and sort by relevance
  const filtered = allSignals
    .filter((s) => s.relevance_score >= MIN_RELEVANCE_SCORE)
    .sort((a, b) => b.relevance_score - a.relevance_score)
    .slice(0, MAX_SIGNALS);

  console.log(`[Filter] ${allSignals.length} total → ${filtered.length} after filtering`);
  return filtered;
}

/**
 * Process a batch of results through the LLM
 */
async function processBatch(
  results: SearchResult[],
  userProfile: WebIntelUserProfile,
  apiKey: string
): Promise<WebSignal[]> {
  const prompt = buildFilterPrompt(results, userProfile);

  try {
    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          {
            role: 'system',
            content: 'You are a GovCon intelligence analyst. Analyze web search results and extract actionable intelligence signals. Only include signals relevant to the user profile. Be ruthless in filtering out noise.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.3, // Lower temperature for more consistent extraction
        max_tokens: 2000,
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      console.error(`[Filter] Groq API error: ${response.status}`);
      return fallbackScoring(results, userProfile);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      return [];
    }

    return parseSignals(content, results);
  } catch (error) {
    console.error('[Filter] Error processing batch:', error);
    return fallbackScoring(results, userProfile);
  }
}

/**
 * Build the filter prompt (PROMPT 6)
 */
function buildFilterPrompt(
  results: SearchResult[],
  profile: WebIntelUserProfile
): string {
  const resultsText = results
    .map((r, i) => `[${i}] ${r.title}\nURL: ${r.url}\nSnippet: ${r.snippet}\nSource: ${r.source}`)
    .join('\n\n');

  return `Analyze these web search results and extract actionable GovCon intelligence signals.

**User Profile:**
- NAICS Codes: ${profile.naics_codes.join(', ') || 'None'}
- Target Agencies: ${profile.agencies.join(', ') || 'General federal'}
- Competitor Watchlist: ${profile.watched_companies.join(', ') || 'None'}
- Keywords: ${profile.keywords.join(', ') || 'None'}

**Search Results:**
${resultsText}

**Instructions:**
1. Only include signals RELEVANT to the user's NAICS, agencies, or watchlist
2. Score relevance 1-100:
   - Direct NAICS match = 80-100
   - Agency match = 60-80
   - Competitor mention = 50-70
   - General industry news = 30-50
   - Irrelevant = 0 (exclude)
3. Categorize each signal
4. NEVER fabricate URLs - use exact URLs from results
5. Cap at ${MAX_SIGNALS} items maximum

**Signal Types:**
- AWARD_NEWS: Contract awards, wins, losses
- PROTEST: GAO protests, challenges
- AGENCY_ANNOUNCEMENT: Agency news, policy changes
- COMPETITOR_MOVE: Competitor activity, wins, partnerships
- PRIME_TEAMING_SIGNAL: Teaming opportunities, industry days
- BUDGET_SIGNAL: Budget changes, funding shifts
- REGULATORY: Acquisition rule changes
- LEADERSHIP: Key personnel changes

**Output Format:**
Return ONLY a JSON array:
[
  {
    "result_index": 0,
    "signal_type": "AWARD_NEWS",
    "headline": "Brief summary",
    "agency": "Agency name or null",
    "companies_mentioned": ["Company1"],
    "naics_relevance": ["541512"],
    "detail": "2-3 sentences explaining what happened",
    "competitive_implication": "What this means for the user",
    "relevance_score": 85,
    "urgency": "this_week"
  }
]

Urgency values: "immediate", "this_week", "this_month", "monitor"

Do not include any explanation, just the JSON array.`;
}

/**
 * Parse signals from LLM response
 */
function parseSignals(content: string, results: SearchResult[]): WebSignal[] {
  try {
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return [];
    }

    const parsed = JSON.parse(jsonMatch[0]);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((item: unknown): item is Record<string, unknown> =>
        typeof item === 'object' && item !== null
      )
      .map((item, idx) => {
        const resultIndex = typeof item.result_index === 'number'
          ? item.result_index
          : idx;
        const sourceResult = results[resultIndex] || results[0];

        return {
          id: `web-${Date.now()}-${idx}`,
          signal_type: validateSignalType(item.signal_type),
          headline: String(item.headline || sourceResult?.title || ''),
          agency: item.agency ? String(item.agency) : null,
          companies_mentioned: Array.isArray(item.companies_mentioned)
            ? item.companies_mentioned.map(String)
            : [],
          naics_relevance: Array.isArray(item.naics_relevance)
            ? item.naics_relevance.map(String)
            : [],
          detail: String(item.detail || sourceResult?.snippet || ''),
          competitive_implication: String(item.competitive_implication || ''),
          source_url: sourceResult?.url || '',
          source_name: sourceResult?.source || 'Unknown',
          published_date: sourceResult?.publishedDate || new Date().toISOString(),
          relevance_score: typeof item.relevance_score === 'number'
            ? Math.min(100, Math.max(0, item.relevance_score))
            : 50,
          urgency: validateUrgency(item.urgency),
          cross_reference: null, // Will be populated by cross-reference step
        };
      });
  } catch (error) {
    console.error('[Filter] Error parsing signals:', error);
    return [];
  }
}

/**
 * Validate signal type
 */
function validateSignalType(type: unknown): SignalType {
  const validTypes: SignalType[] = [
    'AWARD_NEWS',
    'PROTEST',
    'AGENCY_ANNOUNCEMENT',
    'COMPETITOR_MOVE',
    'PRIME_TEAMING_SIGNAL',
    'BUDGET_SIGNAL',
    'REGULATORY',
    'LEADERSHIP',
  ];

  if (typeof type === 'string' && validTypes.includes(type as SignalType)) {
    return type as SignalType;
  }

  return 'AGENCY_ANNOUNCEMENT';
}

/**
 * Validate urgency
 */
function validateUrgency(urgency: unknown): Urgency {
  const validUrgencies: Urgency[] = ['immediate', 'this_week', 'this_month', 'monitor'];

  if (typeof urgency === 'string' && validUrgencies.includes(urgency as Urgency)) {
    return urgency as Urgency;
  }

  return 'this_week';
}

/**
 * Fallback scoring when LLM is unavailable
 */
function fallbackScoring(
  results: SearchResult[],
  profile: WebIntelUserProfile
): WebSignal[] {
  const signals: WebSignal[] = [];

  for (const [idx, result] of results.entries()) {
    const text = `${result.title} ${result.snippet}`.toLowerCase();

    // Calculate relevance based on keyword matches
    let score = 0;
    const matchedNaics: string[] = [];
    const matchedCompanies: string[] = [];

    // Check NAICS matches
    for (const naics of profile.naics_codes) {
      if (text.includes(naics)) {
        score += 30;
        matchedNaics.push(naics);
      }
    }

    // Check agency matches
    for (const agency of profile.agencies) {
      if (text.includes(agency.toLowerCase())) {
        score += 20;
      }
    }

    // Check competitor matches
    for (const company of profile.watched_companies) {
      if (text.includes(company.toLowerCase())) {
        score += 25;
        matchedCompanies.push(company);
      }
    }

    // Check keyword matches
    for (const keyword of profile.keywords) {
      if (text.includes(keyword.toLowerCase())) {
        score += 10;
      }
    }

    // Boost for GovCon-specific sources
    if (result.source.includes('govconwire') || result.source.includes('fcw')) {
      score += 15;
    }

    // Determine signal type based on content
    let signalType: SignalType = 'AGENCY_ANNOUNCEMENT';
    if (text.includes('protest') || text.includes('gao')) {
      signalType = 'PROTEST';
    } else if (text.includes('award') || text.includes('contract win')) {
      signalType = 'AWARD_NEWS';
    } else if (text.includes('teaming') || text.includes('industry day')) {
      signalType = 'PRIME_TEAMING_SIGNAL';
    } else if (text.includes('budget') || text.includes('appropriation')) {
      signalType = 'BUDGET_SIGNAL';
    } else if (matchedCompanies.length > 0) {
      signalType = 'COMPETITOR_MOVE';
    }

    if (score >= MIN_RELEVANCE_SCORE) {
      signals.push({
        id: `web-${Date.now()}-${idx}`,
        signal_type: signalType,
        headline: result.title,
        agency: null,
        companies_mentioned: matchedCompanies,
        naics_relevance: matchedNaics,
        detail: result.snippet,
        competitive_implication: '',
        source_url: result.url,
        source_name: result.source,
        published_date: result.publishedDate || new Date().toISOString(),
        relevance_score: Math.min(100, score),
        urgency: 'this_week',
        cross_reference: null,
      });
    }
  }

  return signals
    .sort((a, b) => b.relevance_score - a.relevance_score)
    .slice(0, MAX_SIGNALS);
}
