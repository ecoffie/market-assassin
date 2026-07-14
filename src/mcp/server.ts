/**
 * Mindy MCP server — Phase 0 spike (stdio transport).
 *
 * Exposes the GovCon Giants proprietary teaching corpus as an MCP tool so ANY
 * MCP-capable agent (Claude Desktop, Cursor, a customer's own tool) can call
 * `get_winning_playbook(topic)` and get grounded "how to win" guidance — the
 * un-copyable part of the moat (PRD: tasks/PRD-mindy-mcp-server.md §8, Phase 0).
 *
 * Transport: local stdio. Claude Desktop / Cursor spawn this process and speak
 * MCP over stdin/stdout. NO network port, NO auth in Phase 0 — it runs on the
 * operator's own machine against the operator's own env. Auth + credit ledger +
 * hosted HTTP transport are Phase 1+.
 *
 * Run: `npm run mcp:dev` (see scripts/mcp-dev.mjs) — that loads env then launches
 * this file via tsx. Do NOT `console.log` anything here: stdout is the MCP wire.
 * All diagnostics go to stderr (console.error).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { getWinningPlaybook } from './tools/winning-playbook';
import { getPricingIntel } from './tools/pricing-intel';
import { getIncumbentFinancials } from './tools/incumbent-financials';
import { getRegulatoryDemand } from './tools/regulatory-demand';
import { getAwardDetail } from './tools/award-detail';
import { findPredecessor } from './tools/predecessor-award';
import { lookupSamEntity } from './tools/sam-entity';
import { searchContractors } from './tools/search-contractors';
import { getAgencyIntel } from './tools/agency-intel';
import { grantsSearch } from './tools/grants';
import { agencyForecasts } from './tools/forecasts';
import { sbirSearch } from './tools/sbir';
import { expiringContracts } from './tools/expiring-contracts';
import { getAgencyBudgetTrends } from './tools/agency-budget-trends';
import { deriveCompanyKeywords } from './tools/company-keywords';

const server = new McpServer({
  name: 'mindy-govcon',
  version: '0.1.0',
});

server.registerTool(
  'get_winning_playbook',
  {
    title: 'Get Winning Playbook',
    description:
      "Retrieve GovCon Giants' proprietary coaching on HOW TO WIN a specific federal " +
      'contracting scenario — pulled from 8 years of course, proposal-template, and ' +
      'podcast-guest content. This is teaching intelligence, NOT a public data lookup: ' +
      'it answers "how do I actually win this," which no free API (SAM, USASpending) ' +
      'contains. Optionally pass NAICS codes to also get a real contractor win story ' +
      'matched to that industry. Returns grounded=false when the corpus has no match — ' +
      'in that case tell the user there is no coaching content, do not invent advice.',
    inputSchema: {
      topic: z
        .string()
        .min(3)
        .describe(
          'The scenario in plain language, e.g. "win an 8(a) construction recompete at the VA" ' +
            'or "break into cybersecurity contracting as a first-time SDVOSB".',
        ),
      naics_codes: z
        .array(z.string())
        .optional()
        .describe('Optional NAICS codes (4-6 digits) to fetch a matching real win story.'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(12)
        .optional()
        .describe('Max guidance passages to return (default 6).'),
    },
  },
  async ({ topic, naics_codes, limit }) => {
    const result = await getWinningPlaybook({ topic, naics_codes, limit });
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  },
);

server.registerTool(
  'get_pricing_intel',
  {
    title: 'Get Pricing Intel (GSA CALC)',
    description:
      'Price-to-win labor-rate intelligence from the GSA CALC+ API (~240K awarded labor ' +
      'categories, daily refresh). Pass a NAICS code OR a labor-category keyword (e.g. ' +
      '"Software Engineer, Project Manager") to get the market median, aggressive/competitive/' +
      'premium price-to-win rates, small-vs-large business gap, top labor categories, and top ' +
      'competing vendors. Returns grounded=false when CALC has no rates for the input — in that ' +
      'case tell the user no pricing data was found and suggest a broader/sibling term; do NOT ' +
      'invent rates. Rates are GSA Schedule ceiling rates only (not commercial).',
    inputSchema: {
      naics: z
        .string()
        .optional()
        .describe('NAICS code, e.g. "541512". Mutually exclusive with keyword; pass exactly one.'),
      keyword: z
        .string()
        .optional()
        .describe(
          'Labor-category keyword(s), comma-separated, e.g. "Software Engineer, Project Manager". ' +
            'Mutually exclusive with naics; pass exactly one.',
        ),
    },
  },
  async ({ naics, keyword }) => {
    const result = await getPricingIntel({ naics, keyword });
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  },
);

server.registerTool(
  'get_incumbent_financials',
  {
    title: 'Get Incumbent Financials (SEC EDGAR)',
    description:
      'Turn an incumbent company name into a competitive financial read via SEC EDGAR (revenue, ' +
      'net income, gross margin, public float, employees, latest 10-K, recent filings). Public ' +
      'filers only — returns grounded=false for private contractors; in that case do NOT invent ' +
      'figures, tell the user no EDGAR filing exists (likely private) and suggest the contractor-' +
      'profile tool for their federal award history. EDGAR does not break out government-vs-' +
      'commercial revenue; any gov-dependence is an estimate, not a reported figure.',
    inputSchema: {
      company_name: z
        .string()
        .min(2)
        .describe('Company name, e.g. "Leidos" or "Booz Allen Hamilton".'),
      as_of_year: z
        .number()
        .int()
        .optional()
        .describe('Optional fiscal year to surface first (defaults to most recent reported).'),
    },
  },
  async ({ company_name, as_of_year }) => {
    const result = await getIncumbentFinancials({ company_name, as_of_year });
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  },
);

server.registerTool(
  'get_regulatory_demand',
  {
    title: 'Get Regulatory Demand (Federal Register)',
    description:
      'Leading "demand before SAM" indicator: recent Federal Register rules/notices for a topic ' +
      'or agency. A proposed or final rule in a subject area often precedes agency solicitations ' +
      'by 6-18 months as the agency staffs up to implement it — a signal SAM/USASpending cannot ' +
      'provide. Pass at least one of query/agency. Returns grounded=false when no items match — ' +
      'suggest a broader term or longer window; do NOT invent demand. Federal Register does NOT ' +
      'tag items to NAICS; any NAICS mapping is inference, not data — do not claim one.',
    inputSchema: {
      query: z
        .string()
        .optional()
        .describe('Keyword / CFR topic, e.g. "cybersecurity" or "CMMC".'),
      agency: z
        .string()
        .optional()
        .describe('Agency slug or name, e.g. "defense" or "Department of Defense".'),
      document_type: z
        .enum(['RULE', 'PROPOSED_RULE', 'NOTICE'])
        .optional()
        .describe('Filter to a document type. RULE/PROPOSED_RULE carry the strongest demand signal.'),
      days_back: z
        .number()
        .int()
        .min(1)
        .max(365)
        .optional()
        .describe('Look-back window in days (default 90).'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe('Max items to return (default 15).'),
    },
  },
  async ({ query, agency, document_type, days_back, limit }) => {
    const result = await getRegulatoryDemand({ query, agency, document_type, days_back, limit });
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  },
);

server.registerTool(
  'get_award_detail',
  {
    title: 'Get Award Detail (USASpending)',
    description:
      'Full USASpending detail for one federal award: obligated→ceiling (the real prize size), the ' +
      'parent IDV/vehicle you must hold to compete, period of performance (recompete timing), recipient, ' +
      'NAICS/PSC, funding account. Pass a contract number (PIID) OR a generated_internal_id. Returns ' +
      'grounded=false when no award matches — do not invent figures.',
    inputSchema: {
      piid: z.string().optional().describe('Contract number (PIID), e.g. "140F0822D0024".'),
      id: z.string().optional().describe('USASpending generated_internal_id, if already known (skips the resolve).'),
    },
  },
  async ({ piid, id }) => {
    const result = await getAwardDetail({ piid, id });
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  },
);

server.registerTool(
  'find_predecessor_award',
  {
    title: 'Find Predecessor / Incumbent Award (USASpending)',
    description:
      'The LIKELY incumbent contract behind an open opportunity, inferred as the largest recent award ' +
      'matching the NAICS + agency (+ title). Returns full award detail (incumbent, ceiling, expiry, ' +
      'parent vehicle) plus a match-confidence. Best-match inference, NOT a certified link — present as ' +
      '"likely". Returns grounded=false when no good match exists.',
    inputSchema: {
      naics_code: z.string().optional().describe('The opportunity NAICS (4-6 digit).'),
      agency_name: z.string().optional().describe('Buying agency, e.g. "Department of Defense". Sharpens the match.'),
      title: z.string().optional().describe('Opportunity title — raises match confidence when present.'),
    },
  },
  async ({ naics_code, agency_name, title }) => {
    const result = await findPredecessor({ naics_code, agency_name, title });
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  },
);

server.registerTool(
  'lookup_sam_entity',
  {
    title: 'Lookup SAM Entity (SAM.gov)',
    description:
      'Live SAM.gov registration for a contractor: UEI/CAGE, legal name, registration status, NAICS, ' +
      'certifications (8(a), HUBZone, …), location. Pass a UEI for an exact entity, or a company name to ' +
      'search. The "is this vendor real, registered, and set-aside eligible?" check. Set-aside eligibility ' +
      'depends on the CURRENT status shown, not past awards.',
    inputSchema: {
      uei: z.string().optional().describe('12-char SAM UEI for an exact lookup.'),
      name: z.string().optional().describe('Company legal name to search (when no UEI given).'),
      state: z.string().optional().describe('Optional 2-letter state filter for name search.'),
      limit: z.number().int().min(1).max(25).optional().describe('Max name-search matches (default 10).'),
    },
  },
  async ({ uei, name, state, limit }) => {
    const result = await lookupSamEntity({ uei, name, state, limit });
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  },
);

server.registerTool(
  'search_contractors',
  {
    title: 'Search Contractors (USASpending / BigQuery)',
    description:
      'The competitive landscape for a market: top federal contractors by total obligated dollars for a ' +
      'keyword / NAICS / state, with award count and distinct-agency breadth (broad seller vs. single-buyer ' +
      'dependent). The "size up the competition / find teaming partners" lookup. Dollars are cumulative ' +
      'historical obligations, NOT a bid list. grounded=false when nothing matches — broaden the NAICS prefix.',
    inputSchema: {
      keyword: z.string().optional().describe('Free-text company-name match, e.g. "Booz".'),
      naics: z
        .string()
        .optional()
        .describe('NAICS code(s), comma/space separated; 2-6 digit prefixes allowed, e.g. "541512".'),
      state: z.string().optional().describe('Optional 2-letter state filter, e.g. "VA".'),
      sort_by: z
        .enum(['total_obligated', 'award_count', 'recipient_name'])
        .optional()
        .describe('Ranking (default total_obligated).'),
      limit: z.number().int().min(1).max(100).optional().describe('Max rows (default 15).'),
    },
  },
  async ({ keyword, naics, state, sort_by, limit }) => {
    const result = await searchContractors({ keyword, naics, state, sort_by, limit });
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  },
);

server.registerTool(
  'get_agency_intel',
  {
    title: 'Get Agency Intel (Hierarchy + USASpending)',
    description:
      'Target-research read on a federal agency: resolves it by name / abbreviation / CGAC code, then returns ' +
      'identity + hierarchy, curated GovCon pain points & priorities, and (when available) live USASpending ' +
      'obligations for the fiscal year with top NAICS. The "size up a buyer before I pursue them" lookup. Pain ' +
      'points are curated intel, not an official statement. grounded=false when no agency matches — do not guess.',
    inputSchema: {
      agency: z
        .string()
        .min(1)
        .describe('Agency name, abbreviation, or CGAC code, e.g. "VA", "Department of Defense", or "069".'),
      fiscal_year: z
        .number()
        .int()
        .optional()
        .describe('Optional fiscal year for spending (defaults to current federal FY).'),
    },
  },
  async ({ agency, fiscal_year }) => {
    const result = await getAgencyIntel({ agency, fiscal_year });
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  },
);

server.registerTool(
  'search_grants',
  {
    title: 'Search Grants (Grants.gov)',
    description:
      'Federal GRANT opportunities from Grants.gov ($700B+ assistance funding — a different lane than SAM.gov ' +
      'contracts). Search by keyword / agency / funding category. Grants are assistance (different application ' +
      'path than contracts). grounded=false when nothing matches — broaden the keyword.',
    inputSchema: {
      keyword: z.string().optional().describe('Search term, e.g. "broadband".'),
      agency: z.string().optional().describe('Top-level agency code, e.g. "DOD"/"HHS" (client-side prefix filter).'),
      category: z.string().optional().describe('Grants.gov funding category code, e.g. "HL"/"ST".'),
      status: z.enum(['posted', 'forecasted', 'closed', 'archived']).optional().describe('Status (default posted).'),
      limit: z.number().int().min(1).max(100).optional().describe('Max results (default 25).'),
    },
  },
  async ({ keyword, agency, category, status, limit }) => {
    const result = await grantsSearch({ keyword, agency, category, status, limit });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result as unknown as Record<string, unknown> };
  },
);

server.registerTool(
  'get_agency_forecasts',
  {
    title: 'Get Agency Forecasts',
    description:
      'Upcoming federal procurement FORECASTS — planned buys 6-18 months before a solicitation posts (~7,700 ' +
      'records, ~12 agencies). Filter by NAICS / agency / state / set-aside / fiscal year / keyword. A forecast ' +
      'is a PLAN, not a posted opportunity — dates slip. grounded=false may be a coverage gap, not no demand.',
    inputSchema: {
      naics: z.string().optional().describe('NAICS code(s), comma-separated; ≤4 digits = prefix.'),
      agency: z.string().optional().describe('Source agency, case-insensitive partial.'),
      state: z.string().optional().describe('Place-of-performance state (full name matches best).'),
      set_aside: z.string().optional().describe('Set-aside type, e.g. "8(a)".'),
      fiscal_year: z.string().optional().describe('Fiscal year, "FY2026" or "2026".'),
      keyword: z.string().optional().describe('Free-text over title + description.'),
      limit: z.number().int().min(1).max(200).optional().describe('Max results (default 25).'),
    },
  },
  async ({ naics, agency, state, set_aside, fiscal_year, keyword, limit }) => {
    const result = await agencyForecasts({ naics, agency, state, set_aside, fiscal_year, keyword, limit });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result as unknown as Record<string, unknown> };
  },
);

server.registerTool(
  'search_sbir',
  {
    title: 'Search SBIR/STTR',
    description:
      'SBIR/STTR small-business R&D from NIH RePORTER (awarded projects — who won what) + a multisite aggregate ' +
      'of open notices. source="nih" = awarded NIH projects; source="multisite"/"all" = open notices. Filter by ' +
      'keyword / agency / phase. grounded=false when nothing matches — try source="all".',
    inputSchema: {
      keyword: z.string().optional().describe('Search term, e.g. "machine learning".'),
      agency: z.string().optional().describe('NIH institute (NCI, NIAID) or broad agency (NSF, DOD).'),
      phase: z.enum(['1', '2', 'all']).optional().describe('SBIR/STTR phase (default all).'),
      source: z.enum(['nih', 'multisite', 'all']).optional().describe('Data source (default nih = awarded NIH projects).'),
      limit: z.number().int().min(1).max(50).optional().describe('Max results (default 25).'),
    },
  },
  async ({ keyword, agency, phase, source, limit }) => {
    const result = await sbirSearch({ keyword, agency, phase, source, limit });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result as unknown as Record<string, unknown> };
  },
);

server.registerTool(
  'get_expiring_contracts',
  {
    title: 'Get Expiring Contracts (Recompetes)',
    description:
      'Federal contracts EXPIRING soon — recompete targets ("who is about to lose their contract"). Filter by ' +
      'NAICS / agency / state / expiration window (months) / value / recompete-likelihood; soonest-expiring first. ' +
      'A multiple-award IDIQ appears as several rows (one per holder). grounded=false — widen months_window.',
    inputSchema: {
      naics: z.string().optional().describe('NAICS code; ≤5 digits = prefix, 6 = exact.'),
      agency: z.string().optional().describe('Agency name, case-insensitive partial.'),
      state: z.string().optional().describe('2-letter place-of-performance state.'),
      months_window: z.number().int().min(1).max(60).optional().describe('Expiration window in months (default 18).'),
      min_value: z.number().optional().describe('Minimum obligated dollars.'),
      max_value: z.number().optional().describe('Maximum obligated dollars.'),
      likelihood: z.enum(['high', 'medium', 'low']).optional().describe('Recompete-likelihood filter.'),
      limit: z.number().int().min(1).max(200).optional().describe('Max results (default 25).'),
    },
  },
  async ({ naics, agency, state, months_window, min_value, max_value, likelihood, limit }) => {
    const result = await expiringContracts({ naics, agency, state, months_window, min_value, max_value, likelihood, limit });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result as unknown as Record<string, unknown> };
  },
);

server.registerTool(
  'get_agency_budget_trends',
  {
    title: 'Get Agency Budget Trends (OMB/CBJ)',
    description:
      "An agency's discretionary budget authority + the FY2025→FY2026 trend (growing / cut / stable) — where the money " +
      'is moving BEFORE it becomes awards. Pass an agency name or abbreviation ("VA", "Department of Defense", "NASA", ' +
      '"EPA"). Returns FY25 (enacted) + FY26 (President\'s request) budget authority, $ + % change, and the trend. ' +
      'DISCRETIONARY budget authority only (not total obligations); FY26 is a request, not enacted. grounded=false = ' +
      'agency not in the 47-agency toptier set — do NOT invent a number.',
    inputSchema: {
      agency: z.string().describe('Agency name or abbreviation, e.g. "VA", "Department of Defense", "NASA".'),
    },
  },
  async ({ agency }) => {
    const result = getAgencyBudgetTrends({ agency });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result as unknown as Record<string, unknown> };
  },
);

server.registerTool(
  'derive_company_keywords',
  {
    title: 'Derive Company Keywords (semantic)',
    description:
      "Turn a company's OWN words (what they do + past performance) into the search keywords buyers actually use, ranked " +
      'by MEANING. NAICS is the wrong discovery key; a company\'s real vocabulary finds the market its codes miss. Pass a ' +
      'description and/or past-performance scope descriptions (the richest signal). Returns ranked keywords to feed an ' +
      'opportunity search. Semantic embeddings (no BigQuery); fails soft to lexical order if embeddings are down ' +
      '(_meta.ranked). grounded=false = not enough input text — do NOT invent keywords.',
    inputSchema: {
      description: z.string().optional().describe('What the company does — one-liner / pitch / capability summary.'),
      past_performance: z.array(z.string()).optional().describe('Past-performance scope descriptions (richest signal).'),
      capabilities: z.array(z.string()).optional().describe('Capability / service descriptions.'),
      code_titles: z.array(z.string()).optional().describe('NAICS/PSC title text the caller already knows (optional).'),
      limit: z.number().int().min(1).max(25).optional().describe('Max keywords (default 12).'),
    },
  },
  async ({ description, past_performance, capabilities, code_titles, limit }) => {
    const result = await deriveCompanyKeywords({ description, past_performance, capabilities, code_titles, limit });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result as unknown as Record<string, unknown> };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    '[mindy-mcp] stdio server ready — playbook + pricing-intel + incumbent-financials + regulatory-demand + award-detail + predecessor-award + sam-entity + search-contractors + agency-intel + grants + forecasts + sbir + expiring-contracts + agency-budget-trends + company-keywords registered',
  );
}

main().catch((err) => {
  console.error('[mindy-mcp] fatal:', err);
  process.exit(1);
});
