/**
 * RSS Feed Parser
 *
 * Fetches and parses RSS feeds from GovCon trade press and government sources.
 * Uses native fetch + regex parsing (no external XML library).
 */

import { RSSItem, SearchResult } from './types';

// GovCon RSS feed sources
export const RSS_FEEDS = {
  govconwire: {
    url: 'https://www.govconwire.com/feed/',
    name: 'GovConWire',
  },
  fcw: {
    url: 'https://fcw.com/rss-feeds/all.aspx',
    name: 'Federal Computer Week',
  },
  nextgov: {
    url: 'https://www.nextgov.com/rss/all/',
    name: 'NextGov',
  },
  executivebiz: {
    url: 'https://blog.executivebiz.com/feed/',
    name: 'ExecutiveBiz',
  },
  gao_protests: {
    url: 'https://www.gao.gov/rss/bid-protest-decisions.xml',
    name: 'GAO Bid Protests',
  },
} as const;

type FeedKey = keyof typeof RSS_FEEDS;

/**
 * Parse XML element value using regex
 */
function getXmlValue(xml: string, tag: string): string {
  // Try CDATA first
  const cdataRegex = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`, 'i');
  const cdataMatch = xml.match(cdataRegex);
  if (cdataMatch) {
    return cdataMatch[1].trim();
  }

  // Try regular element
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : '';
}

/**
 * Parse RSS items from XML
 */
function parseRSSItems(xml: string, sourceName: string): RSSItem[] {
  const items: RSSItem[] = [];

  // Find all <item> elements
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1];

    const title = getXmlValue(itemXml, 'title');
    const link = getXmlValue(itemXml, 'link');
    const description = stripHtml(getXmlValue(itemXml, 'description'));
    const pubDate = getXmlValue(itemXml, 'pubDate');
    const guid = getXmlValue(itemXml, 'guid');

    if (title && link) {
      items.push({
        title,
        link,
        description,
        pubDate,
        source: sourceName,
        guid,
      });
    }
  }

  return items;
}

/**
 * Strip HTML tags from text
 */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Fetch and parse a single RSS feed
 */
async function fetchFeed(
  url: string,
  sourceName: string
): Promise<RSSItem[]> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'GovCon-Giants-Briefings/1.0',
        'Accept': 'application/rss+xml, application/xml, text/xml',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      console.error(`[RSS] Failed to fetch ${sourceName}: ${response.status}`);
      return [];
    }

    const xml = await response.text();
    const items = parseRSSItems(xml, sourceName);

    console.log(`[RSS] ${sourceName}: ${items.length} items`);
    return items;
  } catch (error) {
    console.error(`[RSS] Error fetching ${sourceName}:`, error);
    return [];
  }
}

/**
 * Fetch all configured RSS feeds
 */
export async function fetchAllRSSFeeds(): Promise<RSSItem[]> {
  console.log('[RSS] Fetching all feeds...');

  const feedPromises = Object.entries(RSS_FEEDS).map(([key, feed]) =>
    fetchFeed(feed.url, feed.name)
  );

  const results = await Promise.all(feedPromises);
  const allItems = results.flat();

  console.log(`[RSS] Total: ${allItems.length} items from ${Object.keys(RSS_FEEDS).length} feeds`);
  return allItems;
}

/**
 * Fetch specific RSS feeds by key
 */
export async function fetchRSSFeeds(feedKeys: FeedKey[]): Promise<RSSItem[]> {
  const feedPromises = feedKeys.map((key) => {
    const feed = RSS_FEEDS[key];
    return fetchFeed(feed.url, feed.name);
  });

  const results = await Promise.all(feedPromises);
  return results.flat();
}

/**
 * Convert RSS items to unified SearchResult format
 */
export function rssToSearchResults(items: RSSItem[]): SearchResult[] {
  return items.map((item) => ({
    title: item.title,
    url: item.link,
    snippet: item.description.substring(0, 300),
    publishedDate: item.pubDate || null,
    source: item.source,
    origin: 'rss' as const,
  }));
}

/**
 * Filter RSS items by keywords
 */
export function filterRSSByKeywords(
  items: RSSItem[],
  keywords: string[]
): RSSItem[] {
  if (keywords.length === 0) return items;

  const lowerKeywords = keywords.map((k) => k.toLowerCase());

  return items.filter((item) => {
    const text = `${item.title} ${item.description}`.toLowerCase();
    return lowerKeywords.some((keyword) => text.includes(keyword));
  });
}

/**
 * Get recent RSS items (last N days)
 */
export function filterRecentRSS(items: RSSItem[], days: number = 7): RSSItem[] {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  return items.filter((item) => {
    if (!item.pubDate) return true; // Include items without dates
    try {
      const itemDate = new Date(item.pubDate);
      return itemDate >= cutoff;
    } catch {
      return true;
    }
  });
}
