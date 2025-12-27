// Tribal Businesses Database and Utilities
import tribalBusinessesData from '@/data/tribal-businesses-database.json';
import { Tribe } from '@/types/federal-market-assassin';

interface TribalBusinessesDatabase {
  tribes: any[];
}

const tribalDB = tribalBusinessesData as any;

/**
 * Get all tribal businesses from database
 */
export function getAllTribalBusinesses(): Tribe[] {
  return tribalDB.tribes.map(enrichTribe);
}

/**
 * Clean and normalize NAICS code for matching
 */
function normalizeNAICSCode(naicsCode: string): { codes: string[]; sector: string } {
  let cleanCode = naicsCode.trim();

  // Handle codes ending in 0000 (sector-level like "810000")
  if (cleanCode.length === 6 && cleanCode.endsWith('0000')) {
    const sector = cleanCode.substring(0, 2);
    return { codes: [sector], sector };
  }

  // Handle codes ending in 000 (subsector-level like "811000")
  if (cleanCode.length === 6 && cleanCode.endsWith('000')) {
    const prefix = cleanCode.substring(0, 3);
    const sector = cleanCode.substring(0, 2);
    return { codes: [prefix, sector], sector };
  }

  // Handle 3-digit codes
  if (cleanCode.length === 3) {
    const sector = cleanCode.substring(0, 2);
    return { codes: [cleanCode, sector], sector };
  }

  // Handle 2-digit codes
  if (cleanCode.length === 2) {
    return { codes: [cleanCode], sector: cleanCode };
  }

  // Handle full 6-digit codes
  const sector = cleanCode.substring(0, 2);
  const prefix = cleanCode.substring(0, 3);
  return { codes: [cleanCode, prefix, sector], sector };
}

/**
 * Find tribal businesses by NAICS code
 */
export function getTribesByNAICS(naicsCode: string): Tribe[] {
  const { codes, sector } = normalizeNAICSCode(naicsCode);

  return tribalDB.tribes
    .filter((tribe: any) => {
      const tribeCodes = tribe.naicsCategories || tribe.allNaicsCodes || [];
      return tribeCodes.some((code: string) => {
        // Check if any of our search codes match
        for (const searchCode of codes) {
          if (code === searchCode || code.startsWith(searchCode) || searchCode.startsWith(code)) {
            return true;
          }
        }
        // Also check if tribe code is in the same sector
        if (code.startsWith(sector)) {
          return true;
        }
        return false;
      });
    })
    .map(enrichTribe);
}

/**
 * Find tribal businesses by state/region
 */
export function getTribesByRegion(state: string): Tribe[] {
  const lowerState = state.toLowerCase();
  return tribalDB.tribes
    .filter((tribe: any) => {
      const tribeState = (tribe.state || tribe.region || '').toLowerCase();
      return tribeState.includes(lowerState) || lowerState.includes(tribeState);
    })
    .map(enrichTribe);
}

/**
 * Find tribal businesses by certification (8(a), etc.)
 */
export function getTribesByCertification(certification: string): Tribe[] {
  const lowerCert = certification.toLowerCase();
  return tribalDB.tribes
    .filter((tribe: any) =>
      tribe.activeSbaCertifications?.some((cert: string) =>
        cert.toLowerCase().includes(lowerCert) ||
        lowerCert.includes(cert.toLowerCase())
      )
    )
    .map(enrichTribe);
}

/**
 * Find tribal businesses by capability keywords
 */
export function getTribesByCapability(keyword: string): Tribe[] {
  const lowerKeyword = keyword.toLowerCase();
  return tribalDB.tribes
    .filter((tribe: any) => {
      const capabilities = tribe.capabilities || [];
      const narrative = (tribe.capabilitiesNarrative || '').toLowerCase();
      return (
        capabilities.some((cap: string) => cap.toLowerCase().includes(lowerKeyword)) ||
        narrative.includes(lowerKeyword)
      );
    })
    .map(enrichTribe);
}

/**
 * Suggest tribal businesses based on NAICS code and region
 */
export function suggestTribesForAgencies(
  agencies: Array<{ name: string; location?: string }>,
  naicsCode?: string
): Tribe[] {
  const suggestions = new Map<string, Tribe>();

  // Add tribes matching NAICS code
  if (naicsCode) {
    getTribesByNAICS(naicsCode).forEach(tribe => {
      suggestions.set(tribe.name, tribe);
    });
  }

  // Add tribes matching agency locations
  agencies.forEach(agency => {
    if (agency.location) {
      getTribesByRegion(agency.location).forEach(tribe => {
        suggestions.set(tribe.name, tribe);
      });
    }
  });

  // Sort by contact info availability (prioritize those with email/contact info)
  return Array.from(suggestions.values())
    .sort((a, b) => {
      const scoreContact = (tribe: Tribe): number => {
        let score = 0;
        if (tribe.contactPersonsEmail) score += 3;
        if (tribe.contactPersonsName) score += 1;
        return score;
      };
      return scoreContact(b) - scoreContact(a);
    })
    .slice(0, 25); // Return top 25 tribal businesses with best contact info
}

/**
 * Enrich tribe with derived/computed fields
 */
function enrichTribe(tribe: Tribe): Tribe {
  // Ensure region is set from state if not already set
  const region = tribe.region || tribe.state || 'Unknown';

  // Ensure capabilities array is populated
  let capabilities = tribe.capabilities || [];
  if (capabilities.length === 0 && tribe.capabilitiesNarrative) {
    // Parse capabilities from narrative
    capabilities = tribe.capabilitiesNarrative
      .split(/[,;]/)
      .map(c => c.trim())
      .filter(c => c.length > 0);
  }

  // Ensure naicsCategories is populated
  const naicsCategories = tribe.naicsCategories || tribe.allNaicsCodes || [];
  if (naicsCategories.length === 0 && tribe.primaryNaicsCode) {
    // Handle case where primaryNaicsCode might be an array
    const primaryCode = Array.isArray(tribe.primaryNaicsCode)
      ? tribe.primaryNaicsCode[0]
      : tribe.primaryNaicsCode;
    if (primaryCode) {
      naicsCategories.push(primaryCode);
    }
  }

  return {
    ...tribe,
    region,
    capabilities,
    naicsCategories,
  };
}

/**
 * Get tribal businesses by name (fuzzy match)
 */
export function findTribeByName(tribeName: string): Tribe | null {
  const lowerName = tribeName.toLowerCase();
  const tribe = tribalDB.tribes.find((t: any) =>
    t.name?.toLowerCase().includes(lowerName) ||
    lowerName.includes(t.name?.toLowerCase() || '')
  );
  return tribe ? enrichTribe(tribe) : null;
}

/**
 * Get tribal businesses with 8(a) certification
 */
export function get8aCertifiedTribes(): Tribe[] {
  return getTribesByCertification('8(a)');
}

/**
 * Get all unique regions/states from database
 */
export function getAllRegions(): string[] {
  const regions = new Set<string>();
  tribalDB.tribes.forEach((tribe: any) => {
    const region = tribe.state || tribe.region;
    if (region) {
      regions.add(region);
    }
  });
  return Array.from(regions).sort();
}

