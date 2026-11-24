/**
 * Intelligence gate, analyst step: turn checked evidence into decisions BEFORE anything is published.
 * Plan: docs/ask-mindy/INTELLIGENCE-GATE-PLAN-2026-11-24.md.
 *
 * The model sees only the records the software checks passed (with their barriers and actions) plus a
 * one-line reason for each excluded record. It returns structured decisions. Software then enforces that
 * every pursuit cites a record that passed (evaluator check 2 cannot be talked around).
 */
import Anthropic from '@anthropic-ai/sdk';
import type { CandidateRecord, RecordCheck } from './evidence-checks';

export const ANALYST_MODEL_DEFAULT = 'claude-opus-5-5';

export interface AnalystInput {
  question: string;
  /** Plain-text company profile, or null when unknown. */
  profile: string | null;
  market: {
    subject: string;
    /** e.g. "$426M nationally, FY2026, awards whose text says 'janitorial services' (not state-scoped)". */
    sizeLine: string | null;
    topAgencies: string[];
    topCompetitors: string[];
    /** e.g. "0 agency forecasts matched; forecast coverage for this market is not established". */
    forecastsLine: string;
    /** What is known about OPEN solicitations. Default: not searched (never imply none exist). */
    openNowLine?: string;
  };
  records: CandidateRecord[];
  checks: RecordCheck[];
}

export interface Pursuit {
  contract_id: string;
  title: string;
  why: string[];
  barrier: string | null;
  next_move: string;
}

export interface AnalystDecision {
  headline: string;
  pursuits: Pursuit[];
  ruled_out: string;
  gaps: string[];
  next_question: string;
}

export const ANALYST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['headline', 'pursuits', 'ruled_out', 'gaps', 'next_question'],
  properties: {
    headline: { type: 'string' },
    pursuits: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['contract_id', 'title', 'why', 'barrier', 'next_move'],
        properties: {
          contract_id: { type: 'string' },
          title: { type: 'string' },
          why: { type: 'array', items: { type: 'string' } },
          barrier: { type: ['string', 'null'] },
          next_move: { type: 'string' },
        },
      },
    },
    ruled_out: { type: 'string' },
    gaps: { type: 'array', items: { type: 'string' } },
    next_question: { type: 'string' },
  },
} as const;

const ANALYST_SYSTEM = `You are Mindy's federal market analyst. A customer asked a question; software has already gathered the evidence and checked every candidate record for relevance and pursuability. Your job is the decision: which of the PASSING records this customer should pursue first, why, what stands in the way, and the next move.

Rules:
- Use only facts in the evidence. Never add an agency, contract, date, dollar amount, person or requirement that is not there. Never say something does not exist (no open bids, no forecasts, no competitors) unless the evidence establishes it; if a source was not searched, say so.
- A pursuit must be one of the PASSING records, cited by its exact contract_id. Rank them: strongest first. Recommend at most 3.
- "why" is 1 to 3 short reasons drawn from the record (location, value, set-aside, how it was competed, timing).
- "barrier" is the biggest obstacle from that record's barriers, in plain words, or null if none.
- "next_move" is one concrete action the customer can take this week. If the record says the capture window has passed, the move is to check SAM.gov for the follow-on solicitation now.
- "ruled_out" says in one or two plain sentences what was excluded and why (wrong state, different work, mandatory nonprofit source), with counts.
- "gaps" lists what the evidence could not establish that would change the decision (for example forecast coverage, the customer's set-aside status). Short phrases.
- "headline" is one sentence a busy owner can act on.
- "next_question" is one plain-English question that would most improve the recommendation.
- Write for a small-business owner, not a contracting officer. No acronyms without saying what they mean. No em dashes.
- If no record passed, say so plainly in the headline, return an empty pursuits list, and explain in gaps what would be needed.`;

function money(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 'value not stated';
  return n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1e3)}K`;
}

export function buildAnalystPrompt(input: AnalystInput): string {
  const byId = new Map(input.records.map((r) => [r.contract_id, r]));
  const passing = input.checks.filter((c) => c.verdict === 'pursue');
  const excluded = input.checks.filter((c) => c.verdict !== 'pursue');
  const line = (r: CandidateRecord & Record<string, unknown>) =>
    [
      r.awarding_sub_agency || 'office not stated',
      String(r.description || '').slice(0, 140),
      `place of performance ${r.place_of_performance_state || 'not stated'}`,
      `obligated ${money(r.total_obligation)}`,
      `current period ends ${r.period_of_performance_current_end || 'not stated'}`,
      `set-aside ${r.set_aside_type || 'not stated'}`,
      `incumbent ${r.incumbent_name || 'not stated'}`,
    ].join(' · ');
  const passingText = passing.length
    ? passing
        .map((c) => {
          const r = byId.get(c.contract_id) as CandidateRecord & Record<string, unknown>;
          return [
            `- contract_id ${c.contract_id}: ${line(r)}`,
            ...c.barriers.map((b) => `    barrier: ${b.detail}`),
            ...c.actions.map((a) => `    action: ${a.detail}`),
          ].join('\n');
        })
        .join('\n')
    : '(none)';
  const excludedText = excluded.length
    ? excluded.map((c) => `- ${c.verdict}: ${c.exclusions.map((e) => e.detail).join(' ')}`).join('\n')
    : '(none)';
  return [
    `CUSTOMER QUESTION: ${input.question}`,
    `COMPANY PROFILE: ${input.profile || 'not provided'}`,
    `MARKET: ${input.market.subject}${input.market.sizeLine ? `; ${input.market.sizeLine}` : ''}`,
    `TOP BUYING AGENCIES: ${input.market.topAgencies.join('; ') || 'none returned'}`,
    `TOP COMPETITORS: ${input.market.topCompetitors.join('; ') || 'none returned'}`,
    `FORECASTS: ${input.market.forecastsLine}`,
    `OPEN SOLICITATIONS: ${input.market.openNowLine || 'NOT searched for this answer. Do not say whether any are open; list checking SAM.gov for open bids as a gap.'}`,
    '',
    `PASSING RECORDS (contracts coming back that this customer could pursue):`,
    passingText,
    '',
    `EXCLUDED RECORDS (do not recommend):`,
    excludedText,
  ].join('\n');
}

/** Software enforcement after the model: a pursuit must cite a record that passed the checks. */
export function enforceDecision(decision: AnalystDecision, checks: RecordCheck[]): { decision: AnalystDecision; dropped: string[] } {
  const passing = new Set(checks.filter((c) => c.verdict === 'pursue').map((c) => c.contract_id));
  const dropped: string[] = [];
  const pursuits = decision.pursuits.filter((p) => {
    if (passing.has(p.contract_id)) return true;
    dropped.push(p.contract_id);
    return false;
  });
  return { decision: { ...decision, pursuits: pursuits.slice(0, 3) }, dropped };
}

export async function runAnalyst(
  input: AnalystInput,
  opts: { client?: Anthropic; model?: string } = {},
): Promise<{ decision: AnalystDecision; dropped: string[]; usage: { input: number; output: number }; model: string }> {
  const client = opts.client ?? new Anthropic();
  const model = opts.model ?? process.env.ASK_MINDY_ANALYST_MODEL ?? ANALYST_MODEL_DEFAULT;
  const msg = await client.messages.create({
    model,
    max_tokens: 8000,
    system: ANALYST_SYSTEM,
    output_config: { effort: 'high', format: { type: 'json_schema', schema: ANALYST_SCHEMA as unknown as Record<string, unknown> } },
    messages: [{ role: 'user', content: buildAnalystPrompt(input) }],
  });
  if (msg.stop_reason === 'refusal' || msg.stop_reason === 'max_tokens') throw new Error(`analyst stopped: ${msg.stop_reason}`);
  const text = msg.content.filter((b) => b.type === 'text').map((b) => (b as Anthropic.TextBlock).text).join('');
  const parsed = JSON.parse(text) as AnalystDecision;
  const { decision, dropped } = enforceDecision(parsed, input.checks);
  return { decision, dropped, usage: { input: msg.usage.input_tokens, output: msg.usage.output_tokens }, model };
}
