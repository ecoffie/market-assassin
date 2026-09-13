/**
 * Relevance gate for beginner SAM results.
 *
 * search_sam_opportunities matches titles with ILIKE + websearch, so a token
 * like "building" hits both "Repair HVAC Building 304" and "Dale Carnegie
 * Building a Stronger Team" (NAICS 611430 training). One off-topic card
 * poisons the /try aha.
 *
 * When resolveBusiness grounded a NAICS set, keep only opportunities whose
 * NAICS shares the primary code's 2-digit sector. Do not admit every code in
 * a dirty coverage set (541512 inside an HVAC coverage is not the market).
 * Missing NAICS on a structured search is not "probably relevant" — drop it.
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

function distinctiveSearchTokens(resolution: ResolvedBusiness): string[] {
  const raw: string[] = [];
  if (resolution.keywords.status === 'known') raw.push(...resolution.keywords.items);
  if (resolution.searchKeyword) raw.push(resolution.searchKeyword);
  if (resolution.coverageKeyword) raw.push(resolution.coverageKeyword);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const phrase of raw) {
    for (const word of phrase.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)) {
      if (word.length < 4 || WEAK_TITLE_TOKENS.has(word) || seen.has(word)) continue;
      seen.add(word);
      out.push(word);
    }
  }
  return out;
}

export function isRelevantOpportunity(item: SamSearchItem, resolution: ResolvedBusiness): boolean {
  const sectors = resolvedMarketSectors(resolution);
  const itemSector = naicsSector(item.naics);
  if (sectors.size > 0) {
    if (!itemSector) return false;
    return sectors.has(itemSector);
  }
  const tokens = distinctiveSearchTokens(resolution);
  if (tokens.length === 0) return true;
  const title = (item.title || '').toLowerCase();
  return tokens.some((tok) => title.includes(tok));
}

export function filterRelevantOpportunities(
  items: readonly SamSearchItem[],
  resolution: ResolvedBusiness,
): SamSearchItem[] {
  return items.filter((item) => isRelevantOpportunity(item, resolution));
}
