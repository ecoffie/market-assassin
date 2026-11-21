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
 *
 * Server-side controls (Agent 4 review of #2204; Eric approved live web search):
 *   - Per-turn cap: at most `maxCallsPerTurn` searches (default 5) per tool instance; one instance is made per
 *     chat turn. Past the cap the tool returns limit_reached:true and does not search.
 *   - Privacy guard: a query containing the caller's or acting workspace's email, a known UEI, or 8+ consecutive
 *     words copied from this turn's document excerpts is refused (refused:true) and never sent out.
 *   - Usage log: one structured line per call (outcome, query length, result count). Never the raw query, and
 *     no credit charge.
 *   - Web findings are unverified; other GovCon data platforms are never cited (rules layer WRITING).
 */
import { isSerperConfigured, searchWeb } from '@/lib/briefings/web-intel/serper';

export const SEARCH_WEB = 'search_web';
const MAX_QUERY_LEN = 240;
const MAX_RESULTS = 8;
export const DEFAULT_MAX_SEARCHES_PER_TURN = 5;
/** Consecutive words copied from a document excerpt that make a query a leak. */
export const DOC_COPY_RUN = 8;

export const SEARCH_WEB_TOOL_DEF = {
  type: 'function' as const,
  function: {
    name: SEARCH_WEB,
    description:
      'Search the open web for public facts Mindy does not store (CRS reports, bill text / Legacy Restoration Fund, highway extensions, GAO reports, PAE / Navy construction press, 8(a) rule-change coverage). Pass one focused query. Returns titles, URLs, and snippets only — quote only what is returned; never invent CRS figures, bill text, or press claims beyond the snippets. Web findings are unverified: label them as from the open web, and never cite other GovCon data platforms. Never put the user\'s email, UEI, or text copied from their uploaded documents in a query. At most a few searches per answer; if limit_reached=true, stop searching and answer from what you have. If available=false, web search is not configured (known gap — say so). If grounded=false with available=true, the search ran and found nothing useful.',
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

export type SearchWebOutcome = 'ok' | 'empty' | 'failed' | 'not_configured' | 'limit_reached' | 'refused' | 'missing_query';

/** One usage record per call. Deliberately has no query text and no credit amount. */
export interface SearchWebUsage {
  tool: typeof SEARCH_WEB;
  outcome: SearchWebOutcome;
  call: number;
  queryLength: number;
  resultCount: number;
  refusedBecause?: 'email' | 'uei' | 'document_text';
}

export interface SearchWebOptions {
  deps?: SearchWebDeps;
  maxCallsPerTurn?: number;
  /** Identifiers that must never leave in a query: caller and acting-workspace emails, known UEIs. */
  forbidden?: { emails?: Array<string | null | undefined>; ueis?: Array<string | null | undefined> };
  /** This turn's document excerpts (the fenced block the model sees). */
  documentText?: string | null;
  onUsage?: (u: SearchWebUsage) => void;
}

const defaultUsageLog = (u: SearchWebUsage) => console.info('[search_web] usage', JSON.stringify(u));

const words = (t: string) => t.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** Does the query contain DOC_COPY_RUN or more consecutive words that also appear consecutively in the documents? */
export function copiesDocumentText(query: string, documentText: string | null | undefined, run = DOC_COPY_RUN): boolean {
  if (!documentText) return false;
  const q = words(query);
  if (q.length < run) return false;
  const doc = ` ${words(documentText).join(' ')} `;
  for (let i = 0; i + run <= q.length; i++) if (doc.includes(` ${q.slice(i, i + run).join(' ')} `)) return true;
  return false;
}

/** Why a query must not leave the server, or null. */
export function privacyRefusal(query: string, opts: Pick<SearchWebOptions, 'forbidden' | 'documentText'>): SearchWebUsage['refusedBecause'] | null {
  const low = query.toLowerCase();
  for (const e of opts.forbidden?.emails ?? []) if (e && e.trim() && low.includes(e.trim().toLowerCase())) return 'email';
  const upper = query.toUpperCase();
  for (const u of opts.forbidden?.ueis ?? []) if (u && u.trim().length >= 12 && upper.includes(u.trim().toUpperCase())) return 'uei';
  if (copiesDocumentText(query, opts.documentText)) return 'document_text';
  return null;
}

export function makeSearchWebTool(opts: SearchWebOptions | SearchWebDeps = {}) {
  // Backward compatible: a bare deps object (tests from #2204) is still accepted.
  const o: SearchWebOptions = 'search' in opts && 'isConfigured' in opts ? { deps: opts as SearchWebDeps } : (opts as SearchWebOptions);
  const deps = o.deps ?? defaultDeps;
  const cap = o.maxCallsPerTurn ?? DEFAULT_MAX_SEARCHES_PER_TURN;
  const log = o.onUsage ?? defaultUsageLog;
  let calls = 0;
  const record = (outcome: SearchWebOutcome, queryLength: number, resultCount = 0, refusedBecause?: SearchWebUsage['refusedBecause']) => {
    try { log({ tool: SEARCH_WEB, outcome, call: calls, queryLength, resultCount, ...(refusedBecause ? { refusedBecause } : {}) }); } catch { /* logging never breaks a turn */ }
  };
  return {
    async execute(args: Record<string, unknown>): Promise<Record<string, unknown>> {
      calls += 1;
      const raw = typeof args.query === 'string' ? args.query.trim() : '';
      if (calls > cap) {
        record('limit_reached', raw.length);
        return {
          ok: true, grounded: false, available: true, limit_reached: true, count: 0, results: [],
          note: `Web search limit for this answer reached (${cap} searches). Do not search again; answer from what you already have and say which questions the web search did not cover.`,
        };
      }
      if (raw) {
        const why = privacyRefusal(raw, o);
        if (why) {
          record('refused', raw.length, 0, why);
          return {
            ok: false, grounded: false, available: true, refused: true, error: 'query_refused', count: 0, results: [],
            note: why === 'document_text'
              ? 'Query refused: it copies text from the user\'s uploaded documents, which must not be sent to an outside search engine. Search with a short general phrase instead.'
              : 'Query refused: it contains the user\'s private identifier, which must not be sent to an outside search engine. Search without it.',
          };
        }
      }
      if (!raw) {
        record('missing_query', 0);
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
        record('not_configured', query.length);
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
        record(results.length ? 'ok' : 'empty', query.length, results.length);
        return {
          ok: true,
          grounded: results.length > 0,
          available: true,
          query,
          count: results.length,
          results,
          note: results.length
            ? 'Quote only these snippets. They are unverified open-web results: attribute each claim to its source URL and say it comes from the web. Never cite other GovCon data platforms. Do not invent details beyond what appears here.'
            : 'Search ran; no useful results. Do not fabricate — say the web search found nothing on this query.',
        };
      } catch (err) {
        record('failed', query.length);
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
