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
import { normalizeStateCode } from '@/lib/utils/us-states';

// Structural subset of the Supabase query builder these tools use. Kept minimal
// so tests can pass a stub without importing the real client.
export interface Tier1Db {
  from(table: string): SamQuery;
}
interface SamQuery {
  select(cols: string): SamQuery;
  eq(col: string, val: unknown): SamQuery;
  /** Set-aside filtering matches a CODE against several variants (8(a) = 8A + 8AN). */
  in(col: string, vals: readonly unknown[]): SamQuery;
  gte(col: string, val: unknown): SamQuery;
  ilike(col: string, val: string): SamQuery;
  or(filters: string): SamQuery;
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
            description:
              'Optional set-aside filter. Accepts the plain-English program name — "8(a)", "SDVOSB", "WOSB", "EDWOSB", "HUBZone", "Small Business", "Veteran", "Buy Indian", "ISBEE", "IEE", "Local Area" — or a raw SAM code ("8A", "8AN", "SDVOSBC", "SBA"…). A program name matches BOTH its competed and sole-source variants (e.g. "8(a)" → 8A + 8AN). An unrecognized value returns an error listing the valid options, never an empty result.',
          },
          state: {
            type: 'string',
            description: 'Optional state to filter by location — matches place of performance OR the buying office (SAM often omits place-of-performance, so office state is included for coverage). Accepts a 2-letter code ("FL") or full name ("Florida").',
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
  pop_state?: string | null;
  pop_city?: string | null;
  office_address?: { state?: string | null } | null;
}

const SAM_LIMIT = 8; // chat answers are tight; a handful of live opps is plenty

/**
 * Build the Tier-1 toolset. `db` is the service-role Supabase client (public
 * data — no user binding). `execute(name, args)` runs the named tool with the
 * model-supplied args (validated per-field; unknown fields ignored).
 */
/**
 * Set-aside filtering. Resolve a caller's term to `set_aside_code` values.
 *
 * WHY THIS EXISTS. The old filter was:
 *
 *     q.ilike('set_aside_description', `%${setAside}%`)
 *
 * and the tool's own description told the model to send "8(a)". SAM writes the
 * COMPETED 8(a) notices as "8a Competed" — no parentheses — and only the
 * sole-source ones as "8(a) Sole Source". So `%8(a)%` silently matched 66 rows
 * and missed all 130 competed ones, and a plain "8(a)" search for a state with
 * only competed notices returned ZERO with no error. Observed live 2026-07-17:
 * Claude asked for 8(a) work near MD, got nothing, and burned three tool calls
 * doubting the API before discovering the token had to be "8A".
 *
 * There is NO single substring that finds all of 8(a) — which is why this maps to
 * the CODE column instead. Codes below are the live distinct values of
 * sam_opportunities.set_aside_code, not a guess. Note `BICiv`'s mixed case: `.in()`
 * is exact.
 *
 * A program name resolves to BOTH variants (competed + sole source) because a user
 * asking for "8(a) opportunities" means both. Raw codes pass through for precision.
 */
const SET_ASIDE_CODES = [
  'SBA', 'SBP', 'NONE', 'SDVOSBC', 'SDVOSBS', 'WOSB', 'WOSBSS', 'EDWOSB',
  '8A', '8AN', 'HZC', 'HZS', 'VSA', 'VSS', 'ISBEE', 'IEE', 'BICiv', 'LAS',
] as const;

/** Plain-English program name → the codes it covers. Keys are normalized (see normSetAside). */
const SET_ASIDE_ALIASES: Record<string, readonly string[]> = {
  '8a': ['8A', '8AN'], // "8(a)", "8a", "8A" — competed AND sole source
  '8acompeted': ['8A'],
  '8asolesource': ['8AN'],
  sdvosb: ['SDVOSBC', 'SDVOSBS'],
  servicedisabledveteranowned: ['SDVOSBC', 'SDVOSBS'],
  wosb: ['WOSB', 'WOSBSS'],
  womenowned: ['WOSB', 'WOSBSS'],
  womenownedsmallbusiness: ['WOSB', 'WOSBSS'],
  edwosb: ['EDWOSB'],
  hubzone: ['HZC', 'HZS'],
  hz: ['HZC', 'HZS'],
  smallbusiness: ['SBA', 'SBP'],
  sb: ['SBA', 'SBP'],
  totalsmallbusiness: ['SBA'],
  partialsmallbusiness: ['SBP'],
  veteran: ['VSA', 'VSS'],
  vosb: ['VSA', 'VSS'],
  buyindian: ['BICiv'],
  isbee: ['ISBEE'],
  indiansmallbusiness: ['ISBEE'],
  iee: ['IEE'],
  localarea: ['LAS'],
  none: ['NONE'],
  nosetaside: ['NONE'],
};

/** "8(a)" / "8A" / "HUB-Zone" → "8a" / "8a" / "hubzone". */
function normSetAside(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Codes for a caller's term, or null if we don't recognize it (→ actionable error, never a silent zero). */
export function resolveSetAsideCodes(input: string): readonly string[] | null {
  const key = normSetAside(input);
  if (SET_ASIDE_ALIASES[key]) return SET_ASIDE_ALIASES[key];
  const exact = SET_ASIDE_CODES.find((c) => normSetAside(c) === key);
  return exact ? [exact] : null;
}

/** The options we advertise when a caller's term doesn't resolve. */
const SET_ASIDE_HELP =
  '8(a), SDVOSB, WOSB, EDWOSB, HUBZone, Small Business, Veteran, Buy Indian, ISBEE, IEE, Local Area, None — or a raw SAM code (8A, 8AN, SDVOSBC, SBA, HZC…)';

export function makeTier1Tools(db: Tier1Db) {
  async function searchSam(args: { keyword?: unknown; naics?: unknown; set_aside?: unknown; state?: unknown }): Promise<Record<string, unknown>> {
    const keyword = typeof args?.keyword === 'string' ? args.keyword.trim() : '';
    if (!keyword) return { ok: false, error: 'keyword_required', count: 0, items: [] };
    const naics = typeof args?.naics === 'string' ? args.naics.trim() : '';
    const setAside = typeof args?.set_aside === 'string' ? args.set_aside.trim() : '';
    // Location: match place-of-performance OR buying-office state. SAM omits
    // pop_state on ~64% of rows, so office_address.state widens coverage. A
    // state arg that doesn't resolve to a real code is ignored (still search).
    const st = typeof args?.state === 'string' ? normalizeStateCode(args.state) : null;

    // Active + not-yet-closed, ranked by soonest deadline. FTS via the
    // GIN-indexed generated tsvector (websearch = supports quoted phrases / OR).
    const todayIso = new Date().toISOString();
    let q = db
      .from('sam_opportunities')
      .select('title, department, naics_code, set_aside_description, notice_type, response_deadline, ui_link, solicitation_number, pop_state, pop_city, office_address')
      .eq('active', true)
      .gte('response_deadline', todayIso)
      .textSearch('search_tsv', keyword, { type: 'websearch' });
    if (naics) q = q.eq('naics_code', naics);
    // Filter on the CODE, never an ILIKE over the free-text description — see
    // SET_ASIDE_CODES above. An unrecognized term is an ERROR, not zero rows:
    // "no 8(a) work in Maryland" and "you spelled the filter wrong" must not look
    // identical to the caller.
    let setAsideCodes: readonly string[] | null = null;
    if (setAside) {
      setAsideCodes = resolveSetAsideCodes(setAside);
      if (!setAsideCodes) {
        return {
          ok: false,
          error: 'unknown_set_aside',
          message: `"${setAside}" is not a set-aside we recognize. Valid options: ${SET_ASIDE_HELP}.`,
          count: 0,
          items: [],
        };
      }
      q = q.in('set_aside_code', setAsideCodes);
    }
    if (st) q = q.or(`pop_state.eq.${st},office_address->>state.eq.${st}`);
    const { data, error } = await q.order('response_deadline', { ascending: true, nullsFirst: false }).limit(SAM_LIMIT);

    if (error) return { ok: false, error: 'sam_unavailable', count: 0, items: [] };
    const rows = (data || []) as SamRow[];
    if (rows.length === 0) {
      // Name EVERY filter that was applied. The old note omitted set_aside, so a
      // zero caused by the set-aside filter read as "nothing exists" — which is
      // how the 8(a) bug stayed invisible.
      return {
        ok: true,
        count: 0,
        items: [],
        note: `No open SAM opportunities matched "${keyword}"${naics ? ` in NAICS ${naics}` : ''}${
          setAsideCodes ? ` with set-aside ${setAside} (${setAsideCodes.join('/')})` : ''
        }${st ? ` in ${st} (place of performance or buying office)` : ''} right now.`,
      };
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
        location: {
          pop_state: r.pop_state ?? null,
          pop_city: r.pop_city ?? null,
          office_state: r.office_address?.state ?? null,
        },
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
