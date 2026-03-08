/**
 * Search Capture Utility
 *
 * Call this function from any tool's search/filter action to capture
 * user searches for building briefing watchlists.
 *
 * This is a fire-and-forget function — it won't block the UI.
 */

type Tool =
  | 'market_assassin'
  | 'recompete'
  | 'opportunity_hunter'
  | 'contractor_db'
  | 'content_generator';

type SearchType =
  | 'naics'
  | 'agency'
  | 'keyword'
  | 'company'
  | 'zip'
  | 'contract'
  | 'psc'
  | 'set_aside';

interface CaptureSearchParams {
  userEmail: string;
  tool: Tool;
  searchType?: SearchType;
  searchValue: string;
  metadata?: Record<string, unknown>;
}

/**
 * Capture a user search for briefing watchlist building.
 *
 * @example
 * // In Market Assassin form submit
 * captureSearch({
 *   userEmail: 'user@example.com',
 *   tool: 'market_assassin',
 *   searchType: 'naics',
 *   searchValue: '541512',
 *   metadata: { agencies: ['DHS', 'DoD'], zip: '20001' }
 * });
 *
 * @example
 * // Capture multiple values at once
 * captureSearchBatch('user@example.com', 'market_assassin', {
 *   naics: ['541512', '541519'],
 *   agency: ['Department of Homeland Security'],
 *   zip: ['20001']
 * });
 */
export async function captureSearch(params: CaptureSearchParams): Promise<void> {
  // Don't capture if no email (user not identified)
  if (!params.userEmail) {
    return;
  }

  // Don't capture empty values
  if (!params.searchValue?.trim()) {
    return;
  }

  try {
    // Fire and forget — don't await in the UI
    fetch('/api/search-capture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_email: params.userEmail,
        tool: params.tool,
        search_type: params.searchType || 'keyword',
        search_value: params.searchValue,
        search_metadata: params.metadata || {}
      })
    }).catch(() => {
      // Silently fail — this is non-critical
    });
  } catch {
    // Silently fail — this is non-critical
  }
}

/**
 * Capture multiple search values at once.
 * Useful when a form has multiple fields (NAICS, agencies, ZIP, etc.)
 *
 * @example
 * captureSearchBatch('user@example.com', 'market_assassin', {
 *   naics: ['541512', '541519'],
 *   agency: ['Department of Homeland Security', 'Department of Defense'],
 *   zip: ['20001'],
 *   keyword: ['cybersecurity']
 * });
 */
export async function captureSearchBatch(
  userEmail: string,
  tool: Tool,
  searches: Partial<Record<SearchType, string[]>>,
  metadata?: Record<string, unknown>
): Promise<void> {
  if (!userEmail) return;

  const entries = Object.entries(searches) as [SearchType, string[]][];

  for (const [searchType, values] of entries) {
    if (!values || !Array.isArray(values)) continue;

    for (const value of values) {
      if (value?.trim()) {
        captureSearch({
          userEmail,
          tool,
          searchType,
          searchValue: value,
          metadata
        });
      }
    }
  }
}

/**
 * Helper to extract and capture searches from Market Assassin form data
 */
export function captureMarketAssassinSearch(
  userEmail: string,
  formData: {
    naicsCode?: string;
    naicsCodes?: string[];
    agencies?: string[];
    zipCode?: string;
    keyword?: string;
    keywords?: string[];
    setAside?: string;
    psc?: string;
  }
): void {
  if (!userEmail) return;

  const searches: Partial<Record<SearchType, string[]>> = {};

  // NAICS codes
  if (formData.naicsCode) {
    searches.naics = [formData.naicsCode];
  }
  if (formData.naicsCodes?.length) {
    searches.naics = [...(searches.naics || []), ...formData.naicsCodes];
  }

  // Agencies
  if (formData.agencies?.length) {
    searches.agency = formData.agencies;
  }

  // ZIP
  if (formData.zipCode) {
    searches.zip = [formData.zipCode];
  }

  // Keywords
  if (formData.keyword) {
    searches.keyword = [formData.keyword];
  }
  if (formData.keywords?.length) {
    searches.keyword = [...(searches.keyword || []), ...formData.keywords];
  }

  // Set-aside
  if (formData.setAside) {
    searches.set_aside = [formData.setAside];
  }

  // PSC
  if (formData.psc) {
    searches.psc = [formData.psc];
  }

  captureSearchBatch(userEmail, 'market_assassin', searches, formData);
}

/**
 * Helper to extract and capture searches from Recompete Tracker filters
 */
export function captureRecompeteSearch(
  userEmail: string,
  filters: {
    naicsCode?: string;
    agency?: string;
    incumbent?: string;
    contractNumber?: string;
  }
): void {
  if (!userEmail) return;

  const searches: Partial<Record<SearchType, string[]>> = {};

  if (filters.naicsCode) {
    searches.naics = [filters.naicsCode];
  }
  if (filters.agency) {
    searches.agency = [filters.agency];
  }
  if (filters.incumbent) {
    searches.company = [filters.incumbent];
  }
  if (filters.contractNumber) {
    searches.contract = [filters.contractNumber];
  }

  captureSearchBatch(userEmail, 'recompete', searches, filters);
}

/**
 * Helper to extract and capture searches from Opportunity Hunter
 */
export function captureOpportunityHunterSearch(
  userEmail: string,
  search: {
    naicsCode?: string;
    keyword?: string;
    agency?: string;
    zipCode?: string;
    setAside?: string;
  }
): void {
  if (!userEmail) return;

  const searches: Partial<Record<SearchType, string[]>> = {};

  if (search.naicsCode) {
    searches.naics = [search.naicsCode];
  }
  if (search.keyword) {
    searches.keyword = [search.keyword];
  }
  if (search.agency) {
    searches.agency = [search.agency];
  }
  if (search.zipCode) {
    searches.zip = [search.zipCode];
  }
  if (search.setAside) {
    searches.set_aside = [search.setAside];
  }

  captureSearchBatch(userEmail, 'opportunity_hunter', searches, search);
}

/**
 * Helper to extract and capture searches from Contractor Database
 */
export function captureContractorDbSearch(
  userEmail: string,
  search: {
    naicsCode?: string;
    companyName?: string;
    agency?: string;
    certification?: string;
  }
): void {
  if (!userEmail) return;

  const searches: Partial<Record<SearchType, string[]>> = {};

  if (search.naicsCode) {
    searches.naics = [search.naicsCode];
  }
  if (search.companyName) {
    searches.company = [search.companyName];
  }
  if (search.agency) {
    searches.agency = [search.agency];
  }
  if (search.certification) {
    searches.set_aside = [search.certification];
  }

  captureSearchBatch(userEmail, 'contractor_db', searches, search);
}
