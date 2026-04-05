/**
 * Pain Points Linker
 *
 * Links agency pain points data to federal hierarchy org codes.
 * Enables unified search across hierarchy + pain points + priorities.
 */

import agencyPainPointsData from '@/data/agency-pain-points.json';
import agencyAliasesData from '@/data/agency-aliases.json';

// Types
export interface AgencyPainPoints {
  agencyName: string;
  painPoints: string[];
  priorities: string[];
  matchedAliases: string[];
}

export interface PainPointSearchResult {
  agency: string;
  painPoints: string[];
  priorities: string[];
  relevanceScore: number;
  matchType: 'exact' | 'alias' | 'partial';
}

// Cache for faster lookups
const painPointsCache = new Map<string, AgencyPainPoints>();
const aliasToAgencyCache = new Map<string, string>();

/**
 * Initialize caches on first use
 */
function initializeCaches() {
  if (painPointsCache.size > 0) return;

  // Build pain points cache
  const agencies = (agencyPainPointsData as { agencies: Record<string, { painPoints: string[]; priorities: string[] }> }).agencies;

  for (const [agencyName, data] of Object.entries(agencies)) {
    painPointsCache.set(agencyName.toLowerCase(), {
      agencyName,
      painPoints: data.painPoints || [],
      priorities: data.priorities || [],
      matchedAliases: []
    });
  }

  // Build alias → agency cache
  const aliases = (agencyAliasesData as { aliases: Record<string, string> }).aliases;

  for (const [alias, agencyName] of Object.entries(aliases)) {
    aliasToAgencyCache.set(alias.toLowerCase(), agencyName);
  }
}

/**
 * Get pain points for an agency by name or alias
 */
export function getPainPointsForAgency(searchTerm: string): AgencyPainPoints | null {
  initializeCaches();

  const normalized = searchTerm.toLowerCase().trim();

  // Direct match
  if (painPointsCache.has(normalized)) {
    return painPointsCache.get(normalized)!;
  }

  // Check if it's an alias
  const aliasedName = aliasToAgencyCache.get(normalized);
  if (aliasedName) {
    const aliasedNormalized = aliasedName.toLowerCase();
    if (painPointsCache.has(aliasedNormalized)) {
      return painPointsCache.get(aliasedNormalized)!;
    }
  }

  // Partial match - check if search term is contained in agency name
  for (const [key, data] of painPointsCache.entries()) {
    if (key.includes(normalized) || data.agencyName.toLowerCase().includes(normalized)) {
      return data;
    }
  }

  return null;
}

/**
 * Search pain points across all agencies
 */
export function searchPainPoints(query: string, limit: number = 10): PainPointSearchResult[] {
  initializeCaches();

  const normalized = query.toLowerCase().trim();
  const results: PainPointSearchResult[] = [];

  // First, check for exact or alias matches
  const exactMatch = getPainPointsForAgency(query);
  if (exactMatch) {
    results.push({
      agency: exactMatch.agencyName,
      painPoints: exactMatch.painPoints,
      priorities: exactMatch.priorities,
      relevanceScore: 100,
      matchType: 'exact'
    });
  }

  // Search for query term in pain points and priorities
  for (const [, data] of painPointsCache.entries()) {
    // Skip if already added as exact match
    if (results.some(r => r.agency === data.agencyName)) continue;

    let score = 0;
    const matchingPainPoints: string[] = [];
    const matchingPriorities: string[] = [];

    // Check pain points
    for (const pp of data.painPoints) {
      if (pp.toLowerCase().includes(normalized)) {
        matchingPainPoints.push(pp);
        score += 10;
      }
    }

    // Check priorities
    for (const p of data.priorities) {
      if (p.toLowerCase().includes(normalized)) {
        matchingPriorities.push(p);
        score += 5;
      }
    }

    // Check agency name
    if (data.agencyName.toLowerCase().includes(normalized)) {
      score += 20;
    }

    if (score > 0) {
      results.push({
        agency: data.agencyName,
        painPoints: matchingPainPoints.length > 0 ? matchingPainPoints : data.painPoints.slice(0, 3),
        priorities: matchingPriorities.length > 0 ? matchingPriorities : data.priorities.slice(0, 3),
        relevanceScore: score,
        matchType: 'partial'
      });
    }
  }

  // Sort by relevance score
  results.sort((a, b) => b.relevanceScore - a.relevanceScore);

  return results.slice(0, limit);
}

/**
 * Get all agencies with pain points
 */
export function getAllAgenciesWithPainPoints(): string[] {
  initializeCaches();
  return Array.from(painPointsCache.values()).map(d => d.agencyName);
}

/**
 * Get pain points by NAICS code
 * Returns agencies whose pain points relate to a NAICS
 */
export function getPainPointsByNaics(naicsCode: string): PainPointSearchResult[] {
  // Map NAICS to relevant keywords
  const naicsKeywords: Record<string, string[]> = {
    '541512': ['cybersecurity', 'IT', 'software', 'cloud', 'network', 'systems'],
    '541511': ['software', 'programming', 'development', 'application'],
    '541519': ['IT', 'computer', 'technology', 'systems'],
    '541611': ['management consulting', 'strategy', 'operations'],
    '541612': ['HR', 'human resources', 'personnel', 'workforce'],
    '541613': ['marketing', 'communications', 'public affairs'],
    '541614': ['logistics', 'supply chain', 'process improvement'],
    '541618': ['consulting', 'advisory', 'management'],
    '541330': ['engineering', 'design', 'technical'],
    '541310': ['architecture', 'design', 'building'],
    '236220': ['construction', 'commercial', 'building'],
    '238210': ['electrical', 'installation', 'wiring'],
    '561210': ['facilities', 'building services', 'janitorial'],
    '561110': ['office', 'administrative', 'support'],
    '541990': ['professional services', 'scientific', 'technical'],
    '517311': ['telecommunications', 'wireless', 'communications'],
    '518210': ['data processing', 'hosting', 'cloud'],
    '611430': ['training', 'education', 'professional development']
  };

  const keywords = naicsKeywords[naicsCode] || [];
  if (keywords.length === 0) return [];

  const results: PainPointSearchResult[] = [];

  for (const keyword of keywords) {
    const keywordResults = searchPainPoints(keyword, 5);
    for (const result of keywordResults) {
      // Avoid duplicates
      if (!results.some(r => r.agency === result.agency)) {
        results.push(result);
      }
    }
  }

  return results.slice(0, 10);
}

/**
 * Resolve an alias to full agency name
 */
export function resolveAlias(alias: string): string | null {
  initializeCaches();

  const normalized = alias.toLowerCase().trim();
  return aliasToAgencyCache.get(normalized) || null;
}

/**
 * Get parent agency for a sub-agency
 */
export function getParentAgency(agencyName: string): string | null {
  const parentMappings = (agencyAliasesData as { parentMappings: Record<string, string> }).parentMappings;
  const aliases = (agencyAliasesData as { aliases: Record<string, string> }).aliases;
  const normalized = agencyName.toLowerCase();

  // First: check if the agency name matches an alias that has a parent mapping
  for (const [alias, fullName] of Object.entries(aliases)) {
    if (fullName.toLowerCase() === normalized || alias.toLowerCase() === normalized) {
      // Check if this alias has a parent mapping
      const aliasUpper = alias.toUpperCase();
      if (parentMappings[aliasUpper]) {
        return parentMappings[aliasUpper];
      }
      if (parentMappings[alias]) {
        return parentMappings[alias];
      }
    }
  }

  // Second: check for exact matches in parent mappings
  for (const [child, parent] of Object.entries(parentMappings)) {
    const childLower = child.toLowerCase();

    // Exact match
    if (normalized === childLower) {
      return parent;
    }

    // Check if child appears as a whole word in the name
    // Use word boundary check for abbreviations (all caps, 2-6 chars)
    if (child.length <= 6 && child === child.toUpperCase()) {
      // For abbreviations, require word boundary match
      const regex = new RegExp(`\\b${childLower}\\b`, 'i');
      if (regex.test(agencyName)) {
        return parent;
      }
    }
  }

  // Third: check if agency name contains full child name (for longer names)
  for (const [child, parent] of Object.entries(parentMappings)) {
    if (child.length > 6 && normalized.includes(child.toLowerCase())) {
      return parent;
    }
  }

  return null;
}

/**
 * Get CGAC code for an agency
 */
export function getCgacCode(agencyName: string): string | null {
  const cgacCodes = (agencyAliasesData as { cgacCodes: Record<string, string> }).cgacCodes;

  for (const [code, name] of Object.entries(cgacCodes)) {
    if (name.toLowerCase() === agencyName.toLowerCase()) {
      return code;
    }
  }

  return null;
}

/**
 * Resolve CGAC code to agency name
 */
export function resolveCgacCode(cgacCode: string): string | null {
  const cgacCodes = (agencyAliasesData as { cgacCodes: Record<string, string> }).cgacCodes;
  return cgacCodes[cgacCode] || null;
}

/**
 * Get comprehensive agency info including pain points, parent, and CGAC
 */
export function getAgencyInfo(searchTerm: string): {
  name: string;
  painPoints: string[];
  priorities: string[];
  parent: string | null;
  cgacCode: string | null;
  aliases: string[];
} | null {
  const painPoints = getPainPointsForAgency(searchTerm);
  if (!painPoints) return null;

  const aliases = (agencyAliasesData as { aliases: Record<string, string> }).aliases;
  const matchingAliases: string[] = [];

  for (const [alias, name] of Object.entries(aliases)) {
    if (name === painPoints.agencyName) {
      matchingAliases.push(alias);
    }
  }

  return {
    name: painPoints.agencyName,
    painPoints: painPoints.painPoints,
    priorities: painPoints.priorities,
    parent: getParentAgency(painPoints.agencyName),
    cgacCode: getCgacCode(painPoints.agencyName),
    aliases: matchingAliases
  };
}

/**
 * Get statistics about pain points data
 */
export function getPainPointsStats(): {
  totalAgencies: number;
  totalPainPoints: number;
  totalPriorities: number;
  totalAliases: number;
} {
  initializeCaches();

  let totalPainPoints = 0;
  let totalPriorities = 0;

  for (const data of painPointsCache.values()) {
    totalPainPoints += data.painPoints.length;
    totalPriorities += data.priorities.length;
  }

  return {
    totalAgencies: painPointsCache.size,
    totalPainPoints,
    totalPriorities,
    totalAliases: aliasToAgencyCache.size
  };
}
