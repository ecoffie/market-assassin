/**
 * Ask Mindy tool `search_web` — open-web search via Serper (same engine as briefing web-intel).
 *
 * Used for Federal Market Profile step 7 (CRS, Legacy Restoration Fund, GAO, PAE press, 8(a)
 * rule changes, etc.) and any Ask turn that needs a public-web fact Mindy does not store.
 *
 * Honest miss contract:
 *   - SERPER_API_KEY missing → grounded:false, available:false (known gap — do not fabricate).
 *   - Configured but empty hits → grounded:false, available:true (searched; nothing useful).
 *   - Hits → grounded:true with title/url/snippet only — never invent beyond returned snippets.
 */
import { isSerperConfigured, searchWeb } from '@/lib/briefings/web-intel/serper';

export const SEARCH_WEB = 'search_web';
const MAX_QUERY_LEN = 240;
const MAX_RESULTS = 8;

export const SEARCH_WEB_TOOL_DEF = {
  type: 'function' as const,
  function: {
    name: SEARCH_WEB,
    description:
      'Search the open web for public facts Mindy does not store (CRS reports, bill text / Legacy Restoration Fund, highway extensions, GAO reports, PAE / Navy construction press, 8(a) rule-change coverage). Pass one focused query. Returns titles, URLs, and snippets only — quote only what is returned; never invent CRS figures, bill text, or press claims beyond the snippets. If available=false, web search is not configured (known gap — say so). If grounded=false with available=true, the search ran and found nothing useful.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'One focused search query, e.g. "NPS deferred maintenance CRS", "Legacy Restoration Fund bill", "PAE Navy construction oversight".',
        },
        include_news: {
          type: 'boolean',
          description: 'Also search news results (default true).',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
};

export type SearchWebDeps = {
  isConfigured: () => boolean;
  search: (
    queries: string[],
    options?: { includeNews?: boolean; maxConcurrent?: number; delayMs?: number },
  ) => Promise<Array<{ title: string; url: string; snippet: string; source?: string; publishedDate?: string | null }>>;
};

const defaultDeps: SearchWebDeps = {
  isConfigured: isSerperConfigured,
  search: searchWeb,
};

export function makeSearchWebTool(deps: SearchWebDeps = defaultDeps) {
  return {
    async execute(args: Record<string, unknown>): Promise<Record<string, unknown>> {
      const raw = typeof args.query === 'string' ? args.query.trim() : '';
      if (!raw) {
        return {
          ok: false,
          grounded: false,
          available: deps.isConfigured(),
          error: 'missing_query',
          message: 'Pass a non-empty query.',
        };
      }
      const query = raw.slice(0, MAX_QUERY_LEN);
      if (!deps.isConfigured()) {
        return {
          ok: true,
          grounded: false,
          available: false,
          query,
          count: 0,
          results: [],
          note: 'Web search is not configured for Ask Mindy. Treat this as a known gap — do not fabricate CRS figures, bill text, GAO findings, or PAE press.',
        };
      }
      const includeNews = args.include_news !== false;
      try {
        const hits = await deps.search([query], { includeNews, maxConcurrent: 1, delayMs: 0 });
        const results = hits.slice(0, MAX_RESULTS).map((h) => ({
          title: h.title,
          url: h.url,
          snippet: h.snippet,
          source: h.source ?? null,
          published: h.publishedDate ?? null,
        }));
        return {
          ok: true,
          grounded: results.length > 0,
          available: true,
          query,
          count: results.length,
          results,
          note: results.length
            ? 'Quote only these snippets. Attribute claims to the source URL. Do not invent details beyond what appears here.'
            : 'Search ran; no useful results. Do not fabricate — say the web search found nothing on this query.',
        };
      } catch (err) {
        return {
          ok: false,
          grounded: false,
          available: true,
          query,
          count: 0,
          results: [],
          error: 'search_failed',
          message: err instanceof Error ? err.message : 'web search failed',
          note: 'Web search failed. Known gap for this turn — do not fabricate.',
        };
      }
    },
  };
}
