/**
 * Search Query Generator
 *
 * Uses Groq Llama 8B to generate targeted search queries based on user's profile.
 * Implements PROMPT 7 from the Daily Briefings spec.
 */

import { GeneratedQuery, WebIntelUserProfile } from './types';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.1-8b-instant'; // Fast and cheap

/**
 * Check if Groq API is configured
 */
export function isGroqConfigured(): boolean {
  return !!process.env.GROQ_API_KEY;
}

/**
 * Generate search queries using Groq LLM
 */
export async function generateSearchQueries(
  userProfile: WebIntelUserProfile
): Promise<GeneratedQuery[]> {
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    console.log('[QueryGen] Groq not configured, using fallback queries');
    return generateFallbackQueries(userProfile);
  }

  const today = new Date().toISOString().split('T')[0];
  const year = new Date().getFullYear();

  const prompt = buildQueryGeneratorPrompt(userProfile, today, year);

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
            content: 'You are a GovCon intelligence analyst. Generate targeted search queries to find actionable intelligence for a federal contractor.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.7,
        max_tokens: 1000,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      console.error(`[QueryGen] Groq API error: ${response.status}`);
      return generateFallbackQueries(userProfile);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      console.error('[QueryGen] Empty response from Groq');
      return generateFallbackQueries(userProfile);
    }

    const queries = parseGeneratedQueries(content);
    console.log(`[QueryGen] Generated ${queries.length} queries`);

    return queries;
  } catch (error) {
    console.error('[QueryGen] Error generating queries:', error);
    return generateFallbackQueries(userProfile);
  }
}

/**
 * Build the prompt for query generation (PROMPT 7)
 */
function buildQueryGeneratorPrompt(
  profile: WebIntelUserProfile,
  today: string,
  year: number
): string {
  return `Generate 15-25 targeted Google search queries to find GovCon intelligence for this contractor:

**User Profile:**
- NAICS Codes: ${profile.naics_codes.join(', ') || 'None specified'}
- Target Agencies: ${profile.agencies.join(', ') || 'General federal'}
- Competitor Watchlist: ${profile.watched_companies.join(', ') || 'None'}
- Tracked Contracts: ${profile.watched_contracts.join(', ') || 'None'}
- Keywords: ${profile.keywords.join(', ') || 'None'}

**Today's Date:** ${today}

**Generate queries in these categories:**

1. AGENCY + NAICS queries (3-5):
   Format: "{agency} {naics_description} contract ${year}"

2. COMPETITOR queries (3-5):
   Format: "{competitor} federal contract win site:govconwire.com"

3. SPECIFIC CONTRACT queries (3-5):
   Format: "{contract_name} recompete OR follow-on"

4. TEAMING/SUBCONTRACTING queries (2-3):
   Format: "industry day {agency}" or "{prime} subcontracting opportunities"

5. BUDGET/POLICY queries (2-3):
   Format: "{agency} budget FY${year}" or "federal acquisition policy ${year}"

6. AGENCY NEWSROOM queries (2-3):
   Format: "site:{agency}.gov/news contract"

**Output Format:**
Return ONLY a JSON array of objects with this structure:
[
  {"query": "exact search query", "type": "agency_naics", "priority": 8},
  {"query": "another query", "type": "competitor", "priority": 7}
]

Priority scale: 1-10 (10 = most important)

Do not include any explanation, just the JSON array.`;
}

/**
 * Parse generated queries from LLM response
 */
function parseGeneratedQueries(content: string): GeneratedQuery[] {
  try {
    // Try to extract JSON array from response
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.warn('[QueryGen] No JSON array found in response');
      return [];
    }

    const parsed = JSON.parse(jsonMatch[0]);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((item: unknown): item is Record<string, unknown> =>
        typeof item === 'object' && item !== null && 'query' in item
      )
      .map((item) => ({
        query: String(item.query),
        type: validateQueryType(item.type),
        priority: typeof item.priority === 'number' ? item.priority : 5,
      }));
  } catch (error) {
    console.error('[QueryGen] Error parsing queries:', error);
    return [];
  }
}

/**
 * Validate query type
 */
function validateQueryType(type: unknown): GeneratedQuery['type'] {
  const validTypes: GeneratedQuery['type'][] = [
    'agency_naics',
    'competitor',
    'contract',
    'teaming',
    'budget',
    'newsroom',
  ];

  if (typeof type === 'string' && validTypes.includes(type as GeneratedQuery['type'])) {
    return type as GeneratedQuery['type'];
  }

  return 'agency_naics';
}

/**
 * Generate fallback queries when LLM is unavailable
 */
function generateFallbackQueries(profile: WebIntelUserProfile): GeneratedQuery[] {
  const queries: GeneratedQuery[] = [];
  const year = new Date().getFullYear();

  // Agency + NAICS queries
  for (const agency of profile.agencies.slice(0, 3)) {
    for (const naics of profile.naics_codes.slice(0, 2)) {
      queries.push({
        query: `"${agency}" NAICS ${naics} contract ${year}`,
        type: 'agency_naics',
        priority: 9,
      });
    }
  }

  // Competitor queries
  for (const competitor of profile.watched_companies.slice(0, 3)) {
    queries.push({
      query: `"${competitor}" federal contract site:govconwire.com`,
      type: 'competitor',
      priority: 8,
    });
  }

  // Contract queries
  for (const contract of profile.watched_contracts.slice(0, 3)) {
    queries.push({
      query: `"${contract}" recompete OR "follow-on"`,
      type: 'contract',
      priority: 8,
    });
  }

  // Teaming queries
  for (const agency of profile.agencies.slice(0, 2)) {
    queries.push({
      query: `"${agency}" industry day ${year}`,
      type: 'teaming',
      priority: 6,
    });
  }

  // Budget queries
  queries.push({
    query: `federal acquisition policy changes ${year}`,
    type: 'budget',
    priority: 5,
  });

  // General GovCon news
  queries.push({
    query: `federal contract award news site:fcw.com`,
    type: 'newsroom',
    priority: 4,
  });

  queries.push({
    query: `GAO bid protest decision site:gao.gov`,
    type: 'newsroom',
    priority: 7,
  });

  return queries;
}

/**
 * Deduplicate and sort queries by priority
 */
export function prioritizeQueries(
  queries: GeneratedQuery[],
  maxQueries: number = 20
): string[] {
  // Sort by priority (descending)
  const sorted = [...queries].sort((a, b) => b.priority - a.priority);

  // Dedupe by query text
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const q of sorted) {
    const normalized = q.query.toLowerCase().trim();
    if (!seen.has(normalized)) {
      seen.add(normalized);
      unique.push(q.query);
    }
  }

  return unique.slice(0, maxQueries);
}
