/**
 * Which public URLs each IndexNow family submits — the SAME gated lists the sitemaps publish,
 * so IndexNow is never told about a page the sitemap would not advertise.
 */
import { getForecastSitemapEntries } from '@/lib/seo/forecast-pages';
import {
  SITE_URL,
  officeEntries,
  closedOpportunityEntries,
  recompeteEntries,
} from '@/lib/seo/sitemap-sections';
import { RECOMPETE_SITEMAP_CHILD_COUNT } from '@/lib/seo/recompetes';

export const INDEXNOW_MAX = 10_000;

export const INDEXNOW_TYPES = ['opportunities', 'offices', 'forecasts', 'closed', 'recompetes'] as const;
export type IndexNowType = (typeof INDEXNOW_TYPES)[number];

/** Every URL the family's sitemap(s) publish. Throws on a read failure (never an empty list). */
export async function familyUrls(type: Exclude<IndexNowType, 'opportunities'>): Promise<string[]> {
  switch (type) {
    case 'offices':
      return (await officeEntries()).map((e) => e.url);
    case 'closed':
      return (await closedOpportunityEntries()).map((e) => e.url);
    case 'forecasts':
      return (await getForecastSitemapEntries()).map((r) => `${SITE_URL}/forecasts/${r.slug}`);
    case 'recompetes': {
      const out: string[] = [];
      for (let c = 0; c < RECOMPETE_SITEMAP_CHILD_COUNT; c++) {
        out.push(...(await recompeteEntries(c)).map((e) => e.url));
      }
      return out;
    }
  }
}

/** The next slice to submit and where the following run starts (wraps to 0 at the end). */
export function nextSlice(total: number, offset: number, size = INDEXNOW_MAX): { start: number; end: number; next: number } {
  const start = offset >= 0 && offset < total ? offset : 0;
  const end = Math.min(start + size, total);
  return { start, end, next: end >= total ? 0 : end };
}

