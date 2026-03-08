/**
 * Web Intelligence Pipeline
 *
 * Unified exports and main orchestration function.
 */

// Re-export types
export * from './types';

// Re-export modules
export { isSerperConfigured, searchWeb, searchGovConNews } from './serper';
export {
  RSS_FEEDS,
  fetchAllRSSFeeds,
  fetchRSSFeeds,
  rssToSearchResults,
  filterRSSByKeywords,
  filterRecentRSS,
} from './rss';
export {
  isGroqConfigured,
  generateSearchQueries,
  prioritizeQueries,
} from './query-generator';
export { filterAndScoreResults } from './filter';
export {
  generateCacheKey,
  checkCache,
  storeInCache,
  batchStoreInCache,
  cleanExpiredCache,
  getCacheStats,
} from './cache';

// Import for orchestration
import { SearchResult, WebSignal, WebIntelUserProfile, WebIntelResult } from './types';
import { isSerperConfigured, searchWeb } from './serper';
import { fetchAllRSSFeeds, rssToSearchResults, filterRecentRSS } from './rss';
import { generateSearchQueries, prioritizeQueries } from './query-generator';
import { filterAndScoreResults } from './filter';
import { checkCache, batchStoreInCache } from './cache';

/**
 * Run the full web intelligence pipeline for a user
 */
export async function runWebIntelPipeline(
  userProfile: WebIntelUserProfile
): Promise<WebIntelResult> {
  const startTime = Date.now();
  console.log('[WebIntel] Starting pipeline...');

  let cacheHits = 0;
  let cacheMisses = 0;
  const allResults: SearchResult[] = [];

  // Step 1: Generate search queries
  const generatedQueries = await generateSearchQueries(userProfile);
  const queries = prioritizeQueries(generatedQueries, 15);
  console.log(`[WebIntel] Generated ${queries.length} queries`);

  // Step 2: Check cache for existing results
  const { hits, misses } = await checkCache(queries);
  cacheHits = hits.size;
  cacheMisses = misses.length;

  // Add cached results
  for (const [query, results] of hits) {
    allResults.push(...results);
  }

  // Step 3: Execute uncached queries via Serper
  if (misses.length > 0 && isSerperConfigured()) {
    console.log(`[WebIntel] Executing ${misses.length} Serper searches...`);
    const newResults = await searchWeb(misses);
    allResults.push(...newResults);

    // Cache the new results (group by approximate query)
    if (newResults.length > 0) {
      // Simple approach: cache all results under each query
      const cacheEntries = misses.map((query) => ({
        query,
        results: newResults.slice(0, 10), // Store top 10 per query
      }));
      await batchStoreInCache(cacheEntries);
    }
  }

  // Step 4: Fetch RSS feeds (always free)
  console.log('[WebIntel] Fetching RSS feeds...');
  const rssItems = await fetchAllRSSFeeds();
  const recentRss = filterRecentRSS(rssItems, 7); // Last 7 days
  const rssResults = rssToSearchResults(recentRss);
  allResults.push(...rssResults);

  console.log(`[WebIntel] Total raw results: ${allResults.length}`);

  // Step 5: Filter and score results
  const signals = await filterAndScoreResults(allResults, userProfile);

  const elapsed = Date.now() - startTime;
  console.log(`[WebIntel] Pipeline complete in ${elapsed}ms: ${signals.length} signals`);

  return {
    signals,
    rawResults: allResults,
    queriesExecuted: queries.length,
    cacheHits,
    cacheMisses,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Run a lightweight version (RSS only, no Serper)
 */
export async function runRSSOnlyPipeline(
  userProfile: WebIntelUserProfile
): Promise<WebIntelResult> {
  console.log('[WebIntel] Running RSS-only pipeline...');

  // Fetch RSS feeds
  const rssItems = await fetchAllRSSFeeds();
  const recentRss = filterRecentRSS(rssItems, 7);
  const rssResults = rssToSearchResults(recentRss);

  // Filter by user's keywords/NAICS if available
  const keywords = [
    ...userProfile.keywords,
    ...userProfile.naics_codes,
    ...userProfile.agencies,
    ...userProfile.watched_companies,
  ];

  // Filter and score
  const signals = await filterAndScoreResults(rssResults, userProfile);

  return {
    signals,
    rawResults: rssResults,
    queriesExecuted: 0,
    cacheHits: 0,
    cacheMisses: 0,
    fetchedAt: new Date().toISOString(),
  };
}
