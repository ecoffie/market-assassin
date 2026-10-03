/**
 * The ChatGPT MCP PROFILE — everything that makes https://mcp.getmindy.ai/chatgpt/mcp
 * different from the full Claude/general endpoint, in one module.
 *
 * Owner decisions (frozen 2026-10-02, tasks/chatgpt-plugin-path-a.md):
 *   1. Commerce cleanup is /chatgpt/mcp ONLY. The full endpoint is untouched.
 *   2. No prices, purchase/top-up links, upgrade pitches, checkout, continue_url, saved
 *      purchase retries, credit footer or `_meta.credits` on this surface.
 *   3. No new-user free-credit acquisition via ChatGPT.
 *   4. A call may debit an existing balance (runMeteredTool — billing seam intact) but
 *      never triggers auto-recharge in-request.
 *   5. Exactly the 15 tools in CHATGPT_TOOL_ALLOWLIST.
 *
 * Input schemas are NOT redefined here: chatgptRegistrationList() reuses the registry's
 * mcpRegistrationList() entries and overrides only title / description / annotations,
 * plus the DESCRIPTION TEXT of selected parameters (CHATGPT_PARAM_COPY — types, required,
 * enums and bounds unchanged). So a schema fix in the registry reaches ChatGPT
 * automatically, and the ChatGPT surface can never accept an argument the dispatcher doesn't.
 *
 * Annotation justifications (per tool, per hint) live in docs/chatgpt-plugin/annotations.json
 * for the submission package; a unit test keeps that file and this module in agreement.
 */
import type { Implementation } from '@modelcontextprotocol/sdk/types.js';
import { z, type ZodRawShape, type ZodTypeAny } from 'zod';
import { mcpRegistrationList, type McpRegistrationEntry, type McpToolAnnotations } from './tool-schemas';
import { buildChatgptRefusal, CHATGPT_REFUSAL_CODES, type ChatgptRefusal } from './chatgpt-refusals';

// ── 1. The allowlist ─────────────────────────────────────────────────────────

export const CHATGPT_TOOL_ALLOWLIST = [
  'find_opportunities',
  'lookup_solicitation',
  'get_solicitation_incumbent',
  'get_award_detail',
  'get_expiring_contracts',
  'search_past_contracts',
  'search_grants',
  'search_contractors',
  'get_contractor_profile',
  'lookup_sam_entity',
  'get_agency_intel',
  'search_federal_events',
  'get_legislation_status',
  'capability_market_match',
  'get_keyword_coverage',
] as const;

export type ChatgptToolName = (typeof CHATGPT_TOOL_ALLOWLIST)[number];

const ALLOW = new Set<string>(CHATGPT_TOOL_ALLOWLIST);

export function isChatgptTool(name: string): name is ChatgptToolName {
  return ALLOW.has(name);
}

// ── 2. ChatGPT-specific titles, descriptions, annotations ───────────────────
//
// Written for USER INTENT: what the user asks → what they get → key limits. No internal
// table names, no result-enum labels, no host-orchestration rules, no credits, no plan
// names. Sibling tools are named only when they are in this subset.
//
// openWorldHint is decided per implementation (see annotations.json): true when the tool
// can make a live call to an external system (SAM.gov, USASpending, Grants.gov, the open
// web, a third-party model API); false when it reads only Mindy's own stored copy of
// public records (Postgres tables / Mindy's BigQuery warehouse) and nothing else.

interface ChatgptToolCopy {
  title: string;
  description: string;
  openWorldHint: boolean;
}

export const CHATGPT_TOOL_COPY: Readonly<Record<ChatgptToolName, ChatgptToolCopy>> = {
  find_opportunities: {
    title: 'Find Opportunities',
    description:
      'Find federal contract opportunities for what a business sells, in plain English (for example "cybersecurity in Florida" or "janitorial for the VA"). One call returns three horizons: Open now (live SAM.gov solicitations), Coming back (contracts likely to be recompeted) and Coming soon (agency procurement forecasts). Each horizon is reported separately as found, empty or unavailable, and an empty horizon is not a market-wide zero. Optional filters: location or states, agency, set-aside, timeframe and stage. To identify one specific or past solicitation, use lookup_solicitation.',
    openWorldHint: true,
  },
  lookup_solicitation: {
    title: 'Look Up a Solicitation',
    description:
      'Find and identify one specific federal solicitation. Paste a solicitation number or SAM.gov notice ID, or describe a past or closed one in your own words (for example "the Navy manufacturing bid at Indian Head we submitted"). Closed and archived notices are included, and closed does not mean awarded. A description returns a likely match for the user to confirm, not a confirmed identity; after they confirm, call again with confirm_notice_id. Amendments collapse to the latest version. For who holds the contract behind it, use get_solicitation_incumbent. To find new work, use find_opportunities.',
    openWorldHint: false,
  },
  get_solicitation_incumbent: {
    title: 'Solicitation Incumbent',
    description:
      'Who currently holds the contract behind a solicitation. Give a SAM.gov solicitation number (for example 140L6226Q0013) or notice ID. Returns the solicitation\'s current status and the likely prior award from USASpending: the incumbent company, contract number, value and ceiling, and end date. The incumbent is a best-match inference, and when no clear prior award exists it says so instead of guessing. A solicitation number is not a contract number; for the full detail of a known contract, use get_award_detail.',
    openWorldHint: true,
  },
  get_award_detail: {
    title: 'Award Detail',
    description:
      'Full public detail for one awarded federal contract, from USASpending: amount obligated and total ceiling, the parent contract vehicle a bidder would need to hold, period of performance and end date (recompete timing), the recipient, NAICS and PSC codes, and the funding account, with a USASpending link. Pass a contract number (PIID) or a USASpending award ID. A solicitation number is not a contract number; use get_solicitation_incumbent for those. When no award matches it says so instead of estimating.',
    openWorldHint: true,
  },
  get_expiring_contracts: {
    title: 'Expiring Contracts',
    description:
      'Federal contracts ending soon that are likely recompete targets. Filter by NAICS, agency, place-of-performance state, months until expiration, contract value and recompete likelihood. Returns the incumbent, agency, value and ceiling, end date and a suggested capture start (end date minus 12 months, not an announced recompete date), soonest first. Task orders are grouped under their parent contract vehicle. If nothing matches, widen the months window. For one combined view of open, recompete and forecast opportunities, use find_opportunities.',
    openWorldHint: true,
  },
  search_past_contracts: {
    title: 'Search Past Contracts',
    description:
      'Search already-awarded federal prime contracts on USASpending by location plus NAICS, PSC, agency, recipient, value or date range, for example "contracts awarded in Florida for IT services". state_scope chooses place of performance (the default), the winning company\'s home state, or both. Each award comes back with recipient, amount, agency, codes, locations, dates and a USASpending link. These are past awards, not open bids: for open work use find_opportunities, and for one company\'s record use get_contractor_profile. Empty results are reported, never filled in.',
    openWorldHint: true,
  },
  search_grants: {
    title: 'Search Grants',
    description:
      'Search federal grant opportunities on Grants.gov by keyword, agency or funding category, for example "rural broadband" or "veteran health". Returns title, agency, status, close date, award ceiling, assistance listing number and a Grants.gov link. Defaults to posted opportunities; forecasted, closed and archived ones are also available. Grants are financial assistance with a different application path from contracts; for contract opportunities, use find_opportunities.',
    openWorldHint: true,
  },
  search_contractors: {
    title: 'Search Contractors',
    description:
      'Size up the competition or find teaming partners: the leading federal contractors for a NAICS code, company-name keyword or state, ranked by total obligated dollars, award count or name. Each firm comes back with its award totals and how many agencies it sells to (a broad seller versus one dependent on a single customer). Dollars are historical USASpending obligations, not a bid list. For one company in depth use get_contractor_profile; for its registration use lookup_sam_entity.',
    openWorldHint: false,
  },
  get_contractor_profile: {
    title: 'Contractor Profile',
    description:
      'Federal award history for one company by name (for example "Leidos"): total awards, top customer agencies and recent contracts, from USASpending award data. When several companies match, it returns the candidates instead of picking one. No awards found means none in this award dataset; it is not proof the company has never won federal work and says nothing about its certifications. For registration status, UEI or certifications, use lookup_sam_entity.',
    openWorldHint: false,
  },
  lookup_sam_entity: {
    title: 'SAM.gov Registration',
    description:
      'Check a company\'s live SAM.gov registration: UEI and CAGE code, legal name, registration status, NAICS codes, small-business certifications (such as 8(a), HUBZone, WOSB and SDVOSB), location, and the names of its registered points of contact. Search by UEI for an exact match, or by company name with an optional state. SAM.gov does not publish contact emails or phone numbers, so only names are returned. Set-aside eligibility depends on the current status shown, not on past awards.',
    openWorldHint: true,
  },
  get_agency_intel: {
    title: 'Agency Intel',
    description:
      'Research a federal agency before pursuing it. Look it up by name, abbreviation or code (for example "VA", "Department of the Navy" or "069"). Returns where it sits in the federal hierarchy, curated challenges and priorities (Mindy\'s research, not official statements), its contract spending for the fiscal year with top NAICS codes when available, and the defense authorization bills on record for it with their status. Bill text is not held. For bill status not tied to an agency, use get_legislation_status.',
    openWorldHint: true,
  },
  search_federal_events: {
    title: 'Federal Events',
    description:
      'Upcoming federal contracting events for an agency: industry days, matchmaking sessions and pre-solicitation conferences from SAM.gov notices, each with date, location, registration link and the buying office. Optionally adds web-discovered association conferences (include_ai_discovery), which carry a confidence score and should be verified before attending, and optionally returns a calendar file of the dated events (include_ics). Looks ahead up to 12 months; widen months_ahead if nothing is found.',
    openWorldHint: true,
  },
  get_legislation_status: {
    title: 'Legislation Status (NDAA)',
    description:
      'Status of defense authorization (NDAA) legislation in Congress, for example "Has the FY2027 NDAA become law?", "H.R. 8800" or "PL 119-60". Returns each bill and version with its stage (introduced, reported, passed House or Senate, enrolled, public law), dates, the latest recorded action and congress.gov links. House and Senate bills are kept separate, and only a public law is law. Covers NDAA-titled bills in the current Congress; other bills and appropriations are not tracked. It holds status, not bill text, so it cannot say what a bill requires.',
    openWorldHint: false,
  },
  capability_market_match: {
    title: 'Capability Market Match',
    description:
      'Where does my company fit in the federal market? Describe what the company does in its own words, plus optional capabilities and past performance, and get its addressable market: the terms buyers use, total federal spending and the NAICS codes it flows through (marked verified or unverified), the competitors already winning there, upcoming agency forecasts and contracts expiring soon. Sections that run out of time are listed as omitted rather than shown as empty. Needs enough company description to work from.',
    openWorldHint: true,
  },
  get_keyword_coverage: {
    title: 'Keyword Market Coverage',
    description:
      'How big is the federal market for a product or service, and which industry codes does it really flow through? Give a keyword such as "drones" or "demolition". Returns total federal contract spending in the latest complete fiscal year (matched on award descriptions), the NAICS codes ranked by share, the smallest set covering about 90% of it, and the top product and service (PSC) codes. Shows why a single NAICS code usually misses most of a market. A result that could not be established is reported separately from a true zero.',
    openWorldHint: false,
  },
};

/** The three hints that are identical for every ChatGPT tool (all are read-only lookups). */
const BASE_HINTS = { readOnlyHint: true, destructiveHint: false, idempotentHint: true } as const;

export function chatgptAnnotationsFor(name: ChatgptToolName): McpToolAnnotations & { title: string } {
  const copy = CHATGPT_TOOL_COPY[name];
  return { title: copy.title, ...BASE_HINTS, openWorldHint: copy.openWorldHint };
}

// ── 2b. ChatGPT-only PARAMETER descriptions (owner decision 2, GO 2026-10-02) ──
//
// Only the `description` TEXT of a parameter changes on /chatgpt/mcp. Type, required,
// enum values, defaults and bounds stay exactly the registry's (the zod type is cloned
// with a new description, never rebuilt). Overrides remove per-call cost talk, internal
// table/field names, result-enum labels and journey jargon. Parameters without an entry
// here keep the registry text (it was audited clean on 2026-10-02; the unit test bans
// commerce terms on every ChatGPT parameter, so a future registry edit that adds one
// fails CI instead of shipping). An override naming a parameter the registry does not
// have THROWS (drift guard) — a renamed param must never silently lose its override.

export const CHATGPT_PARAM_COPY: Readonly<Partial<Record<ChatgptToolName, Readonly<Record<string, string>>>>> = {
  find_opportunities: {
    location:
      'Optional state, as a name or 2-letter code ("Florida" or "FL"). Each horizon applies it slightly differently; the result says how.',
    agency: 'Optional government customer the user wants to sell to ("Navy", "VA", "Department of Defense").',
    limit_per_horizon: 'Maximum items returned for each horizon (default 5, max 25). Each horizon is limited separately.',
    advanced: 'Optional specialist codes (for example NAICS or PSC). Prefer a plain-English query.',
    uei:
      'Optional 12-character SAM.gov UEI of the user\'s company, only if the user already gave it (do not ask for it before showing results). When provided, the company\'s registered NAICS and PSC codes widen the search (shown as a company-registration match, never as a direct match), and each item is marked eligible, not eligible (with the reason) or unknown, based on the company\'s size standard for that notice\'s NAICS code.',
    states:
      'Optional region: several states at once, as names or 2-letter codes (["GA","AL","TN"]). Combined with location. There is no radius or military-installation lookup; a value that is not a US state is reported back in the result and never widens the search.',
    stage:
      'Optional acquisition stage, applied to open solicitations only: market research (RFIs and sources sought), contract-vehicle solicitations (IDIQ, MACC, MATOC, JOC, SABER, BPA) or non-FAR awards (CSO, OTA, BAA). Matched on the SAM.gov notice type first, then on title wording; notices with no recognizable type are left out and counted. Recompetes and forecasts are not filtered by stage. Only pass it when the user asked for a stage.',
  },
  lookup_solicitation: {
    confirm_notice_id:
      'After the user confirms a suggested match ("yes, that\'s the one"), pass that notice ID to get the confirmed, current record.',
  },
  get_award_detail: {
    id: 'USASpending award ID, if already known (for example from a USASpending link). Otherwise pass piid.',
  },
  get_expiring_contracts: {
    limit: 'Maximum results (default 50, max 200).',
  },
  search_grants: {
    agency: 'Top-level agency code, for example "DOD" or "HHS". Matches agencies whose code starts with it.',
  },
  search_contractors: {
    keyword: 'Company-name text to match, for example "Booz".',
    limit: 'Maximum results (default 50, max 100).',
  },
  search_federal_events: {
    agency: 'Agency name, for example "Department of Defense", "Navy" or "GSA". Common variations of agency names are recognized.',
    limit: 'Maximum SAM.gov events returned (default 50, max 100).',
    include_ics:
      'Also return a calendar file (base64-encoded .ics) of the matching events, for import into Google, Outlook or Apple Calendar. Only events with a real published date are included; undated events are counted in the result, never assigned a guessed date. Default false.',
  },
  capability_market_match: {
    client_name: 'Optional company name to show at the top of the result.',
  },
};

/** Clone a zod param with a new description; optional() is re-applied around the clone. */
function withDescription(schema: ZodTypeAny, description: string): ZodTypeAny {
  if (schema instanceof z.ZodOptional) {
    return (schema.unwrap() as ZodTypeAny).describe(description).optional();
  }
  return schema.describe(description);
}

/** Apply CHATGPT_PARAM_COPY to one tool's registry shape (new object; registry untouched). */
export function chatgptInputSchema(
  name: ChatgptToolName,
  base: ZodRawShape,
  overrides: Readonly<Record<string, string>> | undefined = CHATGPT_PARAM_COPY[name],
): ZodRawShape {
  if (!overrides) return base;
  const shape: Record<string, ZodTypeAny> = { ...(base as Record<string, ZodTypeAny>) };
  for (const [param, description] of Object.entries(overrides)) {
    const current = shape[param];
    if (!current) {
      throw new Error(`chatgpt-profile: CHATGPT_PARAM_COPY overrides "${name}.${param}", which is not a parameter in the MCP registry`);
    }
    shape[param] = withDescription(current, description);
  }
  return shape as ZodRawShape;
}

/**
 * The 15 registration entries for the ChatGPT handler — registry schemas, ChatGPT copy.
 * Throws if an allowlisted tool is missing from the registry (a rename must fail loudly,
 * never silently ship a 14-tool profile), or if a param override names an unknown param.
 */
export function chatgptRegistrationList(): McpRegistrationEntry[] {
  const byName = new Map(mcpRegistrationList().map((e) => [e.name, e]));
  return CHATGPT_TOOL_ALLOWLIST.map((name) => {
    const base = byName.get(name);
    if (!base) throw new Error(`chatgpt-profile: allowlisted tool "${name}" is not in the MCP registry`);
    const annotations = chatgptAnnotationsFor(name);
    return {
      name,
      title: annotations.title,
      description: CHATGPT_TOOL_COPY[name].description,
      inputSchema: chatgptInputSchema(name, base.inputSchema),
      annotations,
    };
  });
}

// ── 3. Server identity + instructions ───────────────────────────────────────

export const CHATGPT_SERVER_INFO: Implementation = {
  name: 'Mindy',
  version: '1.0.0',
  description: 'Federal contracting research from public government records: opportunities, awards, contractors, grants, agencies, events and NDAA status.',
  websiteUrl: 'https://getmindy.ai',
  icons: [{ src: 'https://getmindy.ai/icon.png', mimeType: 'image/png', sizes: ['512x512'] }],
};

/**
 * Server instructions. The key guidance sits in the first 512 characters (some hosts
 * truncate); everything references only the 15 subset tools; no commerce.
 */
export const CHATGPT_SERVER_INSTRUCTIONS = [
  'Mindy answers federal contracting questions from public government records (SAM.gov, USASpending, Grants.gov, Congress). Pick one tool by intent: find_opportunities to find work for what a business sells; lookup_solicitation to identify a specific or past solicitation; get_solicitation_incumbent for who holds the contract behind one; get_legislation_status for NDAA or bill status. Report only what tools return. Unavailable is not zero; never invent records.',
  '',
  'Every result carries _meta grounding flags: grounded (real records were returned; get_solicitation_incumbent splits it into grounded_notice and grounded_incumbent) and degraded (a source failed or timed out). When a result is not grounded, say nothing was found or the source was unavailable, and suggest one way to broaden; do not fill the gap with estimates.',
  'Never invent solicitations, awards, companies, contacts, dollar amounts, dates or bill provisions. get_legislation_status and get_agency_intel hold bill status, not bill text: do not describe what a bill requires.',
  'SAM.gov does not publish contact emails or phone numbers; do not supply them.',
  'Keep record identifiers (notice IDs, solicitation and contract numbers) and source links (sam.gov, usaspending.gov, grants.gov, congress.gov) in answers so the user can verify them.',
  'Show results first; ask at most one clarifying question afterwards.',
].join('\n');

// ── 4. Response projection ──────────────────────────────────────────────────
//
// ONE function, applied identically to the text block and structuredContent (the route
// serialises the same projected object into both). Pure: never mutates the tool result.
//
// `_meta` is an ALLOWLIST — grounding / provenance / coverage keys survive, everything
// else (billing, timing, diagnostics, plan versions, model/composition labels, and any
// key a tool adds tomorrow) is dropped until someone decides it belongs on ChatGPT.
// Key names were taken from the real tool outputs (survey 2026-10-02, recorded in
// tasks/chatgpt-plugin-path-a.md), not guessed.

export const CHATGPT_META_ALLOW: ReadonlySet<string> = new Set([
  // grounding (every tool)
  'grounded', 'degraded', 'degraded_reason', 'validation_error', 'confidence', 'as_of', 'source_count',
  'note', 'source_note',
  // section / coverage accounting
  'sections', 'sections_omitted', 'sections_failed', 'section_status', 'sample_coverage',
  'count', 'total', 'match_count', 'candidate_count',
  // find_opportunities (expansion_note is an honest scope disclosure, e.g. "these IT
  // codes can contain cyber work but are not cybersecurity" — kept)
  'find_shape', 'watch_coverage', 'expansion_note',
  // get_solicitation_incumbent
  'grounded_notice', 'grounded_incumbent', 'status', 'amendment', 'matched_by', 'version_count',
  'deadline_conflict', 'notice_ids', 'incumbent_certainty', 'incumbent_reason',
  // get_expiring_contracts
  'vehicle_count', 'orders_rolled_up', 'vehicles_ordering_end_unknown', 'orders_parent_unknown',
  // search_past_contracts
  'state_scope', 'auto_widened', 'field_status',
  // lookup_sam_entity
  'mode', 'source', 'lookup_status', 'match_status', 'reconciliation',
  // get_agency_intel
  'has_spending', 'spending_scope', 'sourced_pain_points', 'legacy_pain_points',
  'legislation_status', 'legislative_measures',
  // search_federal_events
  'sam_count', 'ai_count', 'ai_discovery', 'ics_events', 'ics_skipped_undated',
  // get_legislation_status
  'resolution_kind',
  // capability_market_match
  'anchor_verified', 'anchor_confidence', 'anchor_note', 'selected_anchor', 'lead_keyword',
  'lead_naics', 'tam_verified', 'evidence',
  // get_keyword_coverage
  'evidence_status', 'naics_identity_status', 'naics_count', 'total_market', 'transaction_count',
  'unique_award_count', 'fiscal_year', 'window_kind', 'window_label', 'question_kind',
]);

/**
 * Documented deny list — every key below is dropped by the allowlist anyway; listing them
 * lets the tests prove the specific internals named by the owner never reach ChatGPT.
 */
export const CHATGPT_META_DENY_DOCUMENTED: readonly string[] = [
  'credits', 'elapsed_ms', 'db_ms', 'requests_fired', 'from_cache', 'billing_outcome',
  'rows_before_collapse', 'history_matches', 'corpus_matches', 'collapsed_count', 'sow_text_used',
  'external_api', 'discovery', 'composition', 'competitor_derivation', 'resolved_id',
  'notice_source', 'model', 'model_name',
];

/** Keys removed at ANY depth: commerce continuations + narration that stays off here. */
const STRIP_EVERYWHERE: ReadonlySet<string> = new Set([
  'continue_url', 'continuation_available', 'attempt_id', 'attemptId', '_ai_hint',
]);

/** Incumbent-match scoring internals (get_solicitation_incumbent incumbent / prior_awards[]). */
const INCUMBENT_SCORING_INTERNALS: readonly string[] = [
  'matchScore', 'distinctiveHits', 'workHits', 'locationHits', 'noticeSector', 'awardSector',
];

/** find_opportunities filters_consumed entries that are ranking internals, not user filters. */
// Kept (user-meaningful): location→…, status=active, timeframe.…, pop_end≥today,
// exclude_past_fy, horizon_disabled. Dropped: plan versions, eligibility/rank/query
// plumbing, retrieval routes and data-quality flags.
function isInternalFilterTag(tag: unknown): boolean {
  return typeof tag === 'string' && /^(canonical_discovery:|eligibility:|rank→|query→|agency→|quality_flag=)|_via=/.test(tag);
}

/** A host rule that steers toward a tool this profile does not expose (or `_next`/artifacts). */
const NON_SUBSET_TOOL_RE = /\b[a-z]+(?:_[a-z]+)+\b/g;
function ruleMentionsForeignTool(rule: string): boolean {
  if (/_next|artifact/i.test(rule)) return true;
  for (const m of rule.match(NON_SUBSET_TOOL_RE) ?? []) {
    // only words that are actual MCP tool names count (snake_case field names like
    // related_market_candidate are not tools)
    if (KNOWN_TOOL_NAMES.has(m) && !ALLOW.has(m)) return true;
  }
  return false;
}
const KNOWN_TOOL_NAMES: ReadonlySet<string> = new Set(mcpRegistrationList().map((e) => e.name));

type Json = unknown;
type Obj = Record<string, unknown>;
const isObj = (v: Json): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function projectMeta(meta: Obj): Obj {
  const out: Obj = {};
  for (const [k, v] of Object.entries(meta)) {
    if (CHATGPT_META_ALLOW.has(k)) out[k] = deepClean(v);
  }
  return out;
}

/** Generic recursive pass: `_meta` allowlist at every depth + STRIP_EVERYWHERE keys. */
function deepClean(v: Json): Json {
  if (Array.isArray(v)) return v.map(deepClean);
  if (!isObj(v)) return v;
  const out: Obj = {};
  for (const [k, val] of Object.entries(v)) {
    if (STRIP_EVERYWHERE.has(k)) continue;
    out[k] = k === '_meta' && isObj(val) ? projectMeta(val) : deepClean(val);
  }
  return out;
}

/** `_next`: keep the follow-up prompt, drop credits; drop offers for tools not on this surface. */
function projectNext(next: Json): Json {
  if (!Array.isArray(next)) return next;
  return next
    .filter((n) => !(isObj(n) && typeof n.tool === 'string' && !ALLOW.has(n.tool)))
    .map((n) => {
      if (!isObj(n)) return n;
      const { credits: _credits, ...rest } = n;
      void _credits;
      return rest;
    });
}

function projectFind(r: Obj): Obj {
  const out: Obj = { ...r };
  if (isObj(out.query_summary)) {
    const { interpreted_as: _ia, ...qs } = out.query_summary;
    void _ia;
    out.query_summary = qs;
  }
  if (isObj(out.market_interpretation)) {
    const { retrieval_plan: _rp, ...mi } = out.market_interpretation;
    void _rp;
    if (isObj(mi.buyer)) {
      const { needles: _n, ...buyer } = mi.buyer;
      void _n;
      mi.buyer = buyer;
    }
    if (isObj(mi.truth)) {
      const { records: _rec, ...truth } = mi.truth;
      void _rec;
      mi.truth = truth;
    }
    out.market_interpretation = mi;
  }
  if (isObj(out.horizons)) {
    const hz: Obj = {};
    for (const [key, h] of Object.entries(out.horizons)) {
      if (!isObj(h)) { hz[key] = h; continue; }
      const { allowed_handoffs: _ah, orders_excluded: _oe, unmapped_count: _uc, ...rest } = h;
      void _ah; void _oe; void _uc;
      if (Array.isArray(rest.filters_consumed)) {
        rest.filters_consumed = rest.filters_consumed.filter((t) => !isInternalFilterTag(t));
      }
      hz[key] = rest;
    }
    out.horizons = hz;
  }
  if (isObj(out.presentation) && Array.isArray(out.presentation.host_rules)) {
    out.presentation = {
      ...out.presentation,
      host_rules: out.presentation.host_rules.filter((rule) => typeof rule === 'string' && !ruleMentionsForeignTool(rule)),
    };
  }
  return out;
}

function stripScoring(v: Json): Json {
  if (!isObj(v)) return v;
  const out: Obj = { ...v };
  for (const k of INCUMBENT_SCORING_INTERNALS) delete out[k];
  return out;
}

function projectIncumbent(r: Obj): Obj {
  const out: Obj = { ...r };
  if ('incumbent' in out) out.incumbent = stripScoring(out.incumbent);
  if (Array.isArray(out.prior_awards)) out.prior_awards = out.prior_awards.map(stripScoring);
  return out;
}

/**
 * Project a tool result for ChatGPT. Tool-specific trims first (they know the shape),
 * then the generic pass (`_meta` allowlist everywhere, `_next` credits, commerce keys).
 */
export function projectChatgptResult(tool: string, result: Record<string, unknown>): Record<string, unknown> {
  let r: Obj = { ...result };
  if (tool === 'find_opportunities') r = projectFind(r);
  if (tool === 'get_solicitation_incumbent') r = projectIncumbent(r);
  if (tool === 'get_contractor_profile' && !isObj(r._meta)) {
    // This tool emits no `_meta`; derive the two grounding flags from its OWN resolution
    // fields (no inference beyond them): found=true ⇒ grounded; lookup_failed ⇒ degraded.
    r._meta = { grounded: r.found === true, degraded: r.resolution === 'lookup_failed' };
  }
  if ('_next' in r) r._next = projectNext(r._next);
  const cleaned = deepClean(r) as Obj;
  // Every tool result keeps an object `_meta` (empty when the tool emits none — e.g.
  // get_contractor_profile), so hosts can always read `_meta.grounded` safely.
  if (!isObj(cleaned._meta)) cleaned._meta = {};
  return cleaned;
}

// ── 5. Neutral refusals ─────────────────────────────────────────────────────

export interface MeteredErrorLike {
  code: string;
  message: string;
  commercial?: { required_credits: number | null; available_credits: number | null } | undefined;
}

/**
 * Map a metered failure onto the ChatGPT tool result.
 *   · refusal codes (credits / plan / limits / billing account) → a NON-error structured
 *     refusal with neutral copy and no commerce fields.
 *   · genuine tool failures → isError with the code + a neutral message (never a link).
 */
export function chatgptToolResultFromMeteredError(
  toolName: string,
  error: MeteredErrorLike,
  numbers: { requiredCredits: number | null; availableCredits: number | null },
): { isError: boolean; content: { type: 'text'; text: string }[]; structuredContent?: Record<string, unknown> } {
  if (CHATGPT_REFUSAL_CODES.has(error.code)) {
    const refusal: ChatgptRefusal = buildChatgptRefusal({
      code: error.code,
      toolName,
      requiredCredits: error.commercial?.required_credits ?? numbers.requiredCredits,
      availableCredits: error.commercial?.available_credits ?? numbers.availableCredits,
    });
    const structured = { ...refusal } as unknown as Record<string, unknown>;
    return {
      isError: false,
      content: [
        { type: 'text', text: refusal.message },
        { type: 'text', text: JSON.stringify(structured) },
      ],
      structuredContent: structured,
    };
  }
  return {
    isError: true,
    content: [{ type: 'text', text: `${error.code}: ${error.message}` }],
  };
}
