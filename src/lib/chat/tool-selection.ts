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
import { normalizeStateCode } from '@/lib/utils/us-states';

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

// ── MARKET_RESEARCH: packaged one-shot (Mindy IP), same engine as MCP generate_market_report ──
// Ask used to answer "build a comprehensive market research report" by picking ad-hoc tools and
// stuffing scraps into create_document. MCP called generate_market_report once. Same federal data;
// different orchestration — that gap is why quality diverged. These helpers close it.
export const MARKET_REPORT_TOOL = 'generate_market_report';

/** Customer asked for a full / packaged market research report (not a one-line market fact). */
export const MARKET_RESEARCH_SIGNAL =
  /\b((?:comprehensive|full|complete|client[- ]ready|one[- ]shot)\s+(?:federal\s+)?(?:market\s+)?(?:research\s+)?report|(?:market\s+research|deep[- ]dive)\s+report|(?:generate|create|build|write|prepare|make)\s+(?:me\s+)?(?:a\s+)?(?:comprehensive\s+|full\s+|federal\s+)?(?:market\s+research\s+)?report|(?:market\s+research)\s+for\s+(?:my|our|the)\s+(?:company|firm|business))\b/i;

export function isMarketResearchRequest(customerText: string): boolean {
  return MARKET_RESEARCH_SIGNAL.test(String(customerText || ''));
}

export function filterToolsForTurn<T extends { function?: Record<string, unknown> }>(
  defs: T[],
  customerText: string,
  priorCustomerText?: string | null,
): { defs: T[]; removed: string[]; intent: FindIntent; openOnly: boolean; marketResearch: boolean } {
  const base = filterToolsForQuestion(defs, customerText);
  const intent = inheritFindIntent(customerText, priorCustomerText);
  const openOnly = isOpenOnlyRequest(customerText);
  const marketResearch = isMarketResearchRequest(customerText);
  const findOffered = base.defs.some((d) => String(d.function?.name ?? '') === FIND_TOOL);
  let removed = [...base.removed];
  let kept = base.defs;
  if (intent === 'CURRENT_FIND' && !openOnly && findOffered) {
    kept = kept.filter((d) => {
      const name = String(d.function?.name ?? '');
      // FIND covers recompetes (its Coming back horizon), so the expiring-contracts tool is also not offered on
      // a CURRENT_FIND turn, including one inherited from the previous question.
      if (name === SAM_ONLY_TOOL || name === EXPIRING_CONTRACTS_TOOL) { if (!removed.includes(name)) removed.push(name); return false; }
      return true;
    });
  }
  // Packaged market research (Mindy IP): when the customer asked for a full market report AND
  // generate_market_report is offered, do not also offer create_document or capability_market_match
  // on that turn — those are the scrap-assembly paths that diverge from MCP quality.
  const reportOffered = kept.some((d) => String(d.function?.name ?? '') === MARKET_REPORT_TOOL);
  if (marketResearch && reportOffered) {
    kept = kept.filter((d) => {
      const name = String(d.function?.name ?? '');
      if (name === 'create_document' || name === 'capability_market_match') {
        if (!removed.includes(name)) removed.push(name);
        return false;
      }
      return true;
    });
  }
  return { defs: kept, removed, intent, openOnly, marketResearch };
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

/**
 * Packaged market-report args (Ask ↔ MCP parity). The planner was forced to call
 * generate_market_report but often passed only client_name + "Hawaii" and no keyword —
 * the required market-total measurement then failed, the deliverable was withheld, and
 * Ask narrated thin leftovers. Normalize state codes and ensure a measurement axis.
 */
export function enforceMarketReportArgs(
  toolName: string,
  rawArgs: string,
  customerText: string,
): { args: string; changes: string[] } {
  if (toolName !== MARKET_REPORT_TOOL) return { args: rawArgs, changes: [] };
  let a: Record<string, unknown>;
  try { a = JSON.parse(rawArgs || '{}'); } catch { return { args: rawArgs, changes: [] }; }
  if (!a || typeof a !== 'object' || Array.isArray(a)) return { args: rawArgs, changes: [] };
  const changes: string[] = [];

  if (typeof a.state === 'string' && a.state.trim()) {
    const code = normalizeStateCode(a.state);
    if (code && code !== a.state) { a.state = code; changes.push('state_normalized'); }
    else if (!code) {
      // Try the customer's words (planner may have put a place name elsewhere).
      const fromText = extractStateFromCustomerText(customerText);
      if (fromText) { a.state = fromText; changes.push('state_from_customer'); }
    }
  } else {
    const fromText = extractStateFromCustomerText(customerText);
    if (fromText) { a.state = fromText; changes.push('state_from_customer'); }
  }

  const hasAxis = [a.keyword, a.naics, a.psc].some((v) => typeof v === 'string' && String(v).trim());
  if (!hasAxis) {
    const derived = deriveMarketReportKeyword(customerText);
    if (derived) { a.keyword = derived; changes.push('keyword_from_customer'); }
  }

  if (typeof a.client_name !== 'string' || !String(a.client_name).trim()) {
    const client = extractClientName(customerText);
    if (client) { a.client_name = client; changes.push('client_name_from_customer'); }
  }

  return changes.length ? { args: JSON.stringify(a), changes } : { args: rawArgs, changes: [] };
}

function extractStateFromCustomerText(text: string): string | null {
  const t = String(text || '');
  // "in Hawaii" / "in HI" / trailing state name
  const m = t.match(/\bin\s+([A-Za-z][A-Za-z.\s]{1,30}?)\s*[.?!]?\s*$/i)
    || t.match(/\b(?:for|serving|based in)\s+[^.]+?\bin\s+([A-Za-z][A-Za-z.\s]{1,30}?)\s*[.?!]?\s*$/i);
  if (m) {
    const code = normalizeStateCode(m[1].trim());
    if (code) return code;
  }
  // Bare 2-letter code as its own word
  for (const tok of t.split(/[\s,;]+/)) {
    if (/^[A-Za-z]{2}$/.test(tok)) {
      const code = normalizeStateCode(tok);
      if (code) return code;
    }
  }
  // Full state name anywhere
  for (const name of ['Hawaii', 'Florida', 'California', 'Texas', 'Alaska', 'Virginia', 'Maryland', 'Pennsylvania', 'New York', 'Washington']) {
    if (new RegExp(`\\b${name}\\b`, 'i').test(t)) {
      const code = normalizeStateCode(name);
      if (code) return code;
    }
  }
  return null;
}

/** Industry / activity keyword when the planner forgot the measurement axis. */
function deriveMarketReportKeyword(text: string): string | null {
  const t = String(text || '');
  // "for RBA Construction in Hawaii" → company phrase before "in <state>"
  const forMatch = t.match(/\bfor\s+(.+?)(?:\s+in\s+[A-Za-z][A-Za-z.\s]{1,30})?\s*[.?!]?\s*$/i);
  const phrase = (forMatch?.[1] || t)
    .replace(/\b(my|our|the|a|an)\s+(company|firm|business)\b/gi, ' ')
    .replace(/\b(comprehensive|federal|market|research|report|build|generate|create|write|prepare|make)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!phrase) return null;
  // Prefer a distinctive industry noun at the end of a company name ("RBA Construction" → construction)
  const words = phrase.split(/\s+/).filter(Boolean);
  const last = words[words.length - 1] || '';
  if (/^(construction|janitorial|roofing|hvac|staffing|cybersecurity|cyber|guard|security|catering|plumbing|electrical|landscaping|demolition|facilities|logistics|trucking|cleaning)$/i.test(last)) {
    return last.toLowerCase();
  }
  // Drop all-caps acronyms (RBA) and keep the rest as a keyword phrase
  const meaningful = words.filter((w) => !/^[A-Z]{2,5}$/.test(w) && w.length > 2);
  if (meaningful.length) return meaningful.join(' ').toLowerCase().slice(0, 80);
  return phrase.toLowerCase().slice(0, 80);
}

function extractClientName(text: string): string | null {
  const m = String(text || '').match(/\bfor\s+(.+?)(?:\s+in\s+[A-Za-z][A-Za-z.\s]{1,30})?\s*[.?!]?\s*$/i);
  if (!m) return null;
  const name = m[1].replace(/\b(my|our|the)\s+(company|firm|business)\b/gi, '').trim();
  if (!name || name.length < 2 || name.length > 80) return null;
  if (/^(a|an|the|comprehensive|federal|market)$/i.test(name)) return null;
  return name;
}

/** The one write tool allowed while document text is in the planner context. */
export const DOCUMENT_TEXT_WRITE_TOOL = 'create_document';

/**
 * Prompt-injection guard (Agent 4 / Agent 5, 2026-11-17): on any turn where uploaded or third-party
 * document text is in the PLANNER context, a planted "delete my schedules" or "add these contacts to the
 * CRM" must never reach a real write. Keeps every tool whose chat policy is 'allowed_read', plus
 * create_document; drops every other tool — schedule_market_search, update/delete_market_schedule,
 * add_contacts_to_crm, generate_market_report, and any write added later (policy-driven, not a name list).
 *
 * The route adds `removed` to notOfferedThisTurn, so a planned call to a removed tool is refused BEFORE
 * execution (an execution guard, not only an offer filter). One copy: #2138 (create_document turns) and
 * the revise turn both call this.
 */
export function restrictWritesWhenDocumentText<T extends { function?: Record<string, unknown> }>(
  defs: T[],
  policyFor: (name: string) => { decision: string },
): { defs: T[]; removed: string[] } {
  const kept: T[] = [];
  const removed: string[] = [];
  for (const d of defs) {
    const name = String(d.function?.name ?? '');
    if (name === DOCUMENT_TEXT_WRITE_TOOL || policyFor(name).decision === 'allowed_read') kept.push(d);
    else removed.push(name);
  }
  return { defs: kept, removed };
}
