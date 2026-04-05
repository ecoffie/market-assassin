/**
 * Multisite Pipeline
 *
 * Fetches and scores opportunities from the aggregated_opportunities table.
 * Integrates with daily-alerts and send-briefings crons.
 */

import { createClient } from '@supabase/supabase-js';
import type {
  SourceId,
  MultisiteSearchParams,
  SetAsideType,
  OpportunityType,
} from '@/lib/scrapers/types';

// ============================================================================
// TYPES
// ============================================================================

export interface MultisiteOpportunity {
  id: string;
  source: SourceId;
  externalId: string;
  sourceUrl: string;

  title: string;
  description?: string;
  agency: string;
  subAgency?: string;

  naicsCode?: string;
  pscCode?: string;
  setAside?: SetAsideType;
  opportunityType: OpportunityType;

  postedDate?: string;
  closeDate?: string;

  estimatedValue?: number;

  placeOfPerformance?: {
    state?: string;
    city?: string;
  };

  contact?: {
    name?: string;
    email?: string;
  };

  status: string;
  scrapedAt: string;
}

export interface ScoredMultisiteOpportunity extends MultisiteOpportunity {
  score: number;
  matchReasons: string[];
}

export interface MultisiteSearchResult {
  opportunities: MultisiteOpportunity[];
  totalRecords: number;
  fromCache: boolean;
  fetchedAt: string;
}

export interface UserProfile {
  naicsCodes: string[];
  keywords: string[];
  agencies: string[];
  setAsides?: SetAsideType[];
  preferredSources?: SourceId[];
  excludedSources?: SourceId[];
}

// ============================================================================
// SUPABASE CLIENT
// ============================================================================

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// ============================================================================
// SEARCH FUNCTIONS
// ============================================================================

/**
 * Fetch opportunities from aggregated_opportunities table
 */
export async function fetchMultisiteOpportunities(
  params: MultisiteSearchParams = {}
): Promise<MultisiteSearchResult> {
  const supabase = getSupabase();

  let query = supabase
    .from('aggregated_opportunities')
    .select('*', { count: 'exact' })
    .eq('status', 'active')
    .order('posted_date', { ascending: false });

  // Source filters
  if (params.sources && params.sources.length > 0) {
    query = query.in('source', params.sources);
  }

  if (params.excludeSources && params.excludeSources.length > 0) {
    query = query.not('source', 'in', `(${params.excludeSources.join(',')})`);
  }

  // Classification filters
  if (params.naicsCodes && params.naicsCodes.length > 0) {
    // Match any of the NAICS codes (including 3-digit prefix matches)
    const naicsConditions = params.naicsCodes
      .map(code => `naics_code.ilike.${code}%`)
      .join(',');
    query = query.or(naicsConditions);
  }

  if (params.setAsides && params.setAsides.length > 0) {
    query = query.in('set_aside', params.setAsides);
  }

  if (params.opportunityTypes && params.opportunityTypes.length > 0) {
    query = query.in('opportunity_type', params.opportunityTypes);
  }

  // Agency filters
  if (params.agencies && params.agencies.length > 0) {
    const agencyConditions = params.agencies
      .map(a => `agency.ilike.%${a}%`)
      .join(',');
    query = query.or(agencyConditions);
  }

  // Date filters
  if (params.postedFrom) {
    query = query.gte('posted_date', params.postedFrom);
  }

  if (params.closingAfter) {
    query = query.gte('close_date', params.closingAfter);
  }

  if (params.closingBefore) {
    query = query.lte('close_date', params.closingBefore);
  }

  // Value filters
  if (params.minValue) {
    query = query.gte('estimated_value', params.minValue);
  }

  if (params.maxValue) {
    query = query.lte('estimated_value', params.maxValue);
  }

  // State filters
  if (params.states && params.states.length > 0) {
    query = query.in('place_of_performance_state', params.states);
  }

  // Text search (keywords)
  if (params.keywords && params.keywords.length > 0) {
    const searchQuery = params.keywords.join(' | ');
    query = query.textSearch('title', searchQuery, { type: 'websearch' });
  }

  // Pagination
  const limit = params.limit || 100;
  const offset = params.offset || 0;
  query = query.range(offset, offset + limit - 1);

  // Execute query
  const { data, error, count } = await query;

  if (error) {
    console.error('[Multisite Pipeline] Query error:', error);
    return {
      opportunities: [],
      totalRecords: 0,
      fromCache: false,
      fetchedAt: new Date().toISOString()
    };
  }

  // Transform to MultisiteOpportunity format
  const opportunities: MultisiteOpportunity[] = (data || []).map(row => ({
    id: row.id,
    source: row.source as SourceId,
    externalId: row.external_id,
    sourceUrl: row.source_url,

    title: row.title,
    description: row.description,
    agency: row.agency,
    subAgency: row.sub_agency,

    naicsCode: row.naics_code,
    pscCode: row.psc_code,
    setAside: row.set_aside as SetAsideType,
    opportunityType: row.opportunity_type as OpportunityType,

    postedDate: row.posted_date,
    closeDate: row.close_date,

    estimatedValue: row.estimated_value,

    placeOfPerformance: row.place_of_performance_state ? {
      state: row.place_of_performance_state,
      city: row.place_of_performance_city
    } : undefined,

    contact: row.contact_name ? {
      name: row.contact_name,
      email: row.contact_email
    } : undefined,

    status: row.status,
    scrapedAt: row.scraped_at
  }));

  return {
    opportunities,
    totalRecords: count || opportunities.length,
    fromCache: false,
    fetchedAt: new Date().toISOString()
  };
}

/**
 * Fetch opportunities for a specific user based on their profile
 */
export async function fetchMultisiteForUser(
  userProfile: UserProfile,
  options: {
    limit?: number;
    postedFrom?: string;
    minScore?: number;
  } = {}
): Promise<ScoredMultisiteOpportunity[]> {
  // Build search params from user profile
  const searchParams: MultisiteSearchParams = {
    naicsCodes: userProfile.naicsCodes,
    keywords: userProfile.keywords,
    setAsides: userProfile.setAsides,
    sources: userProfile.preferredSources,
    excludeSources: userProfile.excludedSources,
    postedFrom: options.postedFrom || getDateDaysAgo(7),
    limit: options.limit || 50
  };

  // Fetch opportunities
  const result = await fetchMultisiteOpportunities(searchParams);

  // Score each opportunity
  const scoredOpps = result.opportunities.map(opp => {
    const { score, matchReasons } = scoreMultisiteOpportunity(opp, userProfile);
    return {
      ...opp,
      score,
      matchReasons
    };
  });

  // Filter by minimum score and sort
  const minScore = options.minScore || 25;
  return scoredOpps
    .filter(opp => opp.score >= minScore)
    .sort((a, b) => b.score - a.score);
}

// ============================================================================
// SCORING
// ============================================================================

/**
 * Score an opportunity based on user profile match
 */
export function scoreMultisiteOpportunity(
  opp: MultisiteOpportunity,
  userProfile: UserProfile
): { score: number; matchReasons: string[] } {
  let score = 0;
  const matchReasons: string[] = [];

  // NAICS match (30 pts max)
  if (opp.naicsCode && userProfile.naicsCodes.length > 0) {
    for (const userNaics of userProfile.naicsCodes) {
      if (opp.naicsCode === userNaics) {
        score += 30;
        matchReasons.push(`Exact NAICS match: ${userNaics}`);
        break;
      } else if (opp.naicsCode.startsWith(userNaics.substring(0, 3))) {
        score += 15;
        matchReasons.push(`NAICS sector match: ${userNaics.substring(0, 3)}xxx`);
        break;
      }
    }
  }

  // Agency match (20 pts)
  if (userProfile.agencies.length > 0) {
    const oppAgency = (opp.agency || '').toLowerCase();
    for (const userAgency of userProfile.agencies) {
      if (oppAgency.includes(userAgency.toLowerCase())) {
        score += 20;
        matchReasons.push(`Agency match: ${userAgency}`);
        break;
      }
    }
  }

  // Keyword match (15 pts per keyword, max 30)
  if (userProfile.keywords.length > 0) {
    const oppText = `${opp.title || ''} ${opp.description || ''}`.toLowerCase();
    let keywordScore = 0;

    for (const keyword of userProfile.keywords) {
      if (oppText.includes(keyword.toLowerCase())) {
        keywordScore += 15;
        matchReasons.push(`Keyword: ${keyword}`);
      }
      if (keywordScore >= 30) break;
    }
    score += Math.min(keywordScore, 30);
  }

  // Set-aside match (15 pts)
  if (opp.setAside && userProfile.setAsides && userProfile.setAsides.length > 0) {
    if (userProfile.setAsides.includes(opp.setAside)) {
      score += 15;
      matchReasons.push(`Set-aside match: ${opp.setAside}`);
    }
  }

  // Source bonus (up to 15 pts for high-value sources)
  const sourceBonus: Record<string, number> = {
    dla_dibbs: 10,      // High-volume defense
    navy_neco: 10,
    darpa_baa: 15,      // Research/innovation
    nih_reporter: 10,
    nsf_sbir: 15,       // SBIR opportunities
    acq_gateway: 5      // Forecasts (planning value)
  };
  const bonus = sourceBonus[opp.source] || 0;
  if (bonus > 0) {
    score += bonus;
    // Don't add to matchReasons - just a background boost
  }

  // Deadline urgency (up to 15 pts)
  if (opp.closeDate) {
    const daysUntilClose = getDaysUntil(opp.closeDate);
    if (daysUntilClose > 0 && daysUntilClose <= 7) {
      score += 15;
      matchReasons.push(`Closing soon: ${daysUntilClose} days`);
    } else if (daysUntilClose > 7 && daysUntilClose <= 14) {
      score += 10;
      matchReasons.push(`Closes in ${daysUntilClose} days`);
    } else if (daysUntilClose > 14 && daysUntilClose <= 30) {
      score += 5;
    }
  }

  // Cap at 100
  return {
    score: Math.min(score, 100),
    matchReasons
  };
}

// ============================================================================
// STATISTICS
// ============================================================================

/**
 * Get aggregation statistics
 */
export async function getMultisiteStats(): Promise<{
  totalOpportunities: number;
  bySource: Record<string, number>;
  newLast24h: number;
  newLast7d: number;
  lastUpdated: string;
}> {
  const supabase = getSupabase();

  // Total count
  const { count: totalCount } = await supabase
    .from('aggregated_opportunities')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'active');

  // Count by source
  const { data: sourceCounts } = await supabase
    .from('aggregated_opportunities')
    .select('source')
    .eq('status', 'active');

  const bySource: Record<string, number> = {};
  for (const row of sourceCounts || []) {
    bySource[row.source] = (bySource[row.source] || 0) + 1;
  }

  // New in last 24h
  const { count: new24h } = await supabase
    .from('aggregated_opportunities')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'active')
    .gte('scraped_at', getDateDaysAgo(1));

  // New in last 7d
  const { count: new7d } = await supabase
    .from('aggregated_opportunities')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'active')
    .gte('scraped_at', getDateDaysAgo(7));

  // Last updated
  const { data: latest } = await supabase
    .from('aggregated_opportunities')
    .select('scraped_at')
    .order('scraped_at', { ascending: false })
    .limit(1)
    .single();

  return {
    totalOpportunities: totalCount || 0,
    bySource,
    newLast24h: new24h || 0,
    newLast7d: new7d || 0,
    lastUpdated: latest?.scraped_at || new Date().toISOString()
  };
}

/**
 * Get source health status
 */
export async function getSourceHealth(): Promise<Array<{
  sourceId: SourceId;
  name: string;
  isEnabled: boolean;
  lastScrapeAt?: string;
  lastScrapeStatus?: string;
  lastScrapeCount?: number;
  consecutiveFailures: number;
  status: 'healthy' | 'warning' | 'failed';
}>> {
  const supabase = getSupabase();

  const { data } = await supabase
    .from('multisite_sources')
    .select('*')
    .order('tier', { ascending: true });

  return (data || []).map(source => {
    // Determine health status
    let status: 'healthy' | 'warning' | 'failed' = 'healthy';

    if (source.consecutive_failures >= 3) {
      status = 'failed';
    } else if (source.last_scrape_at) {
      const hoursSinceLastScrape =
        (Date.now() - new Date(source.last_scrape_at).getTime()) / (1000 * 60 * 60);

      if (hoursSinceLastScrape > 48) {
        status = 'warning';
      } else if (source.last_scrape_status === 'failed') {
        status = 'warning';
      }
    } else {
      status = 'warning'; // Never scraped
    }

    return {
      sourceId: source.id as SourceId,
      name: source.name,
      isEnabled: source.is_enabled,
      lastScrapeAt: source.last_scrape_at,
      lastScrapeStatus: source.last_scrape_status,
      lastScrapeCount: source.last_scrape_count,
      consecutiveFailures: source.consecutive_failures || 0,
      status
    };
  });
}

// ============================================================================
// HELPERS
// ============================================================================

function getDateDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

function getDaysUntil(dateStr: string): number {
  const target = new Date(dateStr);
  const now = new Date();
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

// ============================================================================
// EXPORTS
// ============================================================================

export type {
  MultisiteSearchParams,
  SourceId
};
