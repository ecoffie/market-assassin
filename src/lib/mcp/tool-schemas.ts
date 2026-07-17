/**
 * Bridge the registry's OpenAI-style JSON-Schema tool defs (listMcpTools) into
 * the Zod input shapes the MCP SDK's `server.registerTool` wants — so the hosted
 * HTTP transport can register EVERY registry tool from one source of truth
 * instead of hand-declaring one. This is what keeps the endpoint's advertised
 * toolset in sync with `runMcpTool` / the `/mcp` pricing table (they had drifted:
 * the registry has 9 tools, the transport only exposed get_winning_playbook).
 *
 * The registry's parameter schemas are deliberately simple (string / number /
 * boolean / array / enum / object), so a small converter covers them; anything
 * unrecognized falls back to a permissive `z.unknown()` rather than a restrictive
 * default, so a schema quirk can never block an otherwise-valid tool call.
 */
import { z, type ZodRawShape, type ZodTypeAny } from 'zod';
import { listMcpTools } from './tool-registry';

interface JsonSchemaProp {
  type?: string;
  description?: string;
  items?: { type?: string };
  enum?: string[];
}
interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchemaProp>;
  required?: string[];
}

function scalar(type: string | undefined): ZodTypeAny {
  switch (type) {
    case 'number':
    case 'integer':
      return z.number();
    case 'boolean':
      return z.boolean();
    case 'string':
      return z.string();
    default:
      return z.unknown();
  }
}

function propToZod(prop: JsonSchemaProp): ZodTypeAny {
  let base: ZodTypeAny;
  if (prop.enum && prop.enum.length) {
    base = z.enum(prop.enum as [string, ...string[]]);
  } else if (prop.type === 'array') {
    base = z.array(scalar(prop.items?.type));
  } else {
    base = scalar(prop.type);
  }
  return prop.description ? base.describe(prop.description) : base;
}

/**
 * MCP tool annotations (the SDK's `ToolAnnotations`). Claude Desktop reads these
 * to BUCKET tools in its "Tool permissions" UI — without them every tool lands in
 * one flat "Other tools" pile (readOnlyHint absent → uncategorizable). Every Mindy
 * MCP tool is a read-only intel/compute lookup: it queries gov/proprietary data or
 * computes over a solicitation and returns it — it never mutates the user's Mindy
 * account or any external system. So they all carry readOnlyHint:true and collapse
 * into a single "Read-only tools — Always allow" bucket (one safe toggle).
 *
 * ⚠️ If a MUTATING tool is ever added (writes to the user's account, sends an email,
 * etc.), it MUST override this with `readOnlyHint:false, destructiveHint:true` so it
 * does NOT hide inside the always-allow read-only group.
 */
export interface McpToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

const READ_ONLY_ANNOTATIONS: McpToolAnnotations = {
  readOnlyHint: true,   // → Claude Desktop "Read-only tools" bucket
  idempotentHint: true, // same args → same data (a query, not a mutation)
  openWorldHint: true,  // hits live external data (SAM / USASpending / EDGAR / corpus)
};

/**
 * Per-tool title + write classification for the HOSTED edge (mcp.getmindy.ai) —
 * the surface Claude and the directory reviewers actually connect to.
 *
 * This map exists because the blanket READ_ONLY_ANNOTATIONS above was applied to
 * EVERY tool, which was wrong twice over:
 *
 *   1. SAFETY. add_contacts_to_crm writes to the user's own GoHighLevel CRM
 *      (POST /contacts/upsert, which dedupes by email/phone and can therefore
 *      OVERWRITE an existing contact's fields). Declaring it readOnlyHint+
 *      idempotentHint told Claude it could run that write with NO confirmation
 *      prompt. generate_market_report likewise persists a row and mints a public
 *      /reports/{id} link.
 *   2. SUBMISSION. No `title` was emitted at all. The Connectors Directory
 *      requires "a `title` and the applicable `readOnlyHint` or `destructiveHint`"
 *      on every tool, and the portal flags un-annotated tools before you can submit.
 *
 * Keep in sync with src/mcp/server.ts (the stdio server), which carries the same
 * classification inline. Two surfaces, one catalog — changing one means changing
 * both. tool-registry.ts remains the source of truth for WHICH tools exist; this
 * map only decorates them.
 */
type ToolMeta = { title: string; write?: 'destructive' | 'additive' };
const TOOL_META: Readonly<Record<string, ToolMeta>> = {
  add_contacts_to_crm: { title: 'Add Contacts to CRM (one-shot)', write: 'destructive' },
  assess_market_depth: { title: 'Assess Market Depth (Rule of Two)' },
  build_proposal_structure: { title: 'Build Proposal Structure (outline from compliance matrix)' },
  derive_company_keywords: { title: 'Derive Company Keywords' },
  draft_proposal: { title: 'Draft Proposal (full, multi-section)' },
  draft_proposal_section: { title: 'Draft Proposal Section' },
  evaluate_bid_decision: { title: 'Evaluate Bid Decision' },
  export_proposal: { title: 'Export Proposal (.docx)' },
  extract_compliance_matrix: { title: 'Extract Compliance Matrix' },
  extract_statement_of_work: { title: 'Extract Statement of Work' },
  find_capable_contractors: { title: 'Find Capable Contractors' },
  find_predecessor_award: { title: 'Find Predecessor Award' },
  generate_market_report: { title: 'Generate Market Report (one-shot)', write: 'additive' },
  get_agency_budget_trends: { title: 'Get Agency Budget Trends' },
  get_agency_forecasts: { title: 'Get Agency Forecasts' },
  get_agency_intel: { title: 'Get Agency Intel' },
  get_agency_spending_detail: { title: 'Get Agency Spending Detail' },
  get_award_detail: { title: 'Get Award Detail' },
  get_balance: { title: 'Get Credit Balance' },
  get_contractor_award_history: { title: 'Get Contractor Award History' },
  get_contractor_profile: { title: 'Get Contractor Profile' },
  get_expiring_contracts: { title: 'Get Expiring Contracts' },
  get_federal_event_series: { title: 'Get Federal Event Series' },
  get_incumbent_financials: { title: 'Get Incumbent Financials (SEC EDGAR)' },
  get_keyword_coverage: { title: 'Get Keyword Coverage' },
  get_market_vocabulary: { title: 'Get Market Vocabulary' },
  get_pricing_intel: { title: 'Get Pricing Intel (GSA CALC)' },
  get_regulatory_demand: { title: 'Get Regulatory Demand' },
  get_sba_goaling_share: { title: 'Get SBA Goaling Share' },
  get_sblo_contact: { title: 'Get SBLO Contact' },
  get_solicitation_documents: { title: 'Get Solicitation Documents' },
  get_solicitation_incumbent: { title: 'Get Solicitation Incumbent' },
  get_winning_playbook: { title: 'Get Winning Playbook' },
  lookup_federal_osbp: { title: 'Look Up Federal OSBP' },
  lookup_sam_entity: { title: 'Look Up SAM Entity' },
  match_recompete_sow: { title: 'Match Recompete SOW' },
  referee_proposal_compliance: { title: 'Referee Proposal Compliance' },
  scan_proposal_compliance: { title: 'Scan Proposal Compliance' },
  search_agency_opps_by_office: { title: 'Search Agency Opportunities by Office' },
  search_contractors: { title: 'Search Contractors' },
  search_federal_contacts: { title: 'Search Federal Contacts' },
  search_federal_events: { title: 'Search Federal Events' },
  search_grants: { title: 'Search Grants' },
  search_idv_contracts: { title: 'Search IDV Contracts' },
  search_past_contracts: { title: 'Search Past Contracts' },
  search_podcast_lessons: { title: 'Search Podcast Lessons' },
  search_sam_opportunities: { title: 'Search SAM Opportunities' },
  search_sbir: { title: 'Search SBIR' },
};

/** Fallback title for a tool added to the registry but not yet in TOOL_META. */
function fallbackTitle(name: string): string {
  return name.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function annotationsFor(name: string): McpToolAnnotations & { title: string } {
  const meta = TOOL_META[name];
  const title = meta?.title ?? fallbackTitle(name);
  if (!meta?.write) return { title, ...READ_ONLY_ANNOTATIONS };
  // A write is never idempotent here and never read-only. destructiveHint is set
  // EXPLICITLY in both branches: per the MCP spec it defaults to TRUE once
  // readOnlyHint is false, so an additive tool must say false or it always prompts.
  return {
    title,
    readOnlyHint: false,
    destructiveHint: meta.write === 'destructive',
    idempotentHint: false,
    openWorldHint: true,
  };
}

export interface McpRegistrationEntry {
  name: string;
  /** Curated display title (TOOL_META). Beats prettifyToolName's mechanical split. */
  title: string;
  description: string;
  inputSchema: ZodRawShape;
  annotations: McpToolAnnotations;
}

/**
 * Every MCP tool as { name, description, Zod input shape } — ready to loop into
 * `server.registerTool`. Derived from `listMcpTools()`, so adding a tool to the
 * registry automatically surfaces it on the transport.
 */
export function mcpRegistrationList(): McpRegistrationEntry[] {
  return listMcpTools().map((raw) => {
    const fn = (raw as { function: { name: string; description?: string; parameters?: JsonSchema } }).function;
    const params = fn.parameters ?? { type: 'object', properties: {} };
    const required = new Set(params.required ?? []);
    const shape: Record<string, ZodTypeAny> = {};
    for (const [key, prop] of Object.entries(params.properties ?? {})) {
      const zod = propToZod(prop);
      shape[key] = required.has(key) ? zod : zod.optional();
    }
    const { title, ...hints } = annotationsFor(fn.name);
    return {
      name: fn.name,
      title,
      description: fn.description ?? '',
      inputSchema: shape as ZodRawShape,
      annotations: hints,
    };
  });
}
