/**
 * Intelligence gate, independent evaluator (checks 3 to 5) plus the software checks that make the gate
 * hard to pass with polish. Plan: docs/ask-mindy/INTELLIGENCE-GATE-PLAN-2026-11-24.md.
 *
 * Independence: a different model from the analyst, a fixed rubric, and it sees the evidence and the
 * decision only (never the analyst's instructions). It grades; it does not rewrite.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { AnalystDecision } from './analyst';
import type { RecordCheck } from './evidence-checks';
import { ungroundedFigures } from './figure-grounding';

export const EVALUATOR_MODEL_DEFAULT = 'claude-sonnet-5-5';
/** Per-call ceiling when the caller gives none; the gate always passes the time it has left. */
const DEFAULT_CALL_TIMEOUT_MS = 60_000;

export type Criterion = 'relevant' | 'pursuable' | 'reasoned' | 'actionable' | 'clear';

/** Criteria that block a complete answer and the shareable report. 'clear' is advisory (recorded, not blocking). */
export const BLOCKING: ReadonlySet<Criterion> = new Set<Criterion>(['relevant', 'pursuable', 'reasoned', 'actionable']);

export interface CriterionResult {
  criterion: Criterion;
  pass: boolean;
  reason: string;
}

export interface Evaluation {
  pass: boolean;
  results: CriterionResult[];
  /** What to fix, for the one bounded retry. Empty on pass. */
  fix: string[];
}

/**
 * Checks 1 and 2 in software: every pursuit cites a record that passed; "none found" is only honest when none passed.
 * `dropped`: pursuits software already removed (enforceDecision). The headline was written for the full list, so it
 * can name a contract that is no longer there: that fails relevance until the answer is rewritten.
 */
export function softwareChecks(decision: AnalystDecision, checks: RecordCheck[], dropped: string[] = []): CriterionResult[] {
  const passing = new Set(checks.filter((c) => c.verdict === 'pursue').map((c) => c.contract_id));
  const cited = decision.pursuits.map((p) => p.contract_id);
  const allPassing = cited.every((id) => passing.has(id));
  const relevant: CriterionResult = passing.size === 0
    ? { criterion: 'relevant', pass: decision.pursuits.length === 0, reason: decision.pursuits.length === 0 ? 'No record passed and none is recommended.' : 'Recommends records although none passed the checks.' }
    : decision.pursuits.length === 0
      ? { criterion: 'relevant', pass: false, reason: `${passing.size} record(s) passed the checks but none is recommended.` }
      : { criterion: 'relevant', pass: allPassing, reason: allPassing ? 'Every pursuit is a record that passed the relevance checks.' : 'A pursuit cites a record that did not pass.' };
  const relevantChecked: CriterionResult = dropped.length && relevant.pass
    ? { criterion: 'relevant', pass: false, reason: `${dropped.length} recommended contract(s) could not be verified and were removed, so the summary may not match the list.` }
    : relevant;
  const pursuable: CriterionResult = {
    criterion: 'pursuable',
    pass: allPassing && decision.pursuits.every((p) => !!p.next_move?.trim()),
    reason: allPassing ? 'Every pursuit passed the pursuability checks and has a move.' : 'A pursuit failed the pursuability checks.',
  };
  return [relevantChecked, pursuable];
}

const RUBRIC = `You are an independent reviewer for Mindy, a federal contracting intelligence product. You grade an answer written for a small-business owner. You do not rewrite it.

Grade three criteria against the EVIDENCE. Each is pass or fail with one sentence of reason.

reasoned: The answer says WHY each recommended pursuit is a good choice for THIS customer, using facts from the evidence (location, value, set-aside, how it was competed, timing), and ranks them. FAIL if it only lists records or metrics, gives generic advice ("consider reviewing opportunities"), states a fact not in the evidence, claims something does not exist ("no open solicitations", "no forecasts") when the evidence says that source was not searched or not established, or ranks without saying why.

actionable: Each pursuit ends in one concrete move the owner can make this week (what to check or do, where). FAIL for vague moves ("monitor the market", "consider bidding", "ask me to list them") or when the answer reports counts and tells the customer to ask for the list.

clear: Judge the LEAD (headline and pursuits): an owner with no federal background can act on it without reading tables. It leads with the decision, explains any acronym or federal term it uses, and keeps technical figures out of the way. FAIL if the lead opens with market size, codes or methodology, or needs interpretation. The supporting sections (also_consider, ruled_out, gaps) may be denser; fail them only if they contradict the lead. When you cite a confusing word, quote it exactly as it appears in the ANSWER (not the evidence).

An answer that honestly says no record is pursuable can pass if it explains why and what would change that. Polished writing does not pass a criterion on its own.`;

const EVAL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reasoned', 'actionable', 'clear', 'fix'],
  properties: {
    reasoned: { type: 'object', additionalProperties: false, required: ['pass', 'reason'], properties: { pass: { type: 'boolean' }, reason: { type: 'string' } } },
    actionable: { type: 'object', additionalProperties: false, required: ['pass', 'reason'], properties: { pass: { type: 'boolean' }, reason: { type: 'string' } } },
    clear: { type: 'object', additionalProperties: false, required: ['pass', 'reason'], properties: { pass: { type: 'boolean' }, reason: { type: 'string' } } },
    fix: { type: 'array', items: { type: 'string' } },
  },
} as const;

/** Quoted terms in a reviewer reason vs the answer text: are any of them actually there? */
export function verifyQuotedTerms(reason: string, decision: AnalystDecision): 'no_quotes' | 'none_present' | 'some_present' {
  const quoted = [...String(reason).matchAll(/['"\u2018\u201c]([^'"\u2019\u201d]{2,40})['"\u2019\u201d]/g)].map((m) => m[1].trim().toLowerCase()).filter((t) => t && !/^(also_consider|ruled_out|gaps|headline|pursuits)$/.test(t));
  if (!quoted.length) return 'no_quotes';
  const text = JSON.stringify(decision).toLowerCase();
  return quoted.some((t) => text.includes(t)) ? 'some_present' : 'none_present';
}

export async function evaluateDecision(
  args: { question: string; evidence: string; decision: AnalystDecision; checks: RecordCheck[]; dropped?: string[] },
  opts: { client?: Anthropic; model?: string; /** Hard limit for this one call (the gate's deadline). */ timeoutMs?: number } = {},
): Promise<Evaluation & { usage: { input: number; output: number }; model: string }> {
  const software = softwareChecks(args.decision, args.checks, args.dropped || []);
  const client = opts.client ?? new Anthropic();
  const model = opts.model ?? process.env.ASK_MINDY_EVALUATOR_MODEL ?? EVALUATOR_MODEL_DEFAULT;
  const msg = await client.messages.create({
    model,
    max_tokens: 4000,
    system: RUBRIC,
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: EVAL_SCHEMA as unknown as Record<string, unknown> } },
    messages: [{
      role: 'user',
      content: `CUSTOMER QUESTION: ${args.question}\n\nEVIDENCE:\n${args.evidence}\n\nANSWER TO GRADE (JSON):\n${JSON.stringify(args.decision, null, 2)}`,
    }],
  }, { timeout: opts.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS, maxRetries: 0 });
  if (msg.stop_reason === 'refusal' || msg.stop_reason === 'max_tokens') throw new Error(`evaluator stopped: ${msg.stop_reason}`);
  const text = msg.content.filter((b) => b.type === 'text').map((b) => (b as Anthropic.TextBlock).text).join('');
  const j = JSON.parse(text) as Record<'reasoned' | 'actionable' | 'clear', { pass: boolean; reason: string }> & { fix: string[] };
  const judged: CriterionResult[] = (['reasoned', 'actionable', 'clear'] as const).map((c) => ({ criterion: c, pass: !!j[c].pass, reason: j[c].reason }));
  // The reviewer must be right about the text it grades: a clarity failure that only cites words the answer does
  // not contain is not supported (2026-11-24: it cited 'set-aside', 'follow-on' that were only in the evidence).
  const clear = judged.find((r) => r.criterion === 'clear');
  if (clear && !clear.pass) {
    const verdict = verifyQuotedTerms(clear.reason, args.decision);
    if (verdict === 'none_present') {
      clear.pass = true;
      clear.reason = `Reviewer's clarity objection cited only words that are not in the answer; not supported. (${clear.reason})`;
    }
  }
  // Software, not judgment: every dollar amount and calendar date in the answer must be in the evidence.
  const reasoned = judged.find((r) => r.criterion === 'reasoned');
  const unfounded = ungroundedFigures(args.decision, args.evidence);
  if (reasoned && unfounded.length) {
    const named = `These figures could not be traced to the data: ${unfounded.join(', ')}.`;
    reasoned.reason = reasoned.pass ? named : `${named} ${reasoned.reason}`;
    reasoned.pass = false;
  }
  const results = [...software, ...judged];
  // Eric 2026-11-24: factual grounding (relevant, pursuable, reasoned) and actionability block; clarity is ADVISORY.
  // A clarity-only failure neither triggers the retry nor withholds a grounded, actionable answer.
  const pass = results.filter((r) => BLOCKING.has(r.criterion)).every((r) => r.pass);
  const fix = pass ? [] : [...results.filter((r) => !r.pass && BLOCKING.has(r.criterion)).map((r) => `${r.criterion}: ${r.reason}`), ...(j.fix || [])];
  return { pass, results, fix, usage: { input: msg.usage.input_tokens, output: msg.usage.output_tokens }, model };
}
