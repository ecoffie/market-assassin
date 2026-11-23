/**
 * Ask Mindy customer-journey capture (value sprint, 2026-11-23).
 *
 * Drives a MULTI-TURN conversation through the real /api/app/chat route exactly as the app does (one chat
 * session; each turn re-sends the history, with the source ledger the previous answer returned), and captures what
 * the customer got: every SSE event, the answer, the tool trace, the turn notices, the sources and citations, and
 * the deliverables (packaged market report and create_document files).
 *
 * It does NOT grade. Grading happens separately, against a benchmark this code never sees.
 *
 * Flag state is OBSERVED, never assumed: `observeFlags` reads it from the turn notices and executed tools, and
 * `labelRun` refuses to call a run AFTER unless every expected flag was observed on.
 */

export interface JourneyScenario {
  id: string;
  description?: string;
  /** Customer wording only, one entry per turn, in order. */
  turns: string[];
}

export interface SseEvent { type: string; [k: string]: unknown }

export interface TraceTool {
  tool: string;
  status: string;
  args?: unknown;
  result_excerpt?: string;
  result_chars?: number;
  [k: string]: unknown;
}

export interface Deliverable { format: string; document_id: string; file_name?: string; version?: number }

export interface TurnCapture {
  turn: number;
  prompt: string;
  answer: string;
  sessionId: string | null;
  events: SseEvent[];
  tools: TraceTool[];
  notices: string[];
  /** Customer-visible notice codes (SSE `notice` events). */
  userNotices: string[];
  ledger: unknown;
  citations: unknown;
  deliverables: Deliverable[];
  marketReport: { report_id: string | null; url: string | null; title: string; html: string } | null;
  error: string | null;
  httpStatus: number | null;
  ms: number;
}

type HistoryItem = { role: 'user' | 'assistant'; content: string; sources?: unknown };

/** Read an SSE body to the end. Lines that are not JSON `data:` frames (keep-alives) are skipped. */
export async function readSseEvents(body: ReadableStream<Uint8Array>): Promise<SseEvent[]> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  const out: SseEvent[] = [];
  let buf = '';
  const take = (line: string) => {
    if (!line.startsWith('data:')) return;
    try {
      const e = JSON.parse(line.slice(5).trim());
      if (e && typeof e === 'object' && typeof e.type === 'string') out.push(e as SseEvent);
    } catch { /* keep-alive or partial */ }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const l of lines) take(l);
  }
  if (buf) take(buf);
  return out;
}

/** Fold one turn's events into a capture. */
export function captureFromEvents(turn: number, prompt: string, events: SseEvent[], ms: number, httpStatus: number | null): TurnCapture {
  const c: TurnCapture = {
    turn, prompt, answer: '', sessionId: null, events, tools: [], notices: [], userNotices: [], ledger: null, citations: null,
    deliverables: [], marketReport: null, error: null, httpStatus, ms,
  };
  for (const e of events) {
    switch (e.type) {
      case 'token': c.answer += String(e.content ?? ''); break;
      case 'session': c.sessionId = typeof e.sessionId === 'string' ? e.sessionId : c.sessionId; break;
      case 'trace': for (const t of (Array.isArray(e.tools) ? e.tools : []) as TraceTool[]) c.tools.push(t); break;
      case 'trace_usage': for (const n of (Array.isArray(e.notices) ? e.notices : [])) if (typeof n === 'string' && !c.notices.includes(n)) c.notices.push(n); break;
      case 'notice': case 'truncated': c.userNotices.push(String(e.code ?? e.type)); break;
      case 'sources': c.ledger = e.ledger ?? null; break;
      case 'citations': c.citations = e.sources ?? null; break;
      case 'deliverables': c.deliverables = (Array.isArray(e.files) ? e.files : []) as Deliverable[]; break;
      case 'market_report': c.marketReport = { report_id: (e.report_id as string) ?? null, url: (e.url as string) ?? null, title: String(e.title ?? ''), html: String(e.html ?? '') }; break;
      case 'error': c.error = String(e.message ?? 'error'); break;
      default: break;
    }
  }
  return c;
}

export interface RunJourneyOpts {
  host: string;
  email: string;
  token: string;
  scenario: JourneyScenario;
  fetchImpl?: typeof fetch;
  /** Called after each turn (the CLI writes artifacts here). */
  onTurn?: (c: TurnCapture) => Promise<void> | void;
}

/**
 * One chat session, turn by turn, as the app sends it: the session id from the first answer, the full history,
 * and each earlier answer's source ledger re-sent on that assistant message. Stops at the first failed turn
 * (an HTTP error or a stream `error`), since later turns would be answering a broken conversation.
 */
export async function runJourney(opts: RunJourneyOpts): Promise<TurnCapture[]> {
  const f = opts.fetchImpl ?? fetch;
  const history: HistoryItem[] = [];
  const turns: TurnCapture[] = [];
  let sessionId: string | null = null;
  for (let i = 0; i < opts.scenario.turns.length; i++) {
    const prompt = opts.scenario.turns[i];
    const started = Date.now();
    const res = await f(`${opts.host.replace(/\/$/, '')}/api/app/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-mi-auth-token': opts.token },
      body: JSON.stringify({ email: opts.email, message: prompt, history, ...(sessionId ? { sessionId } : {}) }),
    });
    let c: TurnCapture;
    if (!res.ok || !res.body) {
      c = captureFromEvents(i + 1, prompt, [], Date.now() - started, res.status);
      c.error = `HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`;
    } else {
      c = captureFromEvents(i + 1, prompt, await readSseEvents(res.body), Date.now() - started, res.status);
    }
    turns.push(c);
    await opts.onTurn?.(c);
    if (c.error) break;
    sessionId = c.sessionId ?? sessionId;
    history.push({ role: 'user', content: prompt });
    history.push({ role: 'assistant', content: c.answer, ...(c.ledger ? { sources: c.ledger } : {}) });
  }
  return turns;
}

// ── Flag state, observed ─────────────────────────────────────────────────────────────────────────────────────────

export type FlagKey = 'strategy_plan' | 'recipes' | 'vault_generate';
export type FlagState = 'on' | 'off' | 'unobserved';

/** Notices (or executed tools) that can only happen with the flag on, and ones that show it off. */
const FLAG_EVIDENCE: Record<FlagKey, { on: RegExp[]; onTools?: string[]; off: RegExp[] }> = {
  // ASK_MINDY_STRATEGY_PLAN: a strategy ask runs the plan workflow.
  strategy_plan: { on: [/^intent:strategy_plan$/, /^strategy_fit_ranking_note/, /^strategy_plan_check:/], off: [] },
  // ASK_MINDY_RECIPES: the shared fit scorer's note on a FIND answer.
  recipes: { on: [/^fit_ranking_note/], off: [] },
  // VAULT_GENERATED_FILES (generate): create_document was offered or ran.
  vault_generate: {
    on: [/^requested_doc_sections:/, /^sectioned_report:document$/, /^sectioned_report:create_document_forced$/, /^fmp_create_document_reason:/, /^revision:create_document_forced$/],
    onTools: ['create_document'],
    off: [/^fmp_phase:writeup_skipped_no_create_document$/, /^sectioned_report:packaged_with_gap_note:no_document_tool$/],
  },
};

/** What the run's own evidence says about each flag. 'unobserved' is never read as on or off. */
export function observeFlags(turns: readonly TurnCapture[]): Record<FlagKey, { state: FlagState; evidence: string[] }> {
  const out = {} as Record<FlagKey, { state: FlagState; evidence: string[] }>;
  for (const key of Object.keys(FLAG_EVIDENCE) as FlagKey[]) {
    const spec = FLAG_EVIDENCE[key];
    const on: string[] = [];
    const off: string[] = [];
    for (const t of turns) {
      for (const n of t.notices) {
        if (spec.on.some((r) => r.test(n))) on.push(`turn ${t.turn}: ${n}`);
        if (spec.off.some((r) => r.test(n))) off.push(`turn ${t.turn}: ${n}`);
      }
      for (const tool of t.tools) if (spec.onTools?.includes(tool.tool)) on.push(`turn ${t.turn}: ran ${tool.tool}`);
    }
    // Contradictory evidence is reported, and is not "on".
    out[key] = on.length && !off.length ? { state: 'on', evidence: on }
      : off.length && !on.length ? { state: 'off', evidence: off }
        : { state: 'unobserved', evidence: [...on, ...off] };
  }
  return out;
}

export type RunLabel = 'BEFORE' | 'AFTER' | 'UNCONFIRMED';

/**
 * BEFORE needs no flag on (an expected-off flag observed on makes it UNCONFIRMED). AFTER needs EVERY expected
 * flag observed on; anything else is UNCONFIRMED, never silently AFTER.
 */
export function labelRun(intent: 'before' | 'after', expected: readonly FlagKey[], observed: ReturnType<typeof observeFlags>): { label: RunLabel; reasons: string[] } {
  const reasons: string[] = [];
  if (intent === 'after') {
    for (const k of expected) if (observed[k].state !== 'on') reasons.push(`${k} expected on, observed ${observed[k].state}`);
    if (!expected.length) reasons.push('no expected flags were given for an AFTER run');
    return { label: reasons.length ? 'UNCONFIRMED' : 'AFTER', reasons };
  }
  for (const k of Object.keys(observed) as FlagKey[]) if (observed[k].state === 'on') reasons.push(`${k} observed on in a BEFORE run`);
  return { label: reasons.length ? 'UNCONFIRMED' : 'BEFORE', reasons };
}

/** Missing evidence the operator should know about (no trace means the preview was not started with trace on). */
export function runWarnings(turns: readonly TurnCapture[]): string[] {
  const w: string[] = [];
  if (turns.length && turns.every((t) => !t.events.some((e) => e.type === 'trace' || e.type === 'trace_usage'))) {
    w.push('no trace events: the target was not started with ASK_MINDY_TRACE_EVENTS=true, so tools and notices are missing');
  }
  for (const t of turns) {
    if (t.tools.some((x) => typeof x.result_chars === 'number' && x.result_chars > String(x.result_excerpt ?? '').length)) {
      w.push(`turn ${t.turn}: tool results truncated (set ASK_MINDY_TRACE_RESULT_CHARS=200000 on the target)`);
    }
    if (t.error) w.push(`turn ${t.turn}: ${t.error}`);
  }
  return w;
}

// ── Saved conversation reopen (Track A: the journey ends with a conversation the customer can come back to) ─────

export interface ReopenedMessage { role: string; content: string; cited_sources?: unknown; deliverables?: { files?: Deliverable[] } }
export interface ReopenCapture { httpStatus: number | null; title: string | null; messages: ReopenedMessage[]; error: string | null }

/** Reopen the conversation exactly as History does: GET /api/app/chat-sessions?email=&sessionId=. */
export async function reopenConversation(opts: { host: string; email: string; token: string; sessionId: string; fetchImpl?: typeof fetch }): Promise<ReopenCapture> {
  const f = opts.fetchImpl ?? fetch;
  const q = new URLSearchParams({ email: opts.email, sessionId: opts.sessionId });
  try {
    const r = await f(`${opts.host.replace(/\/$/, '')}/api/app/chat-sessions?${q}`, { headers: { 'x-mi-auth-token': opts.token } });
    if (!r.ok) return { httpStatus: r.status, title: null, messages: [], error: `HTTP ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}` };
    const j = await r.json() as { session?: { title?: string | null }; messages?: ReopenedMessage[] };
    return { httpStatus: r.status, title: j.session?.title ?? null, messages: Array.isArray(j.messages) ? j.messages : [], error: null };
  } catch (e) {
    return { httpStatus: null, title: null, messages: [], error: (e as Error).message };
  }
}

/**
 * Continuity facts, not a quality grade: did the saved conversation keep every turn, in order, with the same
 * question, the same answer text, its citations and its document chips? Each difference is listed plainly.
 */
export function reopenContinuity(turns: readonly TurnCapture[], reopened: ReopenCapture): { ok: boolean; differences: string[] } {
  const d: string[] = [];
  if (reopened.error) return { ok: false, differences: [`reopen failed: ${reopened.error}`] };
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  const users = reopened.messages.filter((m) => m.role === 'user');
  const assistants = reopened.messages.filter((m) => m.role === 'assistant');
  const answered = turns.filter((t) => !t.error);
  if (users.length !== answered.length) d.push(`saved ${users.length} question(s), the journey asked ${answered.length}`);
  if (assistants.length !== answered.length) d.push(`saved ${assistants.length} answer(s), the journey received ${answered.length}`);
  answered.forEach((t, i) => {
    const u = users[i];
    const a = assistants[i];
    if (u && !norm(u.content).endsWith(norm(t.prompt))) d.push(`turn ${t.turn}: saved question differs from the one asked`);
    if (!a) return;
    if (norm(a.content) !== norm(t.answer)) d.push(`turn ${t.turn}: saved answer differs from the streamed answer (${norm(a.content).length} vs ${norm(t.answer).length} chars)`);
    const streamedCites = Array.isArray(t.citations) ? t.citations.length : 0;
    const savedCites = Array.isArray(a.cited_sources) ? a.cited_sources.length : 0;
    if (streamedCites !== savedCites) d.push(`turn ${t.turn}: ${streamedCites} citation(s) streamed, ${savedCites} saved`);
    const streamedDocs = t.deliverables.map((x) => x.document_id).sort().join(',');
    const savedDocs = (a.deliverables?.files ?? []).map((x) => x.document_id).sort().join(',');
    if (streamedDocs !== savedDocs) d.push(`turn ${t.turn}: document chips streamed [${streamedDocs}] but saved [${savedDocs}]`);
  });
  return { ok: d.length === 0, differences: d };
}
