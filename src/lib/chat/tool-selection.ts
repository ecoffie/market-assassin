/**
 * Per-question tool offer guard for Ask Mindy (B2).
 *
 * Why: "what opportunities are open for janitorial in Florida" was planned as a
 * get_expiring_contracts call. That tool returns AWARDED contracts with incumbents, not open
 * solicitations; the answer was about the wrong thing and the oversized result overflowed the
 * model's context window.
 *
 * Rule (deterministic, narrow): a question that asks about open / current opportunities and
 * says nothing about expiring work, recompetes, incumbents or end dates is not offered the
 * expiring-contracts tool for that turn, so the planner has to pick an opportunity tool.
 * Anything that mentions expiring / recompete / incumbent keeps every tool, so a recompete
 * question is never starved. This does not change how any search tool retrieves results.
 */
export const EXPIRING_CONTRACTS_TOOL = 'get_expiring_contracts';

export const EXPIRING_SIGNAL =
  /\b(expir\w*|recompet\w*|re-compet\w*|incumbent\w*|ending|ends?|end dates?|renewals?|follow[- ]on|option years?|period of performance|run(?:s|ning)? out|coming due|lapsing)\b/i;

export const OPEN_OPPORTUNITY_SIGNAL =
  /\b(opportunit(?:y|ies)|solicitations?|rfps?|rfqs?|rfis?|sources sought|open bids?|biddable|bid on|open|current(?:ly)?|active|available|posted)\b/i;

export function isOpenOpportunityQuestion(message: string): boolean {
  const m = String(message || '');
  return OPEN_OPPORTUNITY_SIGNAL.test(m) && !EXPIRING_SIGNAL.test(m);
}

export function filterToolsForQuestion<T extends { function?: Record<string, unknown> }>(
  defs: T[],
  message: string,
): { defs: T[]; removed: string[] } {
  if (!isOpenOpportunityQuestion(message)) return { defs, removed: [] };
  const removed: string[] = [];
  const kept = defs.filter((d) => {
    const name = String(d.function?.name ?? '');
    if (name === EXPIRING_CONTRACTS_TOOL) { removed.push(name); return false; }
    return true;
  });
  return { defs: kept, removed };
}
