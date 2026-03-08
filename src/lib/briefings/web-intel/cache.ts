/**
 * Web Intelligence Cache Layer
 *
 * Caches web search results to reduce API costs.
 * Shared across users with overlapping NAICS/agency profiles.
 * TTL: 24 hours.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { SearchResult, WebIntelCacheEntry } from './types';
import { createHash } from 'crypto';

const CACHE_TTL_HOURS = 24;

/**
 * Generate a cache key from query string
 */
export function generateCacheKey(query: string): string {
  const normalized = query.toLowerCase().trim();
  return createHash('md5').update(normalized).digest('hex');
}

/**
 * Create Supabase client
 */
function getSupabaseClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    return null;
  }

  return createClient(url, key);
}

/**
 * Check cache for existing results
 */
export async function checkCache(
  queries: string[]
): Promise<{
  hits: Map<string, SearchResult[]>;
  misses: string[];
}> {
  const supabase = getSupabaseClient();
  const hits = new Map<string, SearchResult[]>();
  const misses: string[] = [];

  if (!supabase) {
    // No cache available, all queries are misses
    return { hits, misses: queries };
  }

  const cacheKeys = queries.map((q) => ({
    query: q,
    key: generateCacheKey(q),
  }));

  const keys = cacheKeys.map((c) => c.key);

  try {
    const { data, error } = await supabase
      .from('web_intelligence_cache')
      .select('cache_key, results, expires_at')
      .in('cache_key', keys)
      .gt('expires_at', new Date().toISOString());

    if (error) {
      console.error('[Cache] Error checking cache:', error);
      return { hits, misses: queries };
    }

    const cachedKeys = new Set((data || []).map((d) => d.cache_key));

    for (const { query, key } of cacheKeys) {
      const cached = data?.find((d) => d.cache_key === key);
      if (cached && cached.results) {
        hits.set(query, cached.results as SearchResult[]);
      } else {
        misses.push(query);
      }
    }

    console.log(`[Cache] ${hits.size} hits, ${misses.length} misses`);
  } catch (error) {
    console.error('[Cache] Error:', error);
    return { hits, misses: queries };
  }

  return { hits, misses };
}

/**
 * Store results in cache
 */
export async function storeInCache(
  query: string,
  results: SearchResult[]
): Promise<void> {
  const supabase = getSupabaseClient();

  if (!supabase) {
    return;
  }

  const cacheKey = generateCacheKey(query);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CACHE_TTL_HOURS * 60 * 60 * 1000);

  try {
    await supabase.from('web_intelligence_cache').upsert({
      cache_key: cacheKey,
      query: query,
      results: results,
      relevance_scores: {},
      fetched_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    }, {
      onConflict: 'cache_key',
    });
  } catch (error) {
    console.error('[Cache] Error storing results:', error);
  }
}

/**
 * Batch store multiple query results
 */
export async function batchStoreInCache(
  queryResults: Array<{ query: string; results: SearchResult[] }>
): Promise<void> {
  const supabase = getSupabaseClient();

  if (!supabase || queryResults.length === 0) {
    return;
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + CACHE_TTL_HOURS * 60 * 60 * 1000);

  const entries = queryResults.map(({ query, results }) => ({
    cache_key: generateCacheKey(query),
    query: query,
    results: results,
    relevance_scores: {},
    fetched_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
  }));

  try {
    await supabase.from('web_intelligence_cache').upsert(entries, {
      onConflict: 'cache_key',
    });

    console.log(`[Cache] Stored ${entries.length} query results`);
  } catch (error) {
    console.error('[Cache] Error batch storing:', error);
  }
}

/**
 * Clean expired cache entries
 */
export async function cleanExpiredCache(): Promise<number> {
  const supabase = getSupabaseClient();

  if (!supabase) {
    return 0;
  }

  try {
    const { data, error } = await supabase
      .from('web_intelligence_cache')
      .delete()
      .lt('expires_at', new Date().toISOString())
      .select('id');

    if (error) {
      console.error('[Cache] Error cleaning expired entries:', error);
      return 0;
    }

    const deleted = data?.length || 0;
    if (deleted > 0) {
      console.log(`[Cache] Cleaned ${deleted} expired entries`);
    }

    return deleted;
  } catch (error) {
    console.error('[Cache] Error:', error);
    return 0;
  }
}

/**
 * Get cache statistics
 */
export async function getCacheStats(): Promise<{
  totalEntries: number;
  expiredEntries: number;
  avgResultsPerQuery: number;
} | null> {
  const supabase = getSupabaseClient();

  if (!supabase) {
    return null;
  }

  try {
    const { data: all } = await supabase
      .from('web_intelligence_cache')
      .select('id, results, expires_at');

    if (!all) {
      return null;
    }

    const now = new Date();
    const expired = all.filter((e) => new Date(e.expires_at) < now).length;
    const totalResults = all.reduce((sum, e) => {
      const results = e.results as SearchResult[] | null;
      return sum + (results?.length || 0);
    }, 0);

    return {
      totalEntries: all.length,
      expiredEntries: expired,
      avgResultsPerQuery: all.length > 0 ? totalResults / all.length : 0,
    };
  } catch (error) {
    console.error('[Cache] Error getting stats:', error);
    return null;
  }
}
