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
import { getKeywordCoverage } from './tools/keyword-coverage';
import { idvContracts } from './tools/idv-contracts';
import { contractorAwardHistory } from './tools/contractor-award-history';
import { assessMarketDepth } from './tools/market-depth';
import { solicitationDocuments } from './tools/solicitation-documents';
import { searchFederalEvents } from './tools/federal-events';
import { scanProposalCompliance } from './tools/scan-compliance';
import { evaluateBidDecisionTool } from './tools/bid-decision';
import { lookupFederalOsbp } from './tools/federal-osbp';
import { searchAgencyOppsByOffice } from './tools/agency-opps-by-office';
import { getSbloContact } from './tools/sblo-contact';
import { searchFederalContacts } from './tools/federal-contacts';
import { searchPodcastLessons } from './tools/podcast-lessons';
import { getAgencyBudgetTrends } from './tools/agency-budget-trends';
import { deriveCompanyKeywords } from './tools/company-keywords';
import { getAgencySpendingDetailTool } from './tools/agency-spending-detail';
import { extractComplianceMatrix } from './tools/compliance-matrix';
import { buildProposalStructureTool } from './tools/proposal-structure';
import { refereeProposalCompliance } from './tools/referee-compliance';

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
  'get_keyword_coverage',
  {
    title: 'Get Keyword Market Coverage',
    description:
      'Market coverage for a PRODUCT/SERVICE keyword (e.g. "drones"). Returns total federal market $, every NAICS ' +
      'that bought it (ranked), the smallest NAICS set covering ~90%, and the top PSCs ("what was bought"). The ' +
      'lesson: a single obvious NAICS is often ~28% of the market — search it alone and you miss the rest. ' +
      'grounded=false when no spending matches.',
    inputSchema: {
      keyword: z.string().describe('Product/service term. Single significant words match best (exact-phrase search).'),
      coverage_target: z.number().min(0.5).max(0.99).optional().describe('Fraction of market to cover (default 0.9).'),
    },
  },
  async ({ keyword, coverage_target }) => {
    const result = await getKeywordCoverage({ keyword, coverage_target });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result as unknown as Record<string, unknown> };
  },
);

server.registerTool(
  'search_idv_contracts',
  {
    title: 'Search IDV Contracts & Task Orders',
    description:
      'Indefinite-Delivery Vehicles (IDIQ/GWAC/BPA) and the task orders flowing through them. search_type:"idv" = ' +
      'base vehicles you must be ON; search_type:"task" = the orders being placed through them. Filter by NAICS / ' +
      'PSC / agency / state / min value / date range. grounded=false when nothing matches.',
    inputSchema: {
      naics: z.string().optional().describe('NAICS code.'),
      psc: z.string().optional().describe('Product/Service Code.'),
      agency: z.string().optional().describe('Awarding agency name.'),
      state: z.string().optional().describe('2-letter state.'),
      min_value: z.number().optional().describe('Minimum award amount (dollars).'),
      date_from: z.string().optional().describe('Action date lower bound (YYYY-MM-DD).'),
      date_to: z.string().optional().describe('Action date upper bound (YYYY-MM-DD).'),
      search_type: z.enum(['idv', 'task']).optional().describe('"idv" = base vehicles (default); "task" = task orders.'),
      limit: z.number().int().min(1).max(100).optional().describe('Max results per page (default 25).'),
      page: z.number().int().min(1).optional().describe('1-based page number.'),
    },
  },
  async ({ naics, psc, agency, state, min_value, date_from, date_to, search_type, limit, page }) => {
    const result = await idvContracts({ naics, psc, agency, state, min_value, date_from, date_to, search_type, limit, page });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result as unknown as Record<string, unknown> };
  },
);

server.registerTool(
  'get_contractor_award_history',
  {
    title: 'Get Contractor Award History',
    description:
      "A named contractor's federal prime-award history: total obligations, award count, year-over-year trend, top " +
      'agencies, top NAICS, recent awards. Size up a competitor, teammate, or incumbent. Name matching is fuzzy — ' +
      'check match.confidence. grounded=false when no cached award history.',
    inputSchema: {
      company: z.string().describe('Contractor name (legal business name matches best).'),
      award_limit: z.number().int().min(1).max(100).optional().describe('Max recent awards to return.'),
    },
  },
  async ({ company, award_limit }) => {
    const result = await contractorAwardHistory({ company, award_limit });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result as unknown as Record<string, unknown> };
  },
);

server.registerTool(
  'assess_market_depth',
  {
    title: 'Assess Market Depth (Rule of Two)',
    description:
      'Rule-of-Two market-depth determination for a NAICS (+ optional set-aside / state): how many CAPABLE small ' +
      'businesses exist, whether the Rule of Two is met (≥2 → set-aside supportable), a scored/tiered vendor list, ' +
      'and memo-ready caveats. registered_only firms never inflate the count. grounded=false when none are capable.',
    inputSchema: {
      naics: z.string().describe('NAICS code (6-digit).'),
      state: z.string().optional().describe('2-letter state to scope the market geographically.'),
      set_aside: z.string().optional().describe("Normalized: '8(a)','HUBZone','SDVOSB','WOSB','EDWOSB','Small Business'."),
      include_emerging: z.boolean().optional().describe('Include emerging (registered, not-yet-performed) firms (default true).'),
      limit: z.number().int().min(1).max(200).optional().describe('Max businesses to return.'),
    },
  },
  async ({ naics, state, set_aside, include_emerging, limit }) => {
    const result = await assessMarketDepth({ naics, state, set_aside, include_emerging, limit });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result as unknown as Record<string, unknown> };
  },
);

server.registerTool(
  'get_solicitation_documents',
  {
    title: 'Get Solicitation Documents (SOW + attachments)',
    description:
      'Full text + downloadable raw files for a SAM solicitation by notice_id — the SOW/PWS, notice body, and every ' +
      'attachment. Returns inline extracted_text (capped; check *_truncated) + a short-lived signed download_url ' +
      '(~1h) to the full raw PDF/DOCX so an agent can feed it to a design tool (Canva) or re-parse it. Cold notices ' +
      'are downloaded + extracted on demand. grounded=false when the notice has no text/attachments.',
    inputSchema: {
      notice_id: z.string().describe('SAM notice id (UUID) or solicitation number — from search_sam_opportunities.'),
    },
  },
  async ({ notice_id }) => {
    const result = await solicitationDocuments({ notice_id });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result as unknown as Record<string, unknown> };
  },
);

server.registerTool(
  'search_federal_events',
  {
    title: 'Search Federal Events (industry days, matchmaking)',
    description:
      'Upcoming federal-contracting events for an agency — industry days, matchmaking, sources-sought, association ' +
      'conferences. "Where do I show up to win this buyer?" Dated SAM.gov Special Notices (source="sam") + optional ' +
      'web-discovered conferences (source="ai", verify before attending). grounded=false when none match.',
    inputSchema: {
      agency: z.string().describe('Agency name, e.g. "Department of Defense", "Navy", "GSA".'),
      months_ahead: z.number().int().min(1).max(12).optional().describe('Look-ahead window in months (default 4).'),
      include_ai_discovery: z.boolean().optional().describe('Also web-search for association conferences not in SAM (slower). Default false.'),
      limit: z.number().int().min(1).max(100).optional().describe('Max SAM events (default 25).'),
    },
  },
  async ({ agency, months_ahead, include_ai_discovery, limit }) => {
    const result = await searchFederalEvents({ agency, months_ahead, include_ai_discovery, limit });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result as unknown as Record<string, unknown> };
  },
);

server.registerTool(
  'scan_proposal_compliance',
  {
    title: 'Scan Proposal Compliance (pre-submit DQ check)',
    description:
      'Pre-submit disqualification check: given the RFP requirements + a proposal draft, flag what could get the bid ' +
      'THROWN OUT — missed deadline, ineligible set-aside, page-limit overage, missing reps/certs or required plans, ' +
      'unaddressed evaluation factors. Returns findings with severity dq/warning/info + an at_risk flag. ' +
      'Deterministic (no AI). Pair with extract_compliance_matrix for the requirements list.',
    inputSchema: {
      requirements: z
        .array(
          z.object({
            requirement: z.string().describe('The requirement text (a shall-statement).'),
            category: z.string().optional().describe('Category hint (submission/evaluation/technical/…).'),
            section: z.string().optional().describe('RFP section, e.g. "L.3.2", "M.2".'),
            id: z.string().optional(),
          }),
        )
        .describe('RFP requirements to check against (from extract_compliance_matrix or your own read).'),
      draft_text: z.string().describe('The full proposal / response text (all sections concatenated).'),
      sections: z
        .array(z.object({ label: z.string(), text: z.string() }))
        .optional()
        .describe('Optional per-section drafts for finer page/coverage checks.'),
      bidder_set_asides: z.array(z.string()).optional().describe('Set-asides the bidder actually holds (e.g. ["8(a)","WOSB"]).'),
    },
  },
  async ({ requirements, draft_text, sections, bidder_set_asides }) => {
    const result = scanProposalCompliance({ requirements, draft_text, sections, bidder_set_asides });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result as unknown as Record<string, unknown> };
  },
);

server.registerTool(
  'evaluate_bid_decision',
  {
    title: 'Evaluate Bid Decision (GovCon bid/no-bid framework)',
    description:
      "GovCon Giants' bid / no-bid framework. ALWAYS returns the framework — the 5 universal eliminator GATES + the " +
      '10-factor scorecard — so you know exactly what to assess. When you also pass gate answers + factor ratings, it ' +
      'SCORES the card: any failed gate = automatic No-Bid; otherwise pursue (≥70) / watch (40–69) / skip (<40). Call ' +
      'once with no args to learn the rubric, then again with your assessment.',
    inputSchema: {
      gates: z.record(z.string(), z.boolean()).optional().describe('gateId → passed? (true/false). A false on any = No-Bid.'),
      ratings: z.record(z.string(), z.number()).optional().describe('factorId → 0-10.'),
    },
  },
  async ({ gates, ratings }) => {
    const result = evaluateBidDecisionTool({ gates, ratings });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result as unknown as Record<string, unknown> };
  },
);

server.registerTool(
  'lookup_federal_osbp',
  {
    title: 'Lookup Federal OSBP / Small Business Office',
    description:
      'The Office of Small Business Programs (OSBP/OSDBU) — the small-business front door — for a federal command ' +
      'or agency. Pass a command/agency name or abbreviation ("NAVFAC", "USACE", "Department of the Navy"). Returns ' +
      'the OSBP office, director (+ director_verified YYYY-MM stamp; names rotate, mailboxes are stable), contact ' +
      'info, acquisition office, forecast URL, and key capabilities. A parent-agency input returns all its commands\' ' +
      'offices. grounded=false = not in the curated (DoD/DLA/Navy/Army-weighted) directory — do NOT invent a contact.',
    inputSchema: {
      agency: z
        .string()
        .describe('Command/agency name or abbreviation, e.g. "NAVFAC", "USACE", "DLA Aviation", "Department of the Navy".'),
    },
  },
  async ({ agency }) => {
    const result = lookupFederalOsbp({ agency });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result as unknown as Record<string, unknown> };
  },
);

server.registerTool(
  'search_agency_opps_by_office',
  {
    title: 'Search Agency Opps by Office (DoDAAC-anchored)',
    description:
      'Open SAM.gov solicitations anchored to a specific BUYING OFFICE, not the whole department. A DoD sub-agency ' +
      '(a USACE district, DARPA, MDA) shares one department label, so a department filter returns the whole-DoD ' +
      'firehose; this anchors on the 6-char DoDAAC prefixing the solicitation number (W912PL = USACE LA District) ' +
      'for THAT office\'s open buys. Pass a command/agency name OR a 6-char DoDAAC, + optional NAICS/state. ' +
      '_meta.anchor="dodaac" = office-precise; "department" = broad civilian preview. grounded=false + ' +
      'anchor="dodaac" = genuinely nothing open now.',
    inputSchema: {
      agency: z.string().optional().describe('Command / agency / sub-agency name, e.g. "USACE", "Naval Sea Systems Command".'),
      dodaac: z.string().optional().describe('A known 6-char DoDAAC (e.g. "W912PL"); takes precedence over agency.'),
      naics: z.string().optional().describe('NAICS filter; ≤4 digits = prefix, 6 = exact.'),
      state: z.string().optional().describe('2-letter place-of-performance state.'),
      limit: z.number().int().min(1).max(100).optional().describe('Max results (default 25).'),
    },
  },
  async ({ agency, dodaac, naics, state, limit }) => {
    const result = await searchAgencyOppsByOffice({ agency, dodaac, naics, state, limit });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result as unknown as Record<string, unknown> };
  },
);

server.registerTool(
  'get_sblo_contact',
  {
    title: 'Get SBLO Contact (prime teaming front door)',
    description:
      'The Small Business Liaison Officer (SBLO) at a prime contractor — WHO to call to team on a subcontract. Pass a ' +
      'company name ("AECOM", "Booz Allen Hamilton", "Leidos"). Curated data: the canonical 200-company Jun-2026 SBLO ' +
      'roster first, then the broader 3,502-prime DB. Returns SBLO name, title, email, phone, supplier portal, source. ' +
      'A matched company with a blank name/email means no public SBLO was found (surfaces the supplier portal instead) ' +
      '— it NEVER invents a contact. grounded=false = company not in the curated set.',
    inputSchema: {
      company: z.string().describe('Prime contractor / company name, e.g. "AECOM", "Leidos".'),
    },
  },
  async ({ company }) => {
    const result = getSbloContact({ company });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result as unknown as Record<string, unknown> };
  },
);

server.registerTool(
  'search_federal_contacts',
  {
    title: 'Search Federal Contacts (DoDAAC-anchored buying-office roster)',
    description:
      'The named PEOPLE at a federal buying office — contracting officers, contract specialists, small-business POCs — ' +
      'anchored on the office\'s 6-char DoDAAC so a DoD sub-agency returns ITS people, not the whole-DoD firehose. Pass ' +
      'an agency/command name OR a 6-char DoDAAC (+ optional office/role/search). The agency\'s OSBP contact is prepended ' +
      'as the front door. _meta.anchor: "dodaac"/"agency-dodaac" = office-precise; "department" = broad civilian preview. ' +
      'Overseas offices filtered out. grounded=false = no matching contacts (never an invented POC).',
    inputSchema: {
      agency: z.string().optional().describe('Agency / command / sub-agency name, e.g. "USACE", "Department of Veterans Affairs".'),
      dodaac: z.string().optional().describe('A known 6-char DoDAAC (e.g. "W912PL") — most precise; anchors on the office.'),
      office: z.string().optional().describe('Office name filter (SAM office column; often null for POCs).'),
      role: z.string().optional().describe('role_category filter (e.g. "contracting_officer", "small_business").'),
      search: z.string().optional().describe('Free-text match on contact name OR title.'),
      limit: z.number().int().min(1).max(200).optional().describe('Max contacts (default 25).'),
    },
  },
  async ({ agency, dodaac, office, role, search, limit }) => {
    const result = await searchFederalContacts({ agency, dodaac, office, role, search, limit });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result as unknown as Record<string, unknown> };
  },
);

server.registerTool(
  'search_podcast_lessons',
  {
    title: 'Search Podcast Lessons (proprietary corpus)',
    description:
      "The proprietary GovCon Giants podcast corpus — real lessons from real contractor/agency guests, matched by topic / " +
      'agency / NAICS / set-aside / guest name. Un-copyable moat content. Returns episode cards with their key_lessons, ' +
      'guest, agencies/NAICS mentioned. grounded=false when nothing matches — do NOT invent a lesson or attribute an ' +
      'invented quote to a guest; every lesson must trace to a returned episode.',
    inputSchema: {
      query: z.string().describe('Free-text: topic, agency, NAICS, set-aside, or a guest name.'),
      limit: z.number().int().min(1).max(12).optional().describe('Max episodes (default 4).'),
    },
  },
  async ({ query, limit }) => {
    const result = await searchPodcastLessons({ query, limit });
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

server.registerTool(
  'get_agency_spending_detail',
  {
    title: 'Get Agency Spending Detail (components + set-asides)',
    description:
      '"Who inside this department buys, and can a small business win here." Complements get_agency_intel with the ' +
      'sub-agency (component) spending breakdown + the set-aside distribution (Small Business / 8(a) / SDVOSB / WOSB / ' +
      'HUBZone shares + overall small-business share) — the small-business easy-entry read. Live USASpending contract ' +
      'obligations (award types A/B/C/D) for a fiscal year. grounded=false = no toptier agency matched; degraded=true = ' +
      'USASpending errored (not $0). Contract obligations only, NOT total agency budget.',
    inputSchema: {
      agency: z.string().describe('Agency name or abbreviation, e.g. "Department of Defense", "VA", "NASA".'),
      fiscal_year: z.number().int().optional().describe('Fiscal year (defaults to the latest complete FY).'),
    },
  },
  async ({ agency, fiscal_year }) => {
    const result = await getAgencySpendingDetailTool({ agency, fiscal_year });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result as unknown as Record<string, unknown> };
  },
);

server.registerTool(
  'extract_compliance_matrix',
  {
    title: 'Extract Compliance Matrix (RFP requirements)',
    description:
      'Harvest EVERY explicit requirement from a federal solicitation into a structured compliance matrix — the ' +
      'shall/must/required obligations plus Section L (instructions), M (evaluation factors), and C (SOW/PWS). Pass ONE ' +
      'of: notice_id (fetches the SOW + body + attachment text server-side) OR rfp_text (the solicitation text directly). ' +
      'Each row: {requirement, category, section, source_quote (verbatim)}. grounded=false = nothing extractable — do ' +
      'NOT invent requirements. Single-doc only: it does not merge amendments over the base.',
    inputSchema: {
      notice_id: z.string().optional().describe('SAM notice id (UUID) or solicitation number — fetches the doc text server-side.'),
      rfp_text: z.string().optional().describe('The solicitation text directly (use when you already have it).'),
    },
  },
  async ({ notice_id, rfp_text }) => {
    const result = await extractComplianceMatrix({ notice_id, rfp_text });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result as unknown as Record<string, unknown> };
  },
);

server.registerTool(
  'build_proposal_structure',
  {
    title: 'Build Proposal Structure (outline from compliance matrix)',
    description:
      'Turn a compliance matrix into the volume → section outline a federal proposal must follow — the next step after ' +
      'extract_compliance_matrix. Pass its `requirements` array and get back the volumes (Technical, Past Performance, ' +
      'Price, Forms), the sections under each, the critical deadline/cert items to handle first, and the cross-cutting ' +
      'format/admin rules that apply across all volumes. Pure shaping (no AI): it neither invents requirements nor drafts ' +
      'content. grounded=false = no requirements supplied — run extract_compliance_matrix first.',
    inputSchema: {
      requirements: z
        .array(
          z.object({
            requirement: z.string().describe('The obligation text (required).'),
            category: z.string().optional().describe('submission|evaluation|technical|past_performance|pricing|admin|other (coerced if free-form).'),
            section: z.string().optional().describe('The L/M/C clause label, if known (e.g. L.3.2).'),
            id: z.string().optional().describe('Stable id (e.g. REQ-001), if you have one.'),
          }),
        )
        .describe('The compliance matrix — pass the requirements[] from extract_compliance_matrix.'),
    },
  },
  async ({ requirements }) => {
    const result = buildProposalStructureTool({ requirements });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result as unknown as Record<string, unknown> };
  },
);

server.registerTool(
  'referee_proposal_compliance',
  {
    title: 'Referee Proposal Compliance (independent draft check)',
    description:
      'The closing step of a proposal: run an assembled draft past an INDEPENDENT compliance referee (a fresh model that ' +
      'did not write it) and get a per-requirement verdict — met / partial / missing — with evidence and an overall ' +
      'compliance score. Pass the `requirements` from extract_compliance_matrix plus your `draft` text. Fix every ' +
      'missing/partial item, then re-referee. grounded=false when no requirements OR no draft is supplied.',
    inputSchema: {
      requirements: z
        .array(
          z.object({
            requirement: z.string().describe('The obligation text (required).'),
            category: z.string().optional().describe('submission|evaluation|technical|past_performance|pricing|admin|other (optional).'),
            section: z.string().optional().describe('The L/M/C clause label, e.g. L.3.2 (optional).'),
            id: z.string().optional().describe('Stable id, e.g. REQ-001 (optional).'),
          }),
        )
        .describe('The compliance matrix — pass the requirements[] from extract_compliance_matrix.'),
      draft: z.string().describe('The assembled proposal draft text to evaluate (read up to the first 24,000 chars).'),
    },
  },
  async ({ requirements, draft }) => {
    const result = await refereeProposalCompliance({ requirements, draft });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result as unknown as Record<string, unknown> };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    '[mindy-mcp] stdio server ready — playbook + pricing-intel + incumbent-financials + regulatory-demand + award-detail + predecessor-award + sam-entity + search-contractors + agency-intel + grants + forecasts + sbir + expiring-contracts + keyword-coverage + idv-contracts + contractor-award-history + market-depth + solicitation-documents + federal-events + scan-compliance + bid-decision + federal-osbp + agency-opps-by-office + sblo-contact + federal-contacts + podcast-lessons + agency-budget-trends + company-keywords + agency-spending-detail + compliance-matrix + proposal-structure + referee-compliance registered',
  );
}

main().catch((err) => {
  console.error('[mindy-mcp] fatal:', err);
  process.exit(1);
});
