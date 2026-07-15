/**
 * Mindy Chat v2 — Tier-1 (SHARED PLATFORM) chat tools.
 *
 * Tier 1 = public federal data (PRD-mindy-chat-data-core.md §5a): SAM
 * opportunities + NAICS market vocabulary. Unlike Tier 0, there is NO per-user
 * scoping — this is the same public data every user can already browse in the
 * panels. So these tools take normal query args from the model and are safe to
 * call for anyone.
 *
 * Two tools:
 *   - search_sam_opportunities — live SAM opps via the existing `search_tsv`
 *     FTS (GIN-indexed, migration 20260703). Active + not-yet-closed only.
 *   - get_market_vocabulary — the buyer-words/phrases that win in a NAICS
 *     (naics_vocabulary, 25,252 terms mined from award text). Reuses the
 *     already-shipped src/lib/market/vocabulary lib.
 *
 * (Federal-contact lookup is served in chat by the canonical MCP-registry tool
 * `search_federal_contacts` via runMcpTool — the chat consumes the full MCP
 * tool catalog, so no separate chat-only contacts tool is needed here.)
 *
 * Same no-fabrication contract as Tier 0: an empty result returns an explicit
 * `count: 0 / items: []` so the model has nothing to embellish (Rule #1).
 */

import { getVocabularyForCodes } from '@/lib/market/vocabulary';

// Structural subset of the Supabase query builder these tools use. Kept minimal
// so tests can pass a stub without importing the real client.
export interface Tier1Db {
  from(table: string): SamQuery;
}
interface SamQuery {
  select(cols: string): SamQuery;
  eq(col: string, val: unknown): SamQuery;
  gte(col: string, val: unknown): SamQuery;
  ilike(col: string, val: string): SamQuery;
  textSearch(col: string, query: string, opts?: { type?: string }): SamQuery;
  order(col: string, opts: { ascending: boolean; nullsFirst?: boolean }): SamQuery;
  limit(n: number): Promise<{ data: unknown[] | null; error: { message?: string } | null }>;
}

export const TIER1_TOOL_DEFS = [
  {
    type: 'function' as const,
    function: {
      name: 'search_sam_opportunities',
      description:
        'Search LIVE, currently-open federal opportunities on SAM.gov by keyword (and optionally NAICS code or set-aside). Call this when the user asks what opportunities/RFPs/solicitations are open, available, or posted in a topic, agency area, or their market. Returns only active, not-yet-closed notices.',
      parameters: {
        type: 'object',
        properties: {
          keyword: {
            type: 'string',
            description: 'Free-text search over opportunity title + description, e.g. "cybersecurity", "janitorial services", "aircraft parts".',
          },
          naics: {
            type: 'string',
            description: 'Optional 6-digit NAICS code to narrow the search, e.g. "541512".',
          },
          set_aside: {
            type: 'string',
            description: 'Optional set-aside filter to match, e.g. "8(a)", "WOSB", "HUBZone", "SDVOSB".',
          },
        },
        required: ['keyword'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_market_vocabulary',
      description:
        "Return the distinctive buyer words and phrases that appear in winning contracts for one or more NAICS codes — the language the government actually uses in this market. Call this when the user asks what keywords/terms to search, how buyers describe their market, or how to phrase a capability statement for a NAICS.",
      parameters: {
        type: 'object',
        properties: {
          naics: {
            type: 'array',
            items: { type: 'string' },
            description: 'One or more 6-digit NAICS codes, e.g. ["541512","541519"].',
          },
        },
        required: ['naics'],
        additionalProperties: false,
      },
    },
  },
];

export const TIER1_TOOL_NAMES = new Set(TIER1_TOOL_DEFS.map((t) => t.function.name));

interface SamRow {
  title?: string;
  department?: string;
  naics_code?: string;
  set_aside_description?: string;
  notice_type?: string;
  response_deadline?: string | null;
  ui_link?: string | null;
  solicitation_number?: string | null;
}

const SAM_LIMIT = 8; // chat answers are tight; a handful of live opps is plenty

/**
 * Build the Tier-1 toolset. `db` is the service-role Supabase client (public
 * data — no user binding). `execute(name, args)` runs the named tool with the
 * model-supplied args (validated per-field; unknown fields ignored).
 */
export function makeTier1Tools(db: Tier1Db) {
  async function searchSam(args: { keyword?: unknown; naics?: unknown; set_aside?: unknown }): Promise<Record<string, unknown>> {
    const keyword = typeof args?.keyword === 'string' ? args.keyword.trim() : '';
    if (!keyword) return { ok: false, error: 'keyword_required', count: 0, items: [] };
    const naics = typeof args?.naics === 'string' ? args.naics.trim() : '';
    const setAside = typeof args?.set_aside === 'string' ? args.set_aside.trim() : '';

    // Active + not-yet-closed, ranked by soonest deadline. FTS via the
    // GIN-indexed generated tsvector (websearch = supports quoted phrases / OR).
    const todayIso = new Date().toISOString();
    let q = db
      .from('sam_opportunities')
      .select('title, department, naics_code, set_aside_description, notice_type, response_deadline, ui_link, solicitation_number')
      .eq('active', true)
      .gte('response_deadline', todayIso)
      .textSearch('search_tsv', keyword, { type: 'websearch' });
    if (naics) q = q.eq('naics_code', naics);
    if (setAside) q = q.ilike('set_aside_description', `%${setAside}%`);
    const { data, error } = await q.order('response_deadline', { ascending: true, nullsFirst: false }).limit(SAM_LIMIT);

    if (error) return { ok: false, error: 'sam_unavailable', count: 0, items: [] };
    const rows = (data || []) as SamRow[];
    if (rows.length === 0) {
      return { ok: true, count: 0, items: [], note: `No open SAM opportunities matched "${keyword}"${naics ? ` in NAICS ${naics}` : ''} right now.` };
    }
    return {
      ok: true,
      count: rows.length,
      items: rows.map((r) => ({
        title: r.title ?? null,
        agency: r.department ?? null,
        naics: r.naics_code ?? null,
        set_aside: r.set_aside_description ?? null,
        type: r.notice_type ?? null,
        deadline: r.response_deadline ?? null,
        solicitation: r.solicitation_number ?? null,
        link: r.ui_link ?? null,
      })),
    };
  }

  async function marketVocabulary(args: { naics?: unknown }): Promise<Record<string, unknown>> {
    const raw = Array.isArray(args?.naics) ? args.naics : [];
    const codes = raw.map((c) => String(c ?? '').trim()).filter(Boolean).slice(0, 5);
    if (codes.length === 0) return { ok: false, error: 'naics_required', count: 0, terms: [] };
    const terms = await getVocabularyForCodes(codes, { limit: 30 });
    if (terms.length === 0) {
      return { ok: true, count: 0, terms: [], note: `No market vocabulary is indexed for NAICS ${codes.join(', ')}.` };
    }
    return {
      ok: true,
      naics: codes,
      count: terms.length,
      terms: terms.map((t) => ({ term: t.term, kind: t.kind, awards: t.df })),
    };
  }

  return {
    async execute(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
      switch (name) {
        case 'search_sam_opportunities':
          return searchSam(args || {});
        case 'get_market_vocabulary':
          return marketVocabulary(args || {});
        default:
          return { ok: false, error: `unknown_tool:${name}` };
      }
    },
  };
}
