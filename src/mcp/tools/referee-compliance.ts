/**
 * MCP tool: referee_proposal_compliance — the CLOSING link in the proposal chain:
 *   extract_compliance_matrix → build_proposal_structure → (agent drafts) → referee.
 *
 * An INDEPENDENT model (Claude, no-training) reads the compliance matrix + the agent's
 * assembled draft and judges each requirement met / partial / missing, with a one-line
 * evidence note and an overall compliance score. Independence is the whole point — the
 * model that wrote the draft thinks it's done; a fresh referee catches the unmet "shall"
 * items before submission.
 *
 * Wraps the shared src/lib/proposal/referee.ts engine (batched, sensitive/no-training).
 * tier: metered, credits: 4 (Claude referee — pricier than the Groq extraction tools).
 * `_meta` always ships; `_ai_hint` OFF by default.
 */
import { refereeProposal, type RefereeRequirement, type RefereeVerdict, type RefereeSummary } from '@/lib/proposal/referee';
import { mcpFlags } from '@/lib/mcp/flags';

/** One requirement as the agent supplies it — pass the requirements[] from
 *  extract_compliance_matrix (only `requirement` is required). */
export interface RefereeInputReq {
  id?: string;
  requirement?: string;
  category?: string;
  section?: string;
}

export interface RefereeComplianceInput {
  requirements?: RefereeInputReq[];
  draft?: string;
  /** LLM cost attribution (the MCP caller's verified email). */
  userEmail?: string | null;
}

export interface RefereeComplianceResult {
  verdicts: RefereeVerdict[];
  summary: RefereeSummary;
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string[] };
  _meta: {
    grounded: boolean;
    degraded: boolean;
    total: number;
    met: number;
    partial: number;
    missing: number;
    score: number;
  };
}

const EMPTY_SUMMARY: RefereeSummary = { total: 0, met: 0, partial: 0, missing: 0, score: 0 };

export async function refereeProposalCompliance(input: RefereeComplianceInput): Promise<RefereeComplianceResult> {
  // Coerce agent-supplied rows into RefereeRequirement: keep only rows with real
  // requirement text (the filter alone doesn't narrow the optional field for TS).
  const requirements: RefereeRequirement[] = (input.requirements || [])
    .filter((r) => typeof r?.requirement === 'string' && r.requirement.trim().length > 0)
    .map((r) => ({ id: r.id, requirement: r.requirement!.trim(), category: r.category, section: r.section }));
  const draft = (input.draft || '').trim();

  // Honest miss — need BOTH a matrix and a draft. Never fabricate verdicts.
  if (requirements.length === 0 || !draft) {
    const missingWhat = requirements.length === 0 && !draft ? 'both a requirements matrix and a draft' : requirements.length === 0 ? 'a requirements matrix' : 'a draft';
    const result: RefereeComplianceResult = {
      verdicts: [],
      summary: EMPTY_SUMMARY,
      _meta: { grounded: false, degraded: false, total: 0, met: 0, partial: 0, missing: 0, score: 0 },
    };
    if (mcpFlags.aiHint) {
      result._ai_hint = {
        summary: `Nothing to referee — you must supply ${missingWhat}.`,
        how_to_use:
          'Run extract_compliance_matrix to get the requirements[], assemble your proposal draft, then pass BOTH here. Do NOT invent verdicts.',
        key_caveats: ['grounded=false means the referee did not run — not that the draft is compliant.'],
      };
    }
    return result;
  }

  const r = await refereeProposal(requirements, draft, { userEmail: input.userEmail ?? null });
  const grounded = r.ok && r.verdicts.length > 0;

  const result: RefereeComplianceResult = {
    verdicts: r.verdicts,
    summary: r.summary,
    _meta: {
      grounded,
      degraded: !r.ok, // every batch failed → referee model down, distinct from "all missing"
      total: r.summary.total,
      met: r.summary.met,
      partial: r.summary.partial,
      missing: r.summary.missing,
      score: r.summary.score,
    },
  };

  if (mcpFlags.aiHint) {
    result._ai_hint = {
      summary: !r.ok
        ? 'The independent referee model was unavailable on every batch — treat as temporarily unavailable, not as "all requirements missing". Retry shortly.'
        : `Refereed ${r.summary.total} requirement(s): ${r.summary.met} met, ${r.summary.partial} partial, ${r.summary.missing} missing (compliance score ${r.summary.score}%). ${r.summary.missing + r.summary.partial > 0 ? `Fix the ${r.summary.missing} missing + ${r.summary.partial} partial item(s) before submission.` : 'All requirements addressed.'}`,
      how_to_use:
        'Each verdict is one requirement judged against the draft: "missing" = not addressed at all (fix first), "partial" = touched but vague/incomplete, "met" = clearly satisfied. The `evidence` note says where it is addressed or what is absent. Address every missing/partial item, then re-referee.',
      key_caveats: [
        'This is an INDEPENDENT strict review — it judges only what the draft text actually says, not what you intended. Every verdict traces to the draft you supplied.',
        'The draft is read up to the first 24,000 characters; for a very long proposal, referee each volume separately for full coverage.',
        'A high score is necessary but not sufficient — it confirms the requirements are addressed, not that the win themes/pricing are competitive.',
      ],
    };
  }
  return result;
}
