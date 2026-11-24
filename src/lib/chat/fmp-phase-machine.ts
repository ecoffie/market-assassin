/**
 * Federal Market Profile — deterministic phase machine.
 *
 * Ask beats free-form Claude+MCP by FORCING evidence order. The model synthesizes
 * inside unlocked phases; it cannot jump to market size before awards, or write-up
 * before contacts + web were attempted.
 *
 * Phases (customer-favoring order: what the firm wins before what the market holds):
 *   identity → awards → pathways → vehicles → market_size → contacts → web → writeup
 *
 * Self-report is host-note only (not a tool phase).
 */

import { extractProfileStates } from './tool-selection';

export type FmpPhase =
  | 'identity'
  | 'awards'
  | 'pathways'
  | 'vehicles'
  | 'market_size'
  | 'contacts'
  | 'web'
  | 'writeup';

export const FMP_PHASE_ORDER: readonly FmpPhase[] = [
  'identity',
  'awards',
  'pathways',
  'vehicles',
  'market_size',
  'contacts',
  'web',
  'writeup',
] as const;

/**
 * Max planner↔tool rounds for one FMP customer turn (R1 + continuations).
 *
 * generate_market_report is an allowed_write and chat caps writes at 1/round, so each
 * per-state market report burns its own round. Measured 2026-11-20 on a cold profile run:
 * awards → pathways → vehicles → 3× market_size exhausted 6 and never reached
 * contacts / web / create_document. 12 covers identity/awards + pathways + vehicles +
 * up to 3 market + contacts + web + write_document (+ one writeup rewrite).
 */
export const FMP_MAX_ROUNDS = 12;

export const FMP_PHASE_TOOLS: Readonly<Record<FmpPhase, ReadonlySet<string>>> = {
  identity: new Set([
    'search_contractors',
    'lookup_sam_entity',
  ]),
  awards: new Set([
    'get_contractor_award_history',
    'get_contractor_profile',
    'get_recipient_annual_obligations',
  ]),
  pathways: new Set([
    'find_opportunities',
    'search_sam_opportunities',
    'lookup_solicitation',
    'get_solicitation_documents',
    'get_agency_forecasts',
  ]),
  vehicles: new Set([
    'search_past_contracts',
    'search_idv_contracts',
    'get_award_detail',
  ]),
  market_size: new Set([
    'generate_market_report',
  ]),
  contacts: new Set([
    'lookup_federal_osbp',
    'search_federal_contacts',
    'get_legislation_status',
  ]),
  web: new Set([
    'search_web',
  ]),
  writeup: new Set([
    'create_document',
  ]),
};

/** Primary tool to force when this phase is the earliest incomplete required gate. */
export const FMP_PHASE_FORCE_TOOL: Readonly<Partial<Record<FmpPhase, string>>> = {
  awards: 'get_contractor_award_history',
  pathways: 'find_opportunities',
  vehicles: 'search_past_contracts',
  market_size: 'generate_market_report',
  contacts: 'get_legislation_status',
  web: 'search_web',
  writeup: 'create_document',
};

export interface FmpToolResult {
  tool: string;
  status: string;
  /** Raw JSON string when available — used for web available=false credit. */
  content?: string;
}

export interface FmpPhaseState {
  /** Phases that have met their completion rule. */
  completed: ReadonlySet<FmpPhase>;
  marketReportCount: number;
  /** How many per-state market reports we want (from customer geography). */
  marketReportTarget: number;
  webAttempted: boolean;
  contactsAttempted: boolean;
  /**
   * How many `create_document` FMP-validator failures have been returned this turn.
   * One rewrite is allowed (used=1 → still incomplete); a second failure completes writeup
   * without shipping a banned saved doc.
   */
  writeupRewriteUsed: number;
  /** True when rounds/budget forced an early unlock so the customer still gets an answer. */
  budgetExhausted: boolean;
}

export function initialFmpPhaseState(customerText: string, opts: { companyStates?: readonly string[] } = {}): FmpPhaseState {
  const textStates = extractProfileStates(customerText);
  // One market report per state the customer named; else per saved company state (at most 3); with neither, one
  // national report. No default region.
  const companyStates = opts.companyStates;
  const target = textStates.length > 0
    ? textStates.length
    : companyStates
      ? Math.max(1, Math.min(3, companyStates.length))
      : 1;
  return {
    completed: new Set(),
    marketReportCount: 0,
    marketReportTarget: target,
    webAttempted: false,
    contactsAttempted: false,
    writeupRewriteUsed: 0,
    budgetExhausted: false,
  };
}

function withCompleted(state: FmpPhaseState, phase: FmpPhase): FmpPhaseState {
  if (state.completed.has(phase)) return state;
  const next = new Set(state.completed);
  next.add(phase);
  return { ...state, completed: next };
}

export type ApplyFmpToolResultsOpts = {
  /**
   * When true (default), writeup completes only on create_document ok:true.
   * Empty/invalid_document payloads do not burn rewrite budget or unlock answer.
   * Set false only for vault-off / legacy tests that still exhaust on rewrite alone.
   */
  requireWriteupOk?: boolean;
};

/**
 * Advance phase completions from tool results in one planner round.
 * Success statuses unlock; web also unlocks on an honest available=false miss.
 */
export function applyFmpToolResults(
  state: FmpPhaseState,
  results: ReadonlyArray<FmpToolResult>,
  opts: ApplyFmpToolResultsOpts = {},
): FmpPhaseState {
  let next = state;
  const requireWriteupOk = opts.requireWriteupOk !== false;
  const ok = (r: FmpToolResult) => r.status === 'success';

  if (results.some((r) => ok(r) && FMP_PHASE_TOOLS.identity.has(r.tool))) {
    next = withCompleted(next, 'identity');
  }
  if (results.some((r) => ok(r) && r.tool === 'get_contractor_award_history')) {
    next = withCompleted(next, 'awards');
    // Awards establish the firm — identity is satisfied even if search_contractors was skipped.
    next = withCompleted(next, 'identity');
  } else if (results.some((r) => ok(r) && FMP_PHASE_TOOLS.awards.has(r.tool))) {
    // Profile/obligations help but do not alone unlock pathways (awards-first rule).
  }

  if (results.some((r) => ok(r) && (
    r.tool === 'find_opportunities'
    || r.tool === 'search_sam_opportunities'
    || r.tool === 'lookup_solicitation'
  ))) {
    next = withCompleted(next, 'pathways');
  }

  if (results.some((r) => ok(r) && FMP_PHASE_TOOLS.vehicles.has(r.tool))) {
    next = withCompleted(next, 'vehicles');
  }

  const marketHits = results.filter((r) => ok(r) && r.tool === 'generate_market_report').length;
  if (marketHits) {
    const marketReportCount = next.marketReportCount + marketHits;
    next = { ...next, marketReportCount };
    if (marketReportCount >= next.marketReportTarget) {
      next = withCompleted(next, 'market_size');
    }
  }

  const contactHit = results.some((r) => ok(r) && FMP_PHASE_TOOLS.contacts.has(r.tool));
  if (contactHit) {
    next = { ...next, contactsAttempted: true };
    next = withCompleted(next, 'contacts');
  }

  for (const r of results) {
    if (r.tool !== 'search_web') continue;
    let attempted = r.status === 'success' || r.status === 'failed';
    if (r.content) {
      try {
        const parsed = JSON.parse(r.content) as { available?: boolean; grounded?: boolean };
        // Honest miss (key missing) still counts — customer gets a disclosed gap.
        if (parsed && parsed.available === false) attempted = true;
        if (parsed && typeof parsed.grounded === 'boolean') attempted = true;
      } catch { /* ignore */ }
    }
    if (attempted) {
      next = { ...next, webAttempted: true };
      next = withCompleted(next, 'web');
    }
  }

  // Writeup: executor status is success whenever the tool RETURNS — even when payload
  // is { ok:false } — so we must read the JSON body. Empty inject → invalid_document
  // must NOT burn rewrite budget or mark ready (vault generate on requires ok:true).
  for (const r of results) {
    if (r.tool !== 'create_document') continue;
    let payload: { ok?: boolean; error?: string } | null = null;
    if (r.content) {
      try {
        payload = JSON.parse(r.content) as { ok?: boolean; error?: string };
      } catch { /* ignore */ }
    }
    if (payload?.ok === true) {
      next = withCompleted(next, 'writeup');
      continue;
    }
    const err = String(payload?.error || '');
    const unusablePayload =
      err === 'invalid_document'
      || err === 'not_available'
      || err === 'workspace_unavailable'
      || err === 'fixture_content'
      || (payload?.ok === false && !err);
    if (unusablePayload) {
      // No real DocModel reached the FMP structure gate — do not complete writeup.
      continue;
    }
    // Real attempt refused (fmp_writeup_invalid) or hard executor failure → rewrite slot.
    if (payload?.ok === false || err === 'fmp_writeup_invalid' || r.status === 'failed') {
      const used = next.writeupRewriteUsed + 1;
      next = { ...next, writeupRewriteUsed: used };
      // Prefer ok:true when vault generate is on. Rewrite exhaust alone does not unlock
      // unless requireWriteupOk is explicitly false.
      if (!requireWriteupOk && used >= 2) next = withCompleted(next, 'writeup');
    }
  }

  return next;
}

/** Mark writeup unlocked because the round budget ran out — still answer with what we have. */
export function markFmpBudgetExhausted(state: FmpPhaseState): FmpPhaseState {
  return withCompleted({ ...state, budgetExhausted: true }, 'writeup');
}

/**
 * Vault generate off / create_document not offered: skip the Vault file gate and
 * complete writeup so the customer still gets a chat answer (markdown fallback).
 */
export function markFmpWriteupSkippedNoDocTool(state: FmpPhaseState): FmpPhaseState {
  return withCompleted(state, 'writeup');
}

/**
 * Phases the planner may use tools from. Earlier completed phases stay open (re-query OK).
 * The earliest incomplete phase is always unlocked so progress can continue.
 */
export function unlockedFmpPhases(state: FmpPhaseState): FmpPhase[] {
  const unlocked: FmpPhase[] = [];
  for (const phase of FMP_PHASE_ORDER) {
    unlocked.push(phase);
    if (!state.completed.has(phase)) break;
  }
  // Market size stays unlocked until target count even after first success.
  if (
    state.marketReportCount > 0
    && state.marketReportCount < state.marketReportTarget
    && !unlocked.includes('market_size')
  ) {
    unlocked.push('market_size');
  }
  return unlocked;
}

export function earliestIncompleteFmpPhase(state: FmpPhaseState): FmpPhase | null {
  for (const phase of FMP_PHASE_ORDER) {
    if (phase === 'market_size') {
      if (state.marketReportCount < state.marketReportTarget) return 'market_size';
      continue;
    }
    if (!state.completed.has(phase)) return phase;
  }
  return null;
}

export function fmpReadyForAnswer(state: FmpPhaseState): boolean {
  return state.completed.has('writeup') || state.budgetExhausted;
}

/** Force tool for the earliest incomplete gate, if offered. */
export function fmpForceTool(
  state: FmpPhaseState,
  offeredNames: ReadonlySet<string>,
): string | null {
  if (fmpReadyForAnswer(state)) return null;
  const phase = earliestIncompleteFmpPhase(state);
  if (!phase) return null;
  // Identity + awards: always force award history (awards-first rule). Identity
  // search can ride along but must not postpone the NAICS-establishing call.
  if (phase === 'identity' || phase === 'awards') {
    return offeredNames.has('get_contractor_award_history') ? 'get_contractor_award_history' : null;
  }
  const tool = FMP_PHASE_FORCE_TOOL[phase];
  if (!tool) return null;
  return offeredNames.has(tool) ? tool : null;
}

export function filterToolsForFmpPhase<T extends { function?: Record<string, unknown> }>(
  defs: T[],
  state: FmpPhaseState,
): { defs: T[]; removed: string[]; unlocked: FmpPhase[]; forceTool: string | null } {
  const unlocked = unlockedFmpPhases(state);
  const allowed = new Set<string>();
  for (const phase of unlocked) {
    for (const t of FMP_PHASE_TOOLS[phase]) allowed.add(t);
  }
  // While still gathering awards, keep identity tools even if awards is the incomplete gate.
  if (!state.completed.has('awards')) {
    for (const t of FMP_PHASE_TOOLS.identity) allowed.add(t);
    for (const t of FMP_PHASE_TOOLS.awards) allowed.add(t);
  }

  const removed: string[] = [];
  const kept = defs.filter((d) => {
    const name = String(d.function?.name ?? '');
    if (!name) return false;
    if (allowed.has(name)) return true;
    removed.push(name);
    return false;
  });
  const offeredNames = new Set(kept.map((d) => String(d.function?.name ?? '')));
  return {
    defs: kept,
    removed,
    unlocked,
    forceTool: fmpForceTool(state, offeredNames),
  };
}

export function fmpPhaseHostNote(state: FmpPhaseState): string {
  const done = FMP_PHASE_ORDER.filter((p) => state.completed.has(p));
  const current = earliestIncompleteFmpPhase(state);
  const lines = [
    'FEDERAL MARKET PROFILE — PHASE PLAN (server-enforced; do not skip ahead):',
    `Completed: ${done.length ? done.join(' → ') : '(none yet)'}.`,
  ];
  if (current) {
    lines.push(`Current required phase: ${current}. Call tools for this phase (and earlier ones) only.`);
    const force = FMP_PHASE_FORCE_TOOL[current];
    if (force) lines.push(`Preferred next call: ${force}.`);
  }
  if (current === 'market_size' || (state.marketReportCount > 0 && state.marketReportCount < state.marketReportTarget)) {
    lines.push(
      `Market size progress: ${state.marketReportCount}/${state.marketReportTarget} per-state generate_market_report calls. Continue until the target (one state per call).`,
    );
  }
  if (state.budgetExhausted) {
    lines.push('Round budget exhausted — answer with evidence gathered so far. Label any missing phase as a known gap.');
  } else if (current === 'writeup') {
    lines.push(
      'Evidence phases complete. Call create_document NOW with the pathway profile (pathways first; who-to-talk-to table; buyer pain; DSBS in checklist; PAE when defense buyers appear; no em dashes; no grading; no Mid plan CTA).',
    );
    if (state.writeupRewriteUsed > 0) {
      lines.push(`Write-up validator rejected the last draft (rewrite ${state.writeupRewriteUsed}/1 used). Fix the listed issues and call create_document once more.`);
    }
  } else if (fmpReadyForAnswer(state)) {
    lines.push('Pathway profile deliverable is complete (or write-up gate skipped). Do not invent missing web/CRS facts.');
  } else {
    lines.push('Do not write the final profile yet. Finish the current phase first.');
  }
  return lines.join('\n');
}

/** Refuse a tool call that belongs to a locked (not yet unlocked) phase. */
export function fmpToolAllowedInPhase(toolName: string, state: FmpPhaseState): boolean {
  const unlocked = unlockedFmpPhases(state);
  const allowed = new Set<string>();
  for (const phase of unlocked) {
    for (const t of FMP_PHASE_TOOLS[phase]) allowed.add(t);
  }
  if (!state.completed.has('awards')) {
    for (const t of FMP_PHASE_TOOLS.identity) allowed.add(t);
    for (const t of FMP_PHASE_TOOLS.awards) allowed.add(t);
  }
  // Unknown / non-FMP tools are denied during an FMP turn (keeps the plan tight).
  const allFmp = new Set<string>();
  for (const phase of FMP_PHASE_ORDER) {
    for (const t of FMP_PHASE_TOOLS[phase]) allFmp.add(t);
  }
  if (!allFmp.has(toolName)) return false;
  return allowed.has(toolName);
}
