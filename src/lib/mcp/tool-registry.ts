/**
 * Mindy MCP tool registry — the transport-agnostic catalog + dispatcher.
 *
 * Phase 1 Slice 2. The hosted HTTP transport (added with the mcp.getmindy.ai
 * subdomain) calls `listMcpTools()` for tools/list and `runMcpTool()` for
 * tools/call. This layer is deliberately independent of the transport AND of
 * billing:
 *   - It REUSES the already-wired chat toolsets (Tier-1 public data + Tier-2
 *     intelligence) via their `execute(name,args)` interface — zero re-implementation.
 *   - Tier-0 (pipeline/Vault, private PII) is intentionally EXCLUDED from v1
 *     (PRD §6 — its own hardening pass is Phase 2).
 *   - Per-tool credit prices are surfaced as metadata here, but NOTHING is debited
 *     yet. The atomic debit-on-success + get_balance land in Slice 3 (money slice),
 *     which will wrap runMcpTool.
 *
 * Data-first: tools return their raw grounded results. Optional narration/enrichment
 * stays gated by mcpFlags (see src/lib/mcp/flags.ts).
 */
import { getWriteClient } from '@/lib/supabase/server-clients';
import { makeTier1Tools, TIER1_TOOL_DEFS, TIER1_TOOL_NAMES, type Tier1Db } from '@/lib/chat/tier1-tools';
import { makeTier2Tools, TIER2_TOOL_DEFS, TIER2_TOOL_NAMES } from '@/lib/chat/tier2-tools';
import { getWinningPlaybook } from '@/mcp/tools/winning-playbook';
import { getPricingIntel } from '@/mcp/tools/pricing-intel';
import { getIncumbentFinancials } from '@/mcp/tools/incumbent-financials';
import { getRegulatoryDemand } from '@/mcp/tools/regulatory-demand';
import { getAwardDetail } from '@/mcp/tools/award-detail';
import { findPredecessor } from '@/mcp/tools/predecessor-award';
import { lookupSamEntity } from '@/mcp/tools/sam-entity';
import { getBalance } from '@/lib/mcp/credits';
import { tierFor } from '@/lib/mcp/entitlements';

export interface McpToolContext {
  /** The verified key owner — used for user-bound tools + (Slice 3) the debit. */
  userEmail: string;
}

/**
 * Per-tool credit price. Debited on success in Slice 3; exposed as `_credits` now so
 * clients/docs can show the price. Prices set from MEASURED BigQuery scan cost (PRD §9 R1,
 * resolved 2026-07-13, $6.25/TB): cheap data lookups = 1, a live-BQ contractor profile = 5,
 * a capable-contractors scan = 25 (measured 6.93 GB / $0.042 per cold call — NAICS is not a
 * partition/cluster key so it scans ~7 GB; the earlier "8" was a guess at only ~1.9× cost,
 * bumped to 25 for a margin-safe ~6× markup), the proprietary playbook = 2.
 */
export const TOOL_CREDITS: Readonly<Record<string, number>> = {
  search_sam_opportunities: 1,
  get_market_vocabulary: 1,
  get_contractor_profile: 5,
  find_capable_contractors: 25,
  get_winning_playbook: 2,
  get_pricing_intel: 1, // GSA CALC labor-rate intel (free upstream, multi-call; warm cache ~free)
  get_incumbent_financials: 2, // SEC EDGAR (multi-endpoint, all free)
  get_regulatory_demand: 1, // Federal Register (single free call, cacheable)
  get_award_detail: 2, // USASpending resolve (PIID→id) + award-detail fetch (both free)
  find_predecessor_award: 2, // USASpending search + award-detail fetch (incumbent inference)
  lookup_sam_entity: 1, // SAM Entity Management API (single lookup/search)
  get_balance: 0, // meta tool — always free
};

/** Free meta-tool: report the caller's live credit balance. */
const GET_BALANCE_TOOL_DEF = {
  type: 'function' as const,
  function: {
    name: 'get_balance',
    description: 'Return the caller\'s current Mindy MCP credit balance. Free (0 credits).',
    parameters: { type: 'object', properties: {} },
  },
};

/** OpenAI-style def for the playbook tool (mirrors src/mcp/server.ts's zod schema). */
const PLAYBOOK_TOOL_DEF = {
  type: 'function' as const,
  function: {
    name: 'get_winning_playbook',
    description:
      "GovCon Giants' proprietary coaching on HOW TO WIN a federal contracting scenario, " +
      'from 8 years of course/proposal/podcast content. Teaching intelligence, not a public ' +
      'data lookup. Optionally pass NAICS for a matched real contractor win story.',
    parameters: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'The scenario in plain language.' },
        naics_codes: { type: 'array', items: { type: 'string' }, description: 'Optional NAICS (4-6 digit).' },
        limit: { type: 'number', description: 'Max guidance passages (default 6).' },
      },
      required: ['topic'],
    },
  },
};

/** OpenAI-style def for the GSA CALC pricing-intel tool (mirrors src/mcp/server.ts zod schema). */
const PRICING_INTEL_TOOL_DEF = {
  type: 'function' as const,
  function: {
    name: 'get_pricing_intel',
    description:
      'Price-to-win labor-rate intelligence from the GSA CALC+ API (~240K awarded labor categories, ' +
      'daily refresh). Pass a NAICS code OR a labor-category keyword to get the market median, ' +
      'aggressive/competitive/premium price-to-win rates, small-vs-large gap, top labor categories, ' +
      'and top competing vendors. Returns grounded=false when CALC has no rates — do not invent rates. ' +
      'Rates are GSA Schedule ceiling rates (not commercial).',
    parameters: {
      type: 'object',
      properties: {
        naics: { type: 'string', description: 'NAICS code, e.g. "541512". Mutually exclusive with keyword.' },
        keyword: { type: 'string', description: 'Labor-category keyword(s), e.g. "Software Engineer". Mutually exclusive with naics.' },
      },
    },
  },
};

/** OpenAI-style def for the SEC EDGAR incumbent-financials tool. */
const INCUMBENT_FINANCIALS_TOOL_DEF = {
  type: 'function' as const,
  function: {
    name: 'get_incumbent_financials',
    description:
      'Turn an incumbent company NAME into a competitive financial read via SEC EDGAR (revenue, net ' +
      'income, gross margin, public float, employees, latest 10-K). Public filers only — returns ' +
      'grounded=false for private contractors (do not invent figures). EDGAR does not break out ' +
      'government-vs-commercial revenue; pair with get_contractor_profile for federal award totals.',
    parameters: {
      type: 'object',
      properties: {
        company_name: { type: 'string', description: 'Company name, e.g. "Leidos".' },
        as_of_year: { type: 'number', description: 'Optional fiscal year to surface first.' },
      },
      required: ['company_name'],
    },
  },
};

/** OpenAI-style def for the Federal Register regulatory-demand tool. */
const REGULATORY_DEMAND_TOOL_DEF = {
  type: 'function' as const,
  function: {
    name: 'get_regulatory_demand',
    description:
      'Leading "demand before SAM" indicator: recent Federal Register rules/notices for a topic or ' +
      'agency. A proposed/final rule often precedes agency solicitations by 6-18 months. Federal ' +
      'Register does NOT tag items to NAICS — any NAICS mapping is inference, not data. Pass at least ' +
      'one of query/agency.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keyword / CFR topic, e.g. "cybersecurity".' },
        agency: { type: 'string', description: 'Agency slug or name, e.g. "defense".' },
        document_type: { type: 'string', enum: ['RULE', 'PROPOSED_RULE', 'NOTICE'], description: 'Filter to a document type.' },
        days_back: { type: 'number', description: 'Look-back window in days (default 90, max 365).' },
        limit: { type: 'number', description: 'Max items (default 15, max 50).' },
      },
    },
  },
};

/** OpenAI-style def for the USASpending award-detail tool. */
const AWARD_DETAIL_TOOL_DEF = {
  type: 'function' as const,
  function: {
    name: 'get_award_detail',
    description:
      'Full USASpending detail for one federal award: obligated→ceiling (the real prize size), the ' +
      'parent IDV/vehicle you must hold to compete, period of performance (recompete timing), recipient, ' +
      'NAICS/PSC, funding account. Pass a contract number (PIID) OR a generated_internal_id. Returns ' +
      'grounded=false when no award matches — do not invent figures.',
    parameters: {
      type: 'object',
      properties: {
        piid: { type: 'string', description: 'Contract number (PIID), e.g. "140F0822D0024".' },
        id: { type: 'string', description: 'USASpending generated_internal_id, if already known (skips the resolve).' },
      },
    },
  },
};

/** OpenAI-style def for the incumbent/predecessor-award inference tool. */
const PREDECESSOR_AWARD_TOOL_DEF = {
  type: 'function' as const,
  function: {
    name: 'find_predecessor_award',
    description:
      'The LIKELY incumbent contract behind an open opportunity, inferred as the largest recent award ' +
      'matching the NAICS + agency (+ title). Returns full award detail (incumbent, ceiling, expiry, ' +
      'parent vehicle) plus a match-confidence. Best-match inference, NOT a certified link — present as ' +
      '"likely". Returns grounded=false when no good match exists.',
    parameters: {
      type: 'object',
      properties: {
        naics_code: { type: 'string', description: 'The opportunity NAICS (4-6 digit).' },
        agency_name: { type: 'string', description: 'Buying agency, e.g. "Department of Defense". Sharpens the match.' },
        title: { type: 'string', description: 'Opportunity title — raises match confidence when present.' },
      },
    },
  },
};

/** OpenAI-style def for the SAM entity lookup tool. */
const SAM_ENTITY_TOOL_DEF = {
  type: 'function' as const,
  function: {
    name: 'lookup_sam_entity',
    description:
      'Live SAM.gov registration for a contractor: UEI/CAGE, legal name, registration status, NAICS, ' +
      'certifications (8(a), HUBZone, …), location. Pass a UEI for an exact entity, or a company name to ' +
      'search. The "is this vendor real, registered, and set-aside eligible?" check. Set-aside eligibility ' +
      'depends on the CURRENT status shown, not past awards.',
    parameters: {
      type: 'object',
      properties: {
        uei: { type: 'string', description: '12-char SAM UEI for an exact lookup.' },
        name: { type: 'string', description: 'Company legal name to search (when no UEI given).' },
        state: { type: 'string', description: 'Optional 2-letter state filter for name search.' },
        limit: { type: 'number', description: 'Max name-search matches (default 10, max 25).' },
      },
    },
  },
};

/** All tools exposed over MCP in v1, each annotated with its credit price. */
export function listMcpTools(): Array<Record<string, unknown>> {
  const defs = [
    ...TIER1_TOOL_DEFS,
    ...TIER2_TOOL_DEFS,
    PLAYBOOK_TOOL_DEF,
    PRICING_INTEL_TOOL_DEF,
    INCUMBENT_FINANCIALS_TOOL_DEF,
    REGULATORY_DEMAND_TOOL_DEF,
    AWARD_DETAIL_TOOL_DEF,
    PREDECESSOR_AWARD_TOOL_DEF,
    SAM_ENTITY_TOOL_DEF,
    GET_BALANCE_TOOL_DEF,
  ];
  return defs.map((d) => ({ ...d, _credits: TOOL_CREDITS[d.function.name] ?? 0, _tier: tierFor(d.function.name) }));
}

/** Is `name` a tool this server exposes? (Fast reject for unknown calls.) */
export function isMcpTool(name: string): boolean {
  return (
    TIER1_TOOL_NAMES.has(name) ||
    TIER2_TOOL_NAMES.has(name) ||
    name === 'get_winning_playbook' ||
    name === 'get_pricing_intel' ||
    name === 'get_incumbent_financials' ||
    name === 'get_regulatory_demand' ||
    name === 'get_award_detail' ||
    name === 'find_predecessor_award' ||
    name === 'lookup_sam_entity' ||
    name === 'get_balance'
  );
}

/** The credit price for a tool (0 if unknown/free). */
export function creditsFor(name: string): number {
  return TOOL_CREDITS[name] ?? 0;
}

export interface McpToolRun {
  /** The tool's raw result (data-first; narration stays flag-gated). */
  result: Record<string, unknown>;
  /** Credits this call WOULD cost — Slice 3 debits this on success. */
  credits: number;
}

/**
 * Run a tool by name with model-supplied args, as the given identity. Reuses the
 * existing chat toolsets' execute(). Throws on an unknown tool (the transport maps
 * that to an MCP error). Does NOT debit — that's Slice 3.
 */
export async function runMcpTool(
  name: string,
  args: Record<string, unknown>,
  ctx: McpToolContext,
): Promise<McpToolRun> {
  const credits = creditsFor(name);

  if (TIER1_TOOL_NAMES.has(name)) {
    // Public data — no user binding. Service-role client adapts to the minimal
    // Tier1Db structural interface (same client the chat route passes; the strict
    // supabase-js generics just don't match the loose interface at the type level).
    const result = await makeTier1Tools(getWriteClient() as unknown as Tier1Db).execute(name, args);
    return { result, credits };
  }

  if (TIER2_TOOL_NAMES.has(name)) {
    // Intelligence tools — user email is the BQ cold-lookup rate-limit key (the
    // Tier-2 cost guard carries over to the MCP edge, per the PRD acceptance gate).
    const result = await makeTier2Tools(ctx.userEmail).execute(name, args);
    return { result, credits };
  }

  if (name === 'get_winning_playbook') {
    const result = (await getWinningPlaybook({
      topic: String(args.topic ?? ''),
      naics_codes: Array.isArray(args.naics_codes) ? (args.naics_codes as string[]) : undefined,
      limit: typeof args.limit === 'number' ? args.limit : undefined,
    })) as unknown as Record<string, unknown>;
    return { result, credits };
  }

  if (name === 'get_pricing_intel') {
    const result = (await getPricingIntel({
      naics: typeof args.naics === 'string' ? args.naics : undefined,
      keyword: typeof args.keyword === 'string' ? args.keyword : undefined,
    })) as unknown as Record<string, unknown>;
    return { result, credits };
  }

  if (name === 'get_incumbent_financials') {
    const result = (await getIncumbentFinancials({
      company_name: String(args.company_name ?? ''),
      as_of_year: typeof args.as_of_year === 'number' ? args.as_of_year : undefined,
    })) as unknown as Record<string, unknown>;
    return { result, credits };
  }

  if (name === 'get_regulatory_demand') {
    const result = (await getRegulatoryDemand({
      query: typeof args.query === 'string' ? args.query : undefined,
      agency: typeof args.agency === 'string' ? args.agency : undefined,
      document_type: (args.document_type as 'RULE' | 'PROPOSED_RULE' | 'NOTICE' | undefined) ?? undefined,
      days_back: typeof args.days_back === 'number' ? args.days_back : undefined,
      limit: typeof args.limit === 'number' ? args.limit : undefined,
    })) as unknown as Record<string, unknown>;
    return { result, credits };
  }

  if (name === 'get_award_detail') {
    const result = (await getAwardDetail({
      piid: typeof args.piid === 'string' ? args.piid : undefined,
      id: typeof args.id === 'string' ? args.id : undefined,
    })) as unknown as Record<string, unknown>;
    return { result, credits };
  }

  if (name === 'find_predecessor_award') {
    const result = (await findPredecessor({
      naics_code: typeof args.naics_code === 'string' ? args.naics_code : undefined,
      agency_name: typeof args.agency_name === 'string' ? args.agency_name : undefined,
      title: typeof args.title === 'string' ? args.title : undefined,
    })) as unknown as Record<string, unknown>;
    return { result, credits };
  }

  if (name === 'lookup_sam_entity') {
    const result = (await lookupSamEntity({
      uei: typeof args.uei === 'string' ? args.uei : undefined,
      name: typeof args.name === 'string' ? args.name : undefined,
      state: typeof args.state === 'string' ? args.state : undefined,
      limit: typeof args.limit === 'number' ? args.limit : undefined,
    })) as unknown as Record<string, unknown>;
    return { result, credits };
  }

  if (name === 'get_balance') {
    const balance = await getBalance(ctx.userEmail);
    return { result: { balance }, credits };
  }

  throw new Error(`Unknown MCP tool: ${name}`);
}
