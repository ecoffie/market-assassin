/**
 * MCP tool: search_sbir — SBIR/STTR small-business R&D opportunities.
 *
 * Wraps src/lib/sbir/search.ts (NIH RePORTER live API + the multisite Supabase
 * aggregate; commodity/public, metered). credits: 5. `_meta` always ships;
 * `_ai_hint` OFF by default.
 */
import { searchSbir, type SbirOpportunity } from '@/lib/sbir/search';
import { mcpFlags } from '@/lib/mcp/flags';

export interface SbirToolInput {
  keyword?: string;
  agency?: string;
  phase?: '1' | '2' | 'all';
  /** nih = awarded NIH projects · dod = open DoD SBIR/STTR TOPICS (Army/Navy/AF/…) · multisite · all. */
  source?: 'nih' | 'multisite' | 'dod' | 'all';
  limit?: number;
}

export interface SbirToolResult {
  queried: { keyword?: string; agency?: string; phase: string; source: string };
  opportunities: SbirOpportunity[];
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string[] };
  _meta: { grounded: boolean; degraded: boolean; count: number };
}

export async function sbirSearch(input: SbirToolInput): Promise<SbirToolResult> {
  const phase = input.phase || 'all';
  const source = input.source || 'nih';
  const res = await searchSbir({ keyword: input.keyword, agency: input.agency, phase, source, limit: input.limit });
  const grounded = res.opportunities.length > 0;
  const result: SbirToolResult = {
    queried: {
      ...(input.keyword ? { keyword: input.keyword } : {}),
      ...(input.agency ? { agency: input.agency } : {}),
      phase,
      source,
    },
    opportunities: res.opportunities,
    _meta: { grounded, degraded: res.degraded, count: res.opportunities.length },
  };
  if (mcpFlags.aiHint) {
    const top = res.opportunities[0];
    result._ai_hint = {
      summary: res.degraded
        ? 'An SBIR source (NIH RePORTER or multisite) errored — retry; partial results may be shown.'
        : grounded
        ? `${res.opportunities.length} SBIR/STTR result(s). Top: ${top.title} (${top.agency}${top.phase ? `, ${top.phase}` : ''}).`
        : 'No SBIR/STTR results. Try source="all", a broader keyword, or drop the agency.',
      how_to_use: grounded
        ? 'NIH RePORTER rows are AWARDED projects (who won what — market intel), NOT open solicitations. For OPEN topics to pursue: source="dod" = DoD SBIR/STTR topics (Army/Navy/AF/SOCOM/DTRA, with topic numbers + close dates); source="multisite" = aggregated open notices.'
        : 'No grounded results; say none matched rather than inventing one.',
      key_caveats: [
        'source="nih" returns AWARDED NIH projects, not open opportunities. For open DEFENSE topics use source="dod"; for other open notices use "multisite"/"all".',
        'source="dod" is served from a cache of the official sbir.gov DoD feed (topic numbers + close dates); NIH RePORTER is health-research heavy and thin for defense.',
      ],
    };
  }
  return result;
}
