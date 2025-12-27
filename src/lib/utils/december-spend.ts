// December Spend Forecast Database and Utilities
import decemberSpendData from '@/data/december-spend-forecast.json';
import { CoreInputs } from '@/types/federal-market-assassin';

export interface DecemberSpendOpportunity {
  agency: string;
  program: string;
  unobligatedBalance?: string;
  unobligated_balance?: string;
  unobligatedBalanceAmount: number | null;
  hotNaics?: string;
  hot_naics?: string;
  naicsCodes: string[];
  primeContractor?: string;
  prime_contractor?: string;
  sbloName?: string | null;
  sblo_name?: string | null;
  sbloEmail?: string | null;
  sblo_email?: string | null;
  sbloPhone?: string | null;
  sblo_phone?: string | null;
  source?: string | null;
}

interface DecemberSpendDatabase {
  opportunities: DecemberSpendOpportunity[];
}

const decemberDB = decemberSpendData as DecemberSpendDatabase;

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

// Extract NAICS codes from hot_naics string
function extractNAICSCodes(hotNaicsString: string | null | undefined): string[] {
  if (!hotNaicsString) return [];
  const naicsRegex = /\((\d{5,6})\)/g;
  const codes: string[] = [];
  let match;
  while ((match = naicsRegex.exec(hotNaicsString)) !== null) {
    codes.push(match[1]);
  }
  return codes;
}

// Parse unobligated balance to number
function parseUnobligatedBalance(balanceStr: string | null | undefined): number | null {
  if (!balanceStr) return null;
  const match = balanceStr.match(/([\d.]+)\s*([BM\+]+)/i);
  if (!match) return null;
  const value = parseFloat(match[1]);
  const multiplier = match[2]?.toUpperCase().replace(/\+/g, '');
  if (multiplier && multiplier.includes('B')) return value * 1000000000;
  if (multiplier && multiplier.includes('M')) return value * 1000000;
  return value;
}

/**
 * Clean malformed contact data
 */
function cleanContactData(text: string | null | undefined): string | null {
  if (!text) return null;

  // Remove common data quality issues
  let cleaned = text
    .replace(/smallbusinesscompliance/gi, '')
    .replace(/Small\s*$/i, '')
    .replace(/Website$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  // If email, validate basic format
  if (cleaned.includes('@')) {
    const emailMatch = cleaned.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/);
    if (emailMatch) {
      cleaned = emailMatch[1];
    }
  }

  return cleaned || null;
}

/**
 * Enrich opportunity with extracted data
 */
function enrichOpportunity(opp: any): DecemberSpendOpportunity {
  const hotNaics = opp.hot_naics || opp.hotNaics || '';
  const unobligatedBalance = opp.unobligated_balance || opp.unobligatedBalance || opp.unobligatedBalanceDec || '';

  const sbloName = cleanContactData(opp.sblo_name || opp.sbloName);
  const sbloEmail = cleanContactData(opp.sblo_email || opp.sbloEmail);

  return {
    agency: opp.agency || '',
    program: opp.program || '',
    unobligatedBalance: unobligatedBalance,
    unobligated_balance: unobligatedBalance,
    unobligatedBalanceAmount: parseUnobligatedBalance(unobligatedBalance),
    hotNaics: hotNaics,
    hot_naics: hotNaics,
    naicsCodes: extractNAICSCodes(hotNaics),
    primeContractor: opp.prime_contractor || opp.primeContractor || '',
    prime_contractor: opp.prime_contractor || opp.primeContractor || '',
    sbloName: sbloName,
    sblo_name: sbloName,
    sbloEmail: sbloEmail,
    sblo_email: sbloEmail,
    sbloPhone: opp.sblo_phone || opp.sbloPhone || null,
    sblo_phone: opp.sblo_phone || opp.sbloPhone || null,
    source: opp.source || null,
  };
}

/**
 * Get all December spend opportunities
 */
export function getAllDecemberOpportunities(): DecemberSpendOpportunity[] {
  return decemberDB.opportunities.map(enrichOpportunity);
}

/**
 * Filter opportunities by NAICS code (matches hot NAICS codes)
 */
export function getOpportunitiesByNAICS(naicsCode: string): DecemberSpendOpportunity[] {
  const { codes: searchCodes, sector } = normalizeNAICSCode(naicsCode);

  return getAllDecemberOpportunities().filter(opp => {
    const oppCodes = opp.naicsCodes.length > 0
      ? opp.naicsCodes
      : extractNAICSCodes(opp.hot_naics || opp.hotNaics || '');

    return oppCodes.some(code => {
      // Check if any of our search codes match
      for (const searchCode of searchCodes) {
        if (code === searchCode || code.startsWith(searchCode) || searchCode.startsWith(code)) {
          return true;
        }
      }
      // Also check if opportunity code is in the same sector
      if (code.startsWith(sector)) {
        return true;
      }
      return false;
    });
  });
}

/**
 * Filter opportunities by agency name (fuzzy match)
 */
export function getOpportunitiesByAgency(agencyName: string): DecemberSpendOpportunity[] {
  const lowerAgency = agencyName.toLowerCase();
  return getAllDecemberOpportunities().filter(opp =>
    opp.agency.toLowerCase().includes(lowerAgency) ||
    lowerAgency.includes(opp.agency.toLowerCase()) ||
    opp.program.toLowerCase().includes(lowerAgency)
  );
}

/**
 * Filter opportunities by agency name array
 */
export function getOpportunitiesByAgencies(agencyNames: string[]): DecemberSpendOpportunity[] {
  const results = new Set<DecemberSpendOpportunity>();
  
  agencyNames.forEach(agencyName => {
    getOpportunitiesByAgency(agencyName).forEach(opp => results.add(opp));
  });
  
  return Array.from(results);
}

/**
 * Get opportunities matching core inputs (business type, NAICS or PSC, agencies)
 */
export function getOpportunitiesByCoreInputs(
  inputs: CoreInputs,
  selectedAgencies: string[]
): DecemberSpendOpportunity[] {
  let opportunities = getAllDecemberOpportunities();

  // Filter by NAICS code if provided (takes priority)
  if (inputs.naicsCode && inputs.naicsCode.trim()) {
    const naicsFiltered = getOpportunitiesByNAICS(inputs.naicsCode);
    if (naicsFiltered.length > 0) {
      opportunities = naicsFiltered;
    }
  } else if (inputs.pscCode && inputs.pscCode.trim()) {
    // If no NAICS but PSC code provided, filter by PSC-related opportunities
    // PSC codes don't directly match our december spend data (which uses NAICS),
    // so we return all opportunities filtered by selected agencies only
    // This allows PSC-based searches to still see December spend opportunities
    console.log(`December Spend: Using PSC code ${inputs.pscCode} - returning agency-filtered results`);
  }

  // Filter by selected agencies
  if (selectedAgencies && selectedAgencies.length > 0) {
    const agencyFiltered = getOpportunitiesByAgencies(selectedAgencies);
    if (agencyFiltered.length > 0) {
      // Merge NAICS and agency filters
      const agencySet = new Set(agencyFiltered.map(o => `${o.agency}|${o.program}`));
      opportunities = opportunities.filter(o =>
        agencySet.has(`${o.agency}|${o.program}`)
      );
    }
  }

  // Deduplicate by agency + program (keep the one with best contact info)
  // Normalize keys to handle whitespace and case variations
  const uniqueMap = new Map<string, DecemberSpendOpportunity>();
  opportunities.forEach(opp => {
    // Normalize agency and program names for consistent deduplication
    const normalizedAgency = (opp.agency || '').trim().toLowerCase();
    const normalizedProgram = (opp.program || '').trim().toLowerCase();
    const key = `${normalizedAgency}|||${normalizedProgram}`;
    const existing = uniqueMap.get(key);

    if (!existing) {
      uniqueMap.set(key, opp);
    } else {
      // Determine which entry has better contact info
      const oppEmail = cleanContactData(opp.sbloEmail || opp.sblo_email);
      const existingEmail = cleanContactData(existing.sbloEmail || existing.sblo_email);
      const hasEmail = !!oppEmail;
      const existingHasEmail = !!existingEmail;

      // Priority 1: Choose entry with SBLO email contact
      if (hasEmail && !existingHasEmail) {
        uniqueMap.set(key, opp);
      } else if (!hasEmail && existingHasEmail) {
        // Keep existing (it has email, current doesn't)
      } else if (hasEmail && existingHasEmail) {
        // Both have email - keep the one with higher balance
        const oppAmount = opp.unobligatedBalanceAmount || 0;
        const existingAmount = existing.unobligatedBalanceAmount || 0;
        if (oppAmount > existingAmount) {
          uniqueMap.set(key, opp);
        }
      } else {
        // Neither has email - check if one has phone
        const hasPhone = !!(opp.sbloPhone || opp.sblo_phone);
        const existingHasPhone = !!(existing.sbloPhone || existing.sblo_phone);

        if (hasPhone && !existingHasPhone) {
          uniqueMap.set(key, opp);
        } else if (!hasPhone && existingHasPhone) {
          // Keep existing
        } else {
          // Both have or don't have phone - keep the one with higher balance
          const oppAmount = opp.unobligatedBalanceAmount || 0;
          const existingAmount = existing.unobligatedBalanceAmount || 0;
          if (oppAmount > existingAmount) {
            uniqueMap.set(key, opp);
          }
          // If balances are equal, keep existing (first one wins)
        }
      }
    }
  });

  opportunities = Array.from(uniqueMap.values());

  // Sort by unobligated balance amount (highest first)
  return opportunities.sort((a, b) => {
    const amountA = a.unobligatedBalanceAmount || 0;
    const amountB = b.unobligatedBalanceAmount || 0;
    return amountB - amountA;
  });
}

/**
 * Get top opportunities by unobligated balance
 */
export function getTopOpportunitiesByBalance(limit: number = 10): DecemberSpendOpportunity[] {
  return getAllDecemberOpportunities()
    .filter(opp => {
      const amount = opp.unobligatedBalanceAmount !== null 
        ? opp.unobligatedBalanceAmount 
        : parseUnobligatedBalance(opp.unobligated_balance || opp.unobligatedBalance);
      return amount !== null;
    })
    .sort((a, b) => {
      const amountA = a.unobligatedBalanceAmount || parseUnobligatedBalance(a.unobligated_balance || a.unobligatedBalance) || 0;
      const amountB = b.unobligatedBalanceAmount || parseUnobligatedBalance(b.unobligated_balance || b.unobligatedBalance) || 0;
      return amountB - amountA;
    })
    .slice(0, limit);
}

/**
 * Determine urgency level based on unobligated balance
 */
export function getUrgencyLevel(opportunity: DecemberSpendOpportunity): 'high' | 'medium' | 'low' {
  const amount = opportunity.unobligatedBalanceAmount || 0;
  
  // High: $5B+, Medium: $2B-$5B, Low: <$2B
  if (amount >= 5000000000) return 'high';
  if (amount >= 2000000000) return 'medium';
  return 'low';
}

/**
 * Generate quick win strategy for opportunity
 */
export function getQuickWinStrategy(
  opportunity: DecemberSpendOpportunity,
  inputs: CoreInputs
): string {
  const strategies: string[] = [];
  const sbloEmail = opportunity.sbloEmail || opportunity.sblo_email;
  const sbloName = opportunity.sbloName || opportunity.sblo_name;
  const primeContractor = opportunity.primeContractor || opportunity.prime_contractor;

  if (sbloEmail) {
    strategies.push(`Contact ${sbloName || 'SBLO'} at ${sbloEmail} immediately`);
  } else {
    strategies.push(`Research and contact SBLO at ${primeContractor}`);
  }

  strategies.push(`Focus on ${opportunity.program} program area`);
  
  const naicsCodes = opportunity.naicsCodes.length > 0
    ? opportunity.naicsCodes
    : extractNAICSCodes(opportunity.hot_naics || opportunity.hotNaics || '');
  if (naicsCodes.length > 0) {
    strategies.push(`Highlight your capabilities in NAICS: ${naicsCodes.slice(0, 3).join(', ')}`);
  } else if (inputs.pscCode) {
    strategies.push(`Highlight your capabilities in PSC: ${inputs.pscCode}`);
  }

  if (inputs.businessType) {
    strategies.push(`Emphasize your ${inputs.businessType} certification for set-aside opportunities`);
  }

  strategies.push('Prepare quick-turnaround capability statement');
  strategies.push('Request 15-minute intro call this week');

  return strategies.join('. ') + '.';
}

/**
 * Get opportunities grouped by agency
 */
export function getOpportunitiesByAgencyGroup(): Record<string, DecemberSpendOpportunity[]> {
  const grouped: Record<string, DecemberSpendOpportunity[]> = {};
  
  getAllDecemberOpportunities().forEach(opp => {
    if (!grouped[opp.agency]) {
      grouped[opp.agency] = [];
    }
    grouped[opp.agency].push(opp);
  });
  
  return grouped;
}

