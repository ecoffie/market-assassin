/**
 * POST /api/app/chat — Ask Mindy (Data Core Q&A)
 *
 * Tool-grounded Q&A streamed via Server-Sent Events. Pipeline:
 *   1. Auth via requireUserAuth (Supabase session, MI 2FA token, or
 *      signed email token)
 *   2. Load the signed-in user's bidder profile (NAICS, business type,
 *      set-asides) so Mindy can personalize — NO knowledge-base retrieval.
 *   3. Build system prompt + history
 *   4. A tool-round pre-flight offers the live federal Data Core tools
 *      (SAM opps / awards / agencies / firms / forecasts / recompete +
 *      the user's private Vault + pipeline); their results are injected
 *      as facts, then the answer is streamed.
 *   5. After the stream completes, fire-and-forget persistence:
 *      upsert session + insert user msg + insert assistant msg + latency.
 *
 * The 8-year teaching corpus + podcast RAG was REMOVED 2026-08-02 (Eric:
 * "anything not related to the data core we should remove. No one wants to
 * learn here"). Ask Mindy answers ONLY from live tool data — there are no
 * teaching/podcast citation chips anymore.
 *
 * SSE event types emitted:
 *   - { type: 'session', sessionId }   — emitted once at the start
 *   - { type: 'token', content }       — streamed model deltas
 *   - { type: 'citations', sources }   — emitted once at the end (empty now)
 *   - { type: 'done' }                 — terminator
 *   - { type: 'error', message }       — on failure
 */

import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyUserOwnsEmail } from '@/lib/api-auth';
import { hasProAccess } from '@/lib/access/resolve-access';
// RAG corpus removed 2026-08-02 (Eric: "not just the podcast the 8 year corpus training —
// anything not related to the data core we should remove. No one wants to learn here").
// Ask Mindy now answers ONLY from the live federal Data Core tools; the teaching-chunk +
// podcast retrieval (retrieveRagContext / retrievePodcastEpisodes) is gone entirely.
import { loadBidderProfile, formatProfileForPrompt } from '@/lib/proposal/loaders';
import { isUserOverBudget, recordLlmUsage } from '@/lib/llm/usage-cost';
import { makeTier0Tools, TIER0_TOOL_DEFS, TIER0_TOOL_NAMES } from '@/lib/chat/tier0-tools';
// Tools run ONLY through the chat tool executor (policy check at offer AND execution,
// preflight, per-tool error capture, execution log). Never import runMcpTool here.
import { createChatToolExecutor, type ChatExecutionRecord } from '@/lib/chat/chat-tool-executor';
import { resolveChatActingScope, vaultEmailFor } from '@/lib/chat/chat-acting-scope';
import type { BidderProfile } from '@/lib/proposal/types';
import { resolvePlannerChain, plannerKey, anthropicSupportsForcedToolChoice, resolveAnswerChain, answerKey, ANSWER_ENDPOINTS, openAiChatParams, type PlannerTarget } from '@/lib/chat/planner-config';
import { fitMessages, inputBudget, type MsgKind } from '@/lib/chat/token-budget';
import { stagingModelConfig, STAGING_CONFIG_HEADER } from '@/lib/chat/staging-model-config';
import { customerErrorMessage } from '@/lib/chat/customer-errors';
import { boundToolResult, perResultBudget } from '@/lib/chat/bound-tool-result';
import { filterToolsForTurn, enforceFindArgs, SAM_ONLY_TOOL } from '@/lib/chat/tool-selection';
import { CURRENT_FIND_CHAT_CONTRACT } from '@/lib/mcp/potato-journey';
import { findCompletionFooter, comingBackListLeadsWithNotCompeted, type FindResultWithItems } from '@/lib/chat/find-completeness';
import { inferredCodeDisclosure } from '@/lib/chat/code-disclosure';
import { getNaics } from '@/lib/codes/lookup';
import { capabilityPlannerNote, interpretCapabilityNaics } from '@/lib/market/capability-naics';
import { guardUnstatedStates, guardUnstatedCities } from '@/lib/chat/stated-filters';
import { parseDisplayHint, displayHintNote } from '@/lib/chat/display-hint';
import { compileIntent, enforceIntent, dedupeToolCalls, isMapScopeNote, splitViewPreamble } from '@/lib/chat/intent-compiler';
import { prepareChatToolArgs, renderExpiringRecords, renderStatusChecks, renderBuyingOffices, renderPricing, renderKeywords, renderVehicleMix, renderSbloContact, lintAnalysis, deterministicNextSteps, crossCheckOffices, checkSummaryAgainstRecords, EXPIRING_TOOL, PAST_CONTRACTS_TOOL, BUYING_OFFICES_TOOL, PRICING_TOOL, KEYWORDS_TOOL, VEHICLE_MIX_TOOL, SBLO_TOOL, type RenderedRecords } from '@/lib/chat/record-render';
import { recordProviderEvent } from '@/lib/chat/provider-events';
import { isSensitiveApprovedProvider } from '@/lib/llm/call-llm';
import { chatDeadlines, toolTimeoutMs, readWithIdleTimeout, incompleteToolNotice, withTimeout, ChatTimeoutError } from '@/lib/chat/turn-deadlines';

// Every Ask Mindy turn carries customer-private context (the user's profile; often Vault or
// pipeline results). So every provider the chat route calls directly must be on the SAME
// approved list callLLM enforces for dataClass:'sensitive' (SENSITIVE_LLM_PROVIDERS).
const providerApprovedForPrivate = (provider: string): boolean =>
  provider === 'openai' ? isSensitiveApprovedProvider('openai')
    : provider === 'anthropic' ? isSensitiveApprovedProvider('claude')
      : provider === 'groq' ? isSensitiveApprovedProvider('groq8b')
        : false;

// Verification aid, OFF by default and never to be set in production: when
// ASK_MINDY_TRACE_EVENTS === 'true', each turn also streams a `trace` event with the planner,
// the redacted tool arguments and a capped excerpt of each tool result, so a baseline run can
// check answers against evidence without a database migration.
// Never on a production deployment, even if the variable is set there by mistake.
const TRACE_EVENTS = process.env.ASK_MINDY_TRACE_EVENTS === 'true' && process.env.VERCEL_ENV !== 'production';
const TRACE_RESULT_CHARS = Number(process.env.ASK_MINDY_TRACE_RESULT_CHARS) || 6000;
import { shadowEntitlement } from '@/lib/entitlements/shadow';
import {
  isCardChatEnabled, cardChatTurnCredits, parseOpportunityContext, cardChatAccess, isBillableTurn,
  CARD_CHAT_TOOLS, buildOpportunityContextBlock,
} from '@/lib/chat/card-chat';
import { SELECTED_NOTICE_COLUMNS, loadSelectedNoticeFacts, formatSelectedNoticeFacts, type SelectedNoticeRecord } from '@/lib/chat/selected-notice';
import { resolveMentionedNotice, answerUsesNotice, type MentionedNoticeResult } from '@/lib/chat/mentioned-notice';
import { abilityOneCaveat } from '@/lib/chat/category-caveats';
import { parseTurnId, claimCardTurn, completeCardTurn, failCardTurn, type ClaimResult } from '@/lib/chat/card-chat-turns';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// A7: an explicit platform limit. Must equal CHAT_ROUTE_MAX_DURATION_S (turn-deadlines.ts): the turn
// watchdog fires before it, so a turn always ends with `error` + `done`, never a silent cut.
export const maxDuration = 300;

// B2: the answer-step model chain lives in resolveAnswerChain (planner-config.ts). The old
// Groq llama-3.1-8b-instant backup is retired; Groq runs only if CHAT_ANSWER_FALLBACKS lists it.
const TEMPERATURE = 0.3;          // citation-faithful per #117 spec
// Raised 1024 → 2048 (2026-11-13, Ask Mindy Phase 0): 1024 cut long answers mid-sentence
// with no signal. A cut answer is now also flagged to the user (finish_reason 'length').
const MAX_TOKENS = 2048;
// Tool round output cap. Raised 512 → 1024: several parallel tool calls with filters can
// exceed 512 tokens, and a truncated argument string used to run as {} (an unfiltered query).
const TOOL_ROUND_MAX_TOKENS = 1024;
const HISTORY_LIMIT = 6;          // last 3 exchanges (6 messages) for continuity

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _supabase: any = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _supabase;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatRequest {
  email: string;
  message: string;
  sessionId?: string;
  history?: ChatMessage[];
  /** Card chat: stable id of THIS question, generated by the browser and reused on retry/refresh/reopen. */
  turn_id?: string;
  /** Card chat: return the saved answer for turn_id if there is one; never run the model. */
  replay_only?: boolean;
  /** How the surface shows the answer ('narrow_panel' = the Map drawer). A system note, never user text. */
  display?: string;
}

// Retained only for the `chat_messages.cited_sources` column shape — Ask Mindy
// no longer produces citation chips (the RAG corpus that fed them is gone), so
// `citedSources` is always []. Kept as a typed empty rather than dropping the
// column so old rows/readers don't break.
interface CitedSource {
  title: string;
  url: string | null;
  doc_type: string;
  source_path: string | null;
  document_id: string | null;
}

/** A provider's machine error code (e.g. `rate_limit_exceeded`), never its free-text message. */
export function providerErrorCode(body: string, res: Response | null): string | null {
  if (!res) return 'network_error';
  try {
    const e = JSON.parse(body)?.error;
    const c = String(e?.code ?? e?.type ?? '');
    return /^[A-Za-z0-9_.-]{1,64}$/.test(c) ? c : null;
  } catch { return null; }
}

function sseEvent(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  'Connection': 'keep-alive',
  'X-Accel-Buffering': 'no', // disable nginx buffering if behind a proxy
};

function jsonResponse(obj: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

/**
 * Card chat, charge once per question: what the route answers when a turn id is already known.
 *   completed     → the SAVED answer and sources, streamed in the normal event shape. No model call, no debit.
 *   in_progress   → 409 turn_in_progress: another request for this question is still answering; ask again.
 *   mismatch      → 409 turn_mismatch: the id belongs to a different question, opportunity or user.
 *   not_completed → 404 turn_not_completed, only for a replay probe (nothing saved; nothing was run).
 * null = carry on and run the turn.
 */
function turnResponse(claim: ClaimResult, replayOnly: boolean, fallbackSessionId: string | null): Response | null {
  if (claim.outcome === 'completed') {
    const events = [
      { type: 'session', sessionId: claim.sessionId || fallbackSessionId },
      { type: 'token', content: claim.answer },
      { type: 'citations', sources: claim.citedSources },
      { type: 'replayed', charged: 0 },
      { type: 'done' },
    ];
    return new Response(events.map(sseEvent).join(''), { headers: SSE_HEADERS });
  }
  if (claim.outcome === 'in_progress') return jsonResponse({ error: 'turn_in_progress', retry_after: 3 }, 409, { 'Retry-After': '3' });
  if (claim.outcome === 'mismatch') return jsonResponse({ error: 'turn_mismatch' }, 409);
  if (claim.outcome === 'not_completed' && replayOnly) return jsonResponse({ error: 'turn_not_completed' }, 404);
  return null;
}

const SYSTEM_PROMPT_TEMPLATE = `You are Mindy — an AI assistant for federal small-business contractors.

VOICE:
- Direct, plain language. Federal acronyms are fine (NAICS, OSBP, FAR, IDIQ, 8(a), HUBZone, WOSB, SDVOSB, SAM, GSA). Tech/sales jargon (TAL, ICP, ABM, GTM) is not.
- NEVER say "I'm an AI" or "as a language model". You're Mindy.
- Keep responses tight. Most answers are 3-6 sentences or a short numbered list. No essays.
- ANSWER FIRST. The first sentence answers the question that was asked: for "which agencies should I target first" it names the first target and why; for "who should I contact" it names the contact. How you ranked, which data you used, its time window and freshness come AFTER the answer in at most two short sentences. Never open with methodology, data caveats or a list of steps you took.

TODAY: {today} (US Eastern). Use this date for every time calculation. When the user asks about a window such as "the next 18 months", compute its end date from today and compare every date you report against it. Never call a date inside the window "outside" it, or the reverse.

GROUNDING:
- You answer from the live federal DATA CORE (your tools) ONLY. There is NO teaching corpus, curriculum, or podcast library — do not offer to "teach", cite lessons/episodes, or mention any knowledge base. If the user wants to learn a concept, answer it briefly from the data at hand or point them at the tool that shows the real records.
- Every specific fact — a code, dollar, agency, name, count, deadline, contact — must come from a tool result. NEVER invent federal programs, agency names, contract values, or contacts. If your tools don't cover it, say so plainly and stop.
- Do NOT add inline citation markers (no bracket refs at all). Write naturally as if you read the records and are explaining them.

YOUR DATA TOOLS:
You have a LARGE toolset over the federal Data Core — each tool's own description says exactly when to use it. USE them instead of giving generic advice: if a tool can answer a question with real data, call it. Never tell the user to "go check SAM.gov / the panel" for something a tool covers. What you can reach, by category:
- THEIR OWN account (private): get_my_pipeline (their tracked pursuits/deadlines/stages) and search_my_vault (retrieves the records in their identity, past performance/CPARS, capabilities and team that match a query — always pass what they are asking about; it returns the relevant records, not the whole Vault). These return ONLY the workspace this user is working in — their own, or a client workspace they are authorized to coach (the result then carries workspace:"client"; say "this client's" rather than "your"). Never anyone else's.
- ADD / SAVE / TRACK requests: chat cannot write to their pipeline, saved list or alerts. When they ask to add, save or track an opportunity, do NOT stop at "I can't": point them to the step that does it — the "Start pursuit" button on the opportunity's map card (adds it to their pursuits), or "Generate proposal" on that card to start a proposal workspace for it. When the opportunity is attached to this chat (its notice chip shows above the message box), the chip's "Start a proposal" button does both: it saves it to My Pursuits and opens a proposal workspace. For an ongoing alert on a market, offer schedule_market_search.
- OPPORTUNITIES: open SAM.gov solicitations (general + by buying office), agency forecasts, expiring/recompete contracts, IDV/GWAC vehicles, grants.
  ⚠️ LABEL THE TYPE of every opportunity you list — never blend them into one flat list. There are three distinct kinds, and mixing them misleads the user:
    • OPEN — a posted solicitation you can bid on now. It HAS a SAM.gov link + a response deadline. CTA: bid / view the solicitation.
    • FORECAST — a PLANNED buy that has NOT been posted to SAM yet (from agency forecasts). It has NO solicitation link, and that is CORRECT, not a failure — the value is being 6–18 months early. NEVER present a forecast as bid-ready.
      ⚠️ SAY IT IS A FORECAST THE FIRST TIME YOU LIST IT — not only when the user asks for a link. Tag the item "Forecast — not yet on SAM". A user who has to ask "where are the links?" has already been misled, and the answer then reads as a broken search instead of an early signal.
      ⚠️ NEVER write "unfortunately", "I couldn't find a link", "may not yet be posted", or "check SAM.gov for updates" about a forecast. Those phrase a CORRECT result as a failure. The honest sentence is: "No link yet — this is a forecast; the solicitation is expected <date>." Say what IS known, never what is missing.
      ⚠️ A forecast without its detail is nearly useless, and the detail is what the user is actually buying. Whenever the tool returns them, LEAD with: expected solicitation date, incumbent, estimated value, and the contracting POC. Those beat a link — they are what lets someone position before the RFP exists.
    • RECOMPETE / EXPIRING — an incumbent contract expiring soon. CTA: track the incumbent + position before the RFP drops.
  When you show a mixed set, group or tag each item by type so the user instantly sees which are bid-now vs early-signal.
- COMPETITORS: a company's award history + profile, the firms that win a NAICS/PSC (teaming or competition), incumbent financials, the likely incumbent behind an opp, SAM entity/registration. When the user pastes a SAM solicitation/RFQ NUMBER (e.g. 140L6226Q0013) and asks who held it / prior price — call get_solicitation_incumbent (NOT get_award_detail; sol# ≠ award PIID).
- MARKET & PRICING: price-to-win labor rates, small-business/Rule-of-Two depth, buyer keyword coverage, market vocabulary, regulatory demand signals, SBA goaling.
- AGENCIES: an agency's pain points & priorities, spending detail, single-award detail (get_award_detail only for true contract PIIDs).
- PEOPLE & EVENTS: the named contacts/decision-makers at a buying office (search_federal_contacts — use it whenever they ask WHO to contact; do NOT punt to SAM), the SBLO at a prime, agency OSBP, and federal events/series.
- PROPOSAL HELP: bid/no-bid evaluation, compliance-matrix extraction, proposal structure, DQ-risk scan, independent compliance referee, SOW extraction, solicitation documents.
Tool-use rules:
- Some tools take a notice_id or RFP text (proposal tools) — if the user hasn't given one, ask for the solicitation number/text rather than guessing.
- If a tool returns a "slow down"/rate_limited note, relay it briefly and suggest they try again shortly — do NOT retry it yourself.
- A tool result with ok:false and an error_category (state "unavailable") means that data COULD NOT BE RETRIEVED. Say the lookup was unavailable or not permitted from chat. NEVER describe it as "none", "no contracts", or zero.
- Filters cover the whole request. get_expiring_contracts accepts several NAICS codes and several states comma-separated in ONE call: when the user names several kinds of work or several states, pass them all there (for example "janitorial and landscaping" -> naics "561720,561730"; "VA, MD and DC" -> state "VA,MD,DC"). Other tools take ONE NAICS code and ONE state per call unless their own description says they accept lists: call them once per code or state instead of joining values. Never drop part of what the user asked for.
- Expiring-contract records are rendered for the user by the system from the tool data (every record, or a stated page with the total). When the user asks to continue a list (for example "show expiring records 21 to 40"), call get_expiring_contracts again with exactly the same filters as the previous search plus display_offset = the first requested record number minus 1. Never present a subset as the full list.
- Only pass search filters the user stated or clearly implied. A city, metro or installation the user named implies its state ("Memphis" means TN): pass that state. Never add a state, agency, NAICS or date range they did not name or imply; the server removes a state the conversation does not imply.
- Is a contract still active / who replaced it: call search_past_contracts ONCE with include_status=true plus a keyword from the description in formal wording ("identification card", not "ID card"), the agency and the state implied by the place (or piid_prefix / the number the user gave). Report each status_checks entry: status, the end date and the successor result: name each candidate with its evidence, or say "checked, none found" and what was checked. Do not ask the user for a contract number first.
- If a result has _meta.lag_note, say the data is current through that date and recent awards may not be published yet. Never say no award was made.
- Incumbents: name one only when _meta.incumbent_finding is "identified". Otherwise follow _meta.absence_note: say you could not identify (or confirm) an incumbent and what was searched. Never say "there is no incumbent", "no one holds it", "it appears there is no incumbent" or "this is a new requirement" unless a record says so; not finding a prior award is not proof that none exists.
- Small-business contact at a buying office or agency (small business specialist, SBLO, OSDBU/OSBP): call search_federal_contacts for the office AND lookup_federal_osbp for its department in the same step. If the office search names no small-business specialist, give the department's small business office from lookup_federal_osbp (office, director, email and phone exactly as returned, with its verified date), and say it is the agency-level small business office, not that buying office's own specialist. Do not stop at "I couldn't confirm a contact" when that lookup returned an office.
- Contacts at a company: call get_sblo_contact. If it has no named liaison but returns registered_points_of_contact, name those people with their titles, say they are the firm's registered SAM points of contact (not a designated small business liaison) as of the as_of date, and never state an email or phone the tool did not return.
- Who buys a kind of work in a city or metro: call get_buying_offices with the state, the core city in city (it expands to the metro automatically), and the NAICS. Name each contracting office with its code, the customer agencies in top_funding_offices, the obligated dollars, and where the work is performed; never say the office is located in the city.
- How much spending runs through schedules, BPAs or IDIQs: call get_vehicle_spend_mix and give dollars and percent for each bucket, plus the verified, heuristic and unresolved shares. unavailable or scope_too_broad is not a zero: say so and narrow the window.
- Keywords for a company: call derive_company_keywords with brand_exclude set to the company name the user gave. Present keywords and occupational_titles, and cite each one's keyword_sources. Never list a city, state or company name as a keyword.
- Labor rates: call get_pricing_intel and quote rate_summary.statement exactly, giving every price point (aggressive, competitive, premium) with its population and n. Competitive is the market median; never present a per-title median as the market median.
- Every tool result carries _meta.result_state and _meta.ignored_args. Only result_state "none_found" with an empty ignored_args is a verified zero: only then may you say nothing matched. "filter_not_applied" or "partial": name each ignored argument and say that part was NOT checked (for example: "I could not filter by city, so this covers all of Tennessee"); never present the result as complete or as a zero. "unavailable": the data could not be retrieved; never call it none. "not_reported": the tool gives no status; judge from the rows it returned (zero rows means nothing matched those filters) and still name any ignored arguments.
- When a tool returns grounded=false / count 0 / found false, say so plainly — NEVER invent a pursuit, opportunity, contract, company, agency, deadline, dollar, contact, or term. Ground every specific ONLY in what the tool actually returned.
- When OPEN solicitations run thin, do NOT fall back to "keep an eye on SAM.gov" / "check SAM.gov for updates" / "monitor the panel" — you have forecast + recompete tools; call them and surface (clearly labeled) FORECAST and RECOMPETE results instead. "Go check SAM yourself" is never an acceptable answer for something a tool covers.
- DO NOT PAD A THIN RESULT. If the user asked for cyber/cloud work and the tools returned two real matches, return two and say the set is thin — never stretch to fill a list with items that only loosely touch the ask. Listing a security-system repair or an air-traffic-control system under "cyber and cloud" makes every other result look equally unreliable. Three precise matches beat seven padded ones, and a user can act on "that's all there is right now"; they cannot act on a list they have to re-filter themselves.

SCOPE:
- You answer questions about US federal contracting — set-asides, certifications, SAM.gov, capability statements, teaming, proposals, market intel, GovCon BD.
- For off-topic queries (general business advice, personal stuff, non-federal contracts), redirect: "I'm focused on federal contracting — try [X] for that." Do NOT cite any sources on off-topic redirects — just redirect plainly.

WRITING STYLE:
- NEVER use bracketed placeholders like "[Company Name]" or "[Your Business]" in responses. If you don't have the user's company name, write generic advice using "your company" or "your business" instead.
- Default to second person ("you / your") — you're talking TO the user, not ABOUT a hypothetical bidder.
- NEVER mention tool names, internal mechanics, or "the [X] tool" to the user. Just answer with what you found, or — if you need one more detail to search (e.g. which agency) — ask for it naturally ("Which agency did you have in mind?"). The user never sees the plumbing.

USER PROFILE (use to personalize answers when relevant; if blank, write generically using "your company"):
{userProfile}`;

// (buildContextBlock / chunksToCitations / buildCitationChips removed 2026-08-02 — the entire RAG
// corpus, teaching chunks AND podcasts, is gone from this route. Ask Mindy answers from the Data
// Core tools; there are no knowledge-base citation chips anymore.)

async function persistExchange(params: {
  email: string;
  sessionId: string;
  userMessage: string;
  assistantMessage: string;
  citedSources: CitedSource[];
  tokensUsed: number | null;
  latencyMs: number;
  /** Per-turn trace: models, tool execution ids/statuses, notices. No arguments or bodies. */
  trace?: Record<string, unknown>;
}) {
  const supabase = getSupabase();

  // Upsert session (create if missing, bump updated_at + message_count if present)
  const { data: existing, error: existingErr } = await supabase
    .from('mindy_chat_sessions')
    .select('id, message_count')
    .eq('id', params.sessionId)
    .maybeSingle();
  if (existingErr) console.error('[chat] session query error:', existingErr.message);

  const sessionTitle = params.userMessage.slice(0, 60).replace(/\s+/g, ' ').trim();
  const nowIso = new Date().toISOString();

  if (existing) {
    await supabase
      .from('mindy_chat_sessions')
      .update({
        message_count: (existing.message_count || 0) + 2,
        updated_at: nowIso,
      })
      .eq('id', params.sessionId);
  } else {
    await supabase.from('mindy_chat_sessions').insert({
      id: params.sessionId,
      user_email: params.email,
      title: sessionTitle,
      message_count: 2,
      created_at: nowIso,
      updated_at: nowIso,
    });
  }

  // Insert both messages. The trace column is additive (migration
  // 20261114_ask_mindy_execution_trace); if it is absent, retry without it so the
  // conversation itself is never lost to a telemetry column.
  const userRow = {
    session_id: params.sessionId,
    role: 'user',
    content: params.userMessage,
    cited_sources: [],
  };
  const assistantRow = {
    session_id: params.sessionId,
    role: 'assistant',
    content: params.assistantMessage,
    cited_sources: params.citedSources,
    tokens_used: params.tokensUsed,
    latency_ms: params.latencyMs,
  };
  const { error: insertErr } = await supabase
    .from('mindy_chat_messages')
    .insert([userRow, params.trace ? { ...assistantRow, trace: params.trace } : assistantRow]);
  if (insertErr) {
    console.error('[chat] message insert rejected:', insertErr.message);
    if (params.trace) {
      const { error: retryErr } = await supabase.from('mindy_chat_messages').insert([userRow, assistantRow]);
      if (retryErr) console.error('[chat] message insert retry rejected:', retryErr.message);
    }
  }
}

export async function POST(request: NextRequest) {
  // Parse body once — Request body is a stream and can't be re-read.
  // requireUserAuth was clone+json()-parsing it as a fallback, but after
  // we'd already consumed it the clone returned empty → 401 "Email required".
  // Same auth bug we hit on the voice routes — fix by pulling email
  // from the parsed body and calling verifyUserOwnsEmail directly.
  let body: ChatRequest;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const email = String(body?.email || '').toLowerCase().trim();
  if (!email) {
    return new Response(JSON.stringify({ error: 'email required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const message = String(body?.message || '').trim();
  if (!message) {
    return new Response(JSON.stringify({ error: 'message required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  // ── Opportunity-INTENT detector (Andre @ CypherIntel, 2026-07-30) ──
  // The tool round runs tool_choice:'auto', so for "what opportunities are available…" the
  // model SOMETIMES declines the tool and answers from the RAG teaching corpus ("keep an eye
  // on SAM.gov") — intermittent, and exactly Andre's bug. When the question is clearly an
  // opportunity/award/forecast SEARCH, we force the tool round to actually call a tool
  // (tool_choice:'required' / Anthropic {type:'any'}). Teaching questions ("how do I write a
  // cap statement") DON'T match, so they still get RAG. Deliberately narrow: an intent verb
  // ("find/show/what's available/search/list/any…") AND an opp noun (opportunities/solicitations
  // /contracts/awards/RFP/RFQ/set-aside/recompete/forecast), OR a bare "opportunities/solicitations"
  // ask. Conservative — a miss just falls back to auto (today's behaviour), never worse.
  const OPP_INTENT = (() => {
    const m = message.toLowerCase();
    const verb = /\b(find|show|list|search|any|what('?s| is| are)|which|are there|looking for|pull up|get me)\b/.test(m);
    const noun = /\b(opportunit|solicitation|contract|award|rfp|rfq|rfi|sources sought|set[- ]aside|recompete|forecast|idiq|gwac|bid|procurement|task order)\b/.test(m);
    const bareOpp = /\b(opportunit(y|ies)|solicitations?|open bids?)\b/.test(m);
    return (verb && noun) || bareOpp;
  })();
  if (message.length > 2000) {
    return new Response(JSON.stringify({ error: 'message too long (2000 char max)' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Auth without re-reading the body. Still validates Supabase session,
  // MI 2FA token, signed query token, and legacy cookie via the helper.
  const auth = await verifyUserOwnsEmail(request, email);
  if (!auth.authenticated || !auth.email) {
    return new Response(JSON.stringify({ error: auth.error || 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Pro gate: Mindy Chat retrieves from the proprietary knowledge base, so it's a
  // paid feature. Enforced server-side (hiding the sidebar item isn't enough — a
  // free user could call this API directly). 403 → the UI shows the upgrade prompt.
  const chatPro = await hasProAccess(auth.email);
  shadowEntitlement({ route: 'app/chat POST', capability: 'chat.ask', email: auth.email, identityVerified: true, currentAllow: chatPro });

  // ── Selected listing (Eric 2026-11-16: it attaches to THIS main chat; see src/lib/chat/selected-notice.ts) ──
  // `context: { kind: 'opportunity', notice_id }` is parsed on every turn, flag or not. The client sends only
  // the notice id; the record and its buyer/contact/incumbent facts are loaded here, never taken from the client.
  // The legacy card-chat path (per-turn credits for non-Pro + its narrowed tool list) still exists only behind
  // MAP_CARD_CHAT_ENABLED, which is off in production; with it off, a selected notice changes the context only:
  // the Pro gate, the full tool set and the CURRENT_FIND contract are unchanged.
  const cardFlag = isCardChatEnabled();
  const selectedCtx = parseOpportunityContext((body as { context?: unknown }).context);
  const cardCtx = cardFlag ? selectedCtx : null;
  const turnCredits = cardChatTurnCredits();
  // Charge once per question: a question already answered is replayed from its saved copy BEFORE any balance
  // check (it was paid for once already), with no model call and no debit.
  const turnId = cardCtx ? parseTurnId(body.turn_id) : null;
  const replayOnly = body.replay_only === true;
  if (replayOnly && !turnId) return jsonResponse({ error: 'turn_id_required' }, 400);
  if (cardCtx && turnId) {
    let probe: ClaimResult;
    try {
      probe = await claimCardTurn({ turnId, email: auth.email, noticeId: cardCtx.noticeId, sessionId: null, question: message, replayOnly: true });
    } catch (err) {
      console.error('[chat] card turn lookup failed:', (err as Error)?.message);
      return jsonResponse({ error: 'turn_unavailable' }, 503);
    }
    const early = turnResponse(probe, replayOnly, null);
    if (early) return early;
  }
  let cardBalance: number | null = null;
  if (!chatPro && cardCtx) {
    const { data: bal, error: balErr } = await getSupabase()
      .from('mcp_credit_balance').select('balance').eq('user_email', auth.email).maybeSingle();
    // A failed read is UNKNOWN, never "has credits" (and never a fabricated 0 shown as truth).
    cardBalance = balErr ? null : Number((bal as { balance?: number } | null)?.balance ?? 0);
  }
  const access = cardChatAccess({ isPro: chatPro, flagOn: cardFlag, context: cardCtx, balance: cardBalance, turnCredits });
  if (!access.allow) {
    return new Response(JSON.stringify({
      error: access.error, upgrade: true,
      ...(access.error === 'credits_required' ? { credits_per_answer: turnCredits, ...(access.balance != null ? { balance: access.balance } : {}) } : {}),
    }), { status: access.status, headers: { 'Content-Type': 'application/json' } });
  }
  const cardBillable = access.billable;
  // A billable card question must carry its turn id: without one a retry could not be recognized, and the
  // route would have no saved copy to replay.
  if (cardBillable && !turnId) return jsonResponse({ error: 'turn_id_required' }, 400);
  let cardRecord: SelectedNoticeRecord | null = null;
  // Why the selected notice could not be attached (main chat only; the card path refuses instead).
  let selectedNoticeMiss: 'unavailable' | 'not_found' | null = null;
  if (selectedCtx) {
    const { data: rec, error: recErr } = await getSupabase()
      .from('sam_opportunities').select(SELECTED_NOTICE_COLUMNS).eq('notice_id', selectedCtx.noticeId).maybeSingle();
    if (recErr || !rec) {
      if (cardCtx) {
        return recErr
          ? new Response(JSON.stringify({ error: 'opportunity_unavailable' }), { status: 503, headers: { 'Content-Type': 'application/json' } })
          : new Response(JSON.stringify({ error: 'opportunity_not_found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
      }
      // Main chat: answer the question anyway, without a selected-notice block (never a guessed record).
      selectedNoticeMiss = recErr ? 'unavailable' : 'not_found';
    } else {
      cardRecord = rec as unknown as SelectedNoticeRecord;
    }
  }

  // B2: no Groq key is required any more (Groq is no longer the default fallback). Missing
  // provider keys are handled per turn and surface as a customer-safe message, never config text.

  // A supplied session id is honored only if it is new or already belongs to this user: persistExchange
  // used to append to ANY existing session id, so a reused id could write into another user's thread.
  let sessionId: string = crypto.randomUUID();
  if (typeof body.sessionId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.sessionId)) {
    const { data: owned, error: ownErr } = await getSupabase()
      .from('mindy_chat_sessions').select('user_email').eq('id', body.sessionId).maybeSingle();
    if (!ownErr && (!owned || String((owned as { user_email?: string }).user_email || '').toLowerCase() === auth.email.toLowerCase())) {
      sessionId = body.sessionId;
    }
  }
  // Claim the turn last, after every early refusal, so a refused request never leaves a turn in progress.
  let claimToken: string | null = null;
  if (cardCtx && turnId) {
    let claim: ClaimResult;
    try {
      claim = await claimCardTurn({ turnId, email: auth.email, noticeId: cardCtx.noticeId, sessionId, question: message, replayOnly: false });
    } catch (err) {
      console.error('[chat] card turn claim failed:', (err as Error)?.message);
      return jsonResponse({ error: 'turn_unavailable' }, 503);
    }
    if (claim.outcome !== 'claimed') return turnResponse(claim, false, sessionId) ?? jsonResponse({ error: 'turn_unavailable' }, 503);
    claimToken = claim.claimToken;
    // A re-claimed turn keeps the session it started in (the claim already checked it is this user's turn).
    if (claim.sessionId) sessionId = claim.sessionId;
  }
  const startedAt = Date.now();
  // A7: every wait in this turn is bounded (src/lib/chat/turn-deadlines.ts).
  const deadlines = chatDeadlines(process.env);

  // SSE response — manually constructed ReadableStream since the
  // Vercel Edge / Node runtime doesn't expose an out-of-the-box helper.
  // The browser disconnecting must stop billing. Three signals, because no single one is reliable
  // everywhere: enqueue/close throwing (local Node), the stream being cancelled, and the request's abort
  // signal (Next.js aborts it when the response connection closes). Production 2026-11-14 proved the
  // first alone is not enough: on Vercel the writes kept succeeding after the client left, and an
  // abandoned card-chat answer was charged.
  let clientGone = false;
  try { request.signal?.addEventListener?.('abort', () => { clientGone = true; }, { once: true }); } catch { /* no signal */ }
  if (request.signal?.aborted) clientGone = true;
  const stream = new ReadableStream({
    cancel() { clientGone = true; },
    async start(controller) {
      const encoder = new TextEncoder();
      // Card turn bookkeeping: settled = completed (saved + charged once) or marked failed (free). Anything
      // that leaves the turn unsettled (an early return, a thrown error) marks it failed in `finally`.
      let turnSettled = false;
      // True only when WE stopped reading the model because the browser left: the answer is incomplete.
      let streamCut = false;
      // A7: the stream has been closed (done sent). After this, send() is a no-op.
      let ended = false;
      // A7: the answer provider stopped sending bytes mid-answer; the answer is cut and flagged.
      let answerStalled = false;
      // A7: the turn watchdog fired: error + done were sent and the card turn released.
      let turnTimedOut = false;
      let answerAbort: AbortController | null = null;
      // The answer stream's reader, so the watchdog can end a pending read even if the abort is not honored.
      let answerReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
      // A client that disconnected makes enqueue/close throw. That must never be mistaken for a
      // tool failure (it would inject a "tools unavailable" note after a completed write), and it
      // must never skip cost recording or persistence: both are wrapped and never throw.
      const send = (obj: unknown) => {
        if (clientGone || ended) return;
        try { controller.enqueue(encoder.encode(sseEvent(obj))); } catch { clientGone = true; }
      };
      const closeStream = () => {
        if (ended) return;
        ended = true;
        try { controller.close(); } catch { clientGone = true; }
      };
      // A7 turn watchdog: whatever is still waiting (a provider, a tool, a database read), the customer gets
      // an error and the stream ends before the platform limit. A card turn is released (free, re-askable)
      // instead of staying locked in progress for its lease.
      const watchdog = setTimeout(() => {
        if (ended) return;
        turnTimedOut = true;
        console.error('[chat] turn deadline reached after', deadlines.turnMs, 'ms');
        try { answerAbort?.abort(new ChatTimeoutError('turn', deadlines.turnMs)); } catch { /* already done */ }
        void answerReader?.cancel().catch(() => {});
        send({ type: 'error', code: 'turn_timeout', message: customerErrorMessage('turn_timeout') });
        send({ type: 'done' });
        closeStream();
        if (claimToken && turnId && !turnSettled) {
          turnSettled = true;
          void failCardTurn({ turnId, claimToken, reason: 'turn_timeout' })
            .catch((e) => console.error('[chat] card turn fail-mark failed:', (e as Error)?.message));
        }
      }, deadlines.turnMs);

      try {
        // Tell client which session this exchange belongs to right away
        send({ type: 'session', sessionId });

        // Load ONLY the bidder profile for context. The ENTIRE RAG corpus — the 8-year
        // teaching/curriculum chunks AND the podcast episodes — was REMOVED (Eric 2026-08-02:
        // "not just the podcast, the 8-year corpus training, anything not related to the data core
        // we should remove. No one wants to learn here"). Ask Mindy on the map answers from the
        // DATA CORE (live SAM/awards/agencies/firms/forecasts/recompete tools), not from a
        // teaching knowledge base. No RAG retrieval, no teaching context, no citation chips.
        // Coach Mode: the profile, Vault, pipeline and Vault-grounded drafts act on the same
        // workspace the screens resolve (x-active-workspace, authorized via org_clients/org_members).
        // No header → the caller's own data, with no extra query. See src/lib/chat/chat-acting-scope.ts.
        // The selected notice's buyer/contact/incumbent facts start loading now (incumbent bounded)
        // so they run alongside the scope + profile reads below.
        // Plain chat (nothing attached): the notice the user NAMED in their own words this conversation is
        // resolved from our record and grounds the answer the same way (src/lib/chat/mentioned-notice.ts).
        // Context only: card billing (cardCtx) is untouched, and nothing is stored.
        const noticeP = (async () => {
          let rec = cardRecord;
          let origin: 'selected' | 'mentioned' = 'selected';
          let mention: MentionedNoticeResult | null = null;
          if (!rec && !selectedCtx) {
            const priorTurns = Array.isArray(body.history) ? body.history.slice(-HISTORY_LIMIT) : [];
            mention = await resolveMentionedNotice(getSupabase(), splitViewPreamble(message).rest || message, priorTurns)
              .catch(() => ({ status: 'none' }) as MentionedNoticeResult);
            if (mention.status === 'resolved') { rec = mention.notice.record; origin = 'mentioned'; }
          }
          const facts = rec ? await loadSelectedNoticeFacts(rec, { cacheKey: `chat:${sessionId}` }).catch(() => null) : null;
          return { rec, origin, mention, facts };
        })();
        const actingScope = await resolveChatActingScope(auth.email!, request);
        // Unresolved workspace → NO profile (the private tools refuse too): a coach acting for a
        // client must never get an answer built on their own profile.
        const profileEmail = vaultEmailFor(actingScope);
        const profile: BidderProfile = profileEmail ? await loadBidderProfile(profileEmail) : {};
        const { rec: noticeRecord, origin: noticeOrigin, mention: mentionedNotice, facts: noticeFacts } = await noticeP;
        cardRecord = noticeRecord;
        const userProfileBlock = formatProfileForPrompt(profile);
        const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
        // F1: the CURRENT_FIND contract (shared with the MCP host's P2 rule). Not for card chat, which answers
        // about one opportunity with its own tool allowlist.
        const systemPrompt = SYSTEM_PROMPT_TEMPLATE.replace('{today}', today).replace('{userProfile}', userProfileBlock)
          + (cardCtx ? '' : `\n\n${CURRENT_FIND_CHAT_CONTRACT}`);

        // Presentation hint from the asking surface (src/lib/chat/display-hint.ts): answer prompt only.
        const displayNote = displayHintNote(parseDisplayHint(body.display));
        const messages: Array<{ role: string; content: string }> = [
          { role: 'system', content: displayNote ? `${systemPrompt}\n\n${displayNote}` : systemPrompt },
        ];
        // Card chat: the selected opportunity, loaded from our record, as a labeled source block.
        const cardContext = cardRecord
          ? buildOpportunityContextBlock(cardRecord, splitViewPreamble(message).rest || message, noticeFacts ? formatSelectedNoticeFacts(noticeFacts) : [], noticeOrigin)
          : null;
        if (cardContext) messages.push({ role: 'system', content: cardContext.block });
        // Category caveat grounded by the work the customer named in THIS message (janitorial → AbilityOne).
        const customerWords = splitViewPreamble(message).rest || message;
        const categoryNote = abilityOneCaveat(customerWords, interpretCapabilityNaics(customerWords).codes);
        if (categoryNote) messages.push({ role: 'system', content: categoryNote });

        // Trim history to last HISTORY_LIMIT messages for prompt-size budget.
        const history = Array.isArray(body.history) ? body.history.slice(-HISTORY_LIMIT) : [];
        for (const h of history) {
          if (h.role === 'user' || h.role === 'assistant') {
            messages.push({ role: h.role, content: String(h.content || '').slice(0, 2000) });
          }
        }

        // No RAG context to append anymore — the user's message goes straight in; the Data Core
        // tools (offered below) do the grounding.
        const userTurn = message;
        // messages is heterogeneous once tools enter (assistant tool_calls +
        // role:'tool' results), so type it loosely for the tool round.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const userTurnIdx = (messages as any[]).push({ role: 'user', content: userTurn }) - 1;
        // B2: full tool results by tool_call_id, so the token-budget step re-bounds from the originals.
        const toolOriginals = new Map<string, string>();
        // F1: the find_opportunities summary, so a CURRENT_FIND answer always covers all three horizons.
        let findResult: FindResultWithItems | null = null;

        // ── TOOL-ROUND message list — the CLEAN question, NO RAG context ──
        // (Andre @ CypherIntel 2026-07-30) The RAG teaching corpus was stapled onto
        // the user turn ABOVE, so the tool-decision model saw a wall of relevant-looking
        // doc chunks and answered from THEM — skipping the live opportunity tools entirely
        // ("keep an eye on SAM.gov"). For "what opportunities are available…" the teaching
        // context is not just useless, it SABOTAGES the search. Fix: the tool round decides
        // whether to call a tool from the RAW question only; the RAG context still rides on
        // the FINAL streamed answer (so "how do I write a cap statement" keeps its teaching
        // corpus). Verified: AJ's exact prompt now fires get_agency_forecasts + labels
        // forecast-vs-open, instead of a RAG essay telling him to check SAM himself.
        // P1-F: the same customer words always map to the same NAICS (deterministic lexicon), so
        // the planner does not re-guess codes on every turn.
        // One request-level timestamp; the compiled intent is the source of truth for scope.
        const requestNow = new Date();
        const intent = compileIntent(message, requestNow, [...history.filter((h) => h.role === 'user').map((h) => String(h.content || '')), message].join('\n'));
        const scopeApplied = new Set<string>();
        const scopeUnapplied = new Set<string>();
        let scopeInferred: string | null = null;
        // The map's view preamble is not the customer's words: "the user typed NAICS …" must not cite it.
        const capabilityNote = capabilityPlannerNote(splitViewPreamble(message).rest);
        const capabilityPhrases = interpretCapabilityNaics(message).items.flatMap((it) => [it.phrase, it.label]);
        const capabilityLabels = interpretCapabilityNaics(message).items.map((it) => it.label);
        // What the customer has said in this conversation (for the stated-filters guard).
        const conversationText = [...history.filter((h) => h.role === 'user').map((h) => String(h.content || '')), message].join('\n');
        const toolRoundMessages: Array<{ role: string; content: string }> = [
          { role: 'system', content: capabilityNote ? `${systemPrompt}\n\n${capabilityNote}` : systemPrompt },
        ];
        if (cardContext) toolRoundMessages.push({ role: 'system', content: cardContext.block });
        for (const h of history) {
          if (h.role === 'user' || h.role === 'assistant') {
            toolRoundMessages.push({ role: h.role, content: String(h.content || '').slice(0, 2000) });
          }
        }
        toolRoundMessages.push({ role: 'user', content: message });

        // Preview-only per-request model configuration (staging acceptance); null on production by construction.
        const staging = stagingModelConfig(request.headers.get(STAGING_CONFIG_HEADER), TRACE_EVENTS);
        const overBudgetEarly = staging?.config.overBudget ?? await isUserOverBudget(email).catch(() => false);
        const modelEnv: Record<string, string | undefined> = staging ? { ...process.env, ...staging.config.env } : process.env;
        const chatModelEarly = overBudgetEarly
          ? (modelEnv.LLM_OPENAI_MODEL || 'gpt-4o-mini')
          : (modelEnv.CHAT_OPENAI_MODEL || 'gpt-4o');

        // ── Mindy Chat v2: Data Core tool round (PRD-mindy-chat-data-core §5a) ──
        // ONE non-streamed pre-flight call offering the Data Core tools:
        //   Tier 0 (PRIVATE) — the user's OWN pipeline/Vault, email bound from the
        //     SESSION (never a tool arg — model cannot reach another user).
        //   Tier 1 (SHARED)  — public federal data: live SAM opps + NAICS market
        //     vocabulary (no per-user scoping).
        // If the model calls one, we execute it and append the result so the
        // streaming block below produces a grounded final answer. If no tool is
        // called, messages is untouched.
        // 2026-11-13 safety release: tools are offered and executed ONLY through the chat
        // tool executor (src/lib/chat/chat-tool-executor.ts); the planner is chosen by
        // resolvePlannerChain (gpt-4o default, no untested fallbacks); failures are recorded.
        let toolProvider = ''; let toolModel = '';
        let toolUsageForCost: { prompt_tokens?: number; completion_tokens?: number } | null = null;
        // Per-turn trace (persisted on the assistant message). Ids, names and statuses only:
        // never tool arguments or result bodies.
        const turnTrace: {
          planner: { provider: string; model: string } | null;
          planner_attempts: Array<{ provider: string; model: string; ok: boolean; status: number | null }>;
          tools_offered: number;
          tool_executions: ChatExecutionRecord[];
          answer: { provider: string; model: string; finish_reason: string | null; fallback: boolean } | null;
          /** Failed answer attempts: status + provider error code only (never the provider's message). */
          answer_attempts: Array<{ provider: string; model: string; status: number | null; code: string | null }>;
          notices: string[];
          context?: { kind: 'opportunity'; notice_id: string };
        } = { planner: null, planner_attempts: [], tools_offered: 0, tool_executions: [], answer: null, answer_attempts: [], notices: [],
              ...(selectedCtx ? { context: { kind: 'opportunity' as const, notice_id: selectedCtx.noticeId } } : {}) };
        if (selectedNoticeMiss) turnTrace.notices.push(`selected_notice:${selectedNoticeMiss}`);
        if (mentionedNotice && mentionedNotice.status !== 'none') turnTrace.notices.push(`mentioned_notice:${mentionedNotice.status}`);
        if (noticeFacts) turnTrace.notices.push(`selected_notice_incumbent:${noticeFacts.incumbent.finding}`);
        if (capabilityNote) turnTrace.notices.push('capability_interpreted');
        if (staging) turnTrace.notices.push(`staging_model_config:${staging.name}`);
        const notify = (code: string, text: string) => {
          turnTrace.notices.push(code);
          send({ type: 'notice', code, message: text });
        };
        // Usage is recorded once per step, including on paths the watchdog cut short (review LOW-2).
        let plannerUsageRecorded = false;
        const recordPlannerUsage = () => {
          if (plannerUsageRecorded || !toolProvider) return;
          plannerUsageRecorded = true;
          void recordLlmUsage({ userEmail: auth.email, tool: 'chat_tool_round', provider: toolProvider, model: toolModel, usage: toolUsageForCost || undefined });
        };
        let plannerUnavailable = false;
        // Index of an assistant tool_calls turn whose results have not all been appended yet.
        let pendingToolTurnIdx: number | null = null;
        const renderedRecords: RenderedRecords[] = [];
        // Option B: true while every tool result this turn was shown as a verified list.
        let allResultsRendered = true;
        try {
          if (actingScope.kind === 'client') turnTrace.notices.push('acting_scope:client_workspace');
          if (actingScope.kind === 'unavailable') turnTrace.notices.push('acting_scope:unavailable');
          const tier0Runtime = makeTier0Tools(getSupabase(), actingScope);
          const executor = createChatToolExecutor({
            userEmail: auth.email!,
            ...(actingScope.kind === 'client' ? { vaultEmail: actingScope.vaultEmail } : {}),
            ...(actingScope.kind === 'unavailable' ? { privateScopeUnavailable: true } : {}),
            chatSessionId: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId) ? sessionId : null,
            tier0: { defs: TIER0_TOOL_DEFS, names: TIER0_TOOL_NAMES, execute: (n, a) => tier0Runtime.execute(n, a) },
            // Card chat offers only its opportunity tools (narrowing; the policy still applies).
            ...(cardCtx ? { allowedToolNames: CARD_CHAT_TOOLS } : {}),
            toolTimeoutMs: (n) => toolTimeoutMs(n, deadlines),
          });
          // Offered tools are filtered by the chat tool policy (blocked tools are never shown).
          // B2: an open-opportunity question is not offered the expiring-contracts tool (it returns
          // awarded contracts, not open solicitations). See src/lib/chat/tool-selection.ts.
          // F1: classified on the CUSTOMER's words (the map view preamble is not theirs). A CURRENT_FIND question
          // is not offered the open-only search_sam_opportunities when find_opportunities is offered.
          const priorCustomerText = [...history].reverse().find((h) => h.role === 'user')?.content;
          const toolOffer = filterToolsForTurn(executor.offeredToolDefs(), splitViewPreamble(message).rest, priorCustomerText ? splitViewPreamble(String(priorCustomerText)).rest : null);
          // Industry codes the CUSTOMER typed (a planner-chosen code is not passed to find_opportunities).
          const customerTypedCodes = interpretCapabilityNaics(splitViewPreamble(message).rest).typedCodes;
          const ALL_TOOL_DEFS = toolOffer.defs;
          const notOfferedThisTurn = new Set(toolOffer.removed);
          for (const n of toolOffer.removed) turnTrace.notices.push(`tool_not_offered:${n}:${n === SAM_ONLY_TOOL ? 'current_find_uses_three_horizons' : 'open_opportunity_question'}`);
          turnTrace.tools_offered = ALL_TOOL_DEFS.length;

          // OpenAI {type:'function',function:{name,description,parameters}} →
          // Anthropic {name,description,input_schema}. Only used when Claude is enabled.
          const anthropicTools = ALL_TOOL_DEFS.map((d) => {
            const fn = (d.function || {}) as { name?: string; description?: string; parameters?: unknown };
            return { name: fn.name, description: fn.description, input_schema: fn.parameters };
          });
          // Translate an Anthropic response → OpenAI choices[0].message so the consumer
          // downstream is provider-agnostic.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const anthropicToOpenAiChoice = (j: any) => {
            const blocks = Array.isArray(j?.content) ? j.content : [];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const textBlock = blocks.find((b: any) => b?.type === 'text');
            const calls = blocks
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              .filter((b: any) => b?.type === 'tool_use')
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              .map((b: any) => ({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } }));
            return {
              choices: [{ message: { content: textBlock?.text ?? null, tool_calls: calls.length ? calls : undefined } }],
              usage: j?.usage ? { prompt_tokens: j.usage.input_tokens, completion_tokens: j.usage.output_tokens } : undefined,
            };
          };

          // One planner attempt. Returns the OpenAI-shaped JSON, or the failure details.
          const callPlanner = async (t: PlannerTarget): Promise<{ ok: true; json: unknown } | { ok: false; status: number | null; detail: string }> => {
            // B2: whole-request budget for the planner (instructions + history + question + tool
            // catalog + output headroom). Oldest history goes first; a request that still cannot
            // fit is never sent.
            const plannerKinds: MsgKind[] = toolRoundMessages.map((m, i) => (i === toolRoundMessages.length - 1 ? 'user' : m.role === 'system' ? 'system' : 'history'));
            const plannerFit = fitMessages(toolRoundMessages, plannerKinds, { budget: inputBudget(t.model, TOOL_ROUND_MAX_TOKENS), tools: ALL_TOOL_DEFS });
            if (plannerFit.droppedHistory) turnTrace.notices.push(`planner_history_dropped:${plannerFit.droppedHistory}`);
            if (!plannerFit.fits) return { ok: false, status: null, detail: `request_too_large: est ${plannerFit.estimate} > budget ${plannerFit.budget} tokens` };
            const plannerMessages = plannerFit.messages;
            try {
              if (t.provider === 'anthropic') {
                const sys = plannerMessages.find((m) => m.role === 'system')?.content || '';
                const convo = plannerMessages
                  .filter((m) => m.role === 'user' || m.role === 'assistant')
                  .map((m) => ({ role: m.role, content: m.content }));
                const forced = OPP_INTENT && anthropicSupportsForcedToolChoice(t.model);
                const cbody: Record<string, unknown> = {
                  model: t.model, max_tokens: TOOL_ROUND_MAX_TOKENS, system: sys,
                  messages: convo, tools: anthropicTools, tool_choice: forced ? { type: 'any' } : { type: 'auto' },
                };
                if (/haiku-4-5|sonnet-4-|opus-4-[0-5]|claude-3/i.test(t.model)) cbody.temperature = 0;
                const cr = await fetch('https://api.anthropic.com/v1/messages', {
                  method: 'POST', signal: AbortSignal.timeout(deadlines.plannerMs),
                  headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
                  body: JSON.stringify(cbody),
                });
                if (cr.ok) return { ok: true, json: anthropicToOpenAiChoice(await cr.json()) };
                return { ok: false, status: cr.status, detail: (await cr.text().catch(() => '')).slice(0, 300) };
              }
              const r = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST', signal: AbortSignal.timeout(deadlines.plannerMs), headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  model: t.model, messages: plannerMessages, ...openAiChatParams(t.model, { temperature: 0, maxTokens: TOOL_ROUND_MAX_TOKENS }),
                  // OPP_INTENT (Andre fix) → 'required' so an opportunity search can't decline the tool.
                  tools: ALL_TOOL_DEFS, tool_choice: OPP_INTENT ? 'required' : 'auto',
                }),
              });
              if (r.ok) return { ok: true, json: await r.json() };
              return { ok: false, status: r.status, detail: (await r.text().catch(() => '')).slice(0, 300) };
            } catch (e) {
              return { ok: false, status: null, detail: String((e as Error)?.message || e) };
            }
          };

          // Explicit planner chain (gpt-4o default; Claude only behind CHAT_CLAUDE_ENABLED;
          // fallbacks only to compatibility-tested planners). Every failure is recorded.
          const resolved = resolvePlannerChain(modelEnv, { overBudget: overBudgetEarly });
          const chain = resolved.filter((t) => providerApprovedForPrivate(t.provider));
          for (const t of resolved) {
            if (!chain.includes(t)) {
              void recordProviderEvent({ kind: 'planner_unavailable', provider: t.provider, model: t.model, detail: 'provider not on the approved list for private data (SENSITIVE_LLM_PROVIDERS)', userEmail: auth.email! });
            }
          }
          let first: { provider: string; model: string; json: unknown } | null = null;
          for (let i = 0; i < chain.length; i++) {
            const t = chain[i];
            const r = await callPlanner(t);
            turnTrace.planner_attempts.push({ provider: t.provider, model: t.model, ok: r.ok, status: r.ok ? null : r.status });
            if (r.ok) { first = { provider: t.provider, model: t.model, json: r.json }; break; }
            const next = chain[i + 1];
            void recordProviderEvent({
              kind: next ? 'planner_fallback' : 'planner_failure',
              provider: t.provider, model: t.model, status: r.status, detail: r.detail,
              userEmail: auth.email!, next: next ? plannerKey(next) : undefined,
            });
          }
          if (!chain.length) {
            void recordProviderEvent({ kind: 'planner_unavailable', provider: 'none', model: 'none', detail: 'no planner configured (missing provider key)', userEmail: auth.email! });
          }

          if (!first) {
            plannerUnavailable = true;
          } else {
            turnTrace.planner = { provider: first.provider, model: first.model };
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const choice = (first.json as any)?.choices?.[0]?.message;
            const plannedCalls = (choice?.tool_calls ?? []) as Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
            // A planner that calls a tool it was not offered this turn is not obeyed (B2).
            const rawCalls = (Array.isArray(plannedCalls) ? plannedCalls : []).filter((tc) => {
              const n = String(tc.function?.name || '');
              if (!notOfferedThisTurn.has(n)) return true;
              turnTrace.notices.push(`unoffered_tool_call_dropped:${n}`);
              return false;
            });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const u = (first.json as any)?.usage;
            toolProvider = first.provider; toolModel = first.model;
            if (u) toolUsageForCost = { prompt_tokens: u.prompt_tokens, completion_tokens: u.completion_tokens };
            if (Array.isArray(rawCalls) && rawCalls.length > 0) {
              // Every call gets a stable id so each result pairs with its call.
              const displayOffsets = new Map<string, number>();
              const scopeNotesByCall = new Map<string, { applied: string[]; unapplied: string[] }>();
              const toolCalls = rawCalls.map((tc, i) => {
                const id = tc.id || `call_${i}`;
                const prepared = prepareChatToolArgs(String(tc.function?.name || ''), String(tc.function?.arguments ?? ''));
                if (prepared.displayOffset) displayOffsets.set(id, prepared.displayOffset);
                // Phase A: constraints the customer stated are enforced on the model's arguments.
                const enforced = enforceIntent(String(tc.function?.name || ''), prepared.args, intent);
                for (const n of enforced.applied) turnTrace.notices.push(`intent_applied:${tc.function?.name}:${n}`);
                for (const n of enforced.unapplied) turnTrace.notices.push(`intent_unapplied:${tc.function?.name}:${n}`);
                // Customer-facing notes are kept per call and shown only for calls that run (a skipped
                // duplicate's notes would describe a search the customer never sees).
                scopeNotesByCall.set(id, enforced);
                // Stated filters only: drop a state the conversation never implied (deterministic).
                const guardedStates = guardUnstatedStates(enforced.args, conversationText);
                // ...and a city the conversation never named (2026-11-15: a map-view turn ran on city=Birmingham).
                const guardedCities = guardUnstatedCities(guardedStates.args, conversationText);
                // F1: a find_opportunities call on a CURRENT_FIND turn keeps all three horizons unless the customer limited it.
                const findArgs = enforceFindArgs(String(tc.function?.name || ''), guardedCities.args, toolOffer.intent, toolOffer.openOnly, customerTypedCodes);
                for (const c of findArgs.changes) turnTrace.notices.push(`find_args_enforced:${c}`);
                const guarded = { args: findArgs.args, removed: [...guardedStates.removed, ...guardedCities.removed] };
                for (const r of guarded.removed) turnTrace.notices.push(`unstated_filter_removed:${tc.function?.name}:${r}`);
                return { ...tc, id, type: 'function' as const, function: { ...tc.function, arguments: guarded.args } };
              });
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              pendingToolTurnIdx = (messages as any[]).push({ role: 'assistant', content: choice.content ?? null, tool_calls: toolCalls }) - 1;
              const withPage = (raw: string, page: number) => { try { return JSON.stringify({ ...JSON.parse(raw || '{}'), __page: page }); } catch { return `${raw}|${page}`; } };
              // The same search planned twice (identical after enforcement, or a code subset of another
              // call) runs and renders once; the duplicate gets a pointer so every call has a result.
              const dedupe = dedupeToolCalls(toolCalls.map((tc) => ({ id: tc.id, name: String(tc.function?.name || ''), args: withPage(String(tc.function.arguments ?? ''), displayOffsets.get(tc.id) ?? 0) })));
              const keepIds = new Set(dedupe.keep.map((k) => k.id));
              for (const d of dedupe.duplicates) turnTrace.notices.push(`duplicate_call_skipped:${d.id}:same_as:${d.of}`);
              for (const id of keepIds) {
                const notes = scopeNotesByCall.get(id);
                for (const n of notes?.applied ?? []) scopeApplied.add(n);
                for (const n of notes?.unapplied ?? []) scopeUnapplied.add(n);
              }
              // A7 (review LOW-1): a planner that answered after the watchdog fired runs nothing — the customer
              // has already seen "took too long". Each call re-checks too (isCancelled), so a write never starts late.
              if (turnTimedOut) { recordPlannerUsage(); return; }
              const results = await executor.executeRound(toolCalls.filter((tc) => keepIds.has(tc.id)), { provider: first.provider, model: first.model }, { deadlineAt: Date.now() + deadlines.toolRoundBudgetMs, isCancelled: () => turnTimedOut });
              // B2: the model sees a BOUNDED copy of each result (structural shortening with a
              // shown-of-total report); the renderers below still read the full r.content.
              const perResultCap = perResultBudget(results.length);
              for (const tc of toolCalls) {
                const r = results.find((x) => x.tool_call_id === tc.id);
                const dup = dedupe.duplicates.find((d) => d.id === tc.id);
                if (r) {
                  toolOriginals.set(r.tool_call_id, r.content);
                  if (r.record.tool === 'find_opportunities' && r.record.status === 'success') {
                    try { const p = JSON.parse(r.content) as FindResultWithItems; if (p && typeof p === 'object') findResult = p; } catch { /* unparseable: no footer */ }
                  }
                  const bounded = boundToolResult(r.content, perResultCap);
                  if (bounded.truncated) turnTrace.notices.push(`tool_result_bounded:${r.record.tool}:${bounded.originalChars}->${bounded.content.length}`);
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  (messages as any[]).push({ role: 'tool', tool_call_id: r.tool_call_id, content: bounded.content });
                }
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                else if (dup) (messages as any[]).push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ duplicate_of: dup.of, note: 'Same search as another call in this turn; its results are shown once.' }) });
              }
              pendingToolTurnIdx = null;
              turnTrace.tool_executions = results.map((r) => r.record);
              // Ported release-hardening R6/R10: disclose codes Mindy chose, from what each strict-filter tool
              // reports it APPLIED (src/lib/chat/code-disclosure.ts).
              scopeInferred = inferredCodeDisclosure(
                results.map((r) => ({ name: r.record.tool, status: r.record.status, content: r.content })),
                // Not "chosen by Mindy": codes the customer typed, and codes the map's industry filter supplied.
                [...interpretCapabilityNaics(intent.customerText.split('\n').map((l) => splitViewPreamble(l).rest).join('\n')).typedCodes,
                  ...(intent.capabilitySource === 'map_filter' ? intent.capabilityCodes : [])],
                (c) => getNaics(c)?.title ?? null,
              );
              if (scopeInferred) turnTrace.notices.push('inferred_codes_disclosed');
              // PR E: verified record lists are rendered from the tool data, not reproduced by the model.
              for (const r of results) {
                const renderers: Record<string, (p: Record<string, unknown>) => RenderedRecords | null> = {
                  [EXPIRING_TOOL]: (p) => renderExpiringRecords(p, { offset: displayOffsets.get(r.tool_call_id) ?? 0, relevancePhrases: capabilityPhrases, requestedLabels: capabilityLabels }),
                  [PAST_CONTRACTS_TOOL]: renderStatusChecks,
                  [BUYING_OFFICES_TOOL]: renderBuyingOffices,
                  [PRICING_TOOL]: renderPricing,
                  [KEYWORDS_TOOL]: renderKeywords,
                  [VEHICLE_MIX_TOOL]: renderVehicleMix,
                  [SBLO_TOOL]: renderSbloContact,
                };
                const renderer = renderers[r.record.tool];
                if (r.record.status !== 'success' || !renderer) { allResultsRendered = false; continue; }
                try {
                  const parsed = JSON.parse(r.content);
                  const rendered = renderer(parsed);
                  if (rendered) renderedRecords.push(rendered);
                  else allResultsRendered = false;
                } catch (renderErr) {
                  allResultsRendered = false;
                  console.error('[chat] record render failed:', renderErr);
                }
              }
              crossCheckOffices(renderedRecords);
              if (TRACE_EVENTS) {
                send({
                  type: 'trace',
                  planner: turnTrace.planner,
                  tools: results.map((r) => ({
                    ...r.record,
                    args: r.argsRedacted,
                    result_excerpt: r.content.slice(0, TRACE_RESULT_CHARS),
                    result_chars: r.content.length,
                  })),
                });
              }
              // A6: every non-success status is announced, not only `failed` (refusals, round budget, timeouts).
              const incomplete = incompleteToolNotice(results.map((r) => r.record));
              if (incomplete) notify(incomplete.code, incomplete.message);
            }
          }
        } catch (toolErr) {
          console.error('[chat] tool round failed:', toolErr);
          plannerUnavailable = true;
          // Never leave an assistant tool_calls turn without its results: the answer call
          // would be rejected. Drop the half-built turn instead.
          if (pendingToolTurnIdx !== null) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (messages as any[]).splice(pendingToolTurnIdx);
            pendingToolTurnIdx = null;
          }
          void recordProviderEvent({ kind: 'planner_failure', provider: 'internal', model: 'tool_round', detail: String((toolErr as Error)?.message || toolErr), userEmail: auth.email! });
        }
        if (plannerUnavailable) {
          notify('tools_unavailable', "Mindy's data tools did not respond for this question, so this answer has no live data behind it. Please try again.");
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (messages as any[]).push({
            role: 'system',
            content: 'NOTE: The live data tools were unavailable for this turn. Do not state any specific contract, award, dollar amount, date, company, agency, contact or count. Tell the user the data lookup failed and suggest trying again.',
          });
        }
        // Log the tool-round LLM spend separately (fire-and-forget).
        recordPlannerUsage();
        // A7 (review LOW-1): no answer request after the watchdog ended the turn.
        if (turnTimedOut) return;
        // ── end Tier-0 tool round ──
        if (renderedRecords.length) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (messages as any[]).push({
            role: 'system',
            content:
              'VERIFIED RECORD LIST: the records below were rendered from the tool data and have ALREADY been shown to the user verbatim, directly above your reply. '
              + 'Do NOT list, repeat or renumber the records, and do not restate identifiers, dates or amounts that are not in this list. '
              + 'WHAT EACH LIST IS: a buying-offices list is federal government offices that buy this work (prospective customers, never partners or competitors); an expiring or past-award list is contracts with the incumbent companies holding them; a keyword list is search terms; a rate list is GSA schedule ceiling rates; a vehicle list is spending by contract vehicle; a contact list is the people the record names, with its own label of whether they are a designated small business liaison. '
              + 'Write 1 to 3 short sentences of NEXT-STEP guidance only: what the customer should look at or do next with these records (for example review the CHECK lines, open a solicitation, check SAM.gov for awards newer than the data, ask for the next page). '
              + 'Do not state any number, date, dollar amount, name, ranking, superlative, trend or characterization, and do not restate or summarize the records: the list carries every fact and warning, and sentences that add facts are removed before display.\n\n'
              + renderedRecords.map((r) => r.text).join('\n\n'),
          });
        }

        // Mindy Chat is the FLAGSHIP user-facing experience — every answer is read,
        // so grounded-Q&A quality is worth the model spend here (Eric, Jul 2: "the
        // mindy chat needs help"). Lead with full gpt-4o (not mini), Groq as fallback.
        // Claude still isn't the default ($149/mo scalability), but chat is exactly
        // the surface where the quality jump shows. Override via CHAT_OPENAI_MODEL if
        // we ever need to dial it back per-env. Both speak the OpenAI streaming
        // format, so the SSE parser below is unchanged and we keep streaming UX.
        // Margin guard (#37, mirrors proposal/chat): a user past their monthly LLM
        // budget is downgraded from gpt-4o to gpt-4o-mini — never blocked, just a
        // cheaper model. Protects the $149 margin now that chat leads with gpt-4o.
        // (Resolved once above for the tool round; reuse to avoid a second budget read.)
        const chatModel = chatModelEarly;
        const streamFrom = (url: string, key: string, model: string, msgs: unknown[], signal: AbortSignal) => fetch(url, {
          method: 'POST', signal,
          headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
          // stream_options.include_usage → OpenAI/Groq emit a final usage-only
          // chunk after the deltas. Without it, a streaming call returns NO usage
          // object, so cost attribution (esp. gpt-4o Chat) would log $0. The extra
          // frame is usage-only (empty choices) and the SSE parser already tolerates it.
          body: JSON.stringify({ model, messages: msgs, ...openAiChatParams(model, { temperature: TEMPERATURE, maxTokens: MAX_TOKENS }), stream: true, stream_options: { include_usage: true } }),
        });

        // B2: explicit answer chain (primary, then supported fallbacks), each provider checked
        // against the private-data approved list. Provider error text goes to recordProviderEvent
        // only; the customer sees a fixed message from customer-errors.ts.
        const answerChain = resolveAnswerChain(modelEnv, { primaryModel: staging?.config.answerPrimary ?? chatModel })
          .filter((t) => {
            if (providerApprovedForPrivate(t.provider)) return true;
            void recordProviderEvent({ kind: 'answer_failure', provider: t.provider, model: t.model, detail: 'answer model skipped: provider not on the approved list for private data', userEmail: auth.email! });
            return false;
          });
        let groqRes: Response | null = null;
        // Track which provider/model actually served the response for cost attribution.
        let usedProvider = '';
        let usedModel = '';
        let answerFallback = false;
        // B2: whole-request token budget for the answer call (see token-budget.ts).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const answerKinds: MsgKind[] = (messages as any[]).map((m, i) => {
          if (m.role === 'tool') return 'tool';
          if (m.tool_calls) return 'tool_call';
          if (m.role === 'system') return String(m.content || '').startsWith('VERIFIED RECORD LIST') ? 'records' : i < userTurnIdx ? 'system' : 'note';
          return i < userTurnIdx ? 'history' : 'user';
        });
        let answerTooLarge = false;
        for (let i = 0; i < answerChain.length && !groqRes; i++) {
          const t = answerChain[i];
          let r: Response | null = null;
          let detail = '';
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const fit = fitMessages(messages as any[], answerKinds, { budget: inputBudget(t.model, MAX_TOKENS), toolOriginals });
          if (fit.droppedHistory) turnTrace.notices.push(`answer_history_dropped:${fit.droppedHistory}`);
          if (fit.toolCapChars) turnTrace.notices.push(`answer_tools_rebounded:${fit.toolCapChars}`);
          if (fit.recordsShortened) turnTrace.notices.push('answer_records_copy_shortened');
          if (!fit.fits) {
            answerTooLarge = true;
            turnTrace.answer_attempts.push({ provider: t.provider, model: t.model, status: null, code: 'request_too_large_not_sent' });
            void recordProviderEvent({ kind: answerChain[i + 1] ? 'answer_fallback' : 'answer_failure', provider: t.provider, model: t.model, status: null, detail: `request_too_large: est ${fit.estimate} > budget ${fit.budget} tokens (not sent)`, userEmail: auth.email! });
            continue;
          }
          // A7: the connect wait is bounded (then the next model is tried); the same controller lets the
          // watchdog stop a stream that is already flowing.
          const ctrl = new AbortController();
          answerAbort = ctrl;
          const connectTimer = setTimeout(() => ctrl.abort(new ChatTimeoutError('answer_connect', deadlines.answerConnectMs)), deadlines.answerConnectMs);
          try {
            r = await streamFrom(ANSWER_ENDPOINTS[t.provider], answerKey(modelEnv, t) || '', t.model, fit.messages, ctrl.signal);
          } catch (e) {
            detail = String((e as Error)?.message || e).slice(0, 300);
          } finally {
            clearTimeout(connectTimer);
          }
          if (turnTimedOut) break;
          if (r && r.ok && r.body) {
            groqRes = r; usedProvider = t.provider; usedModel = t.model; answerFallback = i > 0;
            break;
          }
          if (r) detail = (await withTimeout(r.text(), 5_000, 'answer_error_body').catch(() => '')).slice(0, 300);
          turnTrace.answer_attempts.push({ provider: t.provider, model: t.model, status: r ? r.status : null, code: providerErrorCode(detail, r) });
          const next = answerChain[i + 1];
          void recordProviderEvent({
            kind: next ? 'answer_fallback' : 'answer_failure',
            provider: t.provider, model: t.model, status: r ? r.status : null, detail,
            userEmail: auth.email!, next: next ? `${next.provider}:${next.model}` : undefined,
          });
        }
        if (!answerChain.length) {
          void recordProviderEvent({ kind: 'answer_failure', provider: 'none', model: 'none', detail: 'no answer model configured (missing provider key)', userEmail: auth.email! });
        }
        if (!groqRes || !groqRes.body) {
          const kind = answerTooLarge ? 'request_too_large' : 'answer_unavailable';
          turnTrace.notices.push(kind);
          if (TRACE_EVENTS) {
            // Preview-only: which answer models failed and how (status + provider error code), so a staging
            // run can diagnose a failed turn. The customer-facing message below stays the fixed text.
            send({
              type: 'trace_usage',
              planner: toolProvider ? { provider: toolProvider, model: toolModel, usage: toolUsageForCost } : null,
              answer: null,
              answer_attempts: turnTrace.answer_attempts,
              notices: turnTrace.notices,
            });
          }
          send({ type: 'error', code: kind, message: customerErrorMessage(kind) });
          send({ type: 'done' });
          closeStream();
          return;
        }

        let assistantContent = '';
        if (renderedRecords.length) {
          // Scope the MAP supplied is labeled as the map's, never as "from your request" (2026-11-15 review).
          const fromRequest = [...scopeApplied].filter((n) => !isMapScopeNote(n));
          const fromMap = [...scopeApplied].filter((n) => isMapScopeNote(n));
          const scopeLines = [
            fromRequest.length ? `From your request: ${fromRequest.join('; ')}.` : '',
            ...fromMap.map((n) => `${n.charAt(0).toUpperCase()}${n.slice(1)}.`),
            scopeInferred ? `${scopeInferred}.` : '',
            scopeUnapplied.size ? `Could not apply: ${[...scopeUnapplied].join('; ')}. The results below do not reflect ${scopeUnapplied.size === 1 ? 'it' : 'them'}.` : '',
          ].filter(Boolean).join('\n');
          const recordBlock = `${scopeLines ? `${scopeLines}\n\n` : ''}${renderedRecords.map((r) => r.text).join('\n\n')}\n\n`;
          assistantContent = recordBlock;
          send({ type: 'token', content: recordBlock });
          turnTrace.notices.push('records_rendered');
        }
        const modelTextStart = assistantContent.length;
        let tokensUsed: number | null = null;
        // Full usage object (prompt/completion split) for cost attribution.
        let usageForCost: { prompt_tokens?: number; completion_tokens?: number } | null = null;
        let answerUsageRecorded = false;
        const recordAnswerUsage = () => {
          if (answerUsageRecorded) return;
          answerUsageRecorded = true;
          void recordLlmUsage({ userEmail: auth.email, tool: 'chat', provider: usedProvider, model: usedModel, usage: usageForCost || undefined });
        };
        const reader = groqRes.body.getReader();
        answerReader = reader;
        const decoder = new TextDecoder();
        let leftover = '';
        let finishReason: string | null = null;

        while (true) {
          // Nobody is reading: stop the provider stream instead of generating unread tokens.
          if (clientGone) { streamCut = true; await reader.cancel().catch(() => {}); break; }
          if (turnTimedOut) { await reader.cancel().catch(() => {}); break; }
          // A7: a provider that stops sending mid-answer is cut after answerIdleMs, never awaited forever.
          let read: ReadableStreamReadResult<Uint8Array> | 'timeout';
          try {
            read = await readWithIdleTimeout(reader, deadlines.answerIdleMs);
          } catch (readErr) {
            if (turnTimedOut) break; // the watchdog aborted the stream; it already ended the turn
            throw readErr;
          }
          if (read === 'timeout') {
            answerStalled = true;
            void reader.cancel().catch(() => {});
            try { answerAbort?.abort(new ChatTimeoutError('answer_idle', deadlines.answerIdleMs)); } catch { /* done */ }
            break;
          }
          const { done, value } = read;
          if (done) break;
          const chunkStr = leftover + decoder.decode(value, { stream: true });
          const lines = chunkStr.split('\n');
          leftover = lines.pop() || '';

          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (payload === '[DONE]') continue;
            try {
              const parsed = JSON.parse(payload);
              const delta = parsed?.choices?.[0]?.delta?.content;
              const fr = parsed?.choices?.[0]?.finish_reason;
              if (typeof fr === 'string' && fr) finishReason = fr;
              if (typeof delta === 'string' && delta.length > 0) {
                assistantContent += delta;
                // With a verified list on screen, the analysis is checked before it is shown (see below).
                if (!renderedRecords.length) send({ type: 'token', content: delta });
              }
              if (parsed?.usage?.total_tokens) {
                tokensUsed = parsed.usage.total_tokens;
              }
              if (parsed?.usage && (parsed.usage.prompt_tokens || parsed.usage.completion_tokens)) {
                usageForCost = {
                  prompt_tokens: parsed.usage.prompt_tokens,
                  completion_tokens: parsed.usage.completion_tokens,
                };
              }
            } catch {
              // Ignore unparseable lines — Groq occasionally sends keep-alives
            }
          }
        }

        if (answerStalled) {
          turnTrace.notices.push('answer_stalled');
          if (!assistantContent.trim()) {
            // Nothing was shown: an error, not a blank bubble.
            send({ type: 'error', code: 'answer_unavailable', message: customerErrorMessage('answer_unavailable') });
            send({ type: 'done' });
            closeStream();
            return;
          }
          notify('answer_incomplete', 'Mindy stopped responding partway through this answer, so it is incomplete. Please try again.');
        }
        if (turnTimedOut) { recordAnswerUsage(); return; }

        // Emit citations after the response completes. v2 (May 31): no
        // longer parse inline [→ X] markers from the response — those
        // confused users when the underlying doc had no public URL.
        // Instead we surface the top retrieved sources as clickable
        // chips below the answer. Suppress chips on off-topic redirects
        // (lowercase substring match on the canonical redirect phrase)
        // so we don't attach misleading sources to "I'm focused on
        // federal contracting" responses.
        const lowerResp = assistantContent.toLowerCase();
        const isRedirect = lowerResp.includes("i'm focused on federal contracting") ||
                           lowerResp.includes("i don't have that in my knowledge base");
        // Only show doc citations for KNOWLEDGE answers grounded in the corpus.
        // A tool-driven (live-data) answer or an off-topic redirect gets none —
        // the retrieved chunks weren't its sources, so chips would mislead.
        // No RAG corpus anymore → no teaching/podcast citation chips. Ask Mindy answers from the
        // Data Core tools; those surface their own structured results, not knowledge-base chips.
        if (renderedRecords.length) {
          // Deterministic analysis check: drop unsupported magnitude words and approximated amounts.
          const anyShown = renderedRecords.some((r) => r.shown > 0);
          const anyCheck = renderedRecords.some((r) => r.text.includes('CHECK:'));
          // Option B (rel2 R9): when every result is a verified list, the closing is built from those lists
          // only; the model's closing is not shown (it could refer to things the answer does not show).
          const deterministic = allResultsRendered ? deterministicNextSteps(renderedRecords) : '';
          const linted = deterministic ? { text: deterministic, dropped: [] as string[] } : lintAnalysis(
            assistantContent.slice(modelTextStart),
            anyCheck
              ? 'Review the records marked CHECK above before pursuing them.'
              : anyShown
                ? 'The figures above come directly from the source data for this question.'
                : 'Nothing verified was found for this search; check SAM.gov award notices or the agency\'s announcements for newer information.',
          );
          if (linted.dropped.length) {
            turnTrace.notices.push(`analysis_sentences_dropped:${linted.dropped.length}`);
            console.warn('[chat] analysis sentences dropped:', linted.dropped);
          }
          assistantContent = assistantContent.slice(0, modelTextStart) + linted.text;
          send({ type: 'token', content: linted.text });
          const problems = checkSummaryAgainstRecords(assistantContent.slice(modelTextStart), renderedRecords);
          if (problems.length) {
            const totals = renderedRecords.map((r) => r.total).join(' and ');
            const correction = `\n\nCount check: the verified record count for this search is ${totals}; the list above is authoritative.`;
            assistantContent += correction;
            send({ type: 'token', content: correction });
            turnTrace.notices.push('summary_count_corrected');
            console.warn('[chat] summary contradicted verified records:', problems);
          }
        }
        // F1: any horizon the answer left out is appended from the tool's own summary (status + counts only).
        if (findResult && assistantContent.trim()) {
          // Any horizon the answer did not cover (counts only). Open now rows are never added back (the tool's
          // text match lets noise through, e.g. "Marine Security Guard Residence" cooking services). Coming back
          // DIRECT_MATCH rows (buy-side evidence) ARE added as a table when the answer did not name them.
          // Monitoring only (no rewrite): the answer's own list opened with a not-competed Coming back row.
          if (comingBackListLeadsWithNotCompeted(assistantContent, findResult?.horizons?.coming_back?.items || [])) {
            turnTrace.notices.push('find_coming_back_order_not_competed_first');
          }
          const { text: footer, addedTable } = findCompletionFooter(assistantContent, findResult);
          if (footer) {
            assistantContent += footer;
            send({ type: 'token', content: footer });
            turnTrace.notices.push(addedTable ? 'find_coming_back_table_from_tool' : 'find_horizons_completed_from_summary');
          }
        }
        turnTrace.answer = { provider: usedProvider, model: usedModel, finish_reason: finishReason, fallback: answerFallback };
        if (TRACE_EVENTS) {
          // Verification aid (never on production, see TRACE_EVENTS): token usage per step so a staging run
          // can report real cost, plus the notices that show bounding / budget / fallback decisions.
          send({
            type: 'trace_usage',
            planner: toolProvider ? { provider: toolProvider, model: toolModel, usage: toolUsageForCost } : null,
            answer: { provider: usedProvider, model: usedModel, usage: usageForCost, fallback: answerFallback, finish_reason: finishReason },
            answer_attempts: turnTrace.answer_attempts,
            notices: turnTrace.notices,
          });
        }
        if (finishReason === 'length') {
          turnTrace.notices.push('truncated');
          send({ type: 'truncated', message: 'This answer hit its length limit and was cut off. Ask Mindy to continue, or narrow the question.' });
        }
        // A notice carried over from an EARLIER turn stays as context (so "Email the contracting officer" still
        // works), but the SAM.gov chip is shown only if this answer actually used it. Otherwise every later,
        // unrelated answer was cited to that notice, and the saved copy kept the wrong chip on reload.
        const staleMention = noticeOrigin === 'mentioned' && mentionedNotice?.status === 'resolved'
          && mentionedNotice.notice.fromEarlierTurn && !answerUsesNotice(assistantContent, cardRecord);
        if (staleMention) turnTrace.notices.push('mentioned_notice:chip_dropped_unused');
        const citedSources: CitedSource[] = cardContext && !staleMention
          ? [{ title: cardContext.source.label, url: cardContext.source.url, doc_type: 'sam_notice', source_path: cardRecord ? `sam_notice:${cardRecord.notice_id}` : null, document_id: null }]
          : [];
        send({ type: 'citations', sources: citedSources });

        // Card chat charge: ONCE PER QUESTION. A complete answer is saved with its sources and debited in ONE
        // database transaction (card_chat_complete_turn → mcp_debit_credits), so it is never charged without a
        // copy its owner can recover, and a retry, refresh or reopen replays that copy for free. A failed,
        // empty, degraded or incomplete answer (including one we stopped because the browser left) is marked
        // failed: free, and the same question may be asked again. Pro answers are saved with 0 credits.
        let creditsCharged = 0;
        if (claimToken && turnId && !turnTimedOut) {
          const complete = isBillableTurn({ billable: true, answer: assistantContent, streamError: streamCut || answerStalled, plannerUnavailable, finishReason });
          if (complete) {
            try {
              const c = await completeCardTurn({
                turnId, claimToken, email: auth.email!, answer: assistantContent, citedSources, sessionId,
                credits: cardBillable ? turnCredits : 0,
              });
              turnSettled = true;
              if (c.outcome === 'charged') creditsCharged = c.creditsCharged;
              turnTrace.notices.push(`card_turn:${c.outcome}`);
              if (c.outcome === 'lost_claim' || c.outcome === 'not_found') console.error('[chat] card turn not completed:', c.outcome);
              if (cardBillable) send({ type: 'credits', charged: creditsCharged, balance: c.newBalance, credits_per_answer: turnCredits });
            } catch (completeErr) {
              // Unknown outcome: nothing is reported as charged. `finally` marks the turn failed, which is a
              // no-op if the transaction did commit (a completed turn cannot be failed).
              console.error('[chat] card turn completion failed:', (completeErr as Error)?.message);
              turnTrace.notices.push('card_turn:complete_error');
            }
          } else {
            const reason = streamCut ? 'client_disconnected'
              : answerStalled ? 'answer_stalled'
              : plannerUnavailable ? 'tools_unavailable'
                : !assistantContent.trim() ? 'empty_answer'
                  : `incomplete:${finishReason ?? 'no_finish'}`;
            try {
              await failCardTurn({ turnId, claimToken, reason });
              turnSettled = true;
            } catch (failErr) {
              console.error('[chat] card turn fail-mark failed:', (failErr as Error)?.message);
            }
            turnTrace.notices.push(`card_turn:free:${reason}`);
          }
        }
        turnTrace.notices.push(...(creditsCharged ? [`credits_charged:${creditsCharged}`] : []));
        send({ type: 'done' });
        closeStream();

        // Cost attribution — this route calls the LLM provider directly (bypasses
        // callLLM), so log usage explicitly. Fire-and-forget; never throws.
        recordAnswerUsage();

        // Fire-and-forget persistence (no await — don't block response close)
        const latencyMs = Date.now() - startedAt;
        persistExchange({
          email: auth.email!,
          sessionId,
          userMessage: message,
          assistantMessage: assistantContent,
          citedSources,
          tokensUsed,
          latencyMs,
          trace: turnTrace,
        }).catch(err => console.error('[chat] persist failed:', err));
      } catch (err) {
        console.error('[chat] stream error:', err);
        // B2: never forward the exception text (it can carry provider bodies) to the customer.
        send({ type: 'error', code: 'stream_failed', message: customerErrorMessage('stream_failed') });
        send({ type: 'done' });
        closeStream();
      } finally {
        clearTimeout(watchdog);
        // Any path that did not settle the turn (provider failure, early return, thrown error) leaves it
        // free and re-askable. The update matches only this claim, so it can never undo a completed turn.
        if (claimToken && turnId && !turnSettled) {
          await failCardTurn({ turnId, claimToken, reason: 'turn_error' })
            .catch((e) => console.error('[chat] card turn fail-mark failed:', (e as Error)?.message));
        }
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
