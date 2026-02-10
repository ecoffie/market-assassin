// Pain Point Generator
// Uses Grok AI to generate oversight-grounded pain points for federal agencies
// Preserves existing hand-written pain points and only generates for gaps

import { AgencyOversightContext, formatOversightContextForPrompt } from './federal-oversight-data';

const GROK_API_KEY = process.env.GROK_API_KEY;
const GROK_API_URL = 'https://api.x.ai/v1/chat/completions';
const GROK_MODEL = process.env.GROK_MODEL || 'grok-3';

export interface PainPointGenerationResult {
  agency: string;
  painPoints: string[];
  source: 'existing' | 'generated' | 'merged';
  oversightContext: string[];
}

export interface PriorityGenerationResult {
  agency: string;
  priorities: string[];
  source: 'existing' | 'generated' | 'merged';
}

/**
 * Call Grok API for pain point generation
 */
async function callGrokForPainPoints(prompt: string, systemPrompt: string): Promise<string> {
  if (!GROK_API_KEY) {
    throw new Error('GROK_API_KEY not configured');
  }

  const response = await fetch(GROK_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GROK_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: GROK_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 2000,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Grok API Error (${response.status}): ${error.substring(0, 200)}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

/**
 * Generate pain points for a single agency using oversight data
 *
 * @param agencyName - The agency name
 * @param context - Oversight context (GAO, IG, budget data)
 * @param existingPainPoints - Already-written pain points to preserve
 * @param targetCount - How many total pain points to aim for
 */
export async function generatePainPointsForAgency(
  agencyName: string,
  context: AgencyOversightContext,
  existingPainPoints: string[] = [],
  targetCount: number = 12
): Promise<PainPointGenerationResult> {
  // If we already have enough, skip generation
  if (existingPainPoints.length >= targetCount) {
    return {
      agency: agencyName,
      painPoints: existingPainPoints,
      source: 'existing',
      oversightContext: [],
    };
  }

  const oversightText = formatOversightContextForPrompt(context);
  const neededCount = targetCount - existingPainPoints.length;

  const existingSection = existingPainPoints.length > 0
    ? `\n\nEXISTING PAIN POINTS (already written — do NOT repeat these):\n${existingPainPoints.map((p, i) => `${i + 1}. ${p}`).join('\n')}`
    : '';

  const systemPrompt = `You are a federal procurement intelligence analyst specializing in GovCon market research. You generate specific, actionable pain points that government contractors can use to position their capabilities.

Your pain points must be:
- Grounded in REAL oversight findings (GAO, IG reports, budget data)
- Specific: reference programs, dollar amounts, mandates, or timelines when possible
- Actionable: describe needs that a contractor could realistically address
- Concise: 1-2 sentences maximum per pain point
- Unique: no overlap with existing pain points

Do NOT generate generic pain points like "needs modernization" or "cybersecurity challenges" without specifics.`;

  const prompt = `Generate exactly ${neededCount} specific pain points for "${agencyName}" that a GovCon contractor could address.

${oversightText}
${existingSection}

Return ONLY a JSON array of strings. No numbering, no explanations, just the array.
Example format:
["Pain point 1 with specific details", "Pain point 2 referencing a real program"]`;

  try {
    const response = await callGrokForPainPoints(prompt, systemPrompt);

    // Parse the JSON array from the response
    const painPoints = parsePainPointsResponse(response);

    if (painPoints.length === 0) {
      console.warn(`[PainPointGenerator] No pain points generated for ${agencyName}`);
      return {
        agency: agencyName,
        painPoints: existingPainPoints,
        source: 'existing',
        oversightContext: context.gaoHighRiskAreas.slice(0, 3),
      };
    }

    // Merge existing + generated
    const merged = [...existingPainPoints, ...painPoints.slice(0, neededCount)];

    return {
      agency: agencyName,
      painPoints: merged,
      source: existingPainPoints.length > 0 ? 'merged' : 'generated',
      oversightContext: context.gaoHighRiskAreas.slice(0, 3),
    };
  } catch (error) {
    console.error(`[PainPointGenerator] Error generating for ${agencyName}:`, error);
    return {
      agency: agencyName,
      painPoints: existingPainPoints,
      source: 'existing',
      oversightContext: [],
    };
  }
}

/**
 * Generate spending/funding priorities for a single agency
 * Priorities = where the agency is actively spending money (vs pain points = what hurts)
 *
 * @param agencyName - The agency name
 * @param context - Oversight context (GAO, IG, budget data)
 * @param existingPriorities - Already-written priorities to preserve
 * @param targetCount - How many total priorities to aim for
 */
export async function generatePrioritiesForAgency(
  agencyName: string,
  context: AgencyOversightContext,
  existingPriorities: string[] = [],
  targetCount: number = 10
): Promise<PriorityGenerationResult> {
  // If we already have enough, skip generation
  if (existingPriorities.length >= targetCount) {
    return {
      agency: agencyName,
      priorities: existingPriorities,
      source: 'existing',
    };
  }

  const oversightText = formatOversightContextForPrompt(context);
  const neededCount = targetCount - existingPriorities.length;

  const existingSection = existingPriorities.length > 0
    ? `\n\nEXISTING PRIORITIES (already written — do NOT repeat these):\n${existingPriorities.map((p, i) => `${i + 1}. ${p}`).join('\n')}`
    : '';

  const systemPrompt = `You are a federal budget and procurement analyst specializing in GovCon market intelligence. You identify where federal agencies are ACTIVELY SPENDING MONEY — current programs, funded initiatives, and procurement priorities.

Unlike pain points (problems), priorities are about WHERE THE MONEY IS FLOWING:
- Active programs with allocated budgets
- Recently awarded large contracts or contract vehicles
- Budget line items from Congressional Justifications
- Strategic plan initiatives with funding commitments
- Bipartisan Infrastructure Law / IRA / CHIPS Act funded programs
- Upcoming recompetes and new procurements

Each priority must:
- Reference a SPECIFIC program, initiative, or budget line item
- Include dollar amounts, timelines, or contract vehicles when possible
- Describe something a contractor could bid on or support
- Be 1-2 sentences maximum
- Focus on FY2025-2027 spending (current and near-term)

Do NOT list generic goals like "improve cybersecurity" — instead say "CISA allocated $500M for Continuous Diagnostics and Mitigation (CDM) program to deploy endpoint detection across .gov networks."`;

  const prompt = `Generate exactly ${neededCount} specific SPENDING PRIORITIES for "${agencyName}" — where they are actively putting money and what contractors can pursue.

${oversightText}
${existingSection}

Return ONLY a JSON array of strings. No numbering, no explanations, just the array.
Example format:
["$2.1B allocated for NextGen air traffic control modernization, with RFPs expected Q2 FY2026", "FHWA distributing $12.5B Bridge Investment Program grants — engineering and construction firms can bid through state DOTs"]`;

  try {
    const response = await callGrokForPainPoints(prompt, systemPrompt);
    const priorities = parseJSONArrayResponse(response);

    if (priorities.length === 0) {
      console.warn(`[PriorityGenerator] No priorities generated for ${agencyName}`);
      return {
        agency: agencyName,
        priorities: existingPriorities,
        source: 'existing',
      };
    }

    const merged = [...existingPriorities, ...priorities.slice(0, neededCount)];

    return {
      agency: agencyName,
      priorities: merged,
      source: existingPriorities.length > 0 ? 'merged' : 'generated',
    };
  } catch (error) {
    console.error(`[PriorityGenerator] Error generating for ${agencyName}:`, error);
    return {
      agency: agencyName,
      priorities: existingPriorities,
      source: 'existing',
    };
  }
}

/**
 * Parse the AI response into an array of strings
 * Handles various response formats (pure JSON, markdown-wrapped, etc.)
 */
function parseJSONArrayResponse(response: string): string[] {
  return parsePainPointsResponse(response);
}

/**
 * Parse the AI response into an array of pain point strings
 * Handles various response formats (pure JSON, markdown-wrapped, etc.)
 */
function parsePainPointsResponse(response: string): string[] {
  // Try direct JSON parse first
  try {
    const parsed = JSON.parse(response.trim());
    if (Array.isArray(parsed)) {
      return parsed.filter((p): p is string => typeof p === 'string' && p.length > 10);
    }
  } catch {
    // Not pure JSON, try extracting
  }

  // Try extracting JSON array from markdown code block
  const jsonMatch = response.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      if (Array.isArray(parsed)) {
        return parsed.filter((p): p is string => typeof p === 'string' && p.length > 10);
      }
    } catch {
      // Continue to fallback
    }
  }

  // Try finding a JSON array anywhere in the response
  const arrayMatch = response.match(/\[[\s\S]*?\]/);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed)) {
        return parsed.filter((p): p is string => typeof p === 'string' && p.length > 10);
      }
    } catch {
      // Continue to line-by-line fallback
    }
  }

  // Fallback: parse line-by-line (numbered list or bullet points)
  const lines = response.split('\n')
    .map(line => line.replace(/^\s*[-•*\d.)\]]+\s*/, '').trim())
    .filter(line => line.length > 10 && !line.startsWith('{') && !line.startsWith('['));

  return lines;
}

/**
 * Generate pain points for multiple agencies in batch
 * Includes rate limiting and progress tracking
 *
 * @param agencies - List of agencies to generate for
 * @param existingData - Existing pain points database
 * @param options - Batch processing options
 */
export async function batchGeneratePainPoints(
  agencies: Array<{ name: string; budget?: number }>,
  existingData: Record<string, { painPoints: string[] }>,
  options: {
    targetCount?: number;
    getOversightContext: (agencyName: string, budget?: number) => AgencyOversightContext;
    onProgress?: (completed: number, total: number, agencyName: string) => void;
    delayMs?: number;
  }
): Promise<Map<string, PainPointGenerationResult>> {
  const {
    targetCount = 12,
    getOversightContext,
    onProgress,
    delayMs = 2000,
  } = options;

  const results = new Map<string, PainPointGenerationResult>();
  let completed = 0;

  for (const agency of agencies) {
    const existing = existingData[agency.name]?.painPoints || [];
    const context = getOversightContext(agency.name, agency.budget);

    const result = await generatePainPointsForAgency(
      agency.name,
      context,
      existing,
      targetCount
    );

    results.set(agency.name, result);
    completed++;

    if (onProgress) {
      onProgress(completed, agencies.length, agency.name);
    }

    // Rate limit between API calls
    if (completed < agencies.length && result.source !== 'existing') {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  return results;
}
