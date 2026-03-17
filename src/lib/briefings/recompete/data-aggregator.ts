/**
 * Recompete Data Aggregator
 *
 * Pulls data from USASpending, RSS feeds, and web search to build
 * the raw data needed for recompete briefings.
 */

import { RawRecompeteData, RecompeteUserProfile } from './types';
import { fetchAllRSSFeeds, filterRSSByKeywords, filterRecentRSS, rssToSearchResults } from '../web-intel/rss';
import { searchGovConNews, isSerperConfigured } from '../web-intel/serper';

const USASPENDING_API = 'https://api.usaspending.gov/api/v2';

// Major agencies and their common contract types for recompete tracking
const PRIORITY_AGENCIES = [
  { name: 'Department of Homeland Security', code: '070', acronym: 'DHS' },
  { name: 'Department of Defense', code: '097', acronym: 'DoD' },
  { name: 'Department of Health and Human Services', code: '075', acronym: 'HHS' },
  { name: 'Department of Veterans Affairs', code: '036', acronym: 'VA' },
  { name: 'General Services Administration', code: '047', acronym: 'GSA' },
  { name: 'Department of Energy', code: '089', acronym: 'DOE' },
  { name: 'Department of State', code: '019', acronym: 'DOS' },
  { name: 'National Aeronautics and Space Administration', code: '080', acronym: 'NASA' },
  { name: 'Social Security Administration', code: '028', acronym: 'SSA' },
  { name: 'Department of Transportation', code: '069', acronym: 'DOT' },
];

// DHS sub-agencies (frequently in your examples)
const DHS_SUBAGENCIES = [
  { name: 'Customs and Border Protection', acronym: 'CBP' },
  { name: 'Immigration and Customs Enforcement', acronym: 'ICE' },
  { name: 'Transportation Security Administration', acronym: 'TSA' },
  { name: 'U.S. Citizenship and Immigration Services', acronym: 'USCIS' },
  { name: 'U.S. Coast Guard', acronym: 'USCG' },
  { name: 'U.S. Secret Service', acronym: 'USSS' },
  { name: 'Federal Emergency Management Agency', acronym: 'FEMA' },
  { name: 'Cybersecurity and Infrastructure Security Agency', acronym: 'CISA' },
];

// Keywords for filtering relevant news
const RECOMPETE_KEYWORDS = [
  'recompete',
  'follow-on',
  'follow on',
  'incumbent',
  'contract award',
  'task order',
  'IDIQ',
  'BPA',
  'contract expires',
  'contract expiring',
  'solicitation',
  'RFP',
  'RFI',
  'sources sought',
  'pre-solicitation',
  'award expected',
  'cyber',
  'IT services',
  'modernization',
  'support services',
];

/**
 * Fetch expiring contracts from USASpending
 */
async function fetchExpiringContracts(
  profile: RecompeteUserProfile,
  options: { monthsAhead?: number; limit?: number } = {}
): Promise<RawRecompeteData['expiringContracts']> {
  const { monthsAhead = 18, limit = 100 } = options;

  // Build date filter for contracts ending within monthsAhead
  const today = new Date();
  const futureDate = new Date();
  futureDate.setMonth(futureDate.getMonth() + monthsAhead);

  const contracts: RawRecompeteData['expiringContracts'] = [];

  try {
    // Search by NAICS codes from user profile
    // Get contracts signed in last 5 years that end in the future
    const pastDate = new Date();
    pastDate.setFullYear(pastDate.getFullYear() - 5);

    const naicsCodes = profile.naicsCodes.length > 0 ? profile.naicsCodes.slice(0, 5) : ['541511', '541512', '541519'];

    for (const naics of naicsCodes) {
      const response = await fetch(`${USASPENDING_API}/search/spending_by_award/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filters: {
            time_period: [
              {
                start_date: pastDate.toISOString().split('T')[0],
                end_date: today.toISOString().split('T')[0],
                date_type: 'date_signed',
              },
            ],
            award_type_codes: ['A', 'B', 'C', 'D'], // Contracts only
            naics_codes: [naics],
            award_amounts: [{ lower_bound: 1000000 }], // $1M+ contracts only
          },
          fields: [
            'Award ID',
            'Recipient Name',
            'Award Amount',
            'End Date',
            'Start Date',
            'Awarding Agency',
            'Awarding Sub Agency',
            'naics_code',
            'naics_description',
            'pop_state_code',
            'Description',
          ],
          page: 1,
          limit: 50,
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[DataAggregator] USASpending error for NAICS ${naics}: ${response.status}`, errorText.substring(0, 200));
        continue;
      }

      const data = await response.json();

      for (const award of data.results || []) {
        // Filter: only include contracts ending within the next 18 months
        const endDateStr = award['End Date'];
        if (!endDateStr) continue;

        const endDate = new Date(endDateStr);
        const daysUntilEnd = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

        // Skip contracts that already ended or end more than 18 months from now
        if (daysUntilEnd < 0 || daysUntilEnd > monthsAhead * 30) continue;

        contracts.push({
          piid: award['Award ID'] || '',
          agency: award['Awarding Agency'] || '',
          agencyCode: '',
          vendorName: award['Recipient Name'] || 'Unknown',
          obligatedAmount: parseFloat(award['Award Amount']) || 0,
          currentEndDate: endDateStr,
          naicsCode: award['naics_code'] || naics,
          naicsDescription: award['naics_description'] || award['Description'] || '',
          setAsideType: undefined, // Not available in this endpoint
          placeOfPerformanceState: award['pop_state_code'] || undefined,
        });
      }

      console.log(`[DataAggregator] NAICS ${naics}: ${contracts.length} expiring contracts found`);
    }

    // Sort by value descending
    contracts.sort((a, b) => b.obligatedAmount - a.obligatedAmount);

    return contracts.slice(0, limit);
  } catch (error) {
    console.error('[DataAggregator] Error fetching USASpending data:', error);
    return [];
  }
}

/**
 * Fetch GovCon news from RSS feeds and web search
 */
async function fetchGovConNews(
  profile: RecompeteUserProfile
): Promise<RawRecompeteData['newsItems']> {
  const newsItems: RawRecompeteData['newsItems'] = [];

  try {
    // 1. Fetch RSS feeds
    console.log('[DataAggregator] Fetching RSS feeds...');
    const rssItems = await fetchAllRSSFeeds();
    const recentRss = filterRecentRSS(rssItems, 7); // Last 7 days
    const filteredRss = filterRSSByKeywords(recentRss, RECOMPETE_KEYWORDS);

    for (const item of filteredRss.slice(0, 30)) {
      newsItems.push({
        title: item.title,
        url: item.link,
        source: item.source,
        publishedDate: item.pubDate || undefined,
        snippet: item.description.substring(0, 300),
      });
    }

    console.log(`[DataAggregator] RSS: ${filteredRss.length} relevant items`);

    // 2. Web search if Serper is configured
    if (isSerperConfigured()) {
      console.log('[DataAggregator] Searching web with Serper...');

      // Build search queries from user profile
      const agencies = profile.agencies.length > 0 ? profile.agencies.slice(0, 3) : ['DHS', 'ICE', 'CBP'];
      const competitors = profile.watchedCompanies.slice(0, 3);

      const searchResults = await searchGovConNews(agencies, profile.naicsCodes, competitors);

      for (const result of searchResults.slice(0, 20)) {
        // Avoid duplicates
        if (!newsItems.some(n => n.url === result.url)) {
          newsItems.push({
            title: result.title,
            url: result.url,
            source: result.source,
            publishedDate: result.publishedDate || undefined,
            snippet: result.snippet,
          });
        }
      }

      console.log(`[DataAggregator] Web search: ${searchResults.length} results`);
    }

    return newsItems;
  } catch (error) {
    console.error('[DataAggregator] Error fetching news:', error);
    return newsItems;
  }
}

/**
 * Fetch recent large contract awards (competitor activity)
 */
async function fetchRecentAwards(
  profile: RecompeteUserProfile,
  options: { daysBack?: number; limit?: number } = {}
): Promise<Array<{
  awardId: string;
  recipientName: string;
  awardAmount: number;
  agency: string;
  description: string;
  awardDate: string;
  naicsCode: string;
}>> {
  const { daysBack = 30, limit = 50 } = options;

  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - daysBack);

  try {
    const naicsCodes = profile.naicsCodes.length > 0 ? profile.naicsCodes.slice(0, 3) : ['541511'];

    const response = await fetch(`${USASPENDING_API}/search/spending_by_award/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filters: {
          time_period: [
            {
              start_date: startDate.toISOString().split('T')[0],
              end_date: endDate.toISOString().split('T')[0],
              date_type: 'action_date',
            },
          ],
          award_type_codes: ['A', 'B', 'C', 'D'],
          naics_codes: naicsCodes,
          award_amounts: [
            { lower_bound: 10000000 }, // $10M+ only
          ],
        },
        fields: [
          'Award ID',
          'Recipient Name',
          'Award Amount',
          'Awarding Agency',
          'Description',
          'Start Date',
          'NAICS Code',
        ],
        page: 1,
        limit,
        sort: '-Award Amount',
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      console.error(`[DataAggregator] Awards fetch error: ${response.status}`);
      return [];
    }

    const data = await response.json();

    return (data.results || []).map((award: Record<string, unknown>) => ({
      awardId: String(award['Award ID'] || ''),
      recipientName: String(award['Recipient Name'] || ''),
      awardAmount: parseFloat(String(award['Award Amount'])) || 0,
      agency: String(award['Awarding Agency'] || ''),
      description: String(award['Description'] || ''),
      awardDate: String(award['Start Date'] || ''),
      naicsCode: String(award['NAICS Code'] || ''),
    }));
  } catch (error) {
    console.error('[DataAggregator] Error fetching awards:', error);
    return [];
  }
}

/**
 * Main aggregator function - pulls all data sources
 */
export async function aggregateRecompeteData(
  profile: RecompeteUserProfile
): Promise<RawRecompeteData> {
  console.log(`[DataAggregator] Starting aggregation for ${profile.email}...`);
  const startTime = Date.now();

  // Run all fetches in parallel
  const [expiringContracts, newsItems] = await Promise.all([
    fetchExpiringContracts(profile),
    fetchGovConNews(profile),
  ]);

  console.log(`[DataAggregator] Completed in ${Date.now() - startTime}ms`);
  console.log(`[DataAggregator] Contracts: ${expiringContracts.length}, News: ${newsItems.length}`);

  return {
    expiringContracts,
    newsItems,
    forecasts: [], // SAM.gov forecasts would go here
  };
}

/**
 * Get agency acronym from name
 */
export function getAgencyAcronym(agencyName: string): string {
  // Check main agencies
  for (const agency of PRIORITY_AGENCIES) {
    if (agencyName.toLowerCase().includes(agency.name.toLowerCase()) ||
        agencyName.toLowerCase().includes(agency.acronym.toLowerCase())) {
      return agency.acronym;
    }
  }

  // Check DHS sub-agencies
  for (const sub of DHS_SUBAGENCIES) {
    if (agencyName.toLowerCase().includes(sub.name.toLowerCase()) ||
        agencyName.toLowerCase().includes(sub.acronym.toLowerCase())) {
      return sub.acronym;
    }
  }

  // Extract acronym from parentheses if present
  const match = agencyName.match(/\(([A-Z]{2,6})\)/);
  if (match) return match[1];

  return agencyName.split(' ').map(w => w[0]).join('').substring(0, 4).toUpperCase();
}

/**
 * Format contract value for display
 */
export function formatContractValue(amount: number): string {
  if (amount >= 1_000_000_000) {
    return `~$${(amount / 1_000_000_000).toFixed(1)}B`;
  }
  if (amount >= 100_000_000) {
    return `>$${Math.round(amount / 1_000_000)}M`;
  }
  if (amount >= 50_000_000) {
    return `$${Math.round(amount / 1_000_000)}M–$${Math.round(amount / 1_000_000) + 50}M`;
  }
  if (amount >= 10_000_000) {
    return `~$${Math.round(amount / 1_000_000)}M`;
  }
  if (amount >= 1_000_000) {
    return `$${(amount / 1_000_000).toFixed(1)}M`;
  }
  return `$${Math.round(amount / 1000)}K`;
}

export { fetchExpiringContracts, fetchGovConNews, fetchRecentAwards };
