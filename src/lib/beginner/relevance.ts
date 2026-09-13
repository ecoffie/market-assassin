/**
 * Relevance gate for beginner SAM results.
 *
 * search_sam_opportunities matches titles with ILIKE + websearch, so a token
 * like "building" hits both "Repair HVAC Building 304" and "Dale Carnegie
 * Building a Stronger Team" (NAICS 611430 training). One off-topic card
 * poisons the /try aha.
 *
 * When resolveBusiness grounded a NAICS set, keep the primary 2-digit sector
 * (do not admit every code in a dirty coverage set — 541512 inside HVAC is
 * not the market). Also keep a listing whose title carries a distinctive user
 * word (lidar, drone) even if the NAICS sector differs — drones/lidar span
 * manufacturing and surveying. Missing NAICS with no user-word hit is still
 * dropped. Homonyms without the user word (Dale Carnegie "Building") stay out.
 */

import type { ResolvedBusiness, SamSearchItem } from './types';

const WEAK_TITLE_TOKENS = new Set([
  'building',
  'buildings',
  'service',
  'services',
  'support',
  'system',
  'systems',
  'program',
  'management',
  'team',
  'training',
  'contract',
  'work',
  'repair',
  'replace',
  'project',
  'unit',
  'units',
]);

export function naicsSector(code: string | null | undefined): string | null {
  const digits = String(code || '').replace(/\D/g, '');
  if (digits.length < 2) return null;
  return digits.slice(0, 2);
}

export function resolvedMarketSectors(resolution: ResolvedBusiness): Set<string> {
  if (resolution.naicsCodes.status !== 'known') return new Set();
  const items = resolution.naicsCodes.items;
  const primarySector = naicsSector(resolution.primaryNaics);
  if (primarySector) {
    return new Set(
      items.map(naicsSector).filter((sector): sector is string => sector === primarySector),
    );
  }
  return new Set(items.map(naicsSector).filter((s): s is string => Boolean(s)));
}

function distinctiveTokensFrom(phrases: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const phrase of phrases) {
    for (const word of phrase.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)) {
      if (word.length < 4 || WEAK_TITLE_TOKENS.has(word) || seen.has(word)) continue;
      seen.add(word);
      out.push(word);
    }
  }
  return out;
}

function distinctiveSearchTokens(resolution: ResolvedBusiness): string[] {
  const raw: string[] = [];
  if (resolution.keywords.status === 'known') raw.push(...resolution.keywords.items);
  if (resolution.searchKeyword) raw.push(resolution.searchKeyword);
  if (resolution.coverageKeyword) raw.push(resolution.coverageKeyword);
  if (resolution.original) raw.push(resolution.original);
  if (resolution.followUpUsed) raw.push(resolution.followUpUsed);
  return distinctiveTokensFrom(raw);
}

/** User-typed words only. Coverage phrases like "door repair" would keep auto-door titles. */
function distinctiveUserTokens(resolution: ResolvedBusiness): string[] {
  const raw: string[] = [];
  if (resolution.original) raw.push(resolution.original);
  if (resolution.followUpUsed) raw.push(resolution.followUpUsed);
  return distinctiveTokensFrom(raw);
}

export function isRelevantOpportunity(item: SamSearchItem, resolution: ResolvedBusiness): boolean {
  const title = (item.title || '').toLowerCase();
  const sectors = resolvedMarketSectors(resolution);
  const itemSector = naicsSector(item.naics);
  if (sectors.size > 0) {
    if (itemSector && sectors.has(itemSector)) return true;
    // Drones/lidar span many NAICS. Primary-sector-only would drop surveying
    // LiDAR (541370) when coverage led with aircraft manufacturing (336411).
    // Match the user's own words, not coverage synonyms (door ≠ automobile doors).
    return distinctiveUserTokens(resolution).some((tok) => title.includes(tok));
  }
  const tokens = distinctiveSearchTokens(resolution);
  if (tokens.length === 0) return true;
  return tokens.some((tok) => title.includes(tok));
}

export function filterRelevantOpportunities(
  items: readonly SamSearchItem[],
  resolution: ResolvedBusiness,
): SamSearchItem[] {
  return items.filter((item) => isRelevantOpportunity(item, resolution));
}
