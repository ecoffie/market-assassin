/**
 * MCP tools: draft_proposal + draft_proposal_section — expose Mindy's vault+RAG-
 * grounded proposal draft engine to any MCP agent.
 *
 *   - draft_proposal (credits: 50): the flagship. Wraps generateAllSections
 *     (src/lib/proposal/draft-all.ts) — a two-pass outline→parallel-write that
 *     drafts a full multi-section proposal (exec summary, technical, management,
 *     past performance, pricing OR a Sources-Sought/RFI cap-statement set).
 *   - draft_proposal_section (credits: 12): one section only, via generateV2Draft
 *     (src/lib/proposal/v2.ts).
 *
 * Both take ONE source: rfp_text (the solicitation text directly) OR notice_id
 * (fetched server-side via the same solicitation-documents path compliance-matrix
 * uses — SOW + body + attachment text). userEmail loads the caller's Vault (real
 * past performance / identity / team) so the draft is grounded, not generic.
 *
 * Pattern (mirrors compliance-matrix.ts / referee-compliance.ts): pure async fn,
 * `_meta` ALWAYS ships (grounded/degraded machine signals), `_ai_hint` OFF by
 * default (mcpFlags.aiHint). grounded=false ⇒ the hint says no draft was produced
 * and to NOT fabricate one.
 */
import { generateAllSections } from '@/lib/proposal/draft-all';
import { generateV2Draft } from '@/lib/proposal/v2';
import { getSolicitationDocuments } from '@/lib/sam/solicitation-documents';
import { RFP_SECTIONS, CAP_STATEMENT_SECTIONS, type SectionType, type DraftResult } from '@/lib/proposal/types';
import type { ComplianceReq, ReqCategory } from '@/lib/proposal/section-alignment';
import { mcpFlags } from '@/lib/mcp/flags';

// ---- Shared helpers -------------------------------------------------

const VALID_SECTIONS = new Set<string>([...RFP_SECTIONS, ...CAP_STATEMENT_SECTIONS]);

/** Keep only real SectionType strings the caller passed; undefined ⇒ let the
 *  engine auto-pick (RFP set vs. Sources-Sought/RFI cap-statement set). */
function toSectionTypes(arr?: string[]): SectionType[] | undefined {
  if (!Array.isArray(arr) || arr.length === 0) return undefined;
  const valid = arr.filter((s) => typeof s === 'string' && VALID_SECTIONS.has(s)) as SectionType[];
  return valid.length > 0 ? valid : undefined;
}

/** Coerce agent-supplied requirement rows into ComplianceReq. Category is
 *  re-normalized downstream (sectionAlignedReqs → normalizeCategory), so free-text
 *  is safe here. */
function toComplianceReqs(
  rows?: Array<{ requirement: string; category?: string; section?: string; id?: string }>,
): ComplianceReq[] | undefined {
  if (!Array.isArray(rows) || rows.length === 0) return undefined;
  const mapped = rows
    .filter((r) => r && typeof r.requirement === 'string' && r.requirement.trim())
    .map((r) => ({
      id: r.id,
      requirement: r.requirement,
      category: (r.category || 'other') as ReqCategory,
      section: r.section,
    }));
  return mapped.length > 0 ? mapped : undefined;
}

/** Build the source text for a notice: SOW + notice body + each attachment's
 *  extracted text — so the drafter sees the scope wherever it lives. Identical to
 *  compliance-matrix.ts's textFromNotice (honest degraded on a fetch error). */
async function textFromNotice(noticeId: string): Promise<{ text: string; degraded: boolean }> {
  try {
    const docs = await getSolicitationDocuments({ noticeId });
    const parts: string[] = [];
    if (docs.sow_text) parts.push(docs.sow_text);
    if (docs.description) parts.push(docs.description);
    for (const d of docs.documents) {
      if (d.extracted_text) parts.push(`--- ${d.filename || 'attachment'} ---\n${d.extracted_text}`);
    }
    return { text: parts.join('\n\n').trim(), degraded: false };
  } catch (err) {
    console.error('[draft-proposal] notice fetch failed', noticeId, err);
    return { text: '', degraded: true };
  }
}

/** Resolve the solicitation source text from rfp_text OR notice_id. */
async function resolveSource(
  rfpText?: string,
  noticeId?: string,
): Promise<{ text: string; source: 'notice_id' | 'text' | 'none'; fetchDegraded: boolean }> {
  const explicit = (rfpText || '').trim();
  if (explicit) return { text: explicit, source: 'text', fetchDegraded: false };
  const nid = (noticeId || '').trim();
  if (nid) {
    const fetched = await textFromNotice(nid);
    return { text: fetched.text, source: 'notice_id', fetchDegraded: fetched.degraded };
  }
  return { text: '', source: 'none', fetchDegraded: false };
}

// =====================================================================
// draft_proposal — full multi-section proposal
// =====================================================================

export interface DraftProposalInput {
  rfp_text?: string;
  notice_id?: string;
  /** Which sections to draft (SectionType strings). Omit to auto-pick. */
  sections?: string[];
  agency?: string;
  /** The MCP caller's verified email — loads their Vault + attributes LLM cost. */
  userEmail?: string | null;
}

/** A section trimmed of the heavy internal meta (RAG chunk bodies, source lists,
 *  fact-guard removals) — the agent gets the draft + coverage signals only. */
interface DraftProposalSection {
  section: string;
  title: string;
  content: string;
  word_count: number;
  target_words: number;
  /** How many of the section's requirements were mapped to real vault evidence (0=off/none). */
  requirements_mapped: number;
}

export interface DraftProposalResult {
  sections: DraftProposalSection[];
  outline: Array<{ sectionType: string; emphasis: string; keyAngles: string[] }>;
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string[] };
  _meta: {
    grounded: boolean;
    degraded: boolean;
    source: 'notice_id' | 'text' | 'none';
    section_count: number;
    error_count: number;
  };
}

function trimSection(s: DraftResult): DraftProposalSection {
  return {
    section: s.section,
    title: s.label,
    content: s.draft,
    word_count: s.wordCount,
    target_words: s.targetWords,
    requirements_mapped: s.meta?.evidenceMapped ?? 0,
  };
}

export async function draftProposal(input: DraftProposalInput): Promise<DraftProposalResult> {
  const { text: sourceText, source, fetchDegraded } = await resolveSource(input.rfp_text, input.notice_id);

  // Nothing to draft from — honest miss (or a fetch error). Never fabricate.
  if (!sourceText) {
    const result: DraftProposalResult = {
      sections: [],
      outline: [],
      _meta: { grounded: false, degraded: fetchDegraded, source, section_count: 0, error_count: 0 },
    };
    if (mcpFlags.aiHint) {
      result._ai_hint = {
        summary: fetchDegraded
          ? `Could not fetch documents for notice ${input.notice_id} (source errored) — treat as temporarily unavailable, not as "no draft".`
          : input.notice_id
          ? `Notice ${input.notice_id} has no extractable SOW/attachment text yet — pass the RFP text directly via rfp_text, or try get_solicitation_documents first.`
          : 'Provide rfp_text (the solicitation text) or a notice_id to draft from.',
        how_to_use: 'No draft was produced — do NOT write a proposal from nothing. Get the solicitation text and retry.',
        key_caveats: ['grounded=false means no draft was generated, not that the RFP is empty.'],
      };
    }
    return result;
  }

  const sectionTypes = toSectionTypes(input.sections);

  let sections: DraftProposalSection[] = [];
  let outline: DraftProposalResult['outline'] = [];
  let errorCount = 0;
  let engineDegraded = false;
  try {
    const res = await generateAllSections({
      email: input.userEmail || '',
      sourceText,
      rfpAgency: input.agency,
      ...(sectionTypes ? { sectionTypes } : {}),
    });
    sections = res.sections.map(trimSection);
    outline = res.outline.map((o) => ({ sectionType: o.sectionType, emphasis: o.emphasis, keyAngles: o.keyAngles }));
    errorCount = res.errors.length;
  } catch (err) {
    console.error('[draft-proposal] generateAllSections failed', err);
    engineDegraded = true;
  }

  const grounded = sections.length > 0 && sections.some((s) => (s.content || '').trim().length > 0);
  // degraded = the engine produced NOTHING because it errored (all sections failed
  // or the call threw) — distinct from a partial run with some failures.
  const degraded = engineDegraded || (errorCount > 0 && sections.length === 0);

  const result: DraftProposalResult = {
    sections,
    outline,
    _meta: { grounded, degraded, source, section_count: sections.length, error_count: errorCount },
  };

  if (mcpFlags.aiHint) {
    result._ai_hint = {
      summary: degraded
        ? 'The drafting model was unavailable — treat as temporarily unavailable, not as "no proposal possible". Retry shortly.'
        : !grounded
        ? 'No sections were drafted — the source may be too thin (a synopsis/cover page, not the full solicitation). Supply the full RFP text.'
        : `${sections.length} section(s) drafted (${sections.map((s) => s.title).join(', ')})${errorCount > 0 ? `; ${errorCount} section(s) failed and were dropped` : ''}. Each is vault-grounded where the caller's Vault had matching past performance.`,
      how_to_use:
        'Use the drafted sections as a first-pass response. Every [placeholder] is a fact the drafter did not have — fill it with real data, never an invented value. Pass the sections to export_proposal for a .docx, and to referee_proposal_compliance (with the compliance matrix) before submission.',
      key_caveats: [
        'A DRAFT, not a submission-ready proposal — verify every fact against the RFP and your records; bracketed items are unfilled.',
        'Grounding depends on the caller\'s Vault: with no userEmail (or an empty Vault) the draft leans generic and brackets more.',
        'Do NOT invent facts the draft brackets — a single fabricated number/reference can disqualify the bid.',
      ],
    };
  }
  return result;
}

// =====================================================================
// draft_proposal_section — a single section
// =====================================================================

export interface DraftProposalSectionInput {
  section_type: string;
  rfp_text?: string;
  notice_id?: string;
  agency?: string;
  requirements?: Array<{ requirement: string; category?: string; section?: string; id?: string }>;
  userEmail?: string | null;
}

export interface DraftProposalSectionResult {
  draft?: DraftResult;
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string[] };
  _meta: {
    grounded: boolean;
    degraded: boolean;
    section_type: string;
  };
}

export async function draftProposalSection(input: DraftProposalSectionInput): Promise<DraftProposalSectionResult> {
  const sectionType = (input.section_type || '').trim();
  const validSection = VALID_SECTIONS.has(sectionType);
  const { text: sourceText, fetchDegraded } = await resolveSource(input.rfp_text, input.notice_id);

  // Honest miss — need a valid section type AND source text. Never fabricate.
  if (!validSection || !sourceText) {
    const result: DraftProposalSectionResult = {
      _meta: { grounded: false, degraded: fetchDegraded, section_type: sectionType },
    };
    if (mcpFlags.aiHint) {
      result._ai_hint = {
        summary: !validSection
          ? `"${sectionType || '(none)'}" is not a valid section_type. Use one of: ${[...VALID_SECTIONS].join(', ')}.`
          : fetchDegraded
          ? `Could not fetch documents for notice ${input.notice_id} (source errored) — retry shortly.`
          : 'Provide rfp_text or a notice_id to draft this section from.',
        how_to_use: 'No section was drafted — do NOT write one from nothing. Fix the input and retry.',
        key_caveats: ['grounded=false means no draft was generated.'],
      };
    }
    return result;
  }

  let draft: DraftResult | undefined;
  let degraded = false;
  try {
    draft = await generateV2Draft({
      email: input.userEmail || '',
      sectionType: sectionType as SectionType,
      sourceText,
      rfpAgency: input.agency,
      requirements: toComplianceReqs(input.requirements),
    });
  } catch (err) {
    console.error('[draft-proposal-section] generateV2Draft failed', err);
    degraded = true;
  }

  const grounded = !!draft && (draft.draft || '').trim().length > 0;

  const result: DraftProposalSectionResult = {
    draft,
    _meta: { grounded, degraded, section_type: sectionType },
  };

  if (mcpFlags.aiHint) {
    result._ai_hint = {
      summary: degraded
        ? 'The drafting model was unavailable — treat as temporarily unavailable. Retry shortly.'
        : !grounded
        ? 'The section came back empty — the source may be too thin. Supply the full solicitation text.'
        : `Drafted the ${draft?.label} section (~${draft?.wordCount} words). ${(draft?.meta?.factGuardFlags ?? 0) > 0 ? `${draft?.meta?.factGuardFlags} unverified fact(s) were neutralized to [placeholders].` : 'Vault-grounded where matching past performance existed.'}`,
      how_to_use:
        'A single drafted section. Fill every [placeholder] with real data (never an invented value). Pass requirements[] from extract_compliance_matrix to make the section address its shall-statements one-to-one.',
      key_caveats: [
        'A DRAFT — verify facts; bracketed items are unfilled and must not be fabricated.',
        'Grounding depends on the caller\'s Vault (userEmail); with none the draft leans generic.',
      ],
    };
  }
  return result;
}
