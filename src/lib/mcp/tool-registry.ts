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
import { getSolicitationIncumbent } from '@/mcp/tools/solicitation-incumbent';
import { lookupSamEntity } from '@/mcp/tools/sam-entity';
import { searchContractors } from '@/mcp/tools/search-contractors';
import { getAgencyIntel } from '@/mcp/tools/agency-intel';
import { grantsSearch } from '@/mcp/tools/grants';
import { agencyForecasts } from '@/mcp/tools/forecasts';
import { sbirSearch } from '@/mcp/tools/sbir';
import { expiringContracts } from '@/mcp/tools/expiring-contracts';
import { getKeywordCoverage } from '@/mcp/tools/keyword-coverage';
import { idvContracts } from '@/mcp/tools/idv-contracts';
import { contractorAwardHistory } from '@/mcp/tools/contractor-award-history';
import { assessMarketDepth } from '@/mcp/tools/market-depth';
import { solicitationDocuments } from '@/mcp/tools/solicitation-documents';
import { searchFederalEvents } from '@/mcp/tools/federal-events';
import { scanProposalCompliance } from '@/mcp/tools/scan-compliance';
import { evaluateBidDecisionTool } from '@/mcp/tools/bid-decision';
import { lookupFederalOsbp } from '@/mcp/tools/federal-osbp';
import { searchAgencyOppsByOffice } from '@/mcp/tools/agency-opps-by-office';
import { getSbloContact } from '@/mcp/tools/sblo-contact';
import { searchFederalContacts } from '@/mcp/tools/federal-contacts';
import { searchPodcastLessons } from '@/mcp/tools/podcast-lessons';
import { getAgencyBudgetTrends } from '@/mcp/tools/agency-budget-trends';
import { deriveCompanyKeywords } from '@/mcp/tools/company-keywords';
import { getAgencySpendingDetailTool } from '@/mcp/tools/agency-spending-detail';
import { extractComplianceMatrix } from '@/mcp/tools/compliance-matrix';
import { buildProposalStructureTool, type ProposalStructureInputReq } from '@/mcp/tools/proposal-structure';
import { refereeProposalCompliance, type RefereeInputReq } from '@/mcp/tools/referee-compliance';
import { matchRecompeteSowTool } from '@/mcp/tools/recompete-sow';
import { extractStatementOfWork } from '@/mcp/tools/statement-of-work';
import { getFederalEventSeries } from '@/mcp/tools/event-series';
import { getSbaGoalingShare } from '@/mcp/tools/sba-goaling';
import { draftProposal, draftProposalSection } from '@/mcp/tools/draft-proposal';
import { exportProposal } from '@/mcp/tools/export-proposal';
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
  get_solicitation_incumbent: 2, // SAM notice (sol#) + USASpending prior-award inference
  lookup_sam_entity: 1, // SAM Entity Management API (single lookup/search)
  search_contractors: 2, // live BigQuery recipients scan (competitive landscape)
  get_agency_intel: 1, // agency resolve (local) + USASpending obligations (free)
  search_grants: 1, // Grants.gov search (single free upstream call)
  get_agency_forecasts: 1, // Supabase agency_forecasts read
  search_sbir: 1, // NIH RePORTER + multisite aggregate
  get_expiring_contracts: 1, // Supabase recompete_opportunities read
  get_keyword_coverage: 1, // USASpending spending-by-category (free upstream, cacheable)
  search_idv_contracts: 2, // live USASpending IDV/task-order search
  get_contractor_award_history: 2, // USASpending cache + contractor DB
  assess_market_depth: 2, // Supabase sam_entities + BQ recipients activity enrich
  get_solicitation_documents: 3, // full-text + raw-file delivery (cold path downloads + extracts on demand)
  search_federal_events: 2, // Supabase sam_events read + optional paid AI web discovery (Serper+Groq)
  scan_proposal_compliance: 1, // pure deterministic DQ-risk scan (no LLM/IO)
  evaluate_bid_decision: 1, // pure GovCon bid/no-bid framework + scorer (no LLM/IO)
  lookup_federal_osbp: 1, // curated DoD command / OSBP directory (static, no LLM/IO)
  search_agency_opps_by_office: 1, // DoDAAC-anchored open SAM opps (Supabase read)
  get_sblo_contact: 2, // curated SBLO roster + prime DB, then a live BigQuery prime-verification fallback
  search_federal_contacts: 2, // DoDAAC-anchored buying-office roster (Supabase read + decode)
  search_podcast_lessons: 1, // proprietary podcast corpus (Supabase keyword search)
  get_agency_budget_trends: 1, // curated OMB/CBJ budget-authority JSON (static, no LLM/IO)
  derive_company_keywords: 1, // OpenAI-embedding keyword derivation (no BigQuery)
  get_agency_spending_detail: 2, // multiple USASpending aggregates (total + subagency + set-aside buckets)
  extract_compliance_matrix: 3, // LLM-backed RFP requirement extraction (chunked+parallel; shared cache warms public notices)
  build_proposal_structure: 1, // pure shaping — compliance matrix → volume/section tree (no LLM/IO)
  referee_proposal_compliance: 4, // independent Claude referee (no-training/sensitive) — draft vs matrix, per-req verdicts
  match_recompete_sow: 2, // embed + vector scan over the sam_opportunities SOW corpus (Mindy embeddings moat)
  extract_statement_of_work: 2, // SOW/PWS heading detection over solicitation text (+ notice fetch, CLIN fallback)
  get_federal_event_series: 1, // curated recurring-event catalog (static read, no IO)
  get_sba_goaling_share: 2, // statutory SB goals vs actual set-aside obligations (USASpending aggregates)
  draft_proposal: 50, // full multi-section proposal draft (two-pass outline + parallel per-section LLM generation, vault+RAG grounded)
  draft_proposal_section: 12, // single-section vault+RAG-grounded draft (one LLM generation pass)
  export_proposal: 2, // deterministic .docx assembly from supplied sections (docx lib, no LLM/IO)
  get_balance: 0, // meta tool — always free
};

/**
 * Proprietary tools whose RESULTS are the un-copyable moat — they return curated /
 * teaching content (corpus passages, extracted lessons, curated contact rows), NOT a
 * public-API passthrough. These are the ONLY tools the extraction guard protects
 * (Layers A+B, `src/lib/mcp/extraction-guard.ts`); the public-data wrappers wrap free
 * APIs and are deliberately left ungated (nothing to steal + gating kills day-one
 * utility). Curated-but-public-source tools (search_federal_contacts / get_agency_intel)
 * are intentionally NOT here — their underlying data is public SAM/curated intel.
 */
export const PROPRIETARY_TOOLS: ReadonlySet<string> = new Set([
  'get_winning_playbook', // the teaching corpus — the crown jewel
  'search_podcast_lessons', // extracted key_lessons from the proprietary podcast corpus
  'get_sblo_contact', // curated 200-prime SBLO teaming roster
  'lookup_federal_osbp', // curated DoD command / OSBP directory
]);

/** True if `name` is a proprietary tool the extraction guard should protect. */
export function isProprietaryTool(name: string): boolean {
  return PROPRIETARY_TOOLS.has(name);
}

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
      'NAICS/PSC, funding account. Pass a contract number (PIID) OR a generated_internal_id. Do NOT pass a ' +
      'SAM solicitation/RFQ number — use get_solicitation_incumbent for those. Returns grounded=false when ' +
      'no award matches — do not invent figures.',
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
      '"likely". Returns grounded=false when no good match exists. Prefer get_solicitation_incumbent when ' +
      'the user only has a solicitation NUMBER (RFQ/sol#) — that tool resolves the notice first.',
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

/** Sol # / notice UUID → open notice + likely prior award (Chat "who held this?" path). */
const SOLICITATION_INCUMBENT_TOOL_DEF = {
  type: 'function' as const,
  function: {
    name: 'get_solicitation_incumbent',
    description:
      'PRIMARY tool when the user pastes a SAM solicitation number (e.g. 140L6226Q0013) or notice UUID ' +
      'and asks who won the prior work, what it cost, or "was this awarded before." Resolves the OPEN ' +
      'solicitation on SAM, then finds the LIKELY prior award on USASpending (recipient, PIID, ceiling, ' +
      'expiry). Do NOT call get_award_detail with an RFQ/solicitation number — those are not award PIIDs. ' +
      'grounded_notice=false = sol# not found; grounded_incumbent=false = notice found but no clear prior award.',
    parameters: {
      type: 'object',
      properties: {
        solicitation_number: {
          type: 'string',
          description: 'SAM solicitation number, e.g. "140L6226Q0013".',
        },
        notice_id: {
          type: 'string',
          description: 'Optional SAM notice UUID (32-char hex) if that is what the user pasted.',
        },
      },
      required: [],
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
      'certifications (8(a), HUBZone, …), location, AND the company\'s registered points of contact ' +
      '(government-business / electronic-business / past-performance POC NAMES). The "is this vendor real, ' +
      'registered, set-aside eligible, and who is registered on their SAM profile?" check. Pass a UEI for an ' +
      'exact entity, or a company name to search (the top match is auto-enriched with its POC block). ' +
      'IMPORTANT: SAM redacts POC email/phone on the public API — you get POC NAMES only, never invent an ' +
      'email/phone. Set-aside eligibility depends on the CURRENT status shown, not past awards.',
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

const SEARCH_CONTRACTORS_TOOL_DEF = {
  type: 'function' as const,
  function: {
    name: 'search_contractors',
    description:
      'The competitive landscape for a market: top federal contractors by total obligated dollars for a ' +
      'keyword / NAICS / state, with award count and how many distinct agencies each sells to (a capture ' +
      'signal — broad seller vs. single-buyer dependent). The "size up the competition / find teaming ' +
      'partners" lookup. Dollars are cumulative historical USASpending obligations, not a bid list. Returns ' +
      'grounded=false when nothing matches — broaden the NAICS prefix or drop the state; do not invent firms.',
    parameters: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: 'Free-text company-name match, e.g. "Booz".' },
        naics: { type: 'string', description: 'NAICS code(s), comma/space separated; 2-6 digit prefixes allowed, e.g. "541512".' },
        state: { type: 'string', description: 'Optional 2-letter state filter, e.g. "VA".' },
        sort_by: { type: 'string', enum: ['total_obligated', 'award_count', 'recipient_name'], description: 'Ranking (default total_obligated).' },
        limit: { type: 'number', description: 'Max rows (default 15, max 100).' },
      },
    },
  },
};

const AGENCY_INTEL_TOOL_DEF = {
  type: 'function' as const,
  function: {
    name: 'get_agency_intel',
    description:
      'Target-research read on a federal agency: resolves it by name / abbreviation / CGAC code, then returns ' +
      'identity + hierarchy, curated GovCon pain points & priorities, and (when available) live USASpending ' +
      'obligations for the fiscal year with top NAICS. The "size up a buyer before I pursue them" lookup. Pain ' +
      'points are curated intel, not an official statement. Returns grounded=false when no agency matches — ' +
      'try the full name or a CGAC code; do not guess an agency.',
    parameters: {
      type: 'object',
      properties: {
        agency: { type: 'string', description: 'Agency name, abbreviation, or CGAC code, e.g. "VA", "Department of Defense", or "069".' },
        fiscal_year: { type: 'number', description: 'Optional fiscal year for spending (defaults to current federal FY).' },
      },
      required: ['agency'],
    },
  },
};

const GRANTS_TOOL_DEF = {
  type: 'function' as const,
  function: {
    name: 'search_grants',
    description:
      'Federal GRANT opportunities from Grants.gov ($700B+ of assistance funding — a different lane than ' +
      'SAM.gov contracts). Search by keyword / agency / funding category. Returns title, agency, close date, ' +
      'award ceiling, CFDA, link. Grants are assistance (a different application path than contracts). ' +
      'grounded=false when nothing matches — broaden the keyword; do not invent grants.',
    parameters: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: 'Search term, e.g. "broadband" or "veteran health".' },
        agency: { type: 'string', description: 'Top-level agency code, e.g. "DOD" / "HHS" (client-side prefix filter).' },
        category: { type: 'string', description: 'Grants.gov funding category code, e.g. "HL" (health), "ST" (science).' },
        status: { type: 'string', enum: ['posted', 'forecasted', 'closed', 'archived'], description: 'Opportunity status (default posted).' },
        limit: { type: 'number', description: 'Max results (default 25, max 100).' },
      },
    },
  },
};

const FORECASTS_TOOL_DEF = {
  type: 'function' as const,
  function: {
    name: 'get_agency_forecasts',
    description:
      'Upcoming federal procurement FORECASTS — planned buys 6-18 months before a solicitation posts (the ' +
      '"get in early" signal, ~7,700 records across ~12 agencies). Filter by NAICS / agency / state / set-aside / ' +
      'fiscal year / keyword. Returns title, agency, NAICS, fiscal year+quarter, estimated value, set-aside, ' +
      'incumbent. A forecast is a PLAN, not a posted opportunity — dates slip and some cancel. grounded=false ' +
      'when nothing matches (may be a coverage gap, not absence of demand).',
    parameters: {
      type: 'object',
      properties: {
        naics: { type: 'string', description: 'NAICS code(s), comma-separated; ≤4 digits = prefix.' },
        agency: { type: 'string', description: 'Source agency, case-insensitive partial.' },
        state: { type: 'string', description: 'Place-of-performance state (full name matches best).' },
        set_aside: { type: 'string', description: 'Set-aside type, e.g. "8(a)", "SDVOSB".' },
        fiscal_year: { type: 'string', description: 'Fiscal year, "FY2026" or "2026".' },
        keyword: { type: 'string', description: 'Free-text over title + description.' },
        limit: { type: 'number', description: 'Max results (default 25, max 200).' },
      },
    },
  },
};

const SBIR_TOOL_DEF = {
  type: 'function' as const,
  function: {
    name: 'search_sbir',
    description:
      'SBIR/STTR small-business R&D opportunities from NIH RePORTER (awarded projects — competitive intel on ' +
      'who won what) + a multisite aggregate of open notices. source="nih" = awarded NIH projects; ' +
      'source="multisite"/"all" = open notices. Filter by keyword / agency / phase. Returns title, agency, ' +
      'phase, amount, organization, dates. grounded=false when nothing matches — try source="all".',
    parameters: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: 'Search term, e.g. "machine learning" or "vaccine".' },
        agency: { type: 'string', description: 'NIH institute (NCI, NIAID, …) or broad agency (NSF, DOD, …).' },
        phase: { type: 'string', enum: ['1', '2', 'all'], description: 'SBIR/STTR phase (default all).' },
        source: { type: 'string', enum: ['nih', 'multisite', 'all'], description: 'Data source (default nih = awarded NIH projects).' },
        limit: { type: 'number', description: 'Max results (default 25, max 50).' },
      },
    },
  },
};

const EXPIRING_CONTRACTS_TOOL_DEF = {
  type: 'function' as const,
  function: {
    name: 'get_expiring_contracts',
    description:
      'Federal contracts EXPIRING soon — recompete targets ("who is about to lose their contract so I can ' +
      'pursue it"). Filter by NAICS / agency / state / expiration window (months) / value / recompete-likelihood. ' +
      'Returns incumbent, agency, NAICS, obligated + ceiling value, period-of-performance end, recompete date, ' +
      'likelihood — soonest-expiring first. A multiple-award IDIQ appears as several rows (one per holder). ' +
      'grounded=false when nothing matches — widen months_window.',
    parameters: {
      type: 'object',
      properties: {
        naics: { type: 'string', description: 'NAICS code; ≤5 digits = prefix, 6 = exact.' },
        agency: { type: 'string', description: 'Agency name, case-insensitive partial.' },
        state: { type: 'string', description: '2-letter place-of-performance state.' },
        months_window: { type: 'number', description: 'Expiration window in months (default 18, max 60).' },
        min_value: { type: 'number', description: 'Minimum obligated dollars.' },
        max_value: { type: 'number', description: 'Maximum obligated dollars.' },
        likelihood: { type: 'string', enum: ['high', 'medium', 'low'], description: 'Recompete-likelihood filter.' },
        limit: { type: 'number', description: 'Max results (default 25, max 200).' },
      },
    },
  },
};

const KEYWORD_COVERAGE_TOOL_DEF = {
  type: 'function' as const,
  function: {
    name: 'get_keyword_coverage',
    description:
      'Market coverage for a PRODUCT/SERVICE keyword (e.g. "drones", "demolition"). Returns the TOTAL federal ' +
      'market ($), EVERY NAICS that bought it (ranked), the smallest NAICS set covering ~90%, and the top PSCs ' +
      '("what was actually bought"). The lesson: a single obvious NAICS is often only ~28% of the market — search ' +
      'it alone and you MISS the rest. Use this to derive the RIGHT NAICS set for alerts/searches. grounded=false ' +
      'when no spending matches the keyword.',
    parameters: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: 'Product/service term. Single significant words match best (USASpending keyword search is exact-phrase).' },
        coverage_target: { type: 'number', description: 'Fraction of the market the returned NAICS set should cover (0.5–0.99, default 0.9).' },
      },
      required: ['keyword'],
    },
  },
};

const IDV_CONTRACTS_TOOL_DEF = {
  type: 'function' as const,
  function: {
    name: 'search_idv_contracts',
    description:
      'Indefinite-Delivery Vehicles (IDIQ / GWAC / BPA) and the task orders flowing through them. search_type:"idv" ' +
      'returns the base vehicles you must be ON to compete; search_type:"task" returns the delivery/task orders being ' +
      'ordered through them (demand + typical order size). Filter by NAICS / PSC / agency / state / min value / date ' +
      'range. grounded=false when nothing matches.',
    parameters: {
      type: 'object',
      properties: {
        naics: { type: 'string', description: 'NAICS code.' },
        psc: { type: 'string', description: 'Product/Service Code.' },
        agency: { type: 'string', description: 'Awarding agency name.' },
        state: { type: 'string', description: '2-letter state (recipient or place-of-performance).' },
        min_value: { type: 'number', description: 'Minimum award amount (dollars).' },
        date_from: { type: 'string', description: 'Action date lower bound (YYYY-MM-DD).' },
        date_to: { type: 'string', description: 'Action date upper bound (YYYY-MM-DD).' },
        search_type: { type: 'string', enum: ['idv', 'task'], description: '"idv" = base vehicles (default); "task" = task/delivery orders.' },
        limit: { type: 'number', description: 'Max results per page (default 25).' },
        page: { type: 'number', description: '1-based page number.' },
      },
    },
  },
};

const CONTRACTOR_AWARD_HISTORY_TOOL_DEF = {
  type: 'function' as const,
  function: {
    name: 'get_contractor_award_history',
    description:
      "A named contractor's federal prime-award history: total obligations, award count, year-over-year trend, top " +
      'agencies, top NAICS, and recent awards. Use it to size up a competitor, teammate, or incumbent. Name matching ' +
      'is fuzzy — always check match.confidence. grounded=false when the firm has no cached award history.',
    parameters: {
      type: 'object',
      properties: {
        company: { type: 'string', description: 'Contractor name (legal business name matches best).' },
        award_limit: { type: 'number', description: 'Max recent awards to return.' },
      },
      required: ['company'],
    },
  },
};

const MARKET_DEPTH_TOOL_DEF = {
  type: 'function' as const,
  function: {
    name: 'assess_market_depth',
    description:
      'Rule-of-Two market-depth determination for a NAICS (+ optional set-aside / state): how many CAPABLE small ' +
      'businesses exist, whether the Rule of Two is met (≥2 capable at a fair price → the requirement should be set ' +
      'aside), a scored/tiered vendor list (active_performer > capable > emerging), and memo-ready caveats. ' +
      'registered_only firms are shown separately and never inflate the count. grounded=false when no capable ' +
      'businesses are found.',
    parameters: {
      type: 'object',
      properties: {
        naics: { type: 'string', description: 'NAICS code (6-digit).' },
        state: { type: 'string', description: '2-letter state to scope the market geographically.' },
        set_aside: { type: 'string', description: "Normalized label: '8(a)','HUBZone','SDVOSB','WOSB','EDWOSB','Small Business'." },
        include_emerging: { type: 'boolean', description: 'Include emerging (registered, not-yet-performed) firms in the count (default true).' },
        limit: { type: 'number', description: 'Max businesses to return in the list.' },
      },
      required: ['naics'],
    },
  },
};

const SOLICITATION_DOCUMENTS_TOOL_DEF = {
  type: 'function' as const,
  function: {
    name: 'get_solicitation_documents',
    description:
      'Get the FULL text + downloadable raw files for a SAM solicitation by notice_id — the SOW/PWS, the notice ' +
      'body, and every attachment. Returns notice metadata + inline body/SOW text + a documents[] list, each with ' +
      'inline extracted_text (capped; check *_truncated) AND a short-lived signed download_url (~1h) to the full raw ' +
      'PDF/DOCX so an agent can hand it to a design tool (Canva) or re-parse it. Cold notices (never tracked) are ' +
      'downloaded + extracted ON DEMAND. grounded=false when the notice has no text or attachments — verify the ' +
      'notice_id. SAM attachments are public federal data.',
    parameters: {
      type: 'object',
      properties: {
        notice_id: {
          type: 'string',
          description: 'SAM notice id (UUID) or solicitation number. Get it from search_sam_opportunities results.',
        },
      },
      required: ['notice_id'],
    },
  },
};

const FEDERAL_EVENTS_TOOL_DEF = {
  type: 'function' as const,
  function: {
    name: 'search_federal_events',
    description:
      'Upcoming federal-contracting EVENTS for an agency — industry days, matchmaking, sources-sought, and ' +
      'association conferences. "Where do I show up in person to win this buyer?" Returns dated SAM.gov Special ' +
      'Notices (source="sam", DoDAAC-office-anchored, trust the date) and, when include_ai_discovery is set, ' +
      'web-discovered conferences (source="ai", carry a confidence score — verify before attending). Each event ' +
      'has title, type, date, location, registration URL, and the decoded buying office. grounded=false when no ' +
      'events match — widen months_ahead or enable AI discovery.',
    parameters: {
      type: 'object',
      properties: {
        agency: { type: 'string', description: 'Agency name, e.g. "Department of Defense", "Navy", "GSA". Messy raw names resolve via normalization.' },
        months_ahead: { type: 'number', description: 'Look-ahead window in months (default 4, max 12).' },
        include_ai_discovery: { type: 'boolean', description: 'Also run a web search for association conferences not in SAM (slower, best-effort). Default false.' },
        limit: { type: 'number', description: 'Max SAM events to return (default 25, max 100).' },
      },
      required: ['agency'],
    },
  },
};

const SCAN_COMPLIANCE_TOOL_DEF = {
  type: 'function' as const,
  function: {
    name: 'scan_proposal_compliance',
    description:
      'Pre-submit disqualification check: given the RFP requirements + a proposal draft, flag what could get the ' +
      'bid THROWN OUT — missed deadline (the #1 DQ), ineligible set-aside, page-limit overage, missing reps/certs ' +
      'or required plans, unaddressed evaluation factors, un-acknowledged amendments. Returns findings with ' +
      'severity dq/warning/info + an at_risk flag. Deterministic (no AI). Runs entirely on the inputs you pass — ' +
      'pair with extract_compliance_matrix for the requirements list.',
    parameters: {
      type: 'object',
      properties: {
        requirements: {
          type: 'array',
          description: 'RFP requirements to check against (from extract_compliance_matrix or your own read).',
          items: {
            type: 'object',
            properties: {
              requirement: { type: 'string', description: 'The requirement text (a shall-statement).' },
              category: { type: 'string', description: 'Category hint (submission/evaluation/technical/…); free-text is normalized.' },
              section: { type: 'string', description: 'RFP section, e.g. "L.3.2", "M.2".' },
              id: { type: 'string' },
            },
            required: ['requirement'],
          },
        },
        draft_text: { type: 'string', description: 'The full proposal / response text (all sections concatenated).' },
        sections: {
          type: 'array',
          description: 'Optional per-section drafts for finer page/coverage checks.',
          items: { type: 'object', properties: { label: { type: 'string' }, text: { type: 'string' } }, required: ['label', 'text'] },
        },
        bidder_set_asides: { type: 'array', items: { type: 'string' }, description: 'Set-asides the bidder actually holds (e.g. ["8(a)","WOSB"]).' },
      },
      required: ['requirements', 'draft_text'],
    },
  },
};

const BID_DECISION_TOOL_DEF = {
  type: 'function' as const,
  function: {
    name: 'evaluate_bid_decision',
    description:
      "GovCon Giants' bid / no-bid framework. ALWAYS returns the framework — the 5 universal eliminator GATES " +
      '(set-aside eligibility, licenses, past performance, bonding, deadline) + the 10-factor scorecard with its ' +
      'positive/neutral/negative rubric — so you know exactly what to assess. When you also pass gate answers + ' +
      'factor ratings, it SCORES the card: any failed gate = automatic No-Bid; otherwise pursue (≥70) / watch ' +
      '(40–69) / skip (<40). Call it once with no args to learn the rubric, then again with your assessment.',
    parameters: {
      type: 'object',
      properties: {
        gates: {
          type: 'object',
          description: 'gateId → passed? (true/false), from the returned framework gates. A false on any = No-Bid.',
          additionalProperties: { type: 'boolean' },
        },
        ratings: {
          type: 'object',
          description: 'factorId → 0-10, from the returned framework factors.',
          additionalProperties: { type: 'number' },
        },
      },
    },
  },
};

const FEDERAL_OSBP_TOOL_DEF = {
  type: 'function' as const,
  function: {
    name: 'lookup_federal_osbp',
    description:
      'The Office of Small Business Programs (OSBP/OSDBU) — the small-business front door — for a federal ' +
      'command or agency. Pass a command/agency name or abbreviation (e.g. "NAVFAC", "USACE", "Department of ' +
      'the Navy"). Returns the OSBP office, director (with a director_verified YYYY-MM stamp — names rotate, ' +
      'mailboxes are stable), email/phone/address, acquisition office, forecast URL, and key capabilities. ' +
      'A parent-agency input returns all its commands\' offices. grounded=false = not in the curated directory ' +
      '(DoD/DLA/Navy/Army-weighted) — do NOT invent a contact.',
    parameters: {
      type: 'object',
      properties: {
        agency: {
          type: 'string',
          description: 'Command/agency name or abbreviation, e.g. "NAVFAC", "USACE", "DLA Aviation", "Department of the Navy".',
        },
      },
      required: ['agency'],
    },
  },
};

const AGENCY_OPPS_BY_OFFICE_TOOL_DEF = {
  type: 'function' as const,
  function: {
    name: 'search_agency_opps_by_office',
    description:
      'Open SAM.gov solicitations anchored to a specific BUYING OFFICE — not the whole department. A DoD ' +
      'sub-agency (a USACE district, DARPA, MDA) shares one department label, so a department filter returns the ' +
      'whole-DoD firehose; this anchors on the 6-char DoDAAC that prefixes the solicitation number (W912PL = USACE ' +
      'LA District) for THAT office\'s real open buys. Pass a command/agency name OR a known 6-char DoDAAC, plus ' +
      'optional NAICS/state. _meta.anchor="dodaac" = office-precise; "department" = a broad civilian preview (no ' +
      'DoDAAC path). grounded=false with anchor="dodaac" = genuinely nothing open now, not an error.',
    parameters: {
      type: 'object',
      properties: {
        agency: { type: 'string', description: 'Command / agency / sub-agency name, e.g. "USACE", "Naval Sea Systems Command".' },
        dodaac: { type: 'string', description: 'A known 6-char DoDAAC (e.g. "W912PL"); takes precedence over agency.' },
        naics: { type: 'string', description: 'NAICS filter; ≤4 digits = prefix, 6 = exact.' },
        state: { type: 'string', description: '2-letter place-of-performance state.' },
        limit: { type: 'number', description: 'Max results (default 25, max 100).' },
      },
    },
  },
};

const SBLO_CONTACT_TOOL_DEF = {
  type: 'function' as const,
  function: {
    name: 'get_sblo_contact',
    description:
      'The Small Business Liaison Officer (SBLO) at a prime contractor — WHO to call to team on a subcontract. ' +
      'Pass a company name (e.g. "AECOM", "Booz Allen Hamilton", "Leidos"). Curated SBLO names first (the canonical ' +
      '200-company Jun-2026 roster, then the broader 3,502-prime DB — the hand-verified moat), then a LIVE BigQuery ' +
      'fallback (~317K recipients) that confirms an out-of-snapshot company is a real federal prime + returns live ' +
      'award context. Returns SBLO name/title/email/phone/portal when curated; a blank name/email (including every ' +
      'BigQuery-tier match — BQ has award data, NOT SBLO contacts) means no public SBLO was found, so it surfaces the ' +
      'supplier portal and NEVER invents a contact. grounded=false = not curated and not a matching federal prime.',
    parameters: {
      type: 'object',
      properties: {
        company: { type: 'string', description: 'Prime contractor / company name, e.g. "AECOM", "Leidos".' },
      },
      required: ['company'],
    },
  },
};
const FEDERAL_CONTACTS_TOOL_DEF = {
  type: 'function' as const,
  function: {
    name: 'search_federal_contacts',
    description:
      'The named PEOPLE at a federal buying office — contracting officers, contract specialists, small-business POCs — ' +
      'anchored on the office\'s 6-char DoDAAC so a DoD sub-agency returns ITS people, not the whole-DoD firehose. Pass ' +
      'an agency/command name OR a 6-char DoDAAC (+ optional office / role / free-text search). The agency\'s OSBP ' +
      'small-business contact is prepended as the front door. _meta.anchor: "dodaac"/"agency-dodaac" = office-precise; ' +
      '"department" = broad civilian preview (may mix offices). Overseas offices are filtered out. grounded=false = no ' +
      'matching contacts (never an invented POC); email a contact only if it has a real address.',
    parameters: {
      type: 'object',
      properties: {
        agency: { type: 'string', description: 'Agency / command / sub-agency name, e.g. "USACE", "Department of Veterans Affairs".' },
        dodaac: { type: 'string', description: 'A known 6-char DoDAAC (e.g. "W912PL"); most precise, anchors directly on the office.' },
        office: { type: 'string', description: 'Office name filter (SAM office column; often null for POCs).' },
        role: { type: 'string', description: 'Soft role filter matched against each contact\'s title bucket — one of: contracting officer, contract specialist, small business, program/technical, leadership (or a title substring / acronym like CO, KO, OSBP). If it matches nobody, the filter is dropped and the full roster is still returned.' },
        search: { type: 'string', description: 'Free-text match on contact name OR title.' },
        limit: { type: 'number', description: 'Max contacts (default 25, max 200).' },
      },
    },
  },
};
const PODCAST_LESSONS_TOOL_DEF = {
  type: 'function' as const,
  function: {
    name: 'search_podcast_lessons',
    description:
      "The proprietary GovCon Giants podcast corpus — real lessons from real contractor/agency guests, matched by " +
      'topic / agency / NAICS / set-aside / guest name. Un-copyable moat content: no public API has "what a winning ' +
      'SDVOSB actually learned breaking into VA construction." Returns episode cards with their key_lessons, guest, ' +
      'agencies/NAICS mentioned. grounded=false when nothing matches — do NOT invent a lesson or attribute an invented ' +
      'quote to a guest; every lesson must trace to a returned episode.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free-text: topic, agency, NAICS, set-aside, or a guest name.' },
        limit: { type: 'number', description: 'Max episodes (default 4, max 12).' },
      },
      required: ['query'],
    },
  },
};

const AGENCY_SPENDING_DETAIL_TOOL_DEF = {
  type: 'function' as const,
  function: {
    name: 'get_agency_spending_detail',
    description:
      '"Who inside this department buys, and can a small business win here." Complements get_agency_intel with the ' +
      'sub-agency (component) spending breakdown + the set-aside distribution (Small Business / 8(a) / SDVOSB / WOSB / ' +
      'HUBZone shares + overall small-business share) — the small-business easy-entry read. Live USASpending contract ' +
      'obligations (award types A/B/C/D) for a fiscal year. Pass an agency name/abbreviation. grounded=false = no ' +
      'toptier agency matched (do NOT invent figures); degraded=true = USASpending errored (not $0). Contract ' +
      'obligations only, NOT total agency budget.',
    parameters: {
      type: 'object',
      properties: {
        agency: { type: 'string', description: 'Agency name or abbreviation, e.g. "Department of Defense", "VA", "NASA".' },
        fiscal_year: { type: 'number', description: 'Fiscal year (defaults to the latest complete FY).' },
      },
      required: ['agency'],
    },
  },
};

const AGENCY_BUDGET_TRENDS_TOOL_DEF = {
  type: 'function' as const,
  function: {
    name: 'get_agency_budget_trends',
    description:
      "An agency's discretionary budget authority and the FY2025→FY2026 trend (growing / cut / stable) — where the " +
      'money is moving BEFORE it becomes awards. Pass an agency name or abbreviation ("VA", "Department of Defense", ' +
      '"NASA", "EPA"). Returns FY25 (enacted) + FY26 (President\'s request) budget authority, the $ + % change, and the ' +
      'trend. Figures are DISCRETIONARY budget authority only (not total obligations); FY26 is a request, not enacted. ' +
      'grounded=false = agency not in the 47-agency toptier set — do NOT invent a number.',
    parameters: {
      type: 'object',
      properties: {
        agency: { type: 'string', description: 'Agency name or abbreviation, e.g. "VA", "Department of Defense", "NASA".' },
      },
      required: ['agency'],
    },
  },
};
const COMPANY_KEYWORDS_TOOL_DEF = {
  type: 'function' as const,
  function: {
    name: 'derive_company_keywords',
    description:
      "Turn a company's OWN words (what they do + past performance) into the search keywords buyers actually use, " +
      'ranked by MEANING. NAICS is the wrong discovery key; a company\'s real vocabulary finds the market its codes miss. ' +
      'Pass a description and/or past-performance scope descriptions (the richest signal). Returns ranked keywords to ' +
      'feed an opportunity search. Uses semantic embeddings (no BigQuery); fails soft to lexical order if embeddings are ' +
      'down (_meta.ranked says which). grounded=false = not enough input text — do NOT invent keywords.',
    parameters: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'What the company does — one-liner / pitch / capability summary.' },
        past_performance: { type: 'array', items: { type: 'string' }, description: 'Past-performance scope descriptions (richest signal).' },
        capabilities: { type: 'array', items: { type: 'string' }, description: 'Capability / service descriptions.' },
        code_titles: { type: 'array', items: { type: 'string' }, description: 'NAICS/PSC title text the caller already knows (optional).' },
        limit: { type: 'number', description: 'Max keywords (default 12, max 25).' },
      },
    },
  },
};

const COMPLIANCE_MATRIX_TOOL_DEF = {
  type: 'function' as const,
  function: {
    name: 'extract_compliance_matrix',
    description:
      'Harvest EVERY explicit requirement from a federal solicitation into a structured compliance matrix — the ' +
      'shall/must/required obligations plus Section L (instructions), M (evaluation factors), and C (SOW/PWS). The ' +
      'foundation of a proposal: build the outline from it and check nothing is missed. Pass ONE of: notice_id (fetches ' +
      "the notice's SOW + body + attachment text server-side — pairs with search_sam_opportunities) OR rfp_text (the " +
      'solicitation text directly). Each row: {requirement, category (submission/evaluation/technical/past_performance/' +
      'pricing/admin/other), section, source_quote (verbatim)}. grounded=false = nothing extractable (a synopsis, not ' +
      'the L/M/C body, or a fetch miss) — do NOT invent requirements. Single-doc only: it does not merge amendments over ' +
      'the base; pass amendment text too if dates/specs were revised.',
    parameters: {
      type: 'object',
      properties: {
        notice_id: { type: 'string', description: 'SAM notice id (UUID) or solicitation number — fetches the doc text server-side.' },
        rfp_text: { type: 'string', description: 'The solicitation text directly (use when you already have it, or notice_id has no extractable text).' },
      },
    },
  },
};

const PROPOSAL_STRUCTURE_TOOL_DEF = {
  type: 'function' as const,
  function: {
    name: 'build_proposal_structure',
    description:
      'Turn a compliance matrix into the volume → section → subsection outline a federal proposal must follow. The ' +
      'next step after extract_compliance_matrix: pass its `requirements` array and get back the volumes (Technical, ' +
      'Past Performance, Price, Forms…), each section with the requirements it must satisfy, plus `critical` items ' +
      '(deadlines / mandatory plans & certs) surfaced up front and `crossCutting` format/admin rules that apply to ' +
      'every volume. Pure shaping — it neither invents requirements nor writes prose; it organizes what you pass. ' +
      'grounded=false when no requirements are supplied.',
    parameters: {
      type: 'object',
      properties: {
        requirements: {
          type: 'array',
          description: 'The compliance matrix — pass the requirements[] from extract_compliance_matrix.',
          items: {
            type: 'object',
            properties: {
              requirement: { type: 'string', description: 'The obligation text (required).' },
              category: { type: 'string', description: 'submission | evaluation | technical | past_performance | pricing | admin | other (coerced if omitted/unknown).' },
              section: { type: 'string', description: 'The L/M/C clause label, e.g. "L.3.2" (optional).' },
              id: { type: 'string', description: 'Stable id, e.g. "REQ-001" (optional).' },
            },
            required: ['requirement'],
          },
        },
      },
      required: ['requirements'],
    },
  },
};

const REFEREE_COMPLIANCE_TOOL_DEF = {
  type: 'function' as const,
  function: {
    name: 'referee_proposal_compliance',
    description:
      'The CLOSING step of a proposal: run an assembled draft past an INDEPENDENT compliance referee (a fresh model that ' +
      'did NOT write the draft) and get a per-requirement verdict — met / partial / missing — with a one-line evidence ' +
      'note and an overall compliance score. Pass the `requirements` from extract_compliance_matrix plus your `draft` ' +
      'text. The point is independence: the drafter thinks it is done; the referee catches the unmet "shall" items before ' +
      'submission. Fix every missing/partial item, then re-referee. grounded=false when no requirements OR no draft is ' +
      'supplied (it does not run) — a high score confirms coverage, not competitiveness.',
    parameters: {
      type: 'object',
      properties: {
        requirements: {
          type: 'array',
          description: 'The compliance matrix to check the draft against — pass the requirements[] from extract_compliance_matrix.',
          items: {
            type: 'object',
            properties: {
              requirement: { type: 'string', description: 'The obligation text (required).' },
              category: { type: 'string', description: 'submission | evaluation | technical | past_performance | pricing | admin | other (optional).' },
              section: { type: 'string', description: 'The L/M/C clause label, e.g. "L.3.2" (optional).' },
              id: { type: 'string', description: 'Stable id, e.g. "REQ-001" (optional).' },
            },
            required: ['requirement'],
          },
        },
        draft: { type: 'string', description: 'The assembled proposal draft text to evaluate (read up to the first 24,000 chars).' },
      },
      required: ['requirements', 'draft'],
    },
  },
};

const RECOMPETE_SOW_TOOL_DEF = {
  type: 'function' as const,
  function: {
    name: 'match_recompete_sow',
    description:
      "Given an EXPIRING contract's scope, find the open solicitation that is likely its recompete — by semantic SOW " +
      'similarity over Mindy\'s embedded sam_opportunities corpus. The payoff step of the recompete chain: ' +
      'get_expiring_contracts → an expiring contract → match_recompete_sow → the open opp (pairs with ' +
      'find_predecessor_award for who holds it now). Pass the expiring contract\'s `description` (title/scope/SOW text); ' +
      'optionally `naics` + `agency` to scope candidates. Confidence is honest — it needs BOTH a high top score AND a ' +
      'gap over the runner-up, so a cluster of similar SOWs returns no_confident_match (with candidates to review) rather ' +
      'than a false single answer. grounded=false = no SOW-bearing candidates in scope. Always verify via the SAM link.',
    parameters: {
      type: 'object',
      properties: {
        description: { type: 'string', description: "The expiring contract's title / scope / SOW text to match against the corpus." },
        naics: { type: 'string', description: 'Optional NAICS code to scope candidates (widens to 2-digit if the set is thin).' },
        agency: { type: 'string', description: 'Optional agency/department to scope candidates (matched against the buying department).' },
        piid: { type: 'string', description: 'Optional PIID of the expiring contract (telemetry only).' },
      },
      required: ['description'],
    },
  },
};

const STATEMENT_OF_WORK_TOOL_DEF = {
  type: 'function' as const,
  function: {
    name: 'extract_statement_of_work',
    description:
      'Pull the Statement of Work / PWS / SOO out of a solicitation as clean text to brief subcontractors or seed a ' +
      'technical response. Complements extract_compliance_matrix (requirements) and get_solicitation_documents (raw ' +
      'files): this detects the SOW block by heading boundaries over the COMBINED/inline body — so it recovers scope ' +
      'buried in a Section C blob — and falls back to a CLIN-derived "scope at a glance" from the pricing schedule. Pass ' +
      'ONE of: notice_id (fetches the doc text server-side) OR rfp_text. grounded=false = no SOW block detected — do NOT ' +
      'invent scope.',
    parameters: {
      type: 'object',
      properties: {
        notice_id: { type: 'string', description: 'SAM notice id (UUID) or solicitation number — fetches the doc text server-side.' },
        rfp_text: { type: 'string', description: 'The solicitation text directly (use when you already have it).' },
      },
    },
  },
};

const EVENT_SERIES_TOOL_DEF = {
  type: 'function' as const,
  function: {
    name: 'get_federal_event_series',
    description:
      'The curated calendar of RECURRING federal-contracting event series (AFCEA, NDIA, SAME, APEX Accelerators, GSA…) ' +
      'plus major annual conferences — "where do contractors network in my market year over year." Filter by agency, ' +
      'category (matchmaking / training / conference / industry_day…), or keyword. Complements search_federal_events ' +
      '(dated one-off SAM notices) with the standing series to put on the BD calendar. grounded=false = nothing matched ' +
      'the filter.',
    parameters: {
      type: 'object',
      properties: {
        agency: { type: 'string', description: 'Filter to series serving this agency (multi-agency/government-wide series always included).' },
        category: { type: 'string', description: 'Category filter, e.g. matchmaking, training, conference, industry_day.' },
        query: { type: 'string', description: 'Free-text filter over name / notes / audience.' },
      },
    },
  },
};

const SBA_GOALING_TOOL_DEF = {
  type: 'function' as const,
  function: {
    name: 'get_sba_goaling_share',
    description:
      'The "is this a good small-business market?" read: the STATUTORY government-wide small-business goals (Small ' +
      'Business 23% · WOSB 5% · SDB/8(a) 5% · SDVOSB 3% · HUBZone 3%) set against an agency\'s ACTUAL set-aside ' +
      'obligations from USASpending, per category, with the gap and a meets/below flag. NOTE: actuals measure dollars ' +
      'through set-aside CODES — a floor on, not identical to, the official SBA Scorecard small-business achievement ' +
      '(small firms also win full-and-open); it is not the Scorecard number and does not assert an agency\'s own ' +
      'negotiated goals. grounded=false = no agency matched.',
    parameters: {
      type: 'object',
      properties: {
        agency: { type: 'string', description: 'Agency name or abbreviation, e.g. "Department of Defense", "VA", "NASA".' },
        fiscal_year: { type: 'number', description: 'Fiscal year (defaults to the latest complete FY).' },
      },
      required: ['agency'],
    },
  },
};

const DRAFT_PROPOSAL_TOOL_DEF = {
  type: 'function' as const,
  function: {
    name: 'draft_proposal',
    description:
      'Draft a FULL multi-section federal proposal response from a solicitation — the writing step after ' +
      'extract_compliance_matrix / build_proposal_structure. A two-pass engine (strategic outline → parallel ' +
      'per-section write) grounded in the caller\'s Vault (real past performance, identity, team) + a curated ' +
      'proposal-writing corpus. Auto-picks the section set: an RFP gets Executive Summary / Technical / ' +
      'Management / Past Performance / Pricing; a Sources Sought / RFI gets the cap-statement set — or pass ' +
      '`sections` to choose. Provide ONE of notice_id (fetches the SOW + body + attachment text server-side) OR ' +
      'rfp_text. Pass userEmail to load the caller\'s Vault (without it the draft leans generic and brackets ' +
      'more). This is a DRAFT: every [placeholder] is an unknown to fill with real data — grounded=false means ' +
      'nothing was drafted, so do NOT fabricate a proposal. Feed the output to export_proposal (.docx) and ' +
      'referee_proposal_compliance before submission.',
    parameters: {
      type: 'object',
      properties: {
        notice_id: { type: 'string', description: 'SAM notice id (UUID) or solicitation number — fetches the doc text server-side.' },
        rfp_text: { type: 'string', description: 'The solicitation text directly (use when you already have it, or notice_id has no extractable text).' },
        sections: {
          type: 'array',
          items: { type: 'string' },
          description: 'Which sections to draft. RFP: exec_summary, technical, management, past_performance, pricing. Cap statement: company_overview, cap_past_performance, capabilities, differentiators, poc. Omit to auto-pick.',
        },
        agency: { type: 'string', description: 'The buying agency (skips detection; grounds agency-specific framing).' },
      },
    },
  },
};

const DRAFT_PROPOSAL_SECTION_TOOL_DEF = {
  type: 'function' as const,
  function: {
    name: 'draft_proposal_section',
    description:
      'Draft ONE section of a federal proposal, vault+RAG grounded — for iterating on a single volume without ' +
      're-running the whole proposal. Pass section_type (RFP: exec_summary | technical | management | ' +
      'past_performance | pricing; cap statement: company_overview | cap_past_performance | capabilities | ' +
      'differentiators | poc) and ONE of notice_id (fetches the doc text server-side) OR rfp_text. Optionally pass ' +
      'requirements[] (from extract_compliance_matrix) so the section addresses its shall-statements one-to-one. ' +
      'Pass userEmail to ground it in the caller\'s Vault. A DRAFT: fill every [placeholder] with real data. ' +
      'grounded=false = nothing was drafted (invalid section or no source) — do NOT fabricate.',
    parameters: {
      type: 'object',
      properties: {
        section_type: { type: 'string', description: 'The section to draft, e.g. "technical", "past_performance", "exec_summary".' },
        notice_id: { type: 'string', description: 'SAM notice id (UUID) or solicitation number — fetches the doc text server-side.' },
        rfp_text: { type: 'string', description: 'The solicitation text directly (use when you already have it).' },
        agency: { type: 'string', description: 'The buying agency (skips detection).' },
        requirements: {
          type: 'array',
          description: 'Optional compliance matrix — pass requirements[] from extract_compliance_matrix so the section covers its shalls.',
          items: {
            type: 'object',
            properties: {
              requirement: { type: 'string', description: 'The obligation text (required).' },
              category: { type: 'string', description: 'submission | evaluation | technical | past_performance | pricing | admin | other (coerced if free-form).' },
              section: { type: 'string', description: 'The L/M/C clause label, e.g. "L.3.2" (optional).' },
              id: { type: 'string', description: 'Stable id, e.g. "REQ-001" (optional).' },
            },
            required: ['requirement'],
          },
        },
      },
      required: ['section_type'],
    },
  },
};

const EXPORT_PROPOSAL_TOOL_DEF = {
  type: 'function' as const,
  function: {
    name: 'export_proposal',
    description:
      'Assemble supplied proposal sections into a downloadable Word (.docx) file — the delivery step after ' +
      'draft_proposal (or your own drafted content). Pass sections[] (each { heading, text }) and an optional ' +
      'title; returns the document as base64 (docx_base64) plus filename, mime, and byte_size. Deterministic ' +
      'formatting only — it adds NOTHING and invents NOTHING; [placeholders] in the text carry through verbatim. ' +
      'grounded=false when no sections are supplied (empty document). Decode docx_base64 to save the file.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Optional document title rendered at the top.' },
        sections: {
          type: 'array',
          description: 'The proposal sections to write into the document, in order.',
          items: {
            type: 'object',
            properties: {
              heading: { type: 'string', description: 'The section heading (rendered as Heading 1).' },
              text: { type: 'string', description: 'The section body; blank lines split it into paragraphs.' },
            },
            required: ['heading', 'text'],
          },
        },
      },
      required: ['sections'],
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
    SOLICITATION_INCUMBENT_TOOL_DEF,
    SAM_ENTITY_TOOL_DEF,
    SEARCH_CONTRACTORS_TOOL_DEF,
    AGENCY_INTEL_TOOL_DEF,
    GRANTS_TOOL_DEF,
    FORECASTS_TOOL_DEF,
    SBIR_TOOL_DEF,
    EXPIRING_CONTRACTS_TOOL_DEF,
    KEYWORD_COVERAGE_TOOL_DEF,
    IDV_CONTRACTS_TOOL_DEF,
    CONTRACTOR_AWARD_HISTORY_TOOL_DEF,
    MARKET_DEPTH_TOOL_DEF,
    SOLICITATION_DOCUMENTS_TOOL_DEF,
    FEDERAL_EVENTS_TOOL_DEF,
    SCAN_COMPLIANCE_TOOL_DEF,
    BID_DECISION_TOOL_DEF,
    FEDERAL_OSBP_TOOL_DEF,
    AGENCY_OPPS_BY_OFFICE_TOOL_DEF,
    SBLO_CONTACT_TOOL_DEF,
    FEDERAL_CONTACTS_TOOL_DEF,
    PODCAST_LESSONS_TOOL_DEF,
    AGENCY_BUDGET_TRENDS_TOOL_DEF,
    COMPANY_KEYWORDS_TOOL_DEF,
    AGENCY_SPENDING_DETAIL_TOOL_DEF,
    COMPLIANCE_MATRIX_TOOL_DEF,
    PROPOSAL_STRUCTURE_TOOL_DEF,
    REFEREE_COMPLIANCE_TOOL_DEF,
    RECOMPETE_SOW_TOOL_DEF,
    STATEMENT_OF_WORK_TOOL_DEF,
    EVENT_SERIES_TOOL_DEF,
    SBA_GOALING_TOOL_DEF,
    DRAFT_PROPOSAL_TOOL_DEF,
    DRAFT_PROPOSAL_SECTION_TOOL_DEF,
    EXPORT_PROPOSAL_TOOL_DEF,
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
    name === 'get_solicitation_incumbent' ||
    name === 'lookup_sam_entity' ||
    name === 'search_contractors' ||
    name === 'get_agency_intel' ||
    name === 'search_grants' ||
    name === 'get_agency_forecasts' ||
    name === 'search_sbir' ||
    name === 'get_expiring_contracts' ||
    name === 'get_keyword_coverage' ||
    name === 'search_idv_contracts' ||
    name === 'get_contractor_award_history' ||
    name === 'assess_market_depth' ||
    name === 'get_solicitation_documents' ||
    name === 'search_federal_events' ||
    name === 'scan_proposal_compliance' ||
    name === 'evaluate_bid_decision' ||
    name === 'lookup_federal_osbp' ||
    name === 'search_agency_opps_by_office' ||
    name === 'get_sblo_contact' ||
    name === 'search_federal_contacts' ||
    name === 'search_podcast_lessons' ||
    name === 'get_agency_budget_trends' ||
    name === 'derive_company_keywords' ||
    name === 'get_agency_spending_detail' ||
    name === 'extract_compliance_matrix' ||
    name === 'build_proposal_structure' ||
    name === 'referee_proposal_compliance' ||
    name === 'match_recompete_sow' ||
    name === 'extract_statement_of_work' ||
    name === 'get_federal_event_series' ||
    name === 'get_sba_goaling_share' ||
    name === 'draft_proposal' ||
    name === 'draft_proposal_section' ||
    name === 'export_proposal' ||
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

  if (name === 'get_solicitation_incumbent') {
    const result = (await getSolicitationIncumbent({
      solicitation_number: typeof args.solicitation_number === 'string' ? args.solicitation_number : undefined,
      notice_id: typeof args.notice_id === 'string' ? args.notice_id : undefined,
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

  if (name === 'search_contractors') {
    const result = (await searchContractors({
      keyword: typeof args.keyword === 'string' ? args.keyword : undefined,
      naics: typeof args.naics === 'string' ? args.naics : undefined,
      state: typeof args.state === 'string' ? args.state : undefined,
      sort_by:
        args.sort_by === 'total_obligated' || args.sort_by === 'award_count' || args.sort_by === 'recipient_name'
          ? args.sort_by
          : undefined,
      limit: typeof args.limit === 'number' ? args.limit : undefined,
    })) as unknown as Record<string, unknown>;
    return { result, credits };
  }

  if (name === 'get_agency_intel') {
    const result = (await getAgencyIntel({
      agency: typeof args.agency === 'string' ? args.agency : '',
      fiscal_year: typeof args.fiscal_year === 'number' ? args.fiscal_year : undefined,
    })) as unknown as Record<string, unknown>;
    return { result, credits };
  }

  if (name === 'search_grants') {
    const result = (await grantsSearch({
      keyword: typeof args.keyword === 'string' ? args.keyword : undefined,
      agency: typeof args.agency === 'string' ? args.agency : undefined,
      category: typeof args.category === 'string' ? args.category : undefined,
      status: args.status === 'posted' || args.status === 'forecasted' || args.status === 'closed' || args.status === 'archived' ? args.status : undefined,
      limit: typeof args.limit === 'number' ? args.limit : undefined,
    })) as unknown as Record<string, unknown>;
    return { result, credits };
  }

  if (name === 'get_agency_forecasts') {
    const result = (await agencyForecasts({
      naics: typeof args.naics === 'string' ? args.naics : undefined,
      agency: typeof args.agency === 'string' ? args.agency : undefined,
      state: typeof args.state === 'string' ? args.state : undefined,
      set_aside: typeof args.set_aside === 'string' ? args.set_aside : undefined,
      fiscal_year: typeof args.fiscal_year === 'string' ? args.fiscal_year : undefined,
      keyword: typeof args.keyword === 'string' ? args.keyword : undefined,
      limit: typeof args.limit === 'number' ? args.limit : undefined,
    })) as unknown as Record<string, unknown>;
    return { result, credits };
  }

  if (name === 'search_sbir') {
    const result = (await sbirSearch({
      keyword: typeof args.keyword === 'string' ? args.keyword : undefined,
      agency: typeof args.agency === 'string' ? args.agency : undefined,
      phase: args.phase === '1' || args.phase === '2' || args.phase === 'all' ? args.phase : undefined,
      source: args.source === 'nih' || args.source === 'multisite' || args.source === 'all' ? args.source : undefined,
      limit: typeof args.limit === 'number' ? args.limit : undefined,
    })) as unknown as Record<string, unknown>;
    return { result, credits };
  }

  if (name === 'get_expiring_contracts') {
    const result = (await expiringContracts({
      naics: typeof args.naics === 'string' ? args.naics : undefined,
      agency: typeof args.agency === 'string' ? args.agency : undefined,
      state: typeof args.state === 'string' ? args.state : undefined,
      months_window: typeof args.months_window === 'number' ? args.months_window : undefined,
      min_value: typeof args.min_value === 'number' ? args.min_value : undefined,
      max_value: typeof args.max_value === 'number' ? args.max_value : undefined,
      likelihood: args.likelihood === 'high' || args.likelihood === 'medium' || args.likelihood === 'low' ? args.likelihood : undefined,
      limit: typeof args.limit === 'number' ? args.limit : undefined,
    })) as unknown as Record<string, unknown>;
    return { result, credits };
  }

  if (name === 'get_keyword_coverage') {
    const result = (await getKeywordCoverage({
      keyword: typeof args.keyword === 'string' ? args.keyword : '',
      coverage_target: typeof args.coverage_target === 'number' ? args.coverage_target : undefined,
    })) as unknown as Record<string, unknown>;
    return { result, credits };
  }

  if (name === 'search_idv_contracts') {
    const result = (await idvContracts({
      naics: typeof args.naics === 'string' ? args.naics : undefined,
      psc: typeof args.psc === 'string' ? args.psc : undefined,
      agency: typeof args.agency === 'string' ? args.agency : undefined,
      state: typeof args.state === 'string' ? args.state : undefined,
      min_value: typeof args.min_value === 'number' ? args.min_value : undefined,
      date_from: typeof args.date_from === 'string' ? args.date_from : undefined,
      date_to: typeof args.date_to === 'string' ? args.date_to : undefined,
      search_type: args.search_type === 'idv' || args.search_type === 'task' ? args.search_type : undefined,
      limit: typeof args.limit === 'number' ? args.limit : undefined,
      page: typeof args.page === 'number' ? args.page : undefined,
    })) as unknown as Record<string, unknown>;
    return { result, credits };
  }

  if (name === 'get_contractor_award_history') {
    const result = (await contractorAwardHistory({
      company: typeof args.company === 'string' ? args.company : '',
      award_limit: typeof args.award_limit === 'number' ? args.award_limit : undefined,
    })) as unknown as Record<string, unknown>;
    return { result, credits };
  }

  if (name === 'assess_market_depth') {
    const result = (await assessMarketDepth({
      naics: typeof args.naics === 'string' ? args.naics : '',
      state: typeof args.state === 'string' ? args.state : undefined,
      set_aside: typeof args.set_aside === 'string' ? args.set_aside : undefined,
      include_emerging: typeof args.include_emerging === 'boolean' ? args.include_emerging : undefined,
      limit: typeof args.limit === 'number' ? args.limit : undefined,
    })) as unknown as Record<string, unknown>;
    return { result, credits };
  }

  if (name === 'search_federal_events') {
    const result = (await searchFederalEvents({
      agency: typeof args.agency === 'string' ? args.agency : '',
      months_ahead: typeof args.months_ahead === 'number' ? args.months_ahead : undefined,
      include_ai_discovery: args.include_ai_discovery === true,
      limit: typeof args.limit === 'number' ? args.limit : undefined,
    })) as unknown as Record<string, unknown>;
    return { result, credits };
  }

  if (name === 'get_solicitation_documents') {
    const result = (await solicitationDocuments({
      notice_id: typeof args.notice_id === 'string' ? args.notice_id : '',
    })) as unknown as Record<string, unknown>;
    return { result, credits };
  }

  if (name === 'scan_proposal_compliance') {
    const result = scanProposalCompliance({
      requirements: Array.isArray(args.requirements)
        ? (args.requirements as Array<{ id?: string; requirement: string; category?: string; section?: string }>)
        : [],
      draft_text: typeof args.draft_text === 'string' ? args.draft_text : '',
      sections: Array.isArray(args.sections) ? (args.sections as Array<{ label: string; text: string }>) : undefined,
      bidder_set_asides: Array.isArray(args.bidder_set_asides) ? (args.bidder_set_asides as string[]) : undefined,
    }) as unknown as Record<string, unknown>;
    return { result, credits };
  }

  if (name === 'evaluate_bid_decision') {
    const result = evaluateBidDecisionTool({
      gates: args.gates && typeof args.gates === 'object' ? (args.gates as Record<string, boolean>) : undefined,
      ratings: args.ratings && typeof args.ratings === 'object' ? (args.ratings as Record<string, number>) : undefined,
    }) as unknown as Record<string, unknown>;
    return { result, credits };
  }

  if (name === 'lookup_federal_osbp') {
    const result = lookupFederalOsbp({
      agency: typeof args.agency === 'string' ? args.agency : '',
    }) as unknown as Record<string, unknown>;
    return { result, credits };
  }

  if (name === 'search_agency_opps_by_office') {
    const result = (await searchAgencyOppsByOffice({
      agency: typeof args.agency === 'string' ? args.agency : undefined,
      dodaac: typeof args.dodaac === 'string' ? args.dodaac : undefined,
      naics: typeof args.naics === 'string' ? args.naics : undefined,
      state: typeof args.state === 'string' ? args.state : undefined,
      limit: typeof args.limit === 'number' ? args.limit : undefined,
    })) as unknown as Record<string, unknown>;
    return { result, credits };
  }

  if (name === 'get_sblo_contact') {
    const result = (await getSbloContact({
      company: typeof args.company === 'string' ? args.company : '',
    })) as unknown as Record<string, unknown>;
    return { result, credits };
  }

  if (name === 'search_federal_contacts') {
    const result = (await searchFederalContacts({
      agency: typeof args.agency === 'string' ? args.agency : undefined,
      dodaac: typeof args.dodaac === 'string' ? args.dodaac : undefined,
      office: typeof args.office === 'string' ? args.office : undefined,
      role: typeof args.role === 'string' ? args.role : undefined,
      search: typeof args.search === 'string' ? args.search : undefined,
      limit: typeof args.limit === 'number' ? args.limit : undefined,
    })) as unknown as Record<string, unknown>;
    return { result, credits };
  }

  if (name === 'search_podcast_lessons') {
    const result = (await searchPodcastLessons({
      query: typeof args.query === 'string' ? args.query : '',
      limit: typeof args.limit === 'number' ? args.limit : undefined,
    })) as unknown as Record<string, unknown>;
    return { result, credits };
  }

  if (name === 'get_agency_budget_trends') {
    const result = getAgencyBudgetTrends({
      agency: typeof args.agency === 'string' ? args.agency : '',
    }) as unknown as Record<string, unknown>;
    return { result, credits };
  }

  if (name === 'derive_company_keywords') {
    const result = (await deriveCompanyKeywords({
      description: typeof args.description === 'string' ? args.description : undefined,
      past_performance: Array.isArray(args.past_performance) ? (args.past_performance as string[]) : undefined,
      capabilities: Array.isArray(args.capabilities) ? (args.capabilities as string[]) : undefined,
      code_titles: Array.isArray(args.code_titles) ? (args.code_titles as string[]) : undefined,
      limit: typeof args.limit === 'number' ? args.limit : undefined,
    })) as unknown as Record<string, unknown>;
    return { result, credits };
  }

  if (name === 'get_agency_spending_detail') {
    const result = (await getAgencySpendingDetailTool({
      agency: typeof args.agency === 'string' ? args.agency : '',
      fiscal_year: typeof args.fiscal_year === 'number' ? args.fiscal_year : undefined,
    })) as unknown as Record<string, unknown>;
    return { result, credits };
  }

  if (name === 'extract_compliance_matrix') {
    const result = (await extractComplianceMatrix({
      notice_id: typeof args.notice_id === 'string' ? args.notice_id : undefined,
      rfp_text: typeof args.rfp_text === 'string' ? args.rfp_text : undefined,
      userEmail: ctx.userEmail,
    })) as unknown as Record<string, unknown>;
    return { result, credits };
  }

  if (name === 'build_proposal_structure') {
    const result = buildProposalStructureTool({
      requirements: Array.isArray(args.requirements)
        ? (args.requirements as ProposalStructureInputReq[])
        : [],
    }) as unknown as Record<string, unknown>;
    return { result, credits };
  }

  if (name === 'referee_proposal_compliance') {
    const result = (await refereeProposalCompliance({
      requirements: Array.isArray(args.requirements) ? (args.requirements as RefereeInputReq[]) : [],
      draft: typeof args.draft === 'string' ? args.draft : '',
      userEmail: ctx.userEmail,
    })) as unknown as Record<string, unknown>;
    return { result, credits };
  }

  if (name === 'match_recompete_sow') {
    const result = (await matchRecompeteSowTool({
      description: typeof args.description === 'string' ? args.description : '',
      naics: typeof args.naics === 'string' ? args.naics : undefined,
      agency: typeof args.agency === 'string' ? args.agency : undefined,
      piid: typeof args.piid === 'string' ? args.piid : undefined,
    })) as unknown as Record<string, unknown>;
    return { result, credits };
  }

  if (name === 'extract_statement_of_work') {
    const result = (await extractStatementOfWork({
      notice_id: typeof args.notice_id === 'string' ? args.notice_id : undefined,
      rfp_text: typeof args.rfp_text === 'string' ? args.rfp_text : undefined,
    })) as unknown as Record<string, unknown>;
    return { result, credits };
  }

  if (name === 'get_federal_event_series') {
    const result = getFederalEventSeries({
      agency: typeof args.agency === 'string' ? args.agency : undefined,
      category: typeof args.category === 'string' ? args.category : undefined,
      query: typeof args.query === 'string' ? args.query : undefined,
    }) as unknown as Record<string, unknown>;
    return { result, credits };
  }

  if (name === 'get_sba_goaling_share') {
    const result = (await getSbaGoalingShare({
      agency: typeof args.agency === 'string' ? args.agency : '',
      fiscal_year: typeof args.fiscal_year === 'number' ? args.fiscal_year : undefined,
    })) as unknown as Record<string, unknown>;
    return { result, credits };
  }

  if (name === 'draft_proposal') {
    const result = (await draftProposal({
      rfp_text: typeof args.rfp_text === 'string' ? args.rfp_text : undefined,
      notice_id: typeof args.notice_id === 'string' ? args.notice_id : undefined,
      sections: Array.isArray(args.sections) ? (args.sections as string[]) : undefined,
      agency: typeof args.agency === 'string' ? args.agency : undefined,
      userEmail: ctx.userEmail,
    })) as unknown as Record<string, unknown>;
    return { result, credits };
  }

  if (name === 'draft_proposal_section') {
    const result = (await draftProposalSection({
      section_type: typeof args.section_type === 'string' ? args.section_type : '',
      rfp_text: typeof args.rfp_text === 'string' ? args.rfp_text : undefined,
      notice_id: typeof args.notice_id === 'string' ? args.notice_id : undefined,
      agency: typeof args.agency === 'string' ? args.agency : undefined,
      requirements: Array.isArray(args.requirements)
        ? (args.requirements as Array<{ requirement: string; category?: string; section?: string; id?: string }>)
        : undefined,
      userEmail: ctx.userEmail,
    })) as unknown as Record<string, unknown>;
    return { result, credits };
  }

  if (name === 'export_proposal') {
    const result = (await exportProposal({
      title: typeof args.title === 'string' ? args.title : undefined,
      sections: Array.isArray(args.sections)
        ? (args.sections as Array<{ heading: string; text: string }>)
        : [],
    })) as unknown as Record<string, unknown>;
    return { result, credits };
  }

  if (name === 'get_balance') {
    const balance = await getBalance(ctx.userEmail);
    return { result: { balance }, credits };
  }

  throw new Error(`Unknown MCP tool: ${name}`);
}
