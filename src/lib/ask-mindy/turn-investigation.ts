/**
 * Investigate This Opportunity, for a chat turn: builds the investigation note from the tool results the turn
 * ALREADY fetched (lookup_solicitation, get_solicitation_incumbent, understand_customer,
 * get_solicitation_documents). No second orchestration, no extra tool call, no extra cost or latency.
 * Pure, not wired into the chat route yet (that follows #2285, behind ASK_MINDY_RECIPES, default off).
 *
 * - Only a turn that resolved exactly one notice through lookup_solicitation gets an investigation. Any other turn
 *   gets null, and the answer is written as today.
 * - A tool that was not called this turn is listed as not checked ("not called this turn"). It is never read as
 *   "not found", and the incumbent is never called absent because its lookup did not run.
 * - A tool that failed is unavailable, never an empty result.
 * - The note tells the model to use the recommendation only when the customer asked for a decision (pursue, bid,
 *   investigate, fit); otherwise the facts stand on their own. Value first: an unknown company never blocks the
 *   answer.
 */
import type { CompanyProfile } from './company-profile';
import { composeDeepDive, toFitProfile, type DeepDiveContext } from './compose';
import { investigateOpportunity, investigationNote, type Investigation, type OpportunityExtras } from './investigate';
import type { RecipeRun, StepOutcome, StepRecord } from './orchestrator';

/** The part of a chat tool result this needs (ChatToolResult from chat-tool-executor has this shape). */
export interface TurnToolResult {
  record: { tool: string; status: string; error_category?: string | null };
  content: string;
}

/** Deep-dive recipe step id for each tool a chat turn may have called. */
const STEP_FOR_TOOL: Readonly<Record<string, string>> = {
  lookup_solicitation: 'notice',
  get_solicitation_documents: 'documents',
  get_solicitation_incumbent: 'incumbent',
  understand_customer: 'customer',
};

function outcomeOf(r: TurnToolResult): StepOutcome {
  if (r.record.status !== 'success') return { state: 'unavailable', reason: r.record.error_category || r.record.status };
  try {
    const value = JSON.parse(r.content) as unknown;
    if (value && typeof value === 'object' && (value as { ok?: unknown }).ok === false) {
      const v = value as { error_category?: unknown; error?: unknown };
      return { state: 'unavailable', reason: String(v.error_category ?? v.error ?? 'tool returned ok:false') };
    }
    return { state: 'ok', value };
  } catch {
    return { state: 'unavailable', reason: 'unreadable tool result' };
  }
}

/** The deep-dive run a chat turn amounts to. The last call of each tool wins (a retry replaces a failure). */
export function turnAsDeepDiveRun(results: readonly TurnToolResult[]): RecipeRun & { status: 'ran' } {
  const byStep = new Map<string, StepRecord>();
  for (const r of results) {
    const step = STEP_FOR_TOOL[r.record.tool];
    if (step) byStep.set(step, { id: step, tool: r.record.tool, wave: 0, outcome: outcomeOf(r) });
  }
  const steps = [...byStep.values()];
  return { recipe: 'opportunity_deep_dive', status: 'ran', steps, results: Object.fromEntries(steps.map((s) => [s.id, s.outcome])) };
}

export interface TurnInvestigation {
  deepDive: DeepDiveContext;
  investigation: Investigation;
  note: string;
}

/**
 * The investigation for this turn, or null when the turn did not resolve exactly one notice.
 * `profile` is null when the company is unknown or its profile could not be loaded (never blocks the answer).
 */
export function turnInvestigation(input: {
  results: readonly TurnToolResult[];
  profile: CompanyProfile | null;
  extras?: Partial<OpportunityExtras>;
  nowMs?: number;
}): TurnInvestigation | null {
  const run = turnAsDeepDiveRun(input.results);
  if (!run.steps.some((s) => s.id === 'notice')) return null;
  const nowMs = input.nowMs ?? Date.now();
  const deepDive = composeDeepDive(run, nowMs);
  if (deepDive.notice.state === 'not_found' || deepDive.notice.state === 'ambiguous') {
    // The turn's own lookup answer already says so; an investigation would only repeat it.
    return null;
  }
  // An incumbent lookup that did not run already carries composeDeepDive's own sentence ("whether there is an
  // incumbent is unknown"); listing it again would only repeat it. Documents have no such sentence.
  if (!run.steps.some((s) => s.tool === 'get_solicitation_documents')) {
    deepDive.not_checked.push({ step: 'documents', state: 'not_run', reason: 'not called this turn' });
  }
  const investigation = investigateOpportunity({
    deepDive,
    profile: input.profile ? toFitProfile(input.profile) : null,
    ...(input.extras ? { extras: input.extras } : {}),
    nowMs,
  });
  const note = [
    investigationNote(investigation),
    'Use the recommendation only if the customer asked for a decision about this opportunity (whether to pursue, bid, team or pass, or how well it fits). Otherwise answer with the facts and do not volunteer a recommendation.',
  ].join('\n');
  return { deepDive, investigation, note };
}
