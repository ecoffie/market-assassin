/**
 * PSC-NAICS Crosswalk Utility
 *
 * Provides bidirectional lookups between NAICS codes and PSC (Product Service Codes).
 * Data sourced from USASpending co-occurrence analysis via /api/admin/build-psc-crosswalk.
 */

import crosswalkData from '@/data/psc-naics-crosswalk.json';

export interface PSCMatch {
  pscCode: string;
  pscDescription?: string;
  coOccurrenceCount: number;
  confidence: 'high' | 'medium' | 'low';
}

export interface NAICSMatch {
  naicsCode: string;
  naicsDescription?: string;
  coOccurrenceCount: number;
  confidence: 'high' | 'medium' | 'low';
}

interface CrosswalkEntry {
  matches: Array<{
    code: string;
    description?: string;
    count: number;
  }>;
}

const data = crosswalkData as {
  lastUpdated: string | null;
  version: number;
  naicsToPsc: Record<string, CrosswalkEntry>;
  pscToNaics: Record<string, CrosswalkEntry>;
};

function assignConfidence(count: number, maxCount: number): 'high' | 'medium' | 'low' {
  if (maxCount === 0) return 'low';
  const ratio = count / maxCount;
  if (ratio >= 0.3) return 'high';
  if (ratio >= 0.1) return 'medium';
  return 'low';
}

/**
 * Given a NAICS code, return the most commonly co-occurring PSC codes.
 * Tries exact match first, then 4-digit prefix, then 3-digit, then 2-digit sector.
 */
export function getPSCsForNAICS(naicsCode: string, limit = 10): PSCMatch[] {
  const code = naicsCode.trim();
  const prefixes = [code, code.slice(0, 4), code.slice(0, 3), code.slice(0, 2)];

  for (const prefix of prefixes) {
    const entry = data.naicsToPsc[prefix];
    if (entry?.matches?.length) {
      const maxCount = entry.matches[0].count;
      return entry.matches.slice(0, limit).map(m => ({
        pscCode: m.code,
        pscDescription: m.description,
        coOccurrenceCount: m.count,
        confidence: assignConfidence(m.count, maxCount),
      }));
    }
  }

  return [];
}

/**
 * Given a PSC code, return the most commonly co-occurring NAICS codes.
 * Tries exact match first, then 2-char prefix, then 1-char prefix.
 */
export function getNAICSForPSC(pscCode: string, limit = 10): NAICSMatch[] {
  const code = pscCode.trim().toUpperCase();
  const prefixes = [code, code.slice(0, 2), code.slice(0, 1)];

  for (const prefix of prefixes) {
    const entry = data.pscToNaics[prefix];
    if (entry?.matches?.length) {
      const maxCount = entry.matches[0].count;
      return entry.matches.slice(0, limit).map(m => ({
        naicsCode: m.code,
        naicsDescription: m.description,
        coOccurrenceCount: m.count,
        confidence: assignConfidence(m.count, maxCount),
      }));
    }
  }

  return [];
}

/**
 * Check if crosswalk data has been populated.
 */
export function isCrosswalkLoaded(): boolean {
  return data.version > 0 && data.lastUpdated !== null;
}

/**
 * Get crosswalk metadata.
 */
export function getCrosswalkInfo() {
  return {
    lastUpdated: data.lastUpdated,
    version: data.version,
    naicsEntries: Object.keys(data.naicsToPsc).length,
    pscEntries: Object.keys(data.pscToNaics).length,
  };
}
