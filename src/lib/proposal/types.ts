/**
 * Shared types for the Proposal Assist v2 architecture.
 *
 * v2 ports Content Reaper's layered approach: every output is built
 * from (1) bidder profile + vault, (2) target-agency pain points,
 * (3) RAG style references, (4) section-specific lens for variety.
 * Humanization pass runs after generation.
 */

// ---- Section types --------------------------------------------------

/** RFP / proposal sections — full proposal responses. */
export type RfpSectionType =
  | 'exec_summary'
  | 'technical'
  | 'management'
  | 'past_performance'
  | 'pricing';

/** LOI / market-research response sections — Sources Sought / RFI responses. */
export type CapStatementSectionType =
  | 'company_overview'
  | 'cap_past_performance'
  | 'capabilities'
  | 'differentiators'
  | 'poc';

export type SectionType = RfpSectionType | CapStatementSectionType;

export const RFP_SECTIONS: RfpSectionType[] = [
  'exec_summary', 'technical', 'management', 'past_performance', 'pricing',
];

export const CAP_STATEMENT_SECTIONS: CapStatementSectionType[] = [
  'company_overview', 'cap_past_performance', 'capabilities', 'differentiators', 'poc',
];

export function isCapStatementSection(s: SectionType): s is CapStatementSectionType {
  return (CAP_STATEMENT_SECTIONS as string[]).includes(s);
}

// ---- Context layers --------------------------------------------------

export interface BidderProfile {
  companyName?: string;
  businessType?: string;
  naicsCodes?: string[];
  agencies?: string[];
  setAsides?: string[];
  certifications?: string[];
  locationStates?: string[];
}

export interface VaultContext {
  identity?: Record<string, unknown> | null;
  past_performance?: Array<Record<string, unknown>>;
  capabilities?: Array<Record<string, unknown>>;
  team?: Array<Record<string, unknown>>;
  has_any: boolean;
}

export interface AgencyContext {
  /** The agency name extracted from the RFP (or null if not detected) */
  agency: string | null;
  /** Pain points from the static database (max 6, most relevant first) */
  painPoints: string[];
  /** Strategic priorities the agency has flagged */
  priorities: string[];
  /** Budget trend line if available, e.g. 'VA: FY25 $310B → FY26 $325B (+4.8%)' */
  budgetTrend: string | null;
}

export interface RagChunk {
  document_id: string;
  chunk_index: number;
  chunk_text: string;
  doc_title: string | null;
  doc_type: string | null;
  rank: number;
}

// ---- Lens system ----------------------------------------------------

export interface LensOption {
  /** Short id (for analytics / debugging) */
  id: string;
  /** One-line framing the AI is instructed to adopt */
  framing: string;
}

// ---- Build pipeline -------------------------------------------------

export interface DraftBuildOpts {
  email: string;
  sectionType: SectionType;
  sourceText: string;
  /** File name of the uploaded RFP (for display) */
  fileName?: string;
  /** Optional: explicitly provide the RFP agency (skips detection) */
  rfpAgency?: string;
}

export interface BuiltPrompt {
  systemPrompt: string;
  userPrompt: string;
  /** All the context layers that went in, surfaced for the API response
   *  meta + the /admin/proposal-ab side-by-side view */
  context: {
    profile: BidderProfile;
    vault: VaultContext;
    agency: AgencyContext;
    rag: RagChunk[];
    lens: LensOption | null;
    inputChars: number;
    wasTruncated: boolean;
    /** Situation-aware length: word target + the output-token budget to allow it
     *  (scaled to the section's mapped-requirement count). */
    targetWords?: number;
    maxOutputTokens?: number;
  };
}

export interface DraftResult {
  section: SectionType;
  label: string;
  draft: string;
  wordCount: number;
  targetWords: number;
  meta: {
    model: string;
    pipeline: 'v1' | 'v2';
    inputChars: number;
    truncated: boolean;
    originalChars: number;
    profileGrounded: boolean;
    vaultGrounded: boolean;
    vaultCounts: { past_performance: number; capabilities: number; team: number };
    ragChunksUsed: number;
    ragSources: Array<{ title: string | null; type: string | null }>;
    agencyDetected: string | null;
    painPointsUsed: number;
    lensId: string | null;
    humanized: boolean;
    /** Fact-guard: count of ungrounded facts caught + neutralized to [placeholders]. */
    factGuardFlags?: number;
    /** Fact-guard: the actual ungrounded values that were removed (capped). */
    factGuardRemoved?: string[];
  };
}
