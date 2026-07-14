/**
 * MCP tool: evaluate_bid_decision — GovCon Giants' bid / no-bid framework as a tool.
 * ALWAYS returns the framework (the 5 universal eliminator GATES + the 10-factor
 * scorecard with its positive/neutral/negative rubric) so an agent knows exactly
 * what to assess. When the caller supplies gate answers + factor ratings, it also
 * SCORES the card → blocked / pursue / watch / skip.
 *
 * Wraps the PURE src/lib/proposal/bid-decision.ts (Eric's framework, verbatim from
 * the bid-no-bid PDF). Stateless, no LLM, no I/O. tier: metered, credits: 1.
 * `_meta` always ships; `_ai_hint` OFF by default.
 */
import {
  evaluateBidDecision,
  BID_GATES,
  BID_FACTORS,
  type BidDecisionResult,
} from '@/lib/proposal/bid-decision';
import { mcpFlags } from '@/lib/mcp/flags';

export interface BidDecisionToolInput {
  /** gateId → passed? (from BID_GATES). A false on any gate = automatic No-Bid. */
  gates?: Record<string, boolean>;
  /** factorId → 0-10 (from BID_FACTORS). */
  ratings?: Record<string, number>;
}

export interface BidDecisionToolResult {
  framework: {
    gates: Array<{ id: string; question: string; help: string }>;
    factors: Array<{ id: string; label: string; positive: string; neutral: string; negative: string }>;
    thresholds: { pursue: string; watch: string; skip: string; no_bid: string };
  };
  decision: BidDecisionResult | null; // populated only when gates/ratings supplied
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string[] };
  _meta: {
    grounded: boolean;
    degraded: boolean;
    scored: boolean;
    blocked: boolean;
    recommendation: BidDecisionResult['recommendation'] | null;
  };
}

export function evaluateBidDecisionTool(input: BidDecisionToolInput): BidDecisionToolResult {
  const hasInput =
    (input.gates && Object.keys(input.gates).length > 0) ||
    (input.ratings && Object.keys(input.ratings).length > 0);

  const decision = hasInput
    ? evaluateBidDecision({ gates: input.gates || {}, ratings: input.ratings || {} })
    : null;

  const result: BidDecisionToolResult = {
    framework: {
      gates: BID_GATES.map((g) => ({ id: g.id, question: g.question, help: g.help })),
      factors: BID_FACTORS.map((f) => ({
        id: f.id,
        label: f.label,
        positive: f.positive,
        neutral: f.neutral,
        negative: f.negative,
      })),
      thresholds: {
        pursue: 'score ≥ 70',
        watch: 'score 40–69',
        skip: 'score < 40',
        no_bid: 'any gate failed (automatic, regardless of score)',
      },
    },
    decision,
    _meta: {
      grounded: true, // the framework always returns
      degraded: false,
      scored: decision !== null,
      blocked: decision?.blocked ?? false,
      recommendation: decision?.recommendation ?? null,
    },
  };

  if (mcpFlags.aiHint) {
    result._ai_hint = {
      summary: decision
        ? decision.blocked
          ? `NO-BID — a universal eliminator failed (${decision.failedGates.join(', ')}). No score matters if a gate fails.`
          : `${decision.recommendation.toUpperCase()} — score ${decision.score}/100 across ${decision.rated} rated factor(s). (pursue ≥70 · watch 40–69 · skip <40)`
        : 'Returned the bid/no-bid framework only — no card supplied to score.',
      how_to_use: decision
        ? 'Gates are checked FIRST: a single failed eliminator forces No-Bid regardless of the factor score. Otherwise the recommendation follows the score thresholds.'
        : 'First assess the opportunity against the 5 gates (yes/no) and rate each of the 10 factors 0–10 (use the positive/neutral/negative rubric), then call again with { gates, ratings } to get the scored recommendation.',
      key_caveats: [
        'This scores a bidder\'s SELF-ASSESSMENT — the ratings are judgment calls, not measured facts; garbage in, garbage out.',
        'A gate failure (e.g. ineligible for the set-aside) is an absolute No-Bid — it overrides any high factor score.',
      ],
    };
  }
  return result;
}
