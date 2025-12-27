/**
 * Federal Contractor Database Module
 * GovCon Giants - 2,768 Prime Contractors with SBLO Contacts
 */

import contractorsData from '@/data/contractors.json';

// Types
export interface Contractor {
  company: string;
  sblo_name: string;
  title: string;
  email: string;
  phone: string;
  address: string;
  naics: string;
  source: string;
  contract_count: string;
  total_contract_value: string;
  agencies: string;
  has_subcontract_plan: string;
  has_email: boolean;
  has_phone: boolean;
  has_contact: boolean;
  contract_value_num: number;
}

export interface ContractorSearchOptions {
  search?: string;
  naics?: string;
  agency?: string;
  source?: string;
  hasContact?: boolean;
  hasEmail?: boolean;
  minContractValue?: number;
  maxContractValue?: number;
  limit?: number;
  offset?: number;
  sortBy?: 'company' | 'contract_value' | 'contract_count';
  sortOrder?: 'asc' | 'desc';
}

export interface ContractorSearchResult {
  contractors: Contractor[];
  totalCount: number;
  filteredCount: number;
  limit: number;
  offset: number;
}

// Load contractors data
const contractors: Contractor[] = contractorsData as Contractor[];

/**
 * Search and filter contractors
 */
export function searchContractors(options: ContractorSearchOptions = {}): ContractorSearchResult {
  const {
    search,
    naics,
    agency,
    source,
    hasContact,
    hasEmail,
    minContractValue,
    maxContractValue,
    limit = 50,
    offset = 0,
    sortBy = 'contract_value',
    sortOrder = 'desc'
  } = options;

  let filtered = [...contractors];

  // Text search (company name, SBLO name)
  if (search) {
    const searchLower = search.toLowerCase();
    filtered = filtered.filter(c =>
      c.company.toLowerCase().includes(searchLower) ||
      c.sblo_name.toLowerCase().includes(searchLower) ||
      c.email.toLowerCase().includes(searchLower)
    );
  }

  // NAICS filter
  if (naics) {
    filtered = filtered.filter(c =>
      c.naics.split(',').some(n => n.trim().startsWith(naics))
    );
  }

  // Agency filter
  if (agency) {
    const agencyLower = agency.toLowerCase();
    filtered = filtered.filter(c =>
      c.agencies.toLowerCase().includes(agencyLower)
    );
  }

  // Source filter
  if (source) {
    filtered = filtered.filter(c =>
      c.source.toLowerCase().includes(source.toLowerCase())
    );
  }

  // Has contact filter
  if (hasContact !== undefined) {
    filtered = filtered.filter(c => c.has_contact === hasContact);
  }

  // Has email filter
  if (hasEmail !== undefined) {
    filtered = filtered.filter(c => c.has_email === hasEmail);
  }

  // Contract value range
  if (minContractValue !== undefined) {
    filtered = filtered.filter(c => c.contract_value_num >= minContractValue);
  }
  if (maxContractValue !== undefined) {
    filtered = filtered.filter(c => c.contract_value_num <= maxContractValue);
  }

  // Sort
  filtered.sort((a, b) => {
    let comparison = 0;
    switch (sortBy) {
      case 'company':
        comparison = a.company.localeCompare(b.company);
        break;
      case 'contract_count':
        comparison = parseInt(a.contract_count) - parseInt(b.contract_count);
        break;
      case 'contract_value':
      default:
        comparison = a.contract_value_num - b.contract_value_num;
        break;
    }
    return sortOrder === 'desc' ? -comparison : comparison;
  });

  const filteredCount = filtered.length;

  // Pagination
  const paginated = filtered.slice(offset, offset + limit);

  return {
    contractors: paginated,
    totalCount: contractors.length,
    filteredCount,
    limit,
    offset
  };
}

/**
 * Get contractor by company name
 */
export function getContractorByName(name: string): Contractor | undefined {
  return contractors.find(c =>
    c.company.toLowerCase() === name.toLowerCase()
  );
}

/**
 * Get contractors with email contacts
 */
export function getContractorsWithContacts(options: Omit<ContractorSearchOptions, 'hasContact' | 'hasEmail'> = {}): ContractorSearchResult {
  return searchContractors({ ...options, hasEmail: true });
}

/**
 * Get unique NAICS codes in the database
 */
export function getUniqueNAICS(): string[] {
  const naicsSet = new Set<string>();
  contractors.forEach(c => {
    c.naics.split(',').forEach(n => {
      const trimmed = n.trim();
      if (trimmed) {
        // Add 2-digit prefix
        naicsSet.add(trimmed.substring(0, 2));
      }
    });
  });
  return Array.from(naicsSet).sort();
}

/**
 * Get unique agencies in the database
 */
export function getUniqueAgencies(): string[] {
  const agencySet = new Set<string>();
  contractors.forEach(c => {
    c.agencies.split(',').forEach(a => {
      const trimmed = a.trim();
      if (trimmed) agencySet.add(trimmed);
    });
  });
  return Array.from(agencySet).sort();
}

/**
 * Get unique data sources in the database
 */
export function getUniqueSources(): string[] {
  const sourceSet = new Set<string>();
  contractors.forEach(c => {
    if (c.source) sourceSet.add(c.source);
  });
  return Array.from(sourceSet).sort();
}

/**
 * Get database statistics
 */
export function getDatabaseStats() {
  const withEmail = contractors.filter(c => c.has_email).length;
  const withPhone = contractors.filter(c => c.has_phone).length;
  const withContact = contractors.filter(c => c.has_contact).length;
  const totalValue = contractors.reduce((sum, c) => sum + c.contract_value_num, 0);

  return {
    totalContractors: contractors.length,
    withEmail,
    withPhone,
    withContact,
    totalContractValue: totalValue,
    uniqueAgencies: getUniqueAgencies().length,
    uniqueNAICS: getUniqueNAICS().length
  };
}
