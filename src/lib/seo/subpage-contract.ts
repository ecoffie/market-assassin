/**
 * The contract for contractor data sub-pages (/contractors/[slug]/naics, /agencies).
 *
 * THE DEFECT THIS CLOSES (measured 2026-09-30)
 * --------------------------------------------
 * Both sub-pages decided `robots` and their headline ("All 227 NAICS codes where …") from the
 * profile's STORED aggregate (`distinct_naics_count` / `distinct_agency_count`), and the sitemap
 * emitted the tab from the same stored count. The table underneath is filled from a different
 * cache key (`all-naics` / `all-agencies`) that no warmer populates. With live BigQuery disabled
 * that key misses, so every one of the 12,985 sitemap-listed NAICS/agency sub-pages rendered an
 * empty table under a confident count — indexable and advertised.
 *
 * THE RULE
 * --------
 * Indexing, sitemap eligibility and every count a page claims come from the rows the page can
 * actually RENDER — never from a stored aggregate. Mirrors /contractors/[slug]/contracts, which
 * already gates on `available`.
 *
 * Pure: no I/O. The pages feed it the queryCached result state and the rendered row count.
 */
import type { BqResultState } from '@/lib/bigquery/cache';

export interface SubpageDecision {
  /** robots index. false ⇒ the page must emit noindex,follow. */
  indexable: boolean;
  /** Render the data table. Never render an empty table. */
  showTable: boolean;
  /** Honest non-table state: 'unavailable' = we do not know (cold cache / failed query);
   *  'none' = the dataset genuinely has no rows. */
  notice: 'unavailable' | 'none' | null;
  /** The ONLY count a headline or description may claim: the rendered rows. null = claim no count. */
  headlineCount: number | null;
}

/**
 * @param state        bqResultState() for the sub-page's row key, read right after the fetch.
 * @param renderedRows rows.length of what the page will render.
 * @param minRows      thin-content floor for indexing. Rows below it are still RENDERED
 *                     (real small datasets are preserved), just not indexed.
 */
export function decideSubpage(state: BqResultState, renderedRows: number, minRows: number): SubpageDecision {
  if (state === 'unavailable' || state === 'failed') {
    return { indexable: false, showTable: false, notice: 'unavailable', headlineCount: null };
  }
  if (renderedRows <= 0) {
    return { indexable: false, showTable: false, notice: 'none', headlineCount: null };
  }
  return { indexable: renderedRows >= Math.max(1, minRows), showTable: true, notice: null, headlineCount: renderedRows };
}

/**
 * Sitemap eligibility for a sub-page tab, from the row count the renderer would see.
 * `renderableRows` comes from getSubpageRowCounts(): -1 = key absent (unavailable),
 * -2 = unreadable, 0 = genuinely empty, n = rows. Only a populated set at or above the
 * floor is advertised — the same predicate the page uses for `indexable`, so the sitemap
 * can never assert a URL the page tells Google not to index.
 */
export function subpageSitemapEligible(renderableRows: number | undefined, minRows: number): boolean {
  return typeof renderableRows === 'number' && renderableRows >= Math.max(1, minRows);
}
