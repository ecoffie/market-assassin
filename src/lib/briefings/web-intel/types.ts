/**
 * Web Intelligence Types
 *
 * TypeScript interfaces for the web intelligence pipeline.
 */

export type SignalType =
  | 'AWARD_NEWS'
  | 'PROTEST'
  | 'AGENCY_ANNOUNCEMENT'
  | 'COMPETITOR_MOVE'
  | 'PRIME_TEAMING_SIGNAL'
  | 'BUDGET_SIGNAL'
  | 'REGULATORY'
  | 'LEADERSHIP';

export type Urgency = 'immediate' | 'this_week' | 'this_month' | 'monitor';

/**
 * A web intelligence signal extracted from search results or RSS feeds
 */
export interface WebSignal {
  id: string;
  signal_type: SignalType;
  headline: string;
  agency: string | null;
  companies_mentioned: string[];
  naics_relevance: string[];
  detail: string;
  competitive_implication: string;
  source_url: string;
  source_name: string;
  published_date: string;
  relevance_score: number; // 1-100
  urgency: Urgency;
  cross_reference: string | null; // matching contract/opp ID if found
}

/**
 * Raw search result from Serper API
 */
export interface SerperSearchResult {
  title: string;
  link: string;
  snippet: string;
  date?: string;
  source?: string;
  position: number;
}

/**
 * Serper API response structure
 */
export interface SerperResponse {
  searchParameters: {
    q: string;
    type: string;
    engine: string;
  };
  organic: SerperSearchResult[];
  news?: SerperSearchResult[];
}

/**
 * RSS feed item
 */
export interface RSSItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
  source: string;
  guid?: string;
}

/**
 * Combined search result (from Serper or RSS)
 */
export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  publishedDate: string | null;
  source: string;
  origin: 'serper' | 'rss';
}

/**
 * User profile for query generation
 */
export interface WebIntelUserProfile {
  naics_codes: string[];
  naics_descriptions?: string[];
  agencies: string[];
  watched_companies: string[];
  watched_contracts: string[];
  keywords: string[];
}

/**
 * Generated search query with metadata
 */
export interface GeneratedQuery {
  query: string;
  type: 'agency_naics' | 'competitor' | 'contract' | 'teaming' | 'budget' | 'newsroom';
  priority: number; // 1-10
}

/**
 * Cache entry for web intelligence
 */
export interface WebIntelCacheEntry {
  cache_key: string;
  query: string;
  results: SearchResult[];
  relevance_scores: Record<string, number>;
  fetched_at: string;
  expires_at: string;
}

/**
 * Web intelligence pipeline result
 */
export interface WebIntelResult {
  signals: WebSignal[];
  rawResults: SearchResult[];
  queriesExecuted: number;
  cacheHits: number;
  cacheMisses: number;
  fetchedAt: string;
}
