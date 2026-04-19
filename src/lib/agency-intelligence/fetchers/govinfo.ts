// GovInfo API Fetcher
// Fetches GAO reports, Budget documents, and Congressional materials
// API: https://api.govinfo.gov

import { AgencyIntelligence, GovInfoDocument, FetcherOptions } from '../types';

const GOVINFO_API_BASE = 'https://api.govinfo.gov';
const GOVINFO_API_KEY = process.env.GOVINFO_API_KEY || '';

// GAO report collections we care about
const GAO_COLLECTIONS = ['GAOREPORTS'];

// Map agency names AND topics from GovInfo to our canonical names
const AGENCY_MAPPINGS: Record<string, string> = {
  // Department of Defense - agency names
  'Department of Defense': 'Department of Defense',
  'DoD': 'Department of Defense',
  'Defense Department': 'Department of Defense',
  'Pentagon': 'Department of Defense',
  'Army': 'Department of Defense',
  'Navy': 'Department of Defense',
  'Air Force': 'Department of Defense',
  'Marine Corps': 'Department of Defense',
  // DOD topics
  'Defense Acquisition': 'Department of Defense',
  'Defense Contract': 'Department of Defense',
  'Military Readiness': 'Department of Defense',
  'Weapon System': 'Department of Defense',
  'Joint Strike Fighter': 'Department of Defense',
  'Military Health': 'Department of Defense',
  'TRICARE': 'Department of Defense',

  // Department of Homeland Security - agency names
  'Department of Homeland Security': 'Department of Homeland Security',
  'DHS': 'Department of Homeland Security',
  'Homeland Security': 'Department of Homeland Security',
  'TSA': 'Department of Homeland Security',
  'FEMA': 'Department of Homeland Security',
  'CBP': 'Department of Homeland Security',
  'ICE': 'Department of Homeland Security',
  'Coast Guard': 'Department of Homeland Security',
  'Secret Service': 'Department of Homeland Security',
  'Customs and Border': 'Department of Homeland Security',
  // DHS topics
  'Aviation Security': 'Department of Homeland Security',
  'Border Security': 'Department of Homeland Security',
  'Critical Infrastructure': 'Department of Homeland Security',
  'Emergency Management': 'Department of Homeland Security',
  'Disaster Relief': 'Department of Homeland Security',
  'Cybersecurity': 'Department of Homeland Security',

  // Department of Veterans Affairs - agency names
  'Department of Veterans Affairs': 'Department of Veterans Affairs',
  'VA ': 'Department of Veterans Affairs',
  'Veterans Affairs': 'Department of Veterans Affairs',
  'Veterans Administration': 'Department of Veterans Affairs',
  // VA topics
  'Veterans Health': 'Department of Veterans Affairs',
  'Veterans Benefits': 'Department of Veterans Affairs',
  'GI Bill': 'Department of Veterans Affairs',

  // Department of Health and Human Services - agency names
  'Department of Health and Human Services': 'Department of Health and Human Services',
  'HHS': 'Department of Health and Human Services',
  'Health and Human Services': 'Department of Health and Human Services',
  'CMS': 'Department of Health and Human Services',
  'CDC': 'Department of Health and Human Services',
  'FDA': 'Department of Health and Human Services',
  'NIH': 'Department of Health and Human Services',
  // HHS topics
  'Medicare': 'Department of Health and Human Services',
  'Medicaid': 'Department of Health and Human Services',
  'Public Health': 'Department of Health and Human Services',
  'Blood Safety': 'Department of Health and Human Services',
  'Food Safety': 'Department of Health and Human Services',
  'Drug Safety': 'Department of Health and Human Services',
  'Health Care': 'Department of Health and Human Services',
  'Healthcare': 'Department of Health and Human Services',
  'Hospital': 'Department of Health and Human Services',
  'Nursing Home': 'Department of Health and Human Services',
  'Children With Disabilities': 'Department of Health and Human Services',

  // Department of Energy - agency names
  'Department of Energy': 'Department of Energy',
  'DOE': 'Department of Energy',
  'Energy Department': 'Department of Energy',
  // DOE topics
  'Nuclear': 'Department of Energy',
  'Radioactive': 'Department of Energy',
  'National Lab': 'Department of Energy',
  'Energy Efficiency': 'Department of Energy',

  // Environmental Protection Agency
  'Environmental Protection Agency': 'Environmental Protection Agency',
  'EPA': 'Environmental Protection Agency',
  // EPA topics
  'Environmental': 'Environmental Protection Agency',
  'Pollution': 'Environmental Protection Agency',
  'Clean Water': 'Environmental Protection Agency',
  'Clean Air': 'Environmental Protection Agency',
  'Superfund': 'Environmental Protection Agency',
  'Chemical Safety': 'Environmental Protection Agency',

  // Department of Justice - agency names
  'Department of Justice': 'Department of Justice',
  'DOJ': 'Department of Justice',
  'Justice Department': 'Department of Justice',
  'FBI': 'Department of Justice',
  'DEA': 'Department of Justice',
  'ATF': 'Department of Justice',
  'U.S. Marshals': 'Department of Justice',
  'Bureau of Prisons': 'Department of Justice',
  // DOJ topics
  'Federal Prison': 'Department of Justice',
  'Law Enforcement': 'Department of Justice',
  'Crime': 'Department of Justice',
  'Criminal Justice': 'Department of Justice',

  // Department of Treasury - agency names
  'Department of the Treasury': 'Department of the Treasury',
  'Treasury Department': 'Department of the Treasury',
  'Treasury': 'Department of the Treasury',
  'IRS': 'Department of the Treasury',
  // Treasury topics
  'Tax': 'Department of the Treasury',
  'Taxpayer': 'Department of the Treasury',
  'Debt Collection': 'Department of the Treasury',
  'Financial Regulation': 'Department of the Treasury',

  // Department of Transportation - agency names
  'Department of Transportation': 'Department of Transportation',
  'DOT': 'Department of Transportation',
  'Transportation': 'Department of Transportation',
  'FAA': 'Department of Transportation',
  'NHTSA': 'Department of Transportation',
  'FHWA': 'Department of Transportation',
  'FRA': 'Department of Transportation',
  'FTA': 'Department of Transportation',
  // DOT topics
  'Air Traffic': 'Department of Transportation',
  'Airport': 'Department of Transportation',
  'Highway': 'Department of Transportation',
  'Railroad': 'Department of Transportation',
  'Transit': 'Department of Transportation',
  'Pipeline Safety': 'Department of Transportation',
  'Motor Carrier': 'Department of Transportation',

  // Department of Agriculture - agency names
  'Department of Agriculture': 'Department of Agriculture',
  'USDA': 'Department of Agriculture',
  'Agriculture': 'Department of Agriculture',
  'Forest Service': 'Department of Agriculture',
  // USDA topics
  'Food Stamp': 'Department of Agriculture',
  'SNAP': 'Department of Agriculture',
  'Farm': 'Department of Agriculture',
  'Rural Development': 'Department of Agriculture',

  // Department of Commerce - agency names
  'Department of Commerce': 'Department of Commerce',
  'Commerce Department': 'Department of Commerce',
  'Commerce': 'Department of Commerce',
  'NOAA': 'Department of Commerce',
  'Census Bureau': 'Department of Commerce',
  'Patent and Trademark': 'Department of Commerce',
  'NIST': 'Department of Commerce',
  // Commerce topics
  'Census': 'Department of Commerce',
  'Weather': 'Department of Commerce',
  'Trade': 'Department of Commerce',

  // Department of Education - agency names
  'Department of Education': 'Department of Education',
  'Education Department': 'Department of Education',
  // Education topics
  'Student Loan': 'Department of Education',
  'Student Aid': 'Department of Education',
  'School': 'Department of Education',
  'Higher Education': 'Department of Education',

  // Department of Housing and Urban Development
  'Department of Housing and Urban Development': 'Department of Housing and Urban Development',
  'HUD': 'Department of Housing and Urban Development',
  // HUD topics
  'Public Housing': 'Department of Housing and Urban Development',
  'FHA': 'Department of Housing and Urban Development',
  'Section 8': 'Department of Housing and Urban Development',
  'Homeless': 'Department of Housing and Urban Development',

  // Department of Interior - agency names
  'Department of the Interior': 'Department of the Interior',
  'Interior Department': 'Department of the Interior',
  'Interior': 'Department of the Interior',
  'Bureau of Land Management': 'Department of the Interior',
  'National Park': 'Department of the Interior',
  'Fish and Wildlife': 'Department of the Interior',
  'Bureau of Indian Affairs': 'Department of the Interior',
  // Interior topics
  'Public Lands': 'Department of the Interior',
  'Mineral': 'Department of the Interior',
  'Tribal': 'Department of the Interior',
  'Indian': 'Department of the Interior',

  // Department of Labor - agency names
  'Department of Labor': 'Department of Labor',
  'Labor Department': 'Department of Labor',
  'DOL': 'Department of Labor',
  'OSHA': 'Department of Labor',
  // Labor topics
  'Unemployment': 'Department of Labor',
  'Worker': 'Department of Labor',
  'Workplace': 'Department of Labor',
  'Pension': 'Department of Labor',
  'Job Training': 'Department of Labor',

  // Department of State - agency names
  'Department of State': 'Department of State',
  'State Department': 'Department of State',
  'DOS': 'Department of State',
  // State topics
  'Embassy': 'Department of State',
  'Diplomatic': 'Department of State',
  'Foreign Affairs': 'Department of State',
  'Passport': 'Department of State',
  'Arms Control': 'Department of State',

  // NASA
  'NASA': 'National Aeronautics and Space Administration',
  'National Aeronautics and Space Administration': 'National Aeronautics and Space Administration',
  'Space': 'National Aeronautics and Space Administration',

  // GSA
  'GSA': 'General Services Administration',
  'General Services Administration': 'General Services Administration',
  'Federal Building': 'General Services Administration',
  'Federal Property': 'General Services Administration',

  // SBA
  'SBA': 'Small Business Administration',
  'Small Business Administration': 'Small Business Administration',
  'Small Business': 'Small Business Administration',

  // OPM
  'OPM': 'Office of Personnel Management',
  'Office of Personnel Management': 'Office of Personnel Management',
  'Federal Employee': 'Office of Personnel Management',
  'Civil Service': 'Office of Personnel Management',

  // SSA
  'SSA': 'Social Security Administration',
  'Social Security': 'Social Security Administration',
  'Social Security Administration': 'Social Security Administration',
  'Disability Benefits': 'Social Security Administration',

  // Independent agencies and other
  'NRC': 'Nuclear Regulatory Commission',
  'Nuclear Regulatory Commission': 'Nuclear Regulatory Commission',
  'USPS': 'United States Postal Service',
  'Postal Service': 'United States Postal Service',
  'Amtrak': 'Amtrak',
  'SEC': 'Securities and Exchange Commission',
  'Securities and Exchange': 'Securities and Exchange Commission',
};

/**
 * Fetch GAO reports from GovInfo API
 * Note: GovInfo /search requires POST method, not GET
 */
export async function fetchGAOReports(
  options: FetcherOptions = {}
): Promise<AgencyIntelligence[]> {
  const { fiscalYear = new Date().getFullYear(), limit = 500, dryRun = false } = options;

  if (!GOVINFO_API_KEY) {
    console.warn('[GovInfo] No API key configured (GOVINFO_API_KEY)');
    return [];
  }

  const results: AgencyIntelligence[] = [];

  try {
    // GovInfo /search endpoint requires POST with JSON body
    const searchUrl = `${GOVINFO_API_BASE}/search?api_key=${GOVINFO_API_KEY}`;
    const searchQuery = 'collection:GAOREPORTS AND ("high risk" OR "management challenges" OR "cybersecurity" OR "IT modernization" OR "acquisition")';

    console.log(`[GovInfo] Fetching GAO reports for FY${fiscalYear}...`);

    if (dryRun) {
      console.log(`[GovInfo] Dry run - would POST to /search with query: ${searchQuery.slice(0, 50)}...`);
      return [];
    }

    const response = await fetch(searchUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: searchQuery,
        pageSize: limit,
        offsetMark: '*',
      }),
    });

    if (!response.ok) {
      throw new Error(`GovInfo API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const documents: GovInfoDocument[] = data.results || [];

    console.log(`[GovInfo] API returned ${data.count || 0} total reports, fetched ${documents.length}`);

    console.log(`[GovInfo] Found ${documents.length} GAO documents`);

    for (const doc of documents) {
      // Extract agency mentions from title and metadata
      const agencies = extractAgenciesFromTitle(doc.title);

      for (const agency of agencies.length > 0 ? agencies : ['General Government']) {
        results.push({
          agency_name: agency,
          intelligence_type: 'gao_high_risk',
          title: doc.title,
          description: `GAO Report: ${doc.title}`,
          source_name: 'GovInfo API',
          source_url: `https://www.govinfo.gov/app/details/${doc.packageId}`,
          source_document: doc.packageId,
          publication_date: doc.dateIssued,
          fiscal_year: fiscalYear,
          keywords: extractKeywords(doc.title),
        });
      }
    }
  } catch (error) {
    console.error('[GovInfo] Error fetching GAO reports:', error);
  }

  return results;
}

/**
 * Fetch budget documents from GovInfo
 * Note: GovInfo /search requires POST method, not GET
 */
export async function fetchBudgetDocuments(
  options: FetcherOptions = {}
): Promise<AgencyIntelligence[]> {
  const { fiscalYear = new Date().getFullYear(), limit = 50, dryRun = false } = options;

  if (!GOVINFO_API_KEY) {
    return [];
  }

  const results: AgencyIntelligence[] = [];

  try {
    // GovInfo /search endpoint requires POST with JSON body
    const searchUrl = `${GOVINFO_API_BASE}/search?api_key=${GOVINFO_API_KEY}`;
    const searchQuery = `collection:BUDGET AND ("congressional justification" OR "budget request" OR "appropriations")`;

    console.log(`[GovInfo] Fetching budget documents for FY${fiscalYear}...`);

    if (dryRun) {
      console.log(`[GovInfo] Dry run - would fetch budget docs`);
      return [];
    }

    const response = await fetch(searchUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: searchQuery,
        pageSize: limit,
        offsetMark: '*',
      }),
    });

    if (!response.ok) {
      throw new Error(`GovInfo API error: ${response.status}`);
    }

    const data = await response.json();
    const documents = data.results || [];

    console.log(`[GovInfo] API returned ${data.count || 0} budget docs, fetched ${documents.length}`);

    for (const doc of documents) {
      const agencies = extractAgenciesFromTitle(doc.title);

      for (const agency of agencies.length > 0 ? agencies : ['Executive Branch']) {
        results.push({
          agency_name: agency,
          intelligence_type: 'budget_priority',
          title: `FY${fiscalYear} Budget: ${doc.title}`,
          description: doc.title,
          source_name: 'GovInfo API',
          source_url: `https://www.govinfo.gov/app/details/${doc.packageId}`,
          source_document: doc.packageId,
          publication_date: doc.dateIssued,
          fiscal_year: fiscalYear,
        });
      }
    }
  } catch (error) {
    console.error('[GovInfo] Error fetching budget documents:', error);
  }

  return results;
}

// Helper functions

function extractAgenciesFromTitle(title: string): string[] {
  const agencies: string[] = [];
  const titleLower = title.toLowerCase();

  for (const [key, canonical] of Object.entries(AGENCY_MAPPINGS)) {
    if (titleLower.includes(key.toLowerCase())) {
      if (!agencies.includes(canonical)) {
        agencies.push(canonical);
      }
    }
  }

  // Additional pattern matching
  const patterns = [
    /Department of (\w+)/gi,
    /(\w+) Agency/gi,
  ];

  for (const pattern of patterns) {
    const matches = title.matchAll(pattern);
    for (const match of matches) {
      const agency = match[0];
      if (!agencies.includes(agency) && agency.length > 5) {
        agencies.push(agency);
      }
    }
  }

  return agencies;
}

function extractKeywords(title: string): string[] {
  const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'is', 'are', 'was', 'were']);

  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(word => word.length > 3 && !stopWords.has(word))
    .slice(0, 10);
}

export default {
  fetchGAOReports,
  fetchBudgetDocuments,
};
