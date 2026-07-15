/**
 * MCP tool: match_recompete_sow — given an EXPIRING contract's scope, find the open
 * solicitation that is likely its recompete, by semantic SOW similarity over Mindy's
 * embedded `sam_opportunities` corpus. The recompete chain's payoff step:
 *   get_expiring_contracts → (an expiring contract) → match_recompete_sow → the open opp.
 * Pairs with find_predecessor_award (who holds it now) → who's-recompeting-what.
 *
 * Confidence is honest: the top score AND its gap to the runner-up must clear thresholds,
 * so a field of equally-plausible matches returns "no confident match" (with the ranked
 * candidates to review) rather than a false-precision single answer.
 *
 * Wraps the shared src/lib/market/recompete-match.ts engine (embed + vector scan).
 * tier: metered, credits: 2. `_meta` always ships; `_ai_hint` OFF by default.
 */
import { matchRecompeteSow, type RecompeteMatchRow } from '@/lib/market/recompete-match';
import { mcpFlags } from '@/lib/mcp/flags';

export interface RecompeteSowInput {
  /** The expiring contract's title / scope / SOW text — what to match against the corpus. */
  description?: string;
  /** Optional NAICS to scope the candidate set (falls back to a 2-digit widen if thin). */
  naics?: string;
  /** Optional agency/department to scope candidates (matched against `department`). */
  agency?: string;
  /** Optional PIID of the expiring contract — passed through to telemetry only. */
  piid?: string;
}

export interface RecompeteSowResult {
  verdict: 'confident_match' | 'no_confident_match';
  confident: boolean;
  /** The single confident match, or null when none clears the confidence bar. */
  match: RecompeteMatchRow | null;
  /** A single below-bar candidate worth a look (only when it clears the "possible" floor). */
  possible: RecompeteMatchRow | null;
  /** The ranked top candidates (up to 3), each labeled by confidence tier. */
  matches: RecompeteMatchRow[];
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string[] };
  _meta: {
    grounded: boolean;
    degraded: boolean;
    verdict: 'confident_match' | 'no_confident_match';
    confident: boolean;
    candidate_count: number;
    top_score: number;
    score_gap: number;
    returned: number;
  };
}

export async function matchRecompeteSowTool(input: RecompeteSowInput): Promise<RecompeteSowResult> {
  const description = (input.description || '').trim();

  // Honest miss — nothing to match against.
  if (!description) {
    const result: RecompeteSowResult = {
      verdict: 'no_confident_match',
      confident: false,
      match: null,
      possible: null,
      matches: [],
      _meta: { grounded: false, degraded: false, verdict: 'no_confident_match', confident: false, candidate_count: 0, top_score: 0, score_gap: 0, returned: 0 },
    };
    if (mcpFlags.aiHint) {
      result._ai_hint = {
        summary: 'No expiring-contract scope was supplied — pass the contract title / SOW text as `description`.',
        how_to_use: 'Get an expiring contract (e.g. via get_expiring_contracts), then pass its title/scope as `description` (+ naics/agency to scope). Do NOT invent a recompete.',
        key_caveats: ['grounded=false means no match was attempted — not that no recompete exists.'],
      };
    }
    return result;
  }

  const r = await matchRecompeteSow({ description, naics: input.naics, agency: input.agency, piid: input.piid });
  const confident = r.verdict === 'confident_match';
  // Grounded = we surfaced at least one ranked candidate (the verdict says if it's confident).
  const grounded = r.ok && (confident || r.top.length > 0);

  const result: RecompeteSowResult = {
    verdict: r.verdict,
    confident,
    match: r.match,
    possible: r.possible,
    matches: r.top,
    _meta: {
      grounded,
      degraded: !r.ok, // infra failure (query/embed down), distinct from an honest no-match
      verdict: r.verdict,
      confident,
      candidate_count: r.telemetry.candidate_count,
      top_score: r.telemetry.top_score,
      score_gap: r.telemetry.score_gap,
      returned: r.top.length,
    },
  };

  if (mcpFlags.aiHint) {
    const top = r.top[0];
    result._ai_hint = {
      summary: !r.ok
        ? 'The corpus match could not run (query/embedding error) — treat as temporarily unavailable, retry shortly.'
        : confident
        ? `Confident recompete match: "${top?.title}" (${top?.department || 'agency n/a'}) at ${top?.scorePct}% SOW similarity, a clear gap over the runner-up.`
        : r.top.length > 0
        ? `No CONFIDENT match — the top candidate ("${top?.title}", ${top?.scorePct}%) is either below the similarity bar or too close to the runner-up. ${r.top.length} candidate(s) returned to review, not confirm.`
        : 'No SOW-bearing candidates found in the corpus for this agency + NAICS scope — no recompete match.',
      how_to_use:
        'When confident=true, `match` is the likely open recompete — open its `samUrl` to verify against the incumbent scope. When confident=false, treat `matches` as leads to review (labeled "possible"), NOT answers. Widen by dropping/relaxing the naics or agency filter if the candidate_count is low.',
      key_caveats: [
        'Similarity ≠ confirmation: a high score means the SOWs read alike, not that it is legally the same requirement. Always verify via the SAM link before relying on it.',
        'Only opportunities with an extracted SOW document are in scope (has_sow_doc); a recompete posted without an attached SOW will not appear here.',
        'Confidence needs BOTH a high top score AND a gap over the runner-up — a cluster of similar SOWs honestly returns no_confident_match rather than guessing.',
      ],
    };
  }
  return result;
}
