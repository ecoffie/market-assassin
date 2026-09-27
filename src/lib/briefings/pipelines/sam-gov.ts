/**
 * SAM.gov Opportunities Pipeline
 *
 * Fetches opportunities from SAM.gov API based on user's watchlist.
 * Returns solicitations, due dates, set-asides, and amendments.
 *
 * NEW: Can now query from local Supabase cache (sam_opportunities table)
 * instead of hitting the API with rate limits.
 */

import { getReadClient } from '@/lib/supabase/server-clients';
import { CURATED_EXACT_CODES } from '@/lib/utils/naics-expansion';
import { sanitizeKeywords, distinctiveKeywords } from '@/lib/market/keyword-sanitize';
import {
  filterMarketToSavedIndustry,
  keywordIncludeTerms,
  preferDistinctiveInOpenMarket,
  keywordEvidence,
  scoreKeywordEvidence,
  hasKeywordSupport,
  type KeywordEvidence,
  type OpenKeywordOutcome,
} from '@/lib/alerts/open-contract-d';
import { matchProfileAgencies } from '@/lib/alerts/agency-match';
// Aliased: this file already has a LOCAL classifyNoticeType (summary buckets).
// This is the authoritative RESPONDABILITY classifier ('bid'|'response'|'none').
import { classifyNoticeType as classifyRespondability, type Respondability } from '@/lib/utils/notice-type';

// Initialize Supabase client for cached opportunities.
// READ REPLICA (Resilience Phase 1): this module ONLY reads sam_opportunities
// (verified: zero writes), and it's the single heaviest read in the app —
// daily-alerts calls it for 150 users × 4/day. So it's the ideal first path to
// route at the read replica: getReadClient() uses SUPABASE_REPLICA_URL when set,
// else falls back to the primary (a no-op until a replica is provisioned). The
// route's OWN client (alert_log reads + writes) stays on the primary, untouched.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = supabaseUrl && supabaseKey ? getReadClient() : null;

interface SAMOpportunity {
  noticeId: string;
  title: string;
  solicitationNumber: string;
  naicsCode: string;
  classificationCode: string; // PSC
  description: string;

  // Agency info
  department: string;
  subTier: string;
  office: string;

  // Dates
  postedDate: string;
  responseDeadline: string;
  archiveDate: string;

  // Set-aside
  setAside: string | null;
  setAsideDescription: string | null;

  // Type and status
  noticeType: string; // 'Solicitation', 'Combined Synopsis/Solicitation', etc.
  active: boolean;

  // Location
  placeOfPerformance: {
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
  } | null;

  // Links
  uiLink: string;

  // Tracking
  lastModifiedDate: string;
}

interface SAMSearchParams {
  naicsCodes?: string[];
  pscCodes?: string[]; // Product/Service Classification codes
  agencies?: string[];
  keywords?: string[];
  zipCodes?: string[];
  setAsides?: string[];
  postedFrom?: string; // ISO date
  postedTo?: string;
  limit?: number;
  // Opportunity types: p=presolicitation, r=sources sought, k=combined, o=solicitation
  noticeTypes?: string[];
  state?: string; // Single state code (legacy)
  states?: string[]; // Multiple state codes for expanded search
  /** Saved NAICS market. PSC recall cannot escape this set. */
  savedNaics?: string[];
  /**
   * Keyword-scan path only: return EVERY preferred row (bounded by MAX_PREFER_SCAN_ROWS)
   * instead of the first `limit` by deadline, so the caller can apply eligibility and
   * ranking before its own final cut. Ignored on the no-keyword path.
   */
  keepAllPreferred?: boolean;
}

const DESCRIPTION_STOP_WORDS = new Set([
  'about', 'after', 'also', 'and', 'are', 'business', 'company', 'does', 'for',
  'from', 'government', 'help', 'into', 'our', 'provide', 'provides', 'providing',
  'services', 'support', 'that', 'the', 'their', 'this', 'through', 'with', 'your',
]);

function extractDescriptionTerms(description?: string | null): string[] {
  if (!description) return [];

  return Array.from(new Set(
    description
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .map(term => term.trim())
      .filter(term => term.length >= 4 && !DESCRIPTION_STOP_WORDS.has(term))
  )).slice(0, 20);
}

interface SAMSearchResult {
  opportunities: SAMOpportunity[];
  totalRecords: number;
  keywordMatchCount?: number;
  distinctiveMatchCount?: number;
  openKeywordOutcome?: OpenKeywordOutcome;
  /** Rows of the NAICS/PSC market examined before keyword preference (keyword profiles only). */
  marketRowsScanned?: number;
  /** True when the market exceeded MAX_PREFER_SCAN_ROWS — keyword matches past it were not examined. */
  scanTruncated?: boolean;
  fetchedAt: string;
  /**
   * Did the cache query itself succeed? Set by fetchSamOpportunitiesFromCache only.
   * 'error' means `opportunities: []` is UNKNOWN, not an empty market — a statement
   * timeout used to be logged as "no opportunities" (match-health audit 2026-10-06).
   * Absent on results from other producers (live API), which is treated as 'ok'.
   */
  queryStatus?: 'ok' | 'error';
  queryError?: { code?: string | null; message: string };
}

/**
 * Bound on how much of a NAICS/PSC market is read to find keyword matches.
 * Keyword preference used to run on the first `limit` (200) rows ordered by
 * deadline, so any match past row 200 was discarded before it was ever checked —
 * on one real profile (780-row market) 57 of 78 keyword matches. Reading the
 * whole market fixes that; this cap only exists so a pathological market cannot
 * turn one alert into an unbounded scan, and hitting it is reported
 * (`scanTruncated`), never silent.
 */
export const MAX_PREFER_SCAN_ROWS = 4000;
const PREFER_SCAN_PAGE = 1000;

interface SAMNoticeSummary {
  totalMatched: number;
  rfp: number;
  rfq: number;
  sourcesSought: number;
  preSol: number;
  combined: number;
  other: number;
  /**
   * false when a page failed: the counts above are a PARTIAL tally (or zero) of an
   * unknown total and must not be presented as the market's size. Absent = complete.
   */
  complete?: boolean;
}

interface SAMRawOpportunity {
  noticeId?: string;
  title?: string;
  solicitationNumber?: string;
  naicsCode?: string;
  classificationCode?: string;
  description?: string;
  department?: { name?: string };
  fullParentPathName?: string;
  subtierAgency?: { name?: string };
  office?: { name?: string };
  officeAddress?: { city?: string; state?: string; zip?: string; country?: string };
  postedDate?: string;
  responseDeadLine?: string;
  responseDeadline?: string;
  archiveDate?: string;
  typeOfSetAside?: string | null;
  typeOfSetAsideDescription?: string | null;
  type?: string;
  noticeType?: string;
  active?: boolean | string;
  placeOfPerformance?: {
    city?: { name?: string };
    state?: { code?: string };
    zip?: string;
    country?: { code?: string };
  } | null;
  uiLink?: string;
  lastModifiedDate?: string;
  [key: string]: unknown;
}

interface SAMCacheOpportunityRow {
  notice_id: string;
  title: string;
  solicitation_number: string | null;
  naics_code: string | null;
  psc_code: string | null;
  description: string | null;
  department: string | null;
  sub_tier: string | null;
  office: string | null;
  posted_date: string | null;
  response_deadline: string | null;
  archive_date: string | null;
  set_aside_code: string | null;
  set_aside_description: string | null;
  notice_type: string | null;
  active: boolean;
  pop_city: string | null;
  pop_state: string | null;
  pop_zip: string | null;
  pop_country: string | null;
  ui_link: string | null;
  last_modified: string | null;
}

interface SAMCacheNoticeSummaryRow {
  notice_type: string | null;
  title: string | null;
  description: string | null;
}

// SAM.gov API base URL
const SAM_API_BASE = 'https://api.sam.gov/opportunities/v2';

// Map our set-aside codes to SAM.gov codes
const setAsideMapping: Record<string, string> = {
  'SBA': 'SBA',
  'SBP': 'SBP',
  '8A': '8A',
  'HUBZone': 'HZC',
  'WOSB': 'WOSB',
  'EDWOSB': 'EDWOSB',
  'SDVOSB': 'SDVOSBC',
  'VOSB': 'VSB',
};

/**
 * Fetch opportunities for a single NAICS code from SAM.gov API
 */
async function fetchSingleNaicsOpportunities(
  naicsCode: string,
  baseParams: URLSearchParams,
  apiKey: string,
  skipNaicsFilter = false
): Promise<SAMOpportunity[]> {
  const queryParams = new URLSearchParams(baseParams);
  // CRITICAL: Trim apiKey to remove any trailing newlines from env var
  queryParams.set('api_key', apiKey.trim());
  // Use 'naics' parameter (not 'ncode') to match SAM.gov MCP server that works
  // NOTE: SAM.gov doesn't reliably filter by NAICS, but we include it anyway
  if (!skipNaicsFilter && naicsCode) {
    queryParams.set('naics', naicsCode);
  }

  const url = `${SAM_API_BASE}/search?${queryParams.toString()}`;
  console.log(`[SAM.gov DEBUG] Built URL: ${url.replace(apiKey, 'SAM-***')}`);
  console.log(`[SAM.gov DEBUG] Base params:`, Object.fromEntries(baseParams.entries()));

  try {
    console.log(`[SAM.gov DEBUG] Starting fetch for NAICS ${naicsCode || 'ALL'}...`);
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(30000),
    });

    console.log(`[SAM.gov DEBUG] Response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unable to read error');
      console.error(`[SAM.gov] Error for NAICS ${naicsCode}: ${response.status} - ${errorText.substring(0, 500)}`);
      return [];
    }

    const responseText = await response.text();
    console.log(`[SAM.gov DEBUG] Response length: ${responseText.length}`);
    console.log(`[SAM.gov DEBUG] Response preview: ${responseText.substring(0, 200)}`);

    let data;
    try {
      data = JSON.parse(responseText) as { opportunitiesData?: SAMRawOpportunity[], totalRecords?: number };
    } catch (parseError) {
      console.error(`[SAM.gov DEBUG] JSON parse error:`, parseError);
      console.error(`[SAM.gov DEBUG] Raw response: ${responseText.substring(0, 500)}`);
      return [];
    }

    const opps = data.opportunitiesData || [];
    console.log(`[SAM.gov DEBUG] NAICS ${naicsCode || 'ALL'}: returned ${opps.length} opps (total: ${data.totalRecords || 'unknown'})`);
    return opps.map((opp) => parseOpportunity(opp));
  } catch (error) {
    console.error(`[SAM.gov DEBUG] Error fetching NAICS ${naicsCode}:`, error);
    return [];
  }
}

/**
 * Parse raw SAM.gov opportunity into our interface
 */
function parseOpportunity(opp: SAMRawOpportunity): SAMOpportunity {
  return {
    noticeId: opp.noticeId || '',
    title: opp.title || '',
    solicitationNumber: opp.solicitationNumber || '',
    naicsCode: opp.naicsCode || '',
    classificationCode: opp.classificationCode || '',
    description: opp.description || '',
    department: opp.department?.name || opp.fullParentPathName?.split('.')[0] || '',
    subTier: opp.subtierAgency?.name || '',
    office: opp.office?.name || opp.officeAddress?.city || '',
    postedDate: opp.postedDate || '',
    responseDeadline: opp.responseDeadLine || opp.responseDeadline || '',
    archiveDate: opp.archiveDate || '',
    setAside: opp.typeOfSetAside || null,
    setAsideDescription: opp.typeOfSetAsideDescription || null,
    noticeType: opp.type || opp.noticeType || '',
    active: opp.active === 'Yes' || opp.active === true,
    placeOfPerformance: opp.placeOfPerformance ? {
      city: opp.placeOfPerformance.city?.name,
      state: opp.placeOfPerformance.state?.code,
      zip: opp.placeOfPerformance.zip,
      country: opp.placeOfPerformance.country?.code,
    } : null,
    uiLink: opp.uiLink || `https://sam.gov/opp/${opp.noticeId}/view`,
    lastModifiedDate: opp.lastModifiedDate || opp.postedDate || '',
  };
}

/**
 * Fetch opportunities from SAM.gov API
 * Handles multiple NAICS codes by making parallel requests and merging results
 */
export async function fetchSamOpportunities(
  params: SAMSearchParams,
  apiKey: string
): Promise<SAMSearchResult> {
  const {
    naicsCodes = [],
    keywords = [],
    zipCodes = [],
    setAsides = [],
    postedFrom,
    postedTo,
    limit = 100,
    noticeTypes = [],
    state,
    states,
  } = params;

  console.log(`[SAM.gov DEBUG] Input params:`, JSON.stringify({
    naicsCodes: naicsCodes.slice(0, 5),
    postedFrom,
    postedTo,
    limit,
    apiKeyPresent: !!apiKey,
    apiKeyPrefix: apiKey ? apiKey.substring(0, 15) : 'NONE',
  }));

  // Build base query parameters (without NAICS - we'll add per-request)
  const baseParams = new URLSearchParams();
  baseParams.set('limit', String(Math.min(limit, 50))); // Cap per-request to 50
  // SAM.gov requires MM/dd/yyyy format - convert if passed in ISO format (YYYY-MM-DD)
  const convertedPostedFrom = postedFrom ? convertToSAMDateFormat(postedFrom) : getDefaultPostedFrom();
  const convertedPostedTo = postedTo ? convertToSAMDateFormat(postedTo) : getTodayDate();
  baseParams.set('postedFrom', convertedPostedFrom);
  baseParams.set('postedTo', convertedPostedTo);

  console.log(`[SAM.gov DEBUG] Date conversion:`, JSON.stringify({
    inputPostedFrom: postedFrom,
    inputPostedTo: postedTo,
    convertedPostedFrom,
    convertedPostedTo,
  }));

  // Add keywords — SANITIZED (#61): drop short/ambiguous abbreviations that
  // produce noise in title/description search (Eric: "OTA" → potable/rota/total).
  // A user who saved a 3-char keyword shouldn't get junk in their alerts.
  const safeKeywords = sanitizeKeywords(keywords);
  if (safeKeywords.length > 0) {
    baseParams.set('q', safeKeywords.join(' OR '));
  }

  // Add set-asides
  if (setAsides.length > 0) {
    const samSetAsides = setAsides.map(s => setAsideMapping[s] || s).join(',');
    baseParams.set('typeOfSetAside', samSetAsides);
  }

  // Add place of performance
  if (zipCodes.length > 0) {
    baseParams.set('poplace', zipCodes.join(','));
  }

  // State filter - support multiple states for expanded coverage
  // SAM.gov API supports comma-separated state codes
  const stateList = states || (state ? [state] : []);
  if (stateList.length > 0) {
    baseParams.set('state', stateList.join(','));
    console.log(`[SAM.gov] State filter: ${stateList.join(', ')}`);
  }

  // Add notice types
  if (noticeTypes.length > 0) {
    baseParams.set('ptype', noticeTypes.join(','));
  }

  console.log(`[SAM.gov] Fetching opportunities for ${naicsCodes.length} NAICS codes: ${naicsCodes.slice(0, 10).join(', ')}${naicsCodes.length > 10 ? '...' : ''}`);

  // SAM.gov API does NOT support comma-separated NAICS codes (returns 0 results)
  // We must make PARALLEL requests for each NAICS code and merge results
  if (naicsCodes.length === 0) {
    console.log('[SAM.gov] No NAICS codes provided');
    return { opportunities: [], totalRecords: 0, fetchedAt: new Date().toISOString() };
  }

  // Make parallel requests for each NAICS code (limit to 10 to balance coverage vs rate limits)
  // Rate limit: 10 requests/minute, 1000/day - fetching 10 codes is safe
  const codesToFetch = naicsCodes.slice(0, 10);
  console.log(`[SAM.gov] Making ${codesToFetch.length} parallel requests for: ${codesToFetch.join(', ')}`);

  const results = await Promise.all(
    codesToFetch.map(code => fetchSingleNaicsOpportunities(code, baseParams, apiKey))
  );

  // Merge and deduplicate by noticeId
  const seenIds = new Set<string>();
  const allOpportunities: SAMOpportunity[] = [];

  for (const opportunities of results) {
    for (const opp of opportunities) {
      if (!seenIds.has(opp.noticeId)) {
        // NOTE: SAM.gov API doesn't reliably filter by NAICS, so we used to do client-side filtering here.
        // However, this resulted in 0 results because SAM.gov returns unrelated NAICS codes.
        // For now, we trust the API and show all results. TODO: Investigate SAM.gov ncode parameter.
        // If user has specific NAICS, they're likely interested in these active opportunities anyway.
        seenIds.add(opp.noticeId);
        allOpportunities.push(opp);
      }
    }
  }

  console.log(`[SAM.gov] Retrieved ${allOpportunities.length} unique opportunities from ${codesToFetch.length} NAICS codes`);

  // FALLBACK: If NAICS-filtered requests return 0 results, fetch without NAICS filter
  // This ensures users always get some opportunities to act on
  if (allOpportunities.length === 0) {
    console.log(`[SAM.gov] NAICS-filtered requests returned 0 results. Fetching without NAICS filter as fallback...`);
    try {
      const fallbackOpportunities = await fetchSingleNaicsOpportunities('', baseParams, apiKey, true);
      console.log(`[SAM.gov] Fallback returned ${fallbackOpportunities.length} opportunities`);
      return {
        opportunities: fallbackOpportunities.slice(0, limit),
        totalRecords: fallbackOpportunities.length,
        fetchedAt: new Date().toISOString(),
      };
    } catch (err) {
      console.error('[SAM.gov] Fallback fetch error:', err);
    }
  }

  return {
    opportunities: allOpportunities.slice(0, limit),
    totalRecords: allOpportunities.length,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Fetch opportunities for a specific user's watchlist
 */
export async function fetchOpportunitiesForUser(
  userProfile: {
    naics_codes: string[];
    agencies: string[];
    keywords: string[];
    zip_codes: string[];
    location_state?: string | null;
    location_states?: string[] | null;
  },
  apiKey: string
): Promise<SAMSearchResult> {
  // Build search params from user profile
  // Expanded limits for better opportunity coverage
  const params: SAMSearchParams = {
    naicsCodes: userProfile.naics_codes?.slice(0, 15) || [], // Expanded from 10 to 15
    keywords: userProfile.keywords?.slice(0, 10) || [], // Expanded from 5 to 10
    zipCodes: userProfile.zip_codes?.slice(0, 5) || [], // Expanded from 3 to 5
    state: userProfile.location_state || undefined,
    states: userProfile.location_states?.slice(0, 10) || undefined,
    // Posted in last 30 days for better coverage
    postedFrom: getDateDaysAgo(30),
    limit: 300, // Increased from 200
  };

  return fetchSamOpportunities(params, apiKey);
}

/**
 * Compare two snapshots and identify changes
 */
export function diffOpportunities(
  today: SAMOpportunity[],
  yesterday: SAMOpportunity[]
): {
  new: SAMOpportunity[];
  modified: Array<{
    opportunity: SAMOpportunity;
    changes: string[];
  }>;
  closed: SAMOpportunity[];
} {
  const yesterdayMap = new Map(yesterday.map(o => [o.noticeId, o]));
  const todayMap = new Map(today.map(o => [o.noticeId, o]));

  // NEW: in today but not yesterday
  const newOpps = today.filter(o => !yesterdayMap.has(o.noticeId));

  // MODIFIED: in both but changed
  const modified: Array<{ opportunity: SAMOpportunity; changes: string[] }> = [];
  for (const opp of today) {
    const prev = yesterdayMap.get(opp.noticeId);
    if (!prev) continue;

    const changes: string[] = [];

    // Check for deadline change
    if (opp.responseDeadline !== prev.responseDeadline) {
      changes.push(`deadline_changed: ${prev.responseDeadline} → ${opp.responseDeadline}`);
    }

    // Check for set-aside change
    if (opp.setAside !== prev.setAside) {
      changes.push(`setaside_changed: ${prev.setAside || 'none'} → ${opp.setAside || 'none'}`);
    }

    // Check for modification (last modified date changed)
    if (opp.lastModifiedDate !== prev.lastModifiedDate) {
      changes.push('amendment_posted');
    }

    // Check for title change (scope change indicator)
    if (opp.title !== prev.title) {
      changes.push('title_changed');
    }

    if (changes.length > 0) {
      modified.push({ opportunity: opp, changes });
    }
  }

  // CLOSED: in yesterday but not today, or active changed to false
  const closed = yesterday.filter(o => {
    const current = todayMap.get(o.noticeId);
    return !current || !current.active;
  });

  return { new: newOpps, modified, closed };
}

// Set-aside categories that require a specific certification on the user's profile.
// Keys are normalized profile tokens (uppercase, no parens/spaces); values are
// substrings to look for in opportunity.setAside or opportunity.setAsideDescription.
const CERT_REQUIRED_SET_ASIDES: Record<string, string[]> = {
  SDVOSB: ['SDVOSB', 'SERVICE-DISABLED VETERAN'],
  VOSB: ['VOSB', 'VETERAN-OWNED', 'VETERAN OWNED'],
  '8A': ['8(A)', '8A'],
  WOSB: ['WOSB', 'WOMEN-OWNED', 'WOMEN OWNED'],
  EDWOSB: ['EDWOSB', 'ECONOMICALLY DISADVANTAGED WOMEN'],
  HUBZONE: ['HUBZONE', 'HZC'],
  TRIBAL: ['TRIBAL', 'INDIAN-OWNED', 'NATIVE-OWNED'],
};

// Notice types that should stay visible as research signals even when set-aside fit is weak.
// Matches noticeType strings used by SAM.gov (sources sought, RFI, special notice).
function isResearchNotice(noticeType: string | null | undefined): boolean {
  if (!noticeType) return false;
  const t = noticeType.toLowerCase();
  return t.includes('sources sought') || t.includes('rfi') || t.includes('special notice');
}

function normalizeSetAsideToken(value: string): string {
  return value.toUpperCase().replace(/[()\s.-]/g, '');
}

// Returns the set of normalized certification tokens the user holds.
function getUserCertifications(profile: { setAsides?: string[]; business_type?: string | null }): Set<string> {
  const tokens = new Set<string>();
  for (const raw of profile.setAsides ?? []) {
    if (raw) tokens.add(normalizeSetAsideToken(raw));
  }
  if (profile.business_type) tokens.add(normalizeSetAsideToken(profile.business_type));
  return tokens;
}

// Returns the cert tokens an opportunity *requires* (e.g. ['WOSB'] for a WOSB set-aside).
// Empty array means full-and-open / Total Small Business / unknown — no cert needed.
function getOpportunityRequiredCerts(opportunity: SAMOpportunity): string[] {
  const haystack = `${opportunity.setAside ?? ''} ${opportunity.setAsideDescription ?? ''}`.toUpperCase();
  const required: string[] = [];
  for (const [cert, needles] of Object.entries(CERT_REQUIRED_SET_ASIDES)) {
    if (needles.some(n => haystack.includes(n))) required.push(cert);
  }
  return required;
}

function isTotalSmallBusiness(opportunity: SAMOpportunity): boolean {
  const haystack = `${opportunity.setAside ?? ''} ${opportunity.setAsideDescription ?? ''}`.toUpperCase();
  return /TOTAL SMALL BUSINESS|SBA\b|SBP\b|SMALL BUSINESS SET-?ASIDE/.test(haystack);
}

const VETERAN_CERTS = new Set(['SDVOSB', 'VOSB', 'VETERAN', 'VETERANOWNED', 'SERVICEDISABLEDVETERAN']);
function isVeteranProfile(certs: Set<string>): boolean {
  for (const c of certs) if (VETERAN_CERTS.has(c)) return true;
  return false;
}

function isVAOpportunity(opportunity: SAMOpportunity): boolean {
  const agency = `${opportunity.department ?? ''} ${opportunity.subTier ?? ''}`.toUpperCase();
  return /VETERANS AFFAIRS|\bVA\b/.test(agency);
}

export interface OpportunityScoreProfile {
  naics_codes: string[];
  agencies: string[];
  keywords: string[];
  business_description?: string | null;
  setAsides?: string[];
  business_type?: string | null;
}

/** Why a notice was selected and ranked — rendered in the alert, never recomputed there. */
export interface OpportunityMatchEvidence {
  naics: 'exact' | 'related' | null;
  keywords: KeywordEvidence;
  /** Profile agencies that name this buyer (anchored — see lib/alerts/agency-match). */
  agencies: string[];
  /** 'keyword' = at least one distinctive keyword found; 'market_only' = NAICS/PSC market with no keyword support. */
  basis: 'keyword' | 'market_only';
  stage: { label: string | null; respondability: Respondability };
}

/**
 * Stage DEMOTION on the RANK only (not the displayed score). A Special Notice
 * ("MTCCS II Ceiling Increase"), Presolicitation or Award has nothing to submit, so
 * it loses 40 rank points.
 *
 * ⚠️ A demotion, not a strict tier: a strongly matched heads-up notice can still
 * outrank a weakly matched biddable one. What prevents it reading as biddable is the
 * stage label in the email, not its position (pinned in alert-relevance-case).
 */
const NOT_RESPONDABLE_RANK_PENALTY = 40;

export function scoreOpportunityDetailed(
  opportunity: SAMOpportunity,
  userProfile: OpportunityScoreProfile,
): { score: number; rank: number; evidence: OpportunityMatchEvidence } {
  let score = 0;

  // NAICS match (highest weight)
  let naics: OpportunityMatchEvidence['naics'] = null;
  if (userProfile.naics_codes.includes(opportunity.naicsCode)) {
    score += 40;
    naics = 'exact';
  } else if (opportunity.naicsCode && userProfile.naics_codes.some(n =>
    opportunity.naicsCode.startsWith(n) || n.startsWith(opportunity.naicsCode)
  )) {
    score += 20; // Partial NAICS match
    naics = 'related';
  }

  // Agency match — anchored identity, never a substring ("NIST" ⊄ "ADMINISTRATION").
  const agencies = matchProfileAgencies(userProfile.agencies, opportunity.department, opportunity.subTier);
  if (agencies.length > 0) score += 30;

  // Keyword evidence — title ≫ description, capped so boilerplate cannot stack.
  const kw = keywordEvidence(opportunity.title, opportunity.description, userProfile.keywords);
  score += scoreKeywordEvidence(kw);

  const oppText = `${opportunity.title} ${opportunity.description}`;
  // Business description semantic-lite ranking.
  // Structured filters still decide inclusion; this only nudges ordering.
  const descriptionTerms = extractDescriptionTerms(userProfile.business_description);
  if (descriptionTerms.length > 0) {
    const descriptionMatches = descriptionTerms.filter(term => oppText.toLowerCase().includes(term)).length;
    score += Math.min(descriptionMatches * 3, 15);
  }

  // Deadline urgency (closer = higher score)
  if (opportunity.responseDeadline) {
    const daysUntilDue = getDaysUntil(opportunity.responseDeadline);
    if (daysUntilDue <= 7) {
      score += 15; // Due this week
    } else if (daysUntilDue <= 14) {
      score += 10; // Due in two weeks
    } else if (daysUntilDue <= 30) {
      score += 5; // Due this month
    }
  }

  // Set-aside scoring — replaces the old flat +10 "any set-aside" bonus.
  const userCerts = getUserCertifications(userProfile);
  const requiredCerts = getOpportunityRequiredCerts(opportunity);
  const research = isResearchNotice(opportunity.noticeType);

  if (requiredCerts.length === 0) {
    // No specific cert required — small Total Small Business / SBA / SBP bonus
    if (isTotalSmallBusiness(opportunity) && userCerts.size > 0) {
      score += 15;
    } else if (opportunity.setAside && !/^none$/i.test(opportunity.setAside)) {
      // Generic set-aside (e.g. Full and Open with preference) — small nudge.
      // 'NONE' is SAM's literal for NO set-aside and earns nothing.
      score += 5;
    }
  } else {
    const userHasMatchingCert = requiredCerts.some(c => userCerts.has(c));
    if (userHasMatchingCert) {
      score += 20; // Direct cert match — strong boost
    } else if (!research) {
      score -= 25; // Cert required, user doesn't have it — strong penalty
    }
    // Research notices with mismatched set-asides: no change (stay visible)
  }

  // VA downrank for non-veteran profiles (research notices exempt).
  if (isVAOpportunity(opportunity) && !isVeteranProfile(userCerts) && !research) {
    score -= 15;
  }

  const stage = classifyRespondability(opportunity.noticeType, opportunity.title);
  const rank = score - (stage.respondability === 'none' ? NOT_RESPONDABLE_RANK_PENALTY : 0);

  return {
    // Displayed score stays 0–100. Ordering uses the UNCLAMPED rank: clamping
    // was what tied 6 of 7 notices at 100 and left the order to the deadline.
    score: Math.max(0, Math.min(score, 100)),
    rank,
    evidence: {
      naics,
      keywords: kw,
      agencies,
      basis: hasKeywordSupport(kw) ? 'keyword' : 'market_only',
      stage: { label: stage.label, respondability: stage.respondability },
    },
  };
}

/**
 * Score an opportunity for relevance to user's profile (0–100, for display).
 *
 * Set-aside and agency ranking follow the rules in
 * docs/TODO-mindy-app-completion.md §5 ("Profile And Ranking Quality"):
 * - Boost Total Small Business / SB-friendly matches for users with any cert
 * - Penalize special set-asides (SDVOSB/VOSB/8a/WOSB/EDWOSB/HUBZone/Tribal)
 *   when the user doesn't hold that certification
 * - Downrank VA opportunities for non-veteran profiles (Sources Sought/RFI/
 *   Special Notice exempt — they stay visible as research signals)
 *
 * Sort by scoreOpportunityDetailed().rank, not this: the clamp makes ties.
 */
export function scoreOpportunity(
  opportunity: SAMOpportunity,
  userProfile: OpportunityScoreProfile,
): number {
  return scoreOpportunityDetailed(opportunity, userProfile).score;
}

// Helper functions
// SAM.gov API requires MM/dd/yyyy format
function formatDateForSAM(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const year = date.getFullYear();
  return `${month}/${day}/${year}`;
}

// Convert any date format to SAM.gov MM/dd/yyyy format
function convertToSAMDateFormat(dateString: string): string {
  // If already in MM/dd/yyyy format, return as-is
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateString)) {
    return dateString;
  }
  // Convert from ISO format (YYYY-MM-DD) or any parseable format
  const date = new Date(dateString);
  if (isNaN(date.getTime())) {
    // Invalid date, return default (30 days ago)
    return getDefaultPostedFrom();
  }
  return formatDateForSAM(date);
}

function getTodayDate(): string {
  return formatDateForSAM(new Date());
}

function getDefaultPostedFrom(): string {
  // Default to 30 days ago
  return getDateDaysAgo(30);
}

function getDateDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return formatDateForSAM(date);
}

function getDaysUntil(dateString: string): number {
  const target = new Date(dateString);
  const today = new Date();
  const diff = target.getTime() - today.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

/**
 * Search SAM.gov for RFI/Sources Sought/Pre-Solicitation related to a contract
 *
 * This searches for early-stage acquisition activity that might indicate
 * a recompete is being planned. We search by:
 * - NAICS code
 * - Agency name keywords
 * - Incumbent company name
 * - Contract-related keywords
 *
 * Notice types: p=presolicitation, r=sources sought, k=combined
 */
export interface RelatedOpportunitySearch {
  naicsCode: string;
  agency: string;
  incumbentName?: string;
  keywords?: string[];
  lookbackDays?: number; // How far back to search (default 180 days)
}

export interface RelatedOpportunityResult {
  found: boolean;
  opportunities: SAMOpportunity[];
  summary: {
    totalFound: number;
    sourcesSought: number;
    presolicitation: number;
    rfis: number;
    solicitations: number;
  };
  searchedAt: string;
  lookbackDays: number;
}

/**
 * Search SAM.gov for RFI/Sources Sought/Pre-Sol activity related to a contract
 *
 * This provides VERIFIED data from SAM.gov instead of relying on AI web search.
 */
export async function searchRelatedOpportunities(
  params: RelatedOpportunitySearch,
  apiKey: string
): Promise<RelatedOpportunityResult> {
  const { naicsCode, agency, keywords = [], lookbackDays = 180 } = params;

  const SAM_API_BASE = 'https://api.sam.gov/opportunities/v2';

  // Build search keywords from agency and custom terms
  const searchTerms: string[] = [];

  // Add agency keywords (extract key words from agency name)
  const agencyWords = agency.toLowerCase()
    .replace(/department of|dept of|u\.s\.|us |agency|office|admin|administration/gi, '')
    .split(/\s+/)
    .filter(w => w.length > 2);
  searchTerms.push(...agencyWords.slice(0, 2));

  // Add any custom keywords
  searchTerms.push(...keywords);

  // Build query string
  const query = searchTerms.length > 0 ? searchTerms.join(' OR ') : '';

  // Calculate date range
  const postedFrom = new Date();
  postedFrom.setDate(postedFrom.getDate() - lookbackDays);
  const postedFromStr = formatDateForSAM(postedFrom);
  const postedToStr = formatDateForSAM(new Date());

  // Build URL with notice types for early-stage activity
  // p = presolicitation, r = sources sought, k = combined, s = special notice
  const queryParams = new URLSearchParams({
    api_key: apiKey,
    ncode: naicsCode,
    ptype: 'p,r,k,s', // presol, sources sought, combined, special notice
    postedFrom: postedFromStr,
    postedTo: postedToStr,
    limit: '50',
  });

  if (query) {
    queryParams.set('q', query);
  }

  const url = `${SAM_API_BASE}/search?${queryParams.toString()}`;

  console.log(`[SAM.gov] Searching related opps for NAICS ${naicsCode}, agency: ${agency}, lookback: ${lookbackDays} days`);

  try {
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      console.error(`[SAM.gov] Related search error: ${response.status}`);
      return {
        found: false,
        opportunities: [],
        summary: { totalFound: 0, sourcesSought: 0, presolicitation: 0, rfis: 0, solicitations: 0 },
        searchedAt: new Date().toISOString(),
        lookbackDays,
      };
    }

    const data = await response.json() as { opportunitiesData?: SAMRawOpportunity[] };
    const opportunities = (data.opportunitiesData || []).map((opp) => parseOpportunity(opp));

    // Categorize by notice type
    const summary = {
      totalFound: opportunities.length,
      sourcesSought: opportunities.filter((o: SAMOpportunity) =>
        o.noticeType.toLowerCase().includes('sources sought') || o.noticeType === 'r'
      ).length,
      presolicitation: opportunities.filter((o: SAMOpportunity) =>
        o.noticeType.toLowerCase().includes('presol') || o.noticeType === 'p'
      ).length,
      rfis: opportunities.filter((o: SAMOpportunity) =>
        o.title.toLowerCase().includes('rfi') ||
        o.description?.toLowerCase().includes('request for information')
      ).length,
      solicitations: opportunities.filter((o: SAMOpportunity) =>
        o.noticeType.toLowerCase().includes('solicitation') &&
        !o.noticeType.toLowerCase().includes('presol')
      ).length,
    };

    console.log(`[SAM.gov] Found ${summary.totalFound} related opps: ${summary.sourcesSought} sources sought, ${summary.presolicitation} presol, ${summary.rfis} RFIs`);

    return {
      found: opportunities.length > 0,
      opportunities,
      summary,
      searchedAt: new Date().toISOString(),
      lookbackDays,
    };
  } catch (error) {
    console.error('[SAM.gov] Related search error:', error);
    return {
      found: false,
      opportunities: [],
      summary: { totalFound: 0, sourcesSought: 0, presolicitation: 0, rfis: 0, solicitations: 0 },
      searchedAt: new Date().toISOString(),
      lookbackDays,
    };
  }
}

/**
 * Fetch opportunities from local Supabase cache (sam_opportunities table)
 *
 * This is MUCH faster than API calls and has no rate limits.
 * Cache is synced daily at 2 AM via /api/cron/sync-sam-opportunities
 *
 * Query strategy:
 * - Match any of the user's NAICS codes (OR logic)
 * - Filter by response deadline (future only)
 * - Order by deadline (urgent first)
 */
/**
 * The #1853 outcome for a failed sam_opportunities read: UNKNOWN, never an empty market.
 * Every error return of the cache fetch goes through this so no path can answer `[]` as "ok".
 */
function samQueryFailed(error: unknown): SAMSearchResult {
  return {
    opportunities: [], totalRecords: 0, fetchedAt: new Date().toISOString(),
    queryStatus: 'error',
    queryError: { code: (error as { code?: string })?.code ?? null, message: String((error as { message?: string })?.message || 'query failed') },
  };
}

export async function fetchSamOpportunitiesFromCache(
  params: SAMSearchParams
): Promise<SAMSearchResult> {
  const {
    naicsCodes = [],
    pscCodes = [],
    keywords = [],
    limit = 100,
    savedNaics,
  } = params;

  if (!supabase) {
    console.error('[SAM Cache] Supabase client not initialized');
    return {
      opportunities: [], totalRecords: 0, fetchedAt: new Date().toISOString(),
      queryStatus: 'error', queryError: { code: 'no_client', message: 'Supabase client not initialized' },
    };
  }

  const searchCriteria = [
    naicsCodes.length > 0 ? `NAICS: ${naicsCodes.slice(0, 3).join(', ')}${naicsCodes.length > 3 ? '...' : ''}` : null,
    pscCodes.length > 0 ? `PSC: ${pscCodes.slice(0, 3).join(', ')}${pscCodes.length > 3 ? '...' : ''}` : null,
    keywords.length > 0 ? `Keywords: ${keywords.slice(0, 2).join(', ')}${keywords.length > 2 ? '...' : ''}` : null,
  ].filter(Boolean);
  console.log(`[SAM Cache] Querying database for ${searchCriteria.join(' | ') || 'all opportunities'}`);

  try {
    // Explicit columns (not select('*')) — avoids pulling the wide raw_data JSONB
    // (~50KB/row) into memory on this hot per-user query. These are exactly the
    // fields the mapper below reads.
    const COLUMNS =
      'notice_id, title, solicitation_number, naics_code, psc_code, description, ' +
      'department, sub_tier, office, posted_date, response_deadline, archive_date, ' +
      'set_aside_code, set_aside_description, notice_type, active, ' +
      'pop_city, pop_state, pop_zip, pop_country, ui_link, last_modified';

    // FILTER BEFORE LIMIT. When keywords will be preferred inside a NAICS/PSC
    // market, read the whole (bounded) market first; the `limit` is applied
    // AFTER preference below. Without keywords, the old single capped query is
    // unchanged — there is nothing to prefer, so the first `limit` rows are the answer.
    const scanWholeMarket =
      distinctiveKeywords(keywords).length > 0 && keywordIncludeTerms(keywords, naicsCodes, pscCodes).length === 0
      && (naicsCodes.length > 0 || pscCodes.length > 0);

    const rows: SAMCacheOpportunityRow[] = [];
    let scanTruncated = false;
    if (scanWholeMarket) {
      // Pages are concatenated with notice_id DE-DUPLICATION. ⚠️ Limitation, stated
      // precisely: the table is synced continuously, so a row whose deadline changes
      // between two page reads can land in both pages (removed here) OR in neither
      // (NOT recoverable here — a row that slid across a page boundary before its page
      // was read is simply not seen this run). De-duplication fixes repeats only; a
      // consistent snapshot would need a single read or a server-side cursor.
      const seenIds = new Set<string>();
      let lastPageFull = false;
      for (let from = 0; from < MAX_PREFER_SCAN_ROWS; from += PREFER_SCAN_PAGE) {
        const { data, error } = await applySamCacheFilters(
          supabase
            .from('sam_opportunities')
            .select(COLUMNS)
            .order('response_deadline', { ascending: true })
            .order('notice_id', { ascending: true }) // stable paging across equal deadlines
            .range(from, Math.min(from + PREFER_SCAN_PAGE, MAX_PREFER_SCAN_ROWS) - 1),
          params
        );
        if (error) {
          // A failed PAGE fails the whole read (#1853): rows already collected are an incomplete
          // market, so they are discarded rather than returned as a smaller "ok" answer.
          console.error('[SAM Cache] Query error:', error);
          return samQueryFailed(error);
        }
        const page = (data || []) as SAMCacheOpportunityRow[];
        for (const r of page) {
          if (seenIds.has(r.notice_id)) continue;
          seenIds.add(r.notice_id);
          rows.push(r);
        }
        lastPageFull = page.length === Math.min(PREFER_SCAN_PAGE, MAX_PREFER_SCAN_ROWS - from);
        if (!lastPageFull) break;
      }
      // A full final page only means the market is AT LEAST the bound. Probe one row
      // past it: exactly MAX_PREFER_SCAN_ROWS rows is a complete scan, not a truncated one
      // (reporting it as truncated would tell the user "your market is larger" — false).
      if (lastPageFull) {
        const { data: beyond, error: beyondErr } = await applySamCacheFilters(
          supabase
            .from('sam_opportunities')
            .select('notice_id')
            .order('response_deadline', { ascending: true })
            .order('notice_id', { ascending: true })
            .range(MAX_PREFER_SCAN_ROWS, MAX_PREFER_SCAN_ROWS),
          params
        );
        // Unknown is not "complete": if the probe fails, disclose possible truncation.
        scanTruncated = beyondErr ? true : ((beyond || []) as unknown[]).length > 0;
      }
      if (scanTruncated) {
        console.warn(`[SAM Cache] market exceeds ${MAX_PREFER_SCAN_ROWS} rows — keyword preference examined the first ${rows.length} by deadline`);
      }
    } else {
      const { data, error } = await applySamCacheFilters(
        supabase
          .from('sam_opportunities')
          .select(COLUMNS)
          .order('response_deadline', { ascending: true })
          .limit(limit),
        params
      );
      if (error) {
        console.error('[SAM Cache] Query error:', error);
        return samQueryFailed(error);
      }
      rows.push(...((data || []) as SAMCacheOpportunityRow[]));
    }

    console.log(`[SAM Cache] Found ${rows.length} opportunities from database${scanWholeMarket ? ' (full market scan for keyword preference)' : ''}`);

    // Transform database records to SAMOpportunity interface
    const opportunities: SAMOpportunity[] = rows.map(row => ({
      noticeId: row.notice_id,
      title: row.title,
      solicitationNumber: row.solicitation_number || '',
      naicsCode: row.naics_code || '',
      classificationCode: row.psc_code || '',
      description: row.description || '',
      department: row.department || '',
      subTier: row.sub_tier || '',
      office: row.office || '',
      postedDate: row.posted_date || '',
      responseDeadline: row.response_deadline || '',
      archiveDate: row.archive_date || '',
      setAside: row.set_aside_code,
      setAsideDescription: row.set_aside_description,
      noticeType: row.notice_type || '',
      active: row.active,
      placeOfPerformance: {
        city: row.pop_city || undefined,
        state: row.pop_state || undefined,
        zip: row.pop_zip || undefined,
        country: row.pop_country || undefined,
      },
      uiLink: row.ui_link || `https://sam.gov/opp/${row.notice_id}/view`,
      lastModifiedDate: row.last_modified || row.posted_date || '',
    }));

    // Respondability gate for NULL-deadline rows. The query now includes
    // deadline-IS-NULL opps (so open Sources Sought / RFIs aren't silently
    // dropped), but ~90% of active null-deadline rows are Award Notices /
    // Justifications — already awarded, nothing to respond to. Keep a
    // null-deadline row ONLY if its notice type is respondable (Sources Sought /
    // RFI / a real solicitation); classifyRespondability defaults unknown/blank
    // types to 'bid' so an un-enriched real solicitation is never wrongly hidden.
    // Dated opps (deadline present) are unaffected — the query already bounded them.
    const runwayGated = opportunities.filter(opp => {
      if (opp.responseDeadline) return true; // has a real future deadline
      return classifyRespondability(opp.noticeType).respondability !== 'none';
    });

    const marketBoundary = savedNaics && savedNaics.length > 0 ? savedNaics : naicsCodes;
    const industry = filterMarketToSavedIndustry(
      runwayGated,
      marketBoundary,
      (opp) => opp.naicsCode,
    );
    if (industry.droppedOffIndustry > 0) {
      console.log(`[SAM Cache] dropped ${industry.droppedOffIndustry} off-saved-market rows (PSC/NAICS expansion)`);
    }

    const preferred = preferDistinctiveInOpenMarket(
      industry.rows,
      keywords,
      (opp) => `${opp.title} ${opp.description}`,
    );
    if (preferred.outcome === 'distinctive_hits') {
      console.log(`[SAM Cache] Contract D distinctive prefer ${preferred.distinctiveMatchCount} of ${industry.rows.length}`);
    } else if (preferred.outcome === 'open_market_no_keyword_hits') {
      console.log(`[SAM Cache] Contract D no distinctive hits in Open market — keeping ${industry.rows.length} NAICS/PSC rows`);
    }

    // `keepAllPreferred`: the caller applies its own eligibility (newness, dedupe) and
    // RANKING and makes the final cut itself. Slicing here by DEADLINE would drop a
    // strong title match at row 201+ of the preferred set before it is ever ranked.
    const keepAll = scanWholeMarket && params.keepAllPreferred === true;
    return {
      opportunities: keepAll ? preferred.rows : preferred.rows.slice(0, limit),
      totalRecords: preferred.rows.length,
      keywordMatchCount: preferred.distinctiveMatchCount,
      distinctiveMatchCount: preferred.distinctiveMatchCount,
      openKeywordOutcome: preferred.outcome,
      marketRowsScanned: scanWholeMarket ? rows.length : undefined,
      scanTruncated: scanWholeMarket ? scanTruncated : undefined,
      fetchedAt: new Date().toISOString(),
      queryStatus: 'ok',
    };
  } catch (error) {
    console.error('[SAM Cache] Error querying cache:', error);
    return {
      opportunities: [], totalRecords: 0, fetchedAt: new Date().toISOString(),
      queryStatus: 'error',
      queryError: { code: 'exception', message: error instanceof Error ? error.message : String(error) },
    };
  }
}

// Supabase query builders use complex fluent generics; keep this helper permissive.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applySamCacheFilters(query: any, params: SAMSearchParams) {
  const {
    naicsCodes = [],
    pscCodes = [],
    setAsides = [],
    state,
    states,
    postedFrom,
    postedTo,
    noticeTypes = [],
  } = params;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let filteredQuery = query as any;

  filteredQuery = filteredQuery.eq('active', true);
  // Runway filter: full now() timestamp (correct — excludes past-deadline opps),
  // OR a NULL deadline. The old `.gte(now)` silently dropped every null-deadline
  // opp (a null never satisfies >=), so open no-deadline Sources Sought / RFIs
  // never reached alerts/briefings/snapshots/dashboard. Include nulls here; the
  // respondability gate in fetchSamOpportunitiesFromCache() then drops the
  // non-respondable nulls (Award Notices / Justifications — already awarded,
  // nothing to respond to) so we surface open RFIs WITHOUT flooding in dead ones.
  const nowIso = new Date().toISOString();
  filteredQuery = filteredQuery.or(`response_deadline.gte.${nowIso},response_deadline.is.null`);

  if (postedFrom) {
    filteredQuery = filteredQuery.gte('posted_date', postedFrom);
  }

  if (postedTo) {
    filteredQuery = filteredQuery.lte('posted_date', postedTo);
  }

  // Contract D: NAICS/PSC is the market. Distinctive keywords prefer AFTER
  // fetch. Generic singles never expand this clause. Keywords enter the
  // query only when the profile has no NAICS and no PSC.
  const keywords = (params.keywords || []).filter(k => k && k.trim().length >= 3).slice(0, 15);
  const whatClauses: string[] = [];

  if (naicsCodes.length > 0) {
    // Widen each code to its 4-digit INDUSTRY GROUP, not the 3-digit subsector.
    // The 4-digit level groups genuinely-similar industries (5617 = ALL building
    // services: pest control, janitorial, landscaping, carpet cleaning). The
    // 3-digit subsector is a grab-bag — 561 also lumps in security guards (5616),
    // office admin (5611) and telemarketing (5614), so a pest-control profile was
    // getting security-camera and call-center alerts. 4-digit keeps the relevant
    // neighbors and drops the cross-industry noise — tighter matching for EVERY
    // tool (daily alerts, briefings, dossier, market dashboard share this filter).
    // A code stored shorter than 4 digits (user typed a 3-digit subsector on
    // purpose) passes through at its own length.
    //
    // EXCEPT for curated codes. The industry picker offers broad buckets, and
    // normalizeNAICSForPersist() maps each to a hand-chosen, DELIBERATELY NON-CONTIGUOUS
    // set: '238' stores [238110, 238120, 238160, 238210, 238220, 238290, 238910, 238990]
    // and SKIPS 238130/238140/238150. Slicing those to 4 digits re-adds exactly the codes a
    // human excluded, so the curation was being undone one layer down.
    //
    // Measured 2026-08-23 on the 541 curated set: the 3 curated codes match 71 active opps;
    // the 4-digit slice matches 139, of which 25 come from 541612/541613/541614 — codes the
    // curation deliberately drops. Roughly double the volume, half of it unwanted.
    //
    // So: a code that came from a curated set stays EXACT. Everything else keeps the 4-digit
    // widen, which is right for a code the user typed themselves.
    const prefixes = new Set<string>();
    const exact = new Set<string>();
    for (const code of naicsCodes) {
      const digits = String(code).replace(/[^\d]/g, '');
      if (digits.length < 2) continue;
      if (digits.length === 6 && CURATED_EXACT_CODES.has(digits)) { exact.add(digits); continue; }
      prefixes.add(digits.length <= 4 ? digits : digits.slice(0, 4));
    }
    for (const prefix of prefixes) whatClauses.push(`naics_code.like.${prefix}%`);
    for (const code of exact) whatClauses.push(`naics_code.eq.${code}`);
  }
  if (pscCodes.length > 0) {
    for (const psc of pscCodes) whatClauses.push(`psc_code.like.${psc}%`);
  }
  const includeKeywords = keywordIncludeTerms(keywords, naicsCodes, pscCodes);
  if (includeKeywords.length > 0) {
    // Keyword matching: leading-wildcard ILIKE (`title.ilike.%kw%`) can't use an
    // index → SEQ SCAN of the ~88k-row table on EVERY keyword search, per user,
    // in daily-alerts + snapshots (the burst-IO exhaustion Supabase support
    // flagged 2026-07-03). The fix is a full-text match against the generated
    // `search_tsv` GIN index (migration 20260703_sam_opportunities_fts.sql).
    //
    // FLAG-GATED: SAM_FTS_KEYWORDS must be 'on' AND the migration must have run,
    // or the .wfts on a missing column would 500 the shared query (this path
    // feeds daily-alerts, snapshots, briefings, AND the live market dashboard).
    // Default OFF = current ILIKE behavior; flip on only after the column exists.
    const useFts = process.env.SAM_FTS_KEYWORDS === 'on';
    for (const kw of includeKeywords) {
      const safe = kw.trim().replace(/[(),]/g, ' ').replace(/\s+/g, ' ');
      if (useFts) {
        // fts(english) = to_tsquery full-text search on the tsvector GIN index.
        // Multi-word keywords are joined with `&` (to_tsquery AND) so the phrase
        // must co-occur ("cyber security" → cyber&security), matching the intent
        // of the old title-ILIKE AND description-ILIKE pair. tsquery-special
        // chars (& | ! : * ' & parens) are stripped to spaces first so a raw
        // keyword can't break query parsing; the resulting lexemes are &-joined.
        const term = safe.replace(/[:&|!*'()]/g, ' ').trim().split(/\s+/).filter(Boolean).join('&');
        if (term) whatClauses.push(`search_tsv.fts(english).${term}`);
      } else {
        // Escape commas/parens that would break PostgREST .or() syntax.
        whatClauses.push(`title.ilike.%${safe}%`);
        whatClauses.push(`description.ilike.%${safe}%`);
      }
    }
  }
  if (whatClauses.length > 0) {
    filteredQuery = filteredQuery.or(whatClauses.join(','));
    console.log(`[SAM Cache] WHAT filter (NAICS/PSC market; keyword-include ${includeKeywords.length}): ${whatClauses.length} clauses`);
  }

  if (setAsides.length > 0) {
    // A certification EXPANDS what you may bid — it must never HIDE work you are
    // already eligible for. Filtering to the set-aside code ALONE did exactly that:
    // UNRESTRICTED (full-and-open) notices carry a NULL or 'NONE' set_aside_code and
    // are the LARGEST pool in the cache (488 null + 145 NONE vs 289 SBA in a 1,000-row
    // sample) — and every small business can bid them. Excluding them turned a helpful
    // preference into a blindfold.
    //
    // Measured on info@lcmanagementsolutions.com (skipped 07-12 → 07-17 with
    // "no_new_or_active_opportunities"): her profile matches 145 live opportunities.
    // The code-only filter returned 0 of them.
    //
    // The state filter ~30 lines up already ORs in `.is.null` for exactly this reason
    // (SAM omits pop_state on ~64% of notices). This filter never learned it.
    const parts = setAsides.map((s) => `set_aside_code.eq.${s}`);
    parts.push('set_aside_code.is.null', 'set_aside_code.eq.NONE');
    filteredQuery = filteredQuery.or(parts.join(','));
    console.log(`[SAM Cache] SET-ASIDE filter: eligible [${setAsides.join(', ')}] + unrestricted (null/NONE)`);
  }

  if (noticeTypes.length > 0) {
    const noticeTypeFilters = new Set<string>();
    for (const type of noticeTypes.map(t => t.toLowerCase())) {
      noticeTypeFilters.add(`notice_type.eq.${type}`);
      if (type === 'p') noticeTypeFilters.add('notice_type.ilike.*presol*');
      if (type === 'r') {
        noticeTypeFilters.add('notice_type.ilike.*source*');
        noticeTypeFilters.add('notice_type.ilike.*rfi*');
      }
      if (type === 'k') noticeTypeFilters.add('notice_type.ilike.*combined*');
      if (type === 'o') noticeTypeFilters.add('notice_type.ilike.*solicitation*');
    }
    filteredQuery = filteredQuery.or(Array.from(noticeTypeFilters).join(','));
  }

  const stateList = Array.from(
    new Set((states || (state ? [state] : []))
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .map(value => value.trim().toUpperCase()))
  );

  if (stateList.length > 0) {
    // IMPORTANT: Many SAM.gov opportunities have NULL pop_state (place of performance not specified).
    // We want to include: (1) opps matching user's states OR (2) opps with no state specified (NULL).
    // Using .or() to combine both conditions ensures we don't filter out the majority of opps.
    const stateOrConditions = stateList.map(s => `pop_state.eq.${s}`).join(',');
    filteredQuery = filteredQuery.or(`${stateOrConditions},pop_state.is.null`);
    console.log(`[SAM Cache] Using soft state filter (includes NULL): ${stateList.join(', ')}`);
  }

  return filteredQuery;
}

function classifyNoticeType(noticeType: string | null | undefined): keyof Omit<SAMNoticeSummary, 'totalMatched'> {
  const type = (noticeType || '').toLowerCase();
  if (type.includes('solicitation') || type.includes('rfp')) return 'rfp';
  if (type.includes('rfq') || type.includes('quote')) return 'rfq';
  if (type.includes('source') || type.includes('rfi') || type.includes('market research')) return 'sourcesSought';
  if (type.includes('presol') || type.includes('intent') || type.includes('pre-sol')) return 'preSol';
  if (type.includes('combined')) return 'combined';
  return 'other';
}

export async function fetchSamOpportunityNoticeSummaryFromCache(
  params: SAMSearchParams
): Promise<SAMNoticeSummary> {
  if (!supabase) {
    console.error('[SAM Cache] Supabase client not initialized');
    return { totalMatched: 0, rfp: 0, rfq: 0, sourcesSought: 0, preSol: 0, combined: 0, other: 0, complete: false };
  }

  const summary: SAMNoticeSummary = {
    totalMatched: 0,
    rfp: 0,
    rfq: 0,
    sourcesSought: 0,
    preSol: 0,
    combined: 0,
    other: 0,
  };

  const pageSize = 1000;

  try {
    for (let from = 0; ; from += pageSize) {
      const query = applySamCacheFilters(
        supabase
          .from('sam_opportunities')
          .select('notice_type,title,description')
          .order('response_deadline', { ascending: true })
          .range(from, from + pageSize - 1),
        params
      );

      const { data, error } = await query;
      if (error) {
        console.error('[SAM Cache] Notice summary query error:', error);
        return { ...summary, complete: false };
      }

      const rows = (data || []) as SAMCacheNoticeSummaryRow[];
      if (rows.length === 0) {
        break;
      }

      for (const row of rows) {
        summary.totalMatched++;
        summary[classifyNoticeType(row.notice_type)]++;
      }

      if (rows.length < pageSize) {
        break;
      }
    }

    return summary;
  } catch (error) {
    console.error('[SAM Cache] Error building notice summary:', error);
    return { ...summary, complete: false };
  }
}

/**
 * Fetch opportunities for a user - prefers cache, falls back to API
 */
export async function fetchOpportunitiesForUserCached(
  userProfile: {
    naics_codes: string[];
    agencies: string[];
    keywords: string[];
    zip_codes: string[];
    location_state?: string | null;
    location_states?: string[] | null;
  }
): Promise<SAMSearchResult> {
  // Build search params from user profile
  const params: SAMSearchParams = {
    naicsCodes: userProfile.naics_codes?.slice(0, 15) || [],
    keywords: userProfile.keywords?.slice(0, 10) || [],
    state: userProfile.location_state || undefined,
    states: userProfile.location_states?.slice(0, 10) || undefined,
    limit: 300,
  };

  // Query from cache (no API key needed!)
  return fetchSamOpportunitiesFromCache(params);
}

export type { SAMOpportunity, SAMSearchParams, SAMSearchResult, SAMNoticeSummary };
