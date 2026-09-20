/**
 * Relevance gate for beginner SAM results.
 *
 * search_sam_opportunities matches titles with ILIKE + websearch, so a token
 * like "building" hits both "Repair HVAC Building 304" and "Dale Carnegie
 * Building a Stronger Team" (NAICS 611430 training). One off-topic card
 * poisons the /try aha.
 *
 * Coverage NAICS sectors are a relevance SIGNAL across the measured candidate
 * set — not an exclusionary identity gate pinned to the dollar-leading sector.
 *
 * Admission:
 *  1. Distinctive USER tokens in the title always admit (lidar / drone / patrol
 *     across sectors).
 *  2. Item sector must be among measured candidate sectors.
 *  3. Dollar-peak sector admits as a soft boost (same-sector 236220 / 238220,
 *     336611 / 336612 stay discoverable).
 *  4. Non-peak measured sectors need phrase corroboration (blocks a dirty IT
 *     sliver like 541512 inside an HVAC coverage histogram).
 *
 * Missing NAICS with no user-word hit is still dropped.
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

/** All 2-digit sectors present in the measured coverage candidate set. */
export function resolvedMarketSectors(resolution: ResolvedBusiness): Set<string> {
  if (resolution.naicsCodes.status !== 'known') return new Set();
  return new Set(
    resolution.naicsCodes.items
      .map(naicsSector)
      .filter((s): s is string => Boolean(s)),
  );
}

/** Dollar-leading sector of the measured histogram (items[0]). Soft boost only. */
export function peakMarketSector(resolution: ResolvedBusiness): string | null {
  if (resolution.naicsCodes.status !== 'known') return null;
  return naicsSector(resolution.naicsCodes.items[0]);
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
  const peak = peakMarketSector(resolution);
  const itemSector = naicsSector(item.naics);
  const userTokens = distinctiveUserTokens(resolution);
  const searchTokens = distinctiveSearchTokens(resolution);

  // Phrase-first: user's own distinctive words admit across sectors.
  if (userTokens.some((tok) => title.includes(tok))) return true;

  if (sectors.size > 0) {
    if (!itemSector || !sectors.has(itemSector)) return false;
    // Soft boost: dollar-peak sector of the measured set (same-sector siblings stay in).
    if (peak && itemSector === peak) return true;
    // Non-peak measured sector needs phrase corroboration (not coverage alone).
    return searchTokens.some((tok) => title.includes(tok));
  }

  const tokens = searchTokens;
  if (tokens.length === 0) return true;
  return tokens.some((tok) => title.includes(tok));
}

export function filterRelevantOpportunities(
  items: readonly SamSearchItem[],
  resolution: ResolvedBusiness,
): SamSearchItem[] {
  return items.filter((item) => isRelevantOpportunity(item, resolution));
}
