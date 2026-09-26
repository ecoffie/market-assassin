/**
 * MCP tool: search_sbir — SBIR/STTR open topics AND award history, in SEPARATE lists.
 *
 * Wraps src/lib/sbir/search.ts. credits: 5. `_meta` always ships; `_ai_hint` OFF by default.
 *
 * ⚠️ The open-vs-awarded distinction ships IN BAND (`open_topics` vs `award_history`, `coverage`,
 * per-row `record_kind`). It used to live only in `_ai_hint`, which is off by default, so hosts
 * presented funded NIH projects as "open SBIR opportunities" (Reed Analytics, 2026-09). Nothing
 * that decides whether a row is biddable may depend on an optional narration layer.
 */
import { searchSbir, type SbirOpportunity, type SbirSource, type SbirSourceReport } from '@/lib/sbir/search';
import { mcpFlags } from '@/lib/mcp/flags';

export interface SbirToolInput {
  keyword?: string;
  agency?: string;
  phase?: '1' | '2' | 'all';
  /** dod = open DoD SBIR/STTR topics · nih = awarded NIH projects · multisite · all (default). */
  source?: SbirSource;
  limit?: number;
}

export interface SbirToolResult {
  queried: { keyword?: string; agency?: string; phase: string; source: string };
  /** Topics a firm can still propose to (close date today or later). Never contains an award. */
  open_topics: SbirOpportunity[];
  /** Projects already FUNDED — competitive intel on who won what. Not biddable. */
  award_history: SbirOpportunity[];
  /** Back-compat alias of `open_topics`. It no longer carries award history. */
  opportunities: SbirOpportunity[];
  sources: SbirSourceReport[];
  coverage: { open_topics_established: boolean; statement: string };
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string[] };
  _meta: {
    grounded: boolean;
    degraded: boolean;
    partial: boolean;
    count: number;
    open_topic_count: number;
    award_history_count: number;
    open_topics_established: boolean;
  };
}

function coverageStatement(openCount: number, established: boolean, sources: SbirSourceReport[]): string {
  const down = sources.filter((s) => s.status === 'error' || s.status === 'timeout' || s.status === 'unavailable');
  const downNote = down.length ? ` Unanswered: ${down.map((s) => `${s.source} (${s.status}${s.detail ? `: ${s.detail}` : ''})`).join('; ')}.` : '';
  if (openCount > 0) return `${openCount} open SBIR/STTR topic(s) with a deadline today or later.${downNote}`;
  if (established) return `No open SBIR/STTR topic matched this search in the sources that answered.${downNote}`;
  return (
    'Open SBIR/STTR topics could NOT be established by this search — do not report that none exist. ' +
    'award_history lists funded projects only; none of them can be proposed to.' + downNote
  );
}

export async function sbirSearch(input: SbirToolInput): Promise<SbirToolResult> {
  const phase = input.phase || 'all';
  const source = input.source || 'all';
  const res = await searchSbir({ keyword: input.keyword, agency: input.agency, phase, source, limit: input.limit });
  const openCount = res.open_topics.length;
  const awardCount = res.award_history.length;
  const grounded = openCount + awardCount > 0;

  const result: SbirToolResult = {
    queried: {
      ...(input.keyword ? { keyword: input.keyword } : {}),
      ...(input.agency ? { agency: input.agency } : {}),
      phase,
      source,
    },
    open_topics: res.open_topics,
    award_history: res.award_history,
    opportunities: res.open_topics,
    sources: res.sources,
    coverage: {
      open_topics_established: res.open_topics_established,
      statement: coverageStatement(openCount, res.open_topics_established, res.sources),
    },
    _meta: {
      grounded,
      degraded: res.degraded,
      partial: res.partial,
      count: openCount + awardCount,
      open_topic_count: openCount,
      award_history_count: awardCount,
      open_topics_established: res.open_topics_established,
    },
  };

  if (mcpFlags.aiHint) {
    result._ai_hint = {
      summary: result.coverage.statement,
      how_to_use:
        'Present open_topics as things to propose to (cite close_date). Present award_history ONLY as ' +
        'who-won-what intel, labeled as awarded — never as open, never with a deadline. Prefer rows with ' +
        'relevance="title"; "upstream_only" means the source matched text we cannot see.',
      key_caveats: [
        'NIH RePORTER (and the multisite rows it feeds) is funded biomedical projects, not solicitations.',
        'A source with status error/timeout/unavailable means UNKNOWN for that source, not zero.',
      ],
    };
  }
  return result;
}
