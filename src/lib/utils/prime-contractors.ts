// Prime Contractor Database and Utilities
import primeContractorsData from '@/data/prime-contractors-database.json';
import tier2ContractorsData from '@/data/tier2-contractors-database.json';
import { PrimeContractor, Tier2Contractor } from '@/types/federal-market-assassin';

interface PrimeContractorsDatabase {
  primes: PrimeContractor[];
}

interface Tier2ContractorsDatabase {
  tier2Contractors: Tier2Contractor[];
}

const primesDB = primeContractorsData as PrimeContractorsDatabase;
const tier2DB = tier2ContractorsData as Tier2ContractorsDatabase;

/**
 * Normalize company name for deduplication
 * Removes punctuation, extra spaces, and common suffixes to match similar names
 */
function normalizeCompanyName(name: string): string {
  return name
    .toUpperCase()
    .replace(/[,.'"\-]/g, '') // Remove punctuation
    .replace(/\s+(LLC|INC|CORP|CORPORATION|COMPANY|CO|LTD|LP|LLP)\.?$/i, '') // Remove common suffixes
    .replace(/\s+/g, ' ') // Normalize spaces
    .trim();
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
 * Get all prime contractors from database
 */
export function getAllPrimeContractors(): PrimeContractor[] {
  return primesDB.primes;
}

/**
 * Get all tier 2 contractors from database
 */
export function getAllTier2Contractors(): Tier2Contractor[] {
  return tier2DB.tier2Contractors;
}

/**
 * Find prime contractors by NAICS code (supports 2-digit sector, 3-digit prefix, and full code)
 */
export function getPrimesByNAICS(naicsCode: string): PrimeContractor[] {
  const { codes, sector } = normalizeNAICSCode(naicsCode);

  return primesDB.primes.filter(prime =>
    prime.naicsCategories?.some(code => {
      // Check if any of our search codes match
      for (const searchCode of codes) {
        if (code === searchCode || code.startsWith(searchCode) || searchCode.startsWith(code)) {
          return true;
        }
      }
      // Also check if prime code is in the same sector
      if (code.startsWith(sector)) {
        return true;
      }
      return false;
    })
  );
}

/**
 * Find prime contractors by agency name (fuzzy match)
 */
export function getPrimesByAgency(agencyName: string): PrimeContractor[] {
  const lowerAgency = agencyName.toLowerCase();
  return primesDB.primes.filter(prime =>
    prime.agencies?.some(agency =>
      agency.toLowerCase().includes(lowerAgency) ||
      lowerAgency.includes(agency.toLowerCase())
    )
  );
}

/**
 * Find prime contractors by name (fuzzy match)
 */
export function findPrimeByName(primeName: string): PrimeContractor | null {
  const lowerName = primeName.toLowerCase();
  return primesDB.primes.find(prime =>
    prime.name.toLowerCase().includes(lowerName) ||
    lowerName.includes(prime.name.toLowerCase())
  ) || null;
}

/**
 * PSC to NAICS mapping for finding relevant primes
 * Maps PSC categories to related NAICS codes
 */
const pscToNaicsMap: Record<string, string[]> = {
  // Services
  'D': ['541511', '541512', '541513', '541519', '518210'], // IT & Telecom
  'R': ['541611', '541612', '541613', '541614', '541618', '541620', '541690'], // Professional Services
  'J': ['811111', '811112', '811118', '811310'], // Maintenance & Repair
  'S': ['561210', '561720', '561730'], // Utilities & Housekeeping
  'Y': ['236220', '237110', '237310', '237990'], // Construction
  'Z': ['236118', '238990'], // Maintenance of Real Property
  'B': ['541720', '541990'], // Special Studies
  'C': ['541310', '541320', '541330', '541340', '541350'], // A&E
  'Q': ['621111', '621210', '621310'], // Medical Services
  'U': ['611430', '611710'], // Education & Training
  'A': ['541713', '541714', '541715'], // R&D
  // Products (numeric)
  '70': ['334111', '334112', '334118', '511210'], // IT Equipment
  '58': ['334210', '334220', '334290'], // Communication Equipment
  '65': ['339112', '339113', '339114'], // Medical Equipment
  '66': ['334510', '334511', '334512', '334513'], // Instruments
  '75': ['339940', '424120'], // Office Supplies
  '71': ['337211', '337214', '337215'], // Furniture
  '23': ['336110', '336111', '336112'], // Motor Vehicles
  '15': ['336411', '336412', '336413'], // Aircraft
};

/**
 * Find prime contractors by PSC code
 * Maps PSC to related NAICS codes and finds matching primes
 */
export function getPrimesByPSC(pscCode: string): PrimeContractor[] {
  const pscPrefix = pscCode.trim().toUpperCase().substring(0, 2);
  const pscFirstChar = pscCode.trim().toUpperCase().charAt(0);

  // Try to find NAICS codes for this PSC
  let relatedNaics = pscToNaicsMap[pscPrefix] || pscToNaicsMap[pscFirstChar] || [];

  if (relatedNaics.length === 0) {
    // Fallback: return diverse primes sorted by contact info, deduplicated
    const seen = new Set<string>();
    return primesDB.primes
      .filter(prime => {
        const normalizedName = normalizeCompanyName(prime.name);
        if (seen.has(normalizedName)) return false;
        seen.add(normalizedName);
        return true;
      })
      .sort((a, b) => {
        const scoreContact = (prime: PrimeContractor): number => {
          let score = 0;
          if (prime.email) score += 3;
          if (prime.phone) score += 2;
          if (prime.sbloName) score += 1;
          return score;
        };
        return scoreContact(b) - scoreContact(a);
      })
      .slice(0, 25);
  }

  // Find primes matching any of the related NAICS codes, deduplicated
  const seen = new Set<string>();
  const matchingPrimes = primesDB.primes.filter(prime => {
    const normalizedName = normalizeCompanyName(prime.name);
    if (seen.has(normalizedName)) return false;

    const matches = prime.naicsCategories?.some(code =>
      relatedNaics.some(naics => code.startsWith(naics.substring(0, 3)) || naics.startsWith(code.substring(0, 3)))
    );

    if (matches) {
      seen.add(normalizedName);
      return true;
    }
    return false;
  });

  return matchingPrimes.sort((a, b) => {
    const scoreContact = (prime: PrimeContractor): number => {
      let score = 0;
      if (prime.email) score += 3;
      if (prime.phone) score += 2;
      if (prime.sbloName) score += 1;
      return score;
    };
    return scoreContact(b) - scoreContact(a);
  }).slice(0, 25);
}

/**
 * Find tier 2 contractors by NAICS code (prioritizes those with contact info)
 */
export function getTier2ByNAICS(naicsCode: string): Tier2Contractor[] {
  const { codes, sector } = normalizeNAICSCode(naicsCode);

  return tier2DB.tier2Contractors
    .filter(tier2 =>
      tier2.naicsCategories?.some(code => {
        // Check if any of our search codes match
        for (const searchCode of codes) {
          if (code === searchCode || code.startsWith(searchCode) || searchCode.startsWith(code)) {
            return true;
          }
        }
        // Also check if tier2 code is in the same sector
        if (code.startsWith(sector)) {
          return true;
        }
        return false;
      })
    )
    .sort((a, b) => {
      const scoreContact = (tier2: Tier2Contractor): number => {
        let score = 0;
        if (tier2.email) score += 3;
        if (tier2.phone) score += 2;
        if (tier2.sbloName) score += 1;
        return score;
      };
      return scoreContact(b) - scoreContact(a);
    });
}

/**
 * Find tier 2 contractors that might work with specific primes (by name similarity)
 */
export function getTier2ByPrimes(primeNames: string[]): Tier2Contractor[] {
  const results: Tier2Contractor[] = [];

  tier2DB.tier2Contractors.forEach(tier2 => {
    // Check if tier2 company name appears in prime names (or vice versa)
    const tier2Lower = tier2.name.toLowerCase();
    const matches = primeNames.some(primeName =>
      tier2Lower.includes(primeName.toLowerCase()) ||
      primeName.toLowerCase().includes(tier2Lower)
    );

    if (!matches) {
      results.push(tier2);
    }
  });

  return results;
}

/**
 * Suggest Tier 2 contractors based on NAICS or PSC code
 * Returns Tier 2 contractors (not prime contractors) for subcontracting opportunities
 */
export function suggestTier2ForAgencies(
  naicsCode?: string,
  pscCode?: string
): Tier2Contractor[] {
  const suggestions = new Map<string, Tier2Contractor>();

  // Add Tier 2 contractors matching NAICS code
  if (naicsCode && naicsCode.trim()) {
    getTier2ByNAICS(naicsCode).forEach(tier2 => {
      const normalizedKey = normalizeCompanyName(tier2.name);
      if (!suggestions.has(normalizedKey)) {
        suggestions.set(normalizedKey, tier2);
      }
    });
  }

  // If no NAICS but PSC code provided, map PSC to NAICS and get Tier 2
  if ((!naicsCode || !naicsCode.trim()) && pscCode && pscCode.trim()) {
    const pscPrefix = pscCode.trim().toUpperCase().substring(0, 2);
    const pscFirstChar = pscCode.trim().toUpperCase().charAt(0);
    const relatedNaics = pscToNaicsMap[pscPrefix] || pscToNaicsMap[pscFirstChar] || [];

    if (relatedNaics.length > 0) {
      // Get Tier 2 contractors for each related NAICS
      relatedNaics.forEach(naics => {
        getTier2ByNAICS(naics).forEach(tier2 => {
          const normalizedKey = normalizeCompanyName(tier2.name);
          if (!suggestions.has(normalizedKey)) {
            suggestions.set(normalizedKey, tier2);
          }
        });
      });
    }
  }

  // If no matches found, return all Tier 2 contractors sorted by contact info
  if (suggestions.size === 0) {
    const seen = new Set<string>();
    return tier2DB.tier2Contractors
      .filter(tier2 => {
        const normalizedName = normalizeCompanyName(tier2.name);
        if (seen.has(normalizedName)) return false;
        seen.add(normalizedName);
        return true;
      })
      .sort((a, b) => {
        const scoreContact = (t: Tier2Contractor): number => {
          let score = 0;
          if (t.email) score += 3;
          if (t.phone) score += 2;
          if (t.sbloName) score += 1;
          return score;
        };
        return scoreContact(b) - scoreContact(a);
      })
      .slice(0, 25);
  }

  // Sort by contact info availability and return top 25
  return Array.from(suggestions.values())
    .sort((a, b) => {
      const scoreContact = (t: Tier2Contractor): number => {
        let score = 0;
        if (t.email) score += 3;
        if (t.phone) score += 2;
        if (t.sbloName) score += 1;
        return score;
      };
      return scoreContact(b) - scoreContact(a);
    })
    .slice(0, 25);
}

/**
 * Suggest prime contractors based on NAICS or PSC, agencies, and pain points
 * Uses normalized company names to prevent duplicates like "LLC" vs ", LLC"
 */
export function suggestPrimesForAgencies(
  agencies: Array<{ name: string; painPoints?: string[] }>,
  naicsCode?: string,
  pscCode?: string
): PrimeContractor[] {
  // Use normalized name as key to prevent duplicates like "ALEUT LLC" vs "ALEUT, LLC"
  const suggestions = new Map<string, PrimeContractor>();

  // Add primes matching NAICS code (takes priority)
  if (naicsCode && naicsCode.trim()) {
    getPrimesByNAICS(naicsCode).forEach(prime => {
      const normalizedKey = normalizeCompanyName(prime.name);
      // Only add if not already present (keeps first match)
      if (!suggestions.has(normalizedKey)) {
        suggestions.set(normalizedKey, prime);
      }
    });
  } else if (pscCode && pscCode.trim()) {
    // If no NAICS but PSC code provided, get primes by PSC category
    getPrimesByPSC(pscCode).forEach(prime => {
      const normalizedKey = normalizeCompanyName(prime.name);
      if (!suggestions.has(normalizedKey)) {
        suggestions.set(normalizedKey, prime);
      }
    });
  }

  // Add primes matching agencies
  agencies.forEach(agency => {
    getPrimesByAgency(agency.name).forEach(prime => {
      const normalizedKey = normalizeCompanyName(prime.name);
      if (!suggestions.has(normalizedKey)) {
        suggestions.set(normalizedKey, prime);
      }
    });
  });

  // Filter by pain point keywords if available
  const allPainPoints = agencies.flatMap(a => a.painPoints || []);
  if (allPainPoints.length > 0) {
    const painPointKeywords = allPainPoints.join(' ').toLowerCase();
    
    // Common pain point to specialty mappings
    const keywordMappings: Record<string, string[]> = {
      'cyber': ['541330', '541511', '541512'],
      'cloud': ['518210', '541511'],
      'it modern': ['541511', '541512', '541330'],
      'construction': ['236', '237', '238'],
      'engineering': ['541330', '541611'],
      'infrastructure': ['237', '541330'],
    };

    primesDB.primes.forEach(prime => {
      const matchesKeyword = Object.entries(keywordMappings).some(([keyword, naicsCodes]) => {
        if (painPointKeywords.includes(keyword)) {
          return prime.naicsCategories?.some(code =>
            naicsCodes.some(matchCode => code.startsWith(matchCode))
          );
        }
        return false;
      });

      if (matchesKeyword) {
        const normalizedKey = normalizeCompanyName(prime.name);
        if (!suggestions.has(normalizedKey)) {
          suggestions.set(normalizedKey, prime);
        }
      }
    });
  }

  // Convert to array, sort by contact info availability, then enrich
  return Array.from(suggestions.values())
    .sort((a, b) => {
      // Score based on contact info availability (higher = better)
      const scoreContact = (prime: PrimeContractor): number => {
        let score = 0;
        if (prime.email) score += 3;
        if (prime.phone) score += 2;
        if (prime.sbloName) score += 1;
        if (prime.supplierPortal) score += 2;
        return score;
      };
      return scoreContact(b) - scoreContact(a);
    })
    .slice(0, 25) // Return top 25 prime contractors with best contact info
    .map(prime => enrichPrimeContractor(prime));
}

/**
 * Enrich prime contractor with derived/computed fields
 */
function enrichPrimeContractor(prime: PrimeContractor): PrimeContractor {
  // Derive specialties from NAICS codes
  const specialties = deriveSpecialties(prime.naicsCategories);
  
  // Determine small business level based on contract count and value
  const smallBusinessLevel = determineSmallBusinessLevel(
    prime.contractCount,
    prime.totalContractValue
  );

  return {
    ...prime,
    specialties,
    smallBusinessLevel,
    contactStrategy: prime.supplierPortal
      ? `Register in ${prime.name} supplier portal at ${prime.supplierPortal}`
      : `Contact ${prime.sbloName || 'SBLO'} at ${prime.name}`,
    opportunities: specialties.join(', '),
    industries: deriveIndustries(prime.naicsCategories),
  };
}

/**
 * Derive specialties from NAICS codes
 */
function deriveSpecialties(naicsCodes: string[]): string[] {
  const specialties: string[] = [];
  const specialtyMap: Record<string, string> = {
    '541330': 'Engineering Services',
    '541511': 'Custom Computer Programming',
    '541512': 'Computer Systems Design',
    '541519': 'Other Computer Related Services',
    '541611': 'Administrative Management',
    '541612': 'Human Resources Consulting',
    '541690': 'Other Consulting Services',
    '541712': 'R&D in Physical Sciences',
    '541714': 'R&D in Biotechnology',
    '541715': 'R&D in Physical Sciences and Engineering',
    '236': 'Construction',
    '237': 'Heavy Construction',
    '238': 'Specialty Trade',
    '518210': 'Data Processing',
    '334511': 'Search, Detection, Navigation, Guidance Systems',
    '336411': 'Aircraft Manufacturing',
    '336611': 'Ship Building',
  };

  naicsCodes?.forEach(code => {
    const prefix3 = code.substring(0, 3);
    if (specialtyMap[code]) {
      specialties.push(specialtyMap[code]);
    } else if (specialtyMap[prefix3]) {
      specialties.push(specialtyMap[prefix3]);
    }
  });

  return [...new Set(specialties)]; // Remove duplicates
}

/**
 * Derive industries from NAICS codes
 */
function deriveIndustries(naicsCodes: string[]): string[] {
  const industries: string[] = [];
  const industryMap: Record<string, string> = {
    '541': 'Professional Services',
    '236': 'Construction of Buildings',
    '237': 'Heavy and Civil Engineering Construction',
    '238': 'Specialty Trade Contractors',
    '518': 'Data Processing and Hosting',
    '332': 'Fabricated Metal Product Manufacturing',
    '334': 'Computer and Electronic Product Manufacturing',
    '336': 'Transportation Equipment Manufacturing',
    '561': 'Administrative and Support Services',
  };

  naicsCodes?.forEach(code => {
    const prefix3 = code.substring(0, 3);
    if (industryMap[prefix3] && !industries.includes(industryMap[prefix3])) {
      industries.push(industryMap[prefix3]);
    }
  });

  return industries;
}

/**
 * Determine small business level
 */
function determineSmallBusinessLevel(
  contractCount?: number | null,
  totalValue?: number | null
): 'high' | 'medium' | 'low' {
  if (!contractCount && !totalValue) return 'medium';
  
  // High if many contracts or high value
  if ((contractCount && contractCount > 100) || (totalValue && totalValue > 10000000000)) {
    return 'high';
  }
  
  // Low if few contracts and low value
  if ((!contractCount || contractCount < 10) && (!totalValue || totalValue < 100000000)) {
    return 'low';
  }
  
  return 'medium';
}

/**
 * Get primes for specific industry (legacy compatibility)
 */
export function getPrimesForIndustry(naicsPrefix: string): string[] {
  const primes = getPrimesByNAICS(naicsPrefix);
  return primes.map(p => p.name);
}

/**
 * Get primes matching pain point keyword (legacy compatibility)
 */
export function getPrimesForPainPoint(keyword: string): string[] {
  const lowerKeyword = keyword.toLowerCase();
  const matchingPrimes = new Set<string>();

  primesDB.primes.forEach(prime => {
    const specialties = deriveSpecialties(prime.naicsCategories);
    const matches = specialties.some(spec =>
      spec.toLowerCase().includes(lowerKeyword) ||
      lowerKeyword.includes(spec.toLowerCase())
    );

    if (matches) {
      matchingPrimes.add(prime.name);
    }
  });

  return Array.from(matchingPrimes);
}

/**
 * Get detailed info for a specific prime
 */
export function getPrimeDetails(primeName: string): PrimeContractor | null {
  const prime = findPrimeByName(primeName);
  return prime ? enrichPrimeContractor(prime) : null;
}

// Legacy exports for backward compatibility
export const primesByIndustry: Record<string, string[]> = {};
export const defaultPrimes: string[] = [];

// Initialize legacy structures from database (for backward compatibility)
primesDB.primes.forEach(prime => {
  prime.naicsCategories?.forEach(naics => {
    const prefix = naics.substring(0, 3);
    if (!primesByIndustry[prefix]) {
      primesByIndustry[prefix] = [];
    }
    if (!primesByIndustry[prefix].includes(prime.name)) {
      primesByIndustry[prefix].push(prime.name);
    }
  });
  if (!defaultPrimes.includes(prime.name)) {
    defaultPrimes.push(prime.name);
  }
});
