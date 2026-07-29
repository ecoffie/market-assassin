/**
 * MCP tool: one_click_proposal — solicitation in, submittable .docx out.
 *
 * Combination tool (highest-ticket). Runs the ENTIRE proposal pipeline in one call:
 *   extract_compliance_matrix → build_proposal_structure → draft_proposal →
 *   referee_proposal_compliance → export_proposal.
 * Hands back the compliance matrix, the volume/section outline, the full multi-section
 * draft, an INDEPENDENT compliance score (met/partial/missing), and the assembled Word
 * (.docx) as base64. Replaces the $3,500–7,500 proposal effort.
 *
 * No new engine — orchestrates the existing proposal tools, each GUARDED (a failed
 * stage degrades, never fabricates; the caller paid — never lose the earlier stages).
 * `_meta` always ships. draft_proposal + referee are real LLM work, so this is the
 * heaviest tool in the catalog and priced accordingly. grounded=false when there is
 * no RFP to work from.
 */
import { extractComplianceMatrix } from '@/mcp/tools/compliance-matrix';
import { buildProposalStructureTool } from '@/mcp/tools/proposal-structure';
import { draftProposal } from '@/mcp/tools/draft-proposal';
import { refereeProposalCompliance } from '@/mcp/tools/referee-compliance';
import { exportProposal } from '@/mcp/tools/export-proposal';

export interface OneClickProposalInput {
  /** SAM notice UUID / solicitation number — the RFP to respond to. */
  notice_id?: string;
  /** Or paste the RFP text directly. */
  rfp_text?: string;
  /** Agency name (helps the draft's tone/positioning). */
  agency?: string;
  /** Title for the exported .docx. */
  title?: string;
  /** The verified MCP caller (ctx.userEmail) — never from args. */
  userEmail?: string | null;
}

export interface OneClickProposalResult {
  compliance_matrix: { requirements: unknown[]; count: number } | null;
  structure: unknown | null;
  draft: { sections: unknown[]; outline: unknown[] } | null;
  compliance_score: unknown | null;
  deliverable: { filename: string; mime: string; docx_base64: string; byte_size: number } | null;
  _meta: {
    grounded: boolean;
    degraded: boolean;
    /** True when the run stopped after the draft to stay in the gateway window (FM-P03). */
    partial?: boolean;
    stages: {
      matrix_requirements: number;
      structure: boolean;
      draft_sections: number;
      referee_score: number | null;
      docx_bytes: number;
    };
    elapsed_ms: number;
    note?: string;
  };
}

async function guarded<T>(p: Promise<T>): Promise<{ value: T | null; degraded: boolean }> {
  try {
    return { value: await p, degraded: false };
  } catch (err) {
    console.error('[one_click_proposal] stage failed:', err);
    return { value: null, degraded: true };
  }
}

function miss(note: string, started: number): OneClickProposalResult {
  return {
    compliance_matrix: null, structure: null, draft: null, compliance_score: null, deliverable: null,
    _meta: {
      grounded: false, degraded: false,
      stages: { matrix_requirements: 0, structure: false, draft_sections: 0, referee_score: null, docx_bytes: 0 },
      elapsed_ms: Date.now() - started, note,
    },
  };
}

export async function oneClickProposal(input: OneClickProposalInput): Promise<OneClickProposalResult> {
  const started = Date.now();
  if (!input.notice_id && !input.rfp_text) {
    return miss('Provide a notice_id (SAM solicitation) or rfp_text to respond to.', started);
  }

  // 1) Compliance matrix — every shall/must requirement.
  const matrix = await guarded(
    extractComplianceMatrix({ notice_id: input.notice_id, rfp_text: input.rfp_text, userEmail: input.userEmail }),
  );
  const requirements = matrix.value?.requirements ?? [];

  // 2) Structure (outline) — deterministic, from the matrix. Sync fn, so guard inline.
  let structure: unknown | null = null;
  try {
    if (requirements.length) structure = buildProposalStructureTool({ requirements });
  } catch (err) {
    console.error('[one_click_proposal] structure stage failed:', err);
  }

  // 3) Draft — the full multi-section draft from the RFP (heavy LLM, two-pass).
  const draft = await guarded(
    draftProposal({ notice_id: input.notice_id, rfp_text: input.rfp_text, agency: input.agency, userEmail: input.userEmail }),
  );
  const sections = draft.value?.sections ?? [];
  const exportSections = sections.map((s) => ({ heading: s.title || s.section, text: s.content }));
  const draftText = sections.map((s) => `${s.title || s.section}\n\n${s.content}`).join('\n\n');

  // TIME-BUDGET GUARD (FM-P03, Eric/QA v5 2026-07-28). This chains 5 sequential passes; on a real
  // multi-shall RFP the whole chain can exceed the MCP gateway window → a hard connector timeout that
  // loses EVERYTHING the caller paid for. The heavy work (matrix + draft) is done by here, so if we're
  // already near the budget we STOP: return the completed stages + tell the caller to run
  // referee_proposal_compliance and export_proposal on the returned draft as two quick follow-ups.
  // This turns a total-loss timeout into a graceful partial that keeps the expensive output.
  const BUDGET_MS = Number.parseInt(process.env.ONE_CLICK_BUDGET_MS || '', 10) || 90_000;
  const overBudget = draftText !== '' && (Date.now() - started) > BUDGET_MS;

  // 4) Referee — INDEPENDENT compliance score of the draft vs the matrix. Skipped if over budget.
  const referee =
    !overBudget && requirements.length && draftText
      ? await guarded(refereeProposalCompliance({ requirements, draft: draftText, userEmail: input.userEmail }))
      : { value: null, degraded: false as boolean };

  // 5) Export — assemble the drafted sections into a submittable .docx. Skipped if over budget.
  const exported =
    !overBudget && exportSections.length
      ? await guarded(exportProposal({ title: input.title || `Proposal — ${input.notice_id || 'draft'}`, sections: exportSections }))
      : { value: null, degraded: false as boolean };

  const degraded = [matrix, draft, referee, exported].some((s) => s.degraded);

  return {
    compliance_matrix: matrix.value ? { requirements, count: requirements.length } : null,
    structure,
    draft: draft.value ? { sections, outline: draft.value.outline } : null,
    compliance_score: referee.value ? referee.value.summary : null,
    deliverable: exported.value
      ? {
          filename: exported.value.filename,
          mime: exported.value.mime,
          docx_base64: exported.value.docx_base64,
          byte_size: exported.value.byte_size,
        }
      : null,
    _meta: {
      grounded: !!draft.value && sections.length > 0,
      degraded,
      // FM-P03: true when we stopped after the draft to stay inside the gateway window. The draft is
      // returned; the caller finishes with two quick follow-ups instead of losing the whole run.
      partial: overBudget,
      stages: {
        matrix_requirements: requirements.length,
        structure: !!structure,
        draft_sections: sections.length,
        referee_score: (referee.value?.summary as { score?: number } | undefined)?.score ?? null,
        docx_bytes: exported.value?.byte_size ?? 0,
      },
      elapsed_ms: Date.now() - started,
      ...(overBudget
        ? { note: 'Returned matrix + structure + draft only, to stay within the response window on a large RFP. Finish with export_proposal (pass the returned draft sections) and referee_proposal_compliance (draft + requirements) as two quick follow-up calls.' }
        : {}),
    },
  };
}
