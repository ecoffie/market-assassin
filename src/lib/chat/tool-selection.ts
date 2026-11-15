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

// ── CURRENT_FIND: the three-horizon contract (F1, 2026-11-15) ────────────────────────────────
// Eric's side-by-side: Claude via the Mindy MCP answered "What open opportunities are there for janitorial
// services in Florida?" with Open now + Coming back (44 recompetes) + related notices, because the MCP host
// is told (P2_FIRST_TURN_INSTRUCTIONS) to call find_opportunities ONCE for a current find. Ask Mindy's
// planner had no such rule and picked the open-only search_sam_opportunities 3/3 times on a replay of that
// exact turn. These helpers make chat follow the same contract deterministically.

export const FIND_TOOL = 'find_opportunities';
export const SAM_ONLY_TOOL = 'search_sam_opportunities';

/** Retrospective intent ("the bid we submitted", "what happened to…"): lookup_solicitation, never FIND. */
export const HISTORICAL_SIGNAL =
  /\b(submitted|we bid|bid we|our bid|our proposal|proposal we|worked on|what happened|previous(?:ly)?|last (?:month|year|week)|the solicitation we|we (?:lost|won|responded))\b/i;

/** A FIND phrased without the word "opportunity": "where's the money", "who buys", "I sell X to Y". */
export const FIND_PHRASE_SIGNAL =
  /\b(where(?:'s| is) the money|what(?:'s| is) available|find (?:me )?(?:work|contracts|opportunit\w*)|i sell|we sell|sell to (?:the )?(?:government|federal|navy|army|air force|va|dod|agencies)|work for the (?:government|federal))\b/i;

/** The customer explicitly limited the search to open solicitations / SAM. "Open opportunities" alone is NOT this. */
export const OPEN_ONLY_SIGNAL =
  /\b(only open|open only|just (?:the )?open|only (?:the )?(?:live|biddable|current) (?:ones|solicitations|bids|notices)|biddable (?:right )?now|on sam(?:\.gov)? only|only on sam(?:\.gov)?|sam(?:\.gov)? only|solicitations only|only solicitations|no recompetes|exclude recompetes|not recompetes)\b/i;

export type FindIntent = 'KNOWN_ID' | 'HISTORICAL' | 'CURRENT_FIND' | 'OTHER';

function hasSolicitationId(text: string): boolean {
  return text.split(/[\s,;()]+/).some((tok) => {
    const t = tok.replace(/[.?!:]+$/, '');
    if (t.length < 8 || t.length > 40 || !/\d/.test(t) || !/[A-Za-z]/.test(t)) return false;
    if (/^[0-9a-f]{32}$/i.test(t.replace(/-/g, ''))) return true; // notice UUID
    // Solicitation numbers are code-like: mostly capitals/digits (W912DY26R0001, 70Z08726QKEYWEST, N00189-26-R-0001).
    return /^[A-Z0-9][A-Z0-9._/-]{7,}$/.test(t);
  });
}

/** Classify the CUSTOMER's words (callers strip the map view preamble first). Mirrors the MCP P2 classes. */
export function classifyFindIntent(customerText: string): FindIntent {
  const t = String(customerText || '');
  if (hasSolicitationId(t)) return 'KNOWN_ID';
  if (HISTORICAL_SIGNAL.test(t)) return 'HISTORICAL';
  if ((OPEN_OPPORTUNITY_SIGNAL.test(t) || FIND_PHRASE_SIGNAL.test(t)) && !EXPIRING_SIGNAL.test(t)) return 'CURRENT_FIND';
  return 'OTHER';
}

export function isOpenOnlyRequest(customerText: string): boolean {
  return OPEN_ONLY_SIGNAL.test(String(customerText || ''));
}

/**
 * The offer for one turn. Unchanged B2 rule: an open-opportunity question is not offered the
 * expiring-contracts tool. F1: a CURRENT_FIND question (and not explicitly open-only) is not offered the
 * open-only search_sam_opportunities when find_opportunities is offered, so the planner has to use the
 * three-horizon FIND. Card chat (its own allowlist, no find_opportunities) is therefore unaffected.
 */
/** A short refinement of a FIND ("What about in Florida?", "and Georgia?"): no new intent of its own. */
const REFINEMENT_SIGNAL = /^\s*(?:what|how) about\b|^\s*(?:and|also|same|now|ok(?:ay)?|how about)\b|^\s*(?:in|for|near|around)\s+\S/i;
export function inheritFindIntent(customerText: string, priorCustomerText: string | null | undefined): FindIntent {
  const own = classifyFindIntent(customerText);
  if (own !== 'OTHER' || !priorCustomerText) return own;
  const words = String(customerText || '').trim().split(/\s+/).filter(Boolean).length;
  if (words > 10 || !REFINEMENT_SIGNAL.test(customerText) || EXPIRING_SIGNAL.test(customerText)) return own;
  return classifyFindIntent(priorCustomerText) === 'CURRENT_FIND' ? 'CURRENT_FIND' : own;
}

export function filterToolsForTurn<T extends { function?: Record<string, unknown> }>(
  defs: T[],
  customerText: string,
  priorCustomerText?: string | null,
): { defs: T[]; removed: string[]; intent: FindIntent; openOnly: boolean } {
  const base = filterToolsForQuestion(defs, customerText);
  const intent = inheritFindIntent(customerText, priorCustomerText);
  const openOnly = isOpenOnlyRequest(customerText);
  const findOffered = base.defs.some((d) => String(d.function?.name ?? '') === FIND_TOOL);
  if (intent !== 'CURRENT_FIND' || openOnly || !findOffered) return { ...base, intent, openOnly };
  const removed = [...base.removed];
  const kept = base.defs.filter((d) => {
    const name = String(d.function?.name ?? '');
    // FIND covers recompetes (its Coming back horizon), so the expiring-contracts tool is also not offered on
    // a CURRENT_FIND turn, including one inherited from the previous question.
    if (name === SAM_ONLY_TOOL || name === EXPIRING_CONTRACTS_TOOL) { if (!removed.includes(name)) removed.push(name); return false; }
    return true;
  });
  return { defs: kept, removed, intent, openOnly };
}

/**
 * Make a find_opportunities call on a CURRENT_FIND turn match what the MCP host sends (Claude's input), so
 * Ask Mindy reads the same data Claude does (Eric's side-by-side, 2026-11-15):
 *  - all three horizons, unless the customer limited it. The planner sets horizons:{…, coming_back:false}
 *    on "open opportunities"; the tool includes a horizon unless it is explicitly false.
 *  - no industry code the customer did not type. The planner added advanced.naics (561720 / 238220 /
 *    561612), which narrowed Florida janitorial recompetes 44 -> 40 and dropped real Texas HVAC solicitations
 *    (FPC Bryan, Fort Sam Houston). P2 says query = what they sell; find_opportunities interprets the words.
 *  - up to 25 rows per horizon (the tool's max; default 5), so a "Coming back" table is not 4 rows plus
 *    "35 counted but not returned". Bounded downstream by the B2 token budget.
 */
export const FIND_ROWS_PER_HORIZON = 25;
export function enforceFindArgs(
  toolName: string,
  rawArgs: string,
  intent: FindIntent,
  openOnly: boolean,
  customerTypedCodes: string[] = [],
): { args: string; changes: string[] } {
  if (toolName !== FIND_TOOL || intent !== 'CURRENT_FIND') return { args: rawArgs, changes: [] };
  let a: Record<string, unknown>;
  try { a = JSON.parse(rawArgs || '{}'); } catch { return { args: rawArgs, changes: [] }; }
  if (!a || typeof a !== 'object' || Array.isArray(a)) return { args: rawArgs, changes: [] };
  const changes: string[] = [];
  const h = (a.horizons && typeof a.horizons === 'object' ? a.horizons : null) as Record<string, unknown> | null;
  if (!openOnly && h && (h.open_now === false || h.coming_back === false || h.coming_soon === false)) {
    a.horizons = { open_now: true, coming_back: true, coming_soon: true };
    changes.push('horizons');
  }
  const adv = (a.advanced && typeof a.advanced === 'object' && !Array.isArray(a.advanced) ? a.advanced : null) as Record<string, unknown> | null;
  if (adv) {
    for (const k of ['naics', 'psc'] as const) {
      if (adv[k] == null || adv[k] === '') continue;
      const vals = (Array.isArray(adv[k]) ? adv[k] as unknown[] : String(adv[k]).split(',')).map((x) => String(x).trim()).filter(Boolean);
      const typed = vals.filter((v) => customerTypedCodes.some((c) => c === v || c.startsWith(v) || v.startsWith(c)));
      if (typed.length === vals.length) continue;
      if (typed.length) adv[k] = Array.isArray(adv[k]) ? typed : typed.join(',');
      else delete adv[k];
      changes.push(`untyped_${k}`);
    }
    if (!Object.keys(adv).length) delete a.advanced;
  }
  const lim = Number(a.limit_per_horizon);
  if (!Number.isFinite(lim) || lim < FIND_ROWS_PER_HORIZON) { a.limit_per_horizon = FIND_ROWS_PER_HORIZON; changes.push('limit_per_horizon'); }
  return changes.length ? { args: JSON.stringify(a), changes } : { args: rawArgs, changes };
}
