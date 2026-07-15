/**
 * MCP tool: build_proposal_structure — turn a compliance matrix into the volume →
 * section → subsection tree a federal proposal must follow. The next link after
 * extract_compliance_matrix in the proposal chain:
 *   extract_compliance_matrix → (requirements[]) → build_proposal_structure → outline.
 *
 * Pure shaping — no LLM, no IO (wraps src/lib/proposal/proposal-structure.ts). Runs on
 * the requirements the agent passes (the matrix), so it's stateless and cheap.
 * tier: metered, credits: 1. `_meta` always ships; `_ai_hint` OFF by default.
 */
import { buildProposalStructure, type ProposalStructure } from '@/lib/proposal/proposal-structure';
import { normalizeCategory, type ComplianceReq } from '@/lib/proposal/section-alignment';
import { mcpFlags } from '@/lib/mcp/flags';

/** One requirement as the agent supplies it — only `requirement` is required; the
 *  rest are best-effort (category is coerced to the 7-way enum). */
export interface ProposalStructureInputReq {
  requirement?: string;
  category?: string;
  section?: string;
  id?: string;
}

export interface ProposalStructureInput {
  requirements?: ProposalStructureInputReq[];
}

export interface ProposalStructureResult extends ProposalStructure {
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string[] };
  _meta: {
    grounded: boolean;
    degraded: boolean;
    input_requirements: number;
    volumes: number;
    sections: number;
    critical: number;
    cross_cutting: number;
  };
}

export function buildProposalStructureTool(input: ProposalStructureInput): ProposalStructureResult {
  // Coerce the agent-supplied rows into valid ComplianceReq: drop rows with no
  // requirement text, normalize each category to the 7-way enum (an agent may pass a
  // hand-built matrix or free-form categories), keep id/section as-is.
  const reqs: ComplianceReq[] = (input.requirements || [])
    .filter((r) => typeof r?.requirement === 'string' && r.requirement.trim().length > 0)
    .map((r) => ({
      id: typeof r.id === 'string' ? r.id : undefined,
      requirement: r.requirement!.trim(),
      category: normalizeCategory(r.category, r.requirement),
      section: typeof r.section === 'string' ? r.section : undefined,
    }));

  const structure = buildProposalStructure(reqs);
  const sections = structure.volumes.reduce((n, v) => n + v.sections.length, 0);
  const grounded = reqs.length > 0 && structure.volumes.length > 0;

  const result: ProposalStructureResult = {
    ...structure,
    _meta: {
      grounded,
      degraded: false, // pure shaping — never a provider failure
      input_requirements: reqs.length,
      volumes: structure.volumes.length,
      sections,
      critical: structure.critical.length,
      cross_cutting: structure.crossCutting.length,
    },
  };

  if (mcpFlags.aiHint) {
    result._ai_hint = {
      summary: !grounded
        ? 'No requirements were supplied, so no outline could be built. Run extract_compliance_matrix first and pass its requirements here.'
        : `Built a ${structure.volumes.length}-volume outline (${sections} sections) from ${reqs.length} requirements. ${structure.critical.length} critical item(s) surfaced up front; ${structure.crossCutting.length} cross-cutting (format/admin/eval) rule(s) apply across all volumes.`,
      how_to_use:
        'This is the proposal skeleton: draft one response per section, satisfying the requirements listed under it. `critical` = deadlines / mandatory plans & certs — handle these first. `crossCutting` = formatting/submission rules that apply to every volume. A volume/section marked optional=true has no requirements yet (present for completeness).',
      key_caveats: [
        'Pure shaping of the requirements you pass — it neither invents requirements nor drafts content; every requirement traces to the matrix you supplied.',
        'Feed it the output of extract_compliance_matrix for best results; a thin/partial matrix yields a thin outline.',
        'The actual section drafting (evidence-weave from a company’s past performance) stays inside Mindy’s app — this returns the structure + the requirements to satisfy, not the prose.',
      ],
    };
  }
  return result;
}
