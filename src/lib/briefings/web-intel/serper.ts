/**
 * Serper API Integration
 *
 * Web search using Serper.dev API with fallback mode when API key not configured.
 */

import { SerperResponse, SerperSearchResult, SearchResult } from './types';

const SERPER_API_URL = 'https://google.serper.dev/search';
const SERPER_NEWS_URL = 'https://google.serper.dev/news';

/**
 * Check if Serper API is configured
 */
export function isSerperConfigured(): boolean {
  return !!process.env.SERPER_API_KEY;
}

/**
 * Execute a single search query via Serper API
 */
async function executeSearch(
  query: string,
  type: 'search' | 'news' = 'search'
): Promise<SearchResult[]> {
  const apiKey = process.env.SERPER_API_KEY;

  if (!apiKey) {
    console.log('[Serper] API key not configured, skipping search');
    return [];
  }

  const url = type === 'news' ? SERPER_NEWS_URL : SERPER_API_URL;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        q: query,
        num: 10, // Results per query
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      console.error(`[Serper] API error: ${response.status} ${response.statusText}`);
      return [];
    }

    const data: SerperResponse = await response.json();

    // Combine organic and news results
    const results: SearchResult[] = [];

    if (data.organic) {
      for (const item of data.organic) {
        results.push(serperToSearchResult(item, 'organic'));
      }
    }

    if (data.news) {
      for (const item of data.news) {
        results.push(serperToSearchResult(item, 'news'));
      }
    }

    return results;
  } catch (error) {
    console.error(`[Serper] Error executing search "${query}":`, error);
    return [];
  }
}

/**
 * Convert Serper result to unified SearchResult
 */
function serperToSearchResult(
  item: SerperSearchResult,
  type: 'organic' | 'news'
): SearchResult {
  return {
    title: item.title,
    url: item.link,
    snippet: item.snippet,
    publishedDate: item.date || null,
    source: item.source || extractDomain(item.link),
    origin: 'serper',
  };
}

/**
 * Extract domain from URL
 */
function extractDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace('www.', '');
  } catch {
    return 'unknown';
  }
}

/**
 * Execute multiple search queries with rate limiting
 */
export async function searchWeb(
  queries: string[],
  options: {
    includeNews?: boolean;
    maxConcurrent?: number;
    delayMs?: number;
  } = {}
): Promise<SearchResult[]> {
  const { includeNews = true, maxConcurrent = 3, delayMs = 200 } = options;

  if (!isSerperConfigured()) {
    console.log('[Serper] Not configured, returning empty results');
    return [];
  }

  console.log(`[Serper] Executing ${queries.length} searches...`);

  const allResults: SearchResult[] = [];
  const seenUrls = new Set<string>();

  // Process queries in batches
  for (let i = 0; i < queries.length; i += maxConcurrent) {
    const batch = queries.slice(i, i + maxConcurrent);

    const batchPromises = batch.map(async (query) => {
      // Execute regular search
      const webResults = await executeSearch(query, 'search');

      // Optionally also search news
      let newsResults: SearchResult[] = [];
      if (includeNews) {
        newsResults = await executeSearch(query, 'news');
      }

      return [...webResults, ...newsResults];
    });

    const batchResults = await Promise.all(batchPromises);

    // Flatten and dedupe
    for (const results of batchResults) {
      for (const result of results) {
        if (!seenUrls.has(result.url)) {
          seenUrls.add(result.url);
          allResults.push(result);
        }
      }
    }

    // Rate limiting between batches
    if (i + maxConcurrent < queries.length) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  console.log(`[Serper] Retrieved ${allResults.length} unique results`);
  return allResults;
}

/**
 * Search for GovCon-specific news
 */
export async function searchGovConNews(
  agencies: string[],
  naicsCodes: string[],
  competitors: string[]
): Promise<SearchResult[]> {
  if (!isSerperConfigured()) {
    return [];
  }

  const queries: string[] = [];

  // Agency-specific queries
  for (const agency of agencies.slice(0, 3)) {
    queries.push(`"${agency}" federal contract award 2026`);
    queries.push(`site:${agency.toLowerCase().replace(/\s+/g, '')}.gov news`);
  }

  // Competitor queries
  for (const competitor of competitors.slice(0, 3)) {
    queries.push(`"${competitor}" federal contract site:govconwire.com`);
  }

  // GAO protests
  queries.push('GAO bid protest decision site:gao.gov');

  // General GovCon news
  queries.push('federal contract award news site:fcw.com');
  queries.push('government contracting news site:nextgov.com');

  return searchWeb(queries, { includeNews: true });
}
