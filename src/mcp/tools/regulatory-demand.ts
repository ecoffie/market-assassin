/**
 * MCP tool: get_regulatory_demand — the "demand before SAM" leading indicator.
 * A proposed or final rule in a subject area often precedes agency solicitations
 * by 6-18 months as the agency staffs up to implement it. This returns recent
 * Federal Register items for a topic/agency — a signal SAM/USASpending cannot
 * provide because no solicitation exists yet. (PRD §5a — Federal Register net-new.)
 *
 * Transport-agnostic pure function — same pattern as winning-playbook.ts /
 * pricing-intel.ts. The stdio entrypoint AND the hosted HTTP edge both wrap this.
 *
 * Data-first (Eric, 2026-07-12): `_meta` (grounded/degraded/counts) ALWAYS ships.
 * `_ai_hint` is OPTIONAL and TOGGLED OFF by default (mcpFlags.aiHint). When
 * enabled, every fact traces to the returned items — and it explicitly does NOT
 * map a rule to a NAICS or set-aside. Federal Register carries no NAICS tag; any
 * such mapping is inference, not data, so the hint refuses to make it.
 *
 * credits: 1 (single free API call, cacheable).
 */
import { fetchRegulatoryDocuments, FederalRegisterItem, FederalRegisterDocType } from '@/lib/federal-register';
import { mcpFlags } from '@/lib/mcp/flags';

export interface RegulatoryDemandInput {
  /** Keyword / CFR topic, e.g. "cybersecurity". At least one of query/agency is required. */
  query?: string;
  /** Agency slug or name, e.g. "defense". */
  agency?: string;
  /** Filter to a document type. */
  document_type?: FederalRegisterDocType;
  /** Look-back window in days (default 90, capped at 365). */
  days_back?: number;
  /** Max items to return (default 15, capped at 50). */
  limit?: number;
}

export interface RegulatoryDemandResult {
  queried: RegulatoryDemandInput;
  /** The recent regulatory items, newest first (pass-through so the agent can cite sub-fields). */
  rules: FederalRegisterItem[];
  _ai_hint?: {
    summary: string;
    how_to_use: string;
    key_caveats: string[];
  };
  _meta: {
    grounded: boolean; // at least one item returned
    degraded: boolean; // upstream ERRORED — NOT a genuine empty result
    total: number; // Federal Register's own count for the window
    returned: number;
    from_cache: boolean;
    validation_error?: string;
  };
}

function buildHint(
  degraded: boolean,
  grounded: boolean,
  rules: FederalRegisterItem[],
  total: number,
  q: RegulatoryDemandInput,
): RegulatoryDemandResult['_ai_hint'] {
  const agencies = Array.from(new Set(rules.flatMap((r) => r.agencies))).slice(0, 3);
  const latest = rules[0];
  const scopeParts = [
    q.query ? `topic "${q.query}"` : null,
    q.agency ? `agency "${q.agency}"` : null,
    q.document_type ? q.document_type.toLowerCase().replace('_', ' ') : 'all types',
  ].filter(Boolean);
  const scope = scopeParts.join(' + ');
  const window = `${q.days_back ?? 90} days`;

  if (degraded) {
    return {
      summary:
        `Federal Register could not be reached (upstream error) for ${scope} in the last ${window}. This is a TEMPORARY SYSTEM ISSUE — NOT a sign no rules exist. Tell the user regulatory data is briefly unavailable and to retry; do NOT state that no items were found or invent any.`,
      how_to_use:
        'Upstream error — tell the user the Federal Register is temporarily unavailable and to retry; do NOT claim no items exist or generate any.',
      key_caveats: ['Federal Register was unreachable (system error) — this is NOT a real no-match.'],
    };
  }
  if (grounded && latest) {
    return {
      summary:
        `${rules.length} regulatory item(s) (${total} total in window) for ${scope} in the last ${window}. Latest: "${latest.title}" (published ${latest.publication_date ?? 'n/a'}, ${latest.document_type}${latest.docket_id ? `, docket ${latest.docket_id}` : ''}). Top agencies: ${agencies.join(', ') || 'n/a'}.`,
      how_to_use:
        'A proposed or final rule in a subject area often precedes agency solicitations by 6-18 months as the agency staffs up to implement it. Treat each item as a leading indicator — watch the issuing agencies\' forecasts and SAM postings for follow-on work in the rule\'s subject area.',
      key_caveats: [
        'Federal Register does NOT tag items to NAICS or a service category. Any mapping from a rule to a NAICS or set-aside is inference, NOT data — do the mapping yourself against the rule text; do not claim Mindy assigned one.',
        'Some items are procedural (meetings, notices) not demand-creating. Filter by document_type=PROPOSED_RULE or RULE for the strongest demand signal.',
        'The returned items are the newest N; the Federal Register `total` is the full window count (may exceed what is returned here).',
      ],
    };
  }
  return {
    summary:
      `No regulatory items match ${scope} in the last ${window}. Do NOT invent demand or claim a rule exists. Tell the user Mindy found no Federal Register items and suggest a broader term, a longer window (days_back), or a different agency.`,
    how_to_use: 'No grounded items returned; state that plainly rather than generating demand signals.',
    key_caveats: ['Zero matches — any item or NAICS mapping here would be ungrounded.'],
  };
}

/**
 * Run the regulatory-demand lookup. Pure function — no transport, no auth.
 * Never fabricates: empty result → grounded=false; never maps a rule to a NAICS.
 */
export async function getRegulatoryDemand(input: RegulatoryDemandInput): Promise<RegulatoryDemandResult> {
  const query = input.query?.trim();
  const agency = input.agency?.trim();
  const queried: RegulatoryDemandInput = {
    query: query || undefined,
    agency: agency || undefined,
    document_type: input.document_type,
    days_back: input.days_back,
    limit: input.limit,
  };

  if (!query && !agency) {
    return {
      queried,
      rules: [],
      _meta: { grounded: false, degraded: false, total: 0, returned: 0, from_cache: false, validation_error: 'no_input' },
    };
  }

  let items: FederalRegisterItem[] = [];
  let total = 0;
  let fetchErrored = false;
  let fromCache = false;
  try {
    // Pass `today` so the window is deterministic per-call; here we use now.
    const res = await fetchRegulatoryDocuments(
      { query, agency, document_type: input.document_type, days_back: input.days_back, limit: input.limit },
    );
    if (res === null) {
      fetchErrored = true;
    } else {
      items = res.items;
      total = res.total;
      fromCache = res.fromCache;
    }
  } catch (err) {
    fetchErrored = true;
    console.error('[mcp:get_regulatory_demand] Federal Register fetch failed:', err);
  }

  const grounded = items.length > 0;
  const degraded = fetchErrored && !grounded;

  const result: RegulatoryDemandResult = {
    queried,
    rules: items,
    _meta: {
      grounded,
      degraded,
      total,
      returned: items.length,
      from_cache: fromCache,
    },
  };

  if (mcpFlags.aiHint) {
    result._ai_hint = buildHint(degraded, grounded, items, total, queried);
  }

  return result;
}