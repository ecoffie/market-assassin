/**
 * MCP tool: scan_proposal_compliance — pre-submit disqualification check. Given the
 * RFP's requirements + a proposal draft, flag what could get the bid THROWN OUT:
 * missed deadline, ineligible set-aside, page-limit overage, missing reps/certs or
 * required plans, unaddressed evaluation factors, un-acknowledged amendments.
 *
 * Wraps the PURE, deterministic src/lib/proposal/compliance-scanner.ts (no LLM, no
 * I/O — the checks encode the real DQ patterns, e.g. the #1 DQ: a late submission).
 * Stateless: runs entirely on inputs the caller passes. tier: metered, credits: 1.
 * `_meta` always ships; `_ai_hint` OFF by default.
 */
import { scanCompliance, type ScanFinding } from '@/lib/proposal/compliance-scanner';
import type { ComplianceReq, ReqCategory } from '@/lib/proposal/section-alignment';
import { mcpFlags } from '@/lib/mcp/flags';

export interface ScanComplianceToolInput {
  /** Requirements harvested from the RFP (e.g. from extract_compliance_matrix, or the caller's own read). */
  requirements: Array<{ id?: string; requirement: string; category?: string; section?: string }>;
  /** The full proposal / response text (all sections concatenated). */
  draft_text: string;
  /** Optional per-section drafts for finer page/coverage checks. */
  sections?: Array<{ label: string; text: string }>;
  /** Set-asides the bidder actually holds (for eligibility checks). */
  bidder_set_asides?: string[];
}

export interface ScanComplianceToolResult {
  findings: ScanFinding[];
  counts: { dq: number; warning: number; info: number };
  at_risk: boolean;
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string[] };
  _meta: {
    grounded: boolean;
    degraded: boolean;
    at_risk: boolean;
    dq_count: number;
    warning_count: number;
    finding_count: number;
  };
}

export function scanProposalCompliance(input: ScanComplianceToolInput): ScanComplianceToolResult {
  const requirements: ComplianceReq[] = (input.requirements || [])
    .filter((r) => r && typeof r.requirement === 'string' && r.requirement.trim())
    .map((r) => ({
      id: r.id,
      requirement: r.requirement,
      // scanCompliance re-normalizes the category internally, so any free-text is safe.
      category: (r.category || 'other') as ReqCategory,
      section: r.section,
    }));
  const draftText = typeof input.draft_text === 'string' ? input.draft_text : '';

  const grounded = requirements.length > 0 && draftText.trim().length > 0;

  const res = scanCompliance({
    requirements,
    draftText,
    sections: input.sections,
    bidderSetAsides: input.bidder_set_asides,
  });

  const result: ScanComplianceToolResult = {
    findings: res.findings,
    counts: res.counts,
    at_risk: res.atRisk,
    _meta: {
      grounded,
      degraded: false,
      at_risk: res.atRisk,
      dq_count: res.counts.dq,
      warning_count: res.counts.warning,
      finding_count: res.findings.length,
    },
  };

  if (mcpFlags.aiHint) {
    const dq = res.findings.find((f) => f.severity === 'dq');
    result._ai_hint = {
      summary: !grounded
        ? 'Provide both a non-empty requirements list AND draft_text — with neither, no compliance scan can run.'
        : res.atRisk
        ? `AT RISK — ${res.counts.dq} disqualifying issue(s) + ${res.counts.warning} warning(s). Fix the DQs before submitting${dq ? `: e.g. "${dq.title}".` : '.'}`
        : res.findings.length > 0
        ? `No disqualifiers, but ${res.counts.warning} warning(s) + ${res.counts.info} note(s) to tighten.`
        : 'No compliance issues detected against the supplied requirements.',
      how_to_use: grounded
        ? 'Treat severity="dq" findings as submit-blockers (a late/non-responsive proposal is rejected unread). "warning" = fix before submit; "info" = polish. Each finding cites the rule + the requirement it traces to.'
        : 'Not enough input to scan; ask the user for the RFP requirements and their draft.',
      key_caveats: [
        'Only as complete as the requirements passed in — a missed requirement can\'t be checked. Pair with extract_compliance_matrix for full coverage.',
        'Deterministic pattern checks (deadline, page limits, set-aside, reps/certs) — NOT a substitute for a human compliance review of substance.',
      ],
    };
  }
  return result;
}
