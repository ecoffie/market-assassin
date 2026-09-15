/**
 * MCP tool: match_company_to_pathways — PATHWAY FIT journey slot.
 * Credits: 8. Deterministic two-sided matcher; no Talent; no LLM ranking.
 */
import {
  matchCompanyToPathways,
  type MatchCompanyToPathwaysInput,
  type MatchCompanyToPathwaysResult,
} from '@/lib/pathways';

export type { MatchCompanyToPathwaysInput, MatchCompanyToPathwaysResult };

export async function matchCompanyToPathwaysTool(
  input: MatchCompanyToPathwaysInput & { actor?: string },
): Promise<MatchCompanyToPathwaysResult> {
  return matchCompanyToPathways(input);
}
