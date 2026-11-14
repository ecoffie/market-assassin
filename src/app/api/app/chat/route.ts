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
import { resolvePlannerChain, plannerKey, anthropicSupportsForcedToolChoice, type PlannerTarget } from '@/lib/chat/planner-config';
import { capabilityPlannerNote } from '@/lib/market/capability-naics';
import { guardUnstatedStates } from '@/lib/chat/stated-filters';
import { prepareChatToolArgs, renderExpiringRecords, renderStatusChecks, renderBuyingOffices, checkSummaryAgainstRecords, EXPIRING_TOOL, PAST_CONTRACTS_TOOL, BUYING_OFFICES_TOOL, type RenderedRecords } from '@/lib/chat/record-render';
import { recordProviderEvent } from '@/lib/chat/provider-events';
import { isSensitiveApprovedProvider } from '@/lib/llm/call-llm';

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

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Swapped from llama-3.3-70b-versatile to 8b-instant 2026-05-28 after
// the 70b TPD ceiling (100K tokens/day) ran out — chat throughput got
// blocked while the metadata extraction batch competed for the same
// budget. The 8b model is in a separate quota bucket and is roughly
// 2x faster. We trade a small amount of nuance for reliability under
// Free tier. Flip back to 70b once Dev Tier reopens OR the rolling
// 24h window clears AND metadata extraction is done.
const GROQ_MODEL = 'llama-3.1-8b-instant';
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

function sseEvent(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

const SYSTEM_PROMPT_TEMPLATE = `You are Mindy — an AI assistant for federal small-business contractors.

VOICE:
- Direct, plain language. Federal acronyms are fine (NAICS, OSBP, FAR, IDIQ, 8(a), HUBZone, WOSB, SDVOSB, SAM, GSA). Tech/sales jargon (TAL, ICP, ABM, GTM) is not.
- NEVER say "I'm an AI" or "as a language model". You're Mindy.
- Keep responses tight. Most answers are 3-6 sentences or a short numbered list. No essays.

TODAY: {today} (US Eastern). Use this date for every time calculation. When the user asks about a window such as "the next 18 months", compute its end date from today and compare every date you report against it. Never call a date inside the window "outside" it, or the reverse.

GROUNDING:
- You answer from the live federal DATA CORE (your tools) ONLY. There is NO teaching corpus, curriculum, or podcast library — do not offer to "teach", cite lessons/episodes, or mention any knowledge base. If the user wants to learn a concept, answer it briefly from the data at hand or point them at the tool that shows the real records.
- Every specific fact — a code, dollar, agency, name, count, deadline, contact — must come from a tool result. NEVER invent federal programs, agency names, contract values, or contacts. If your tools don't cover it, say so plainly and stop.
- Do NOT add inline citation markers (no bracket refs at all). Write naturally as if you read the records and are explaining them.

YOUR DATA TOOLS:
You have a LARGE toolset over the federal Data Core — each tool's own description says exactly when to use it. USE them instead of giving generic advice: if a tool can answer a question with real data, call it. Never tell the user to "go check SAM.gov / the panel" for something a tool covers. What you can reach, by category:
- THEIR OWN account (private): get_my_pipeline (their tracked pursuits/deadlines/stages) and search_my_vault (their identity, past performance/CPARS, capabilities). These return ONLY this signed-in user's data — never anyone else's.
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
  if (!chatPro) {
    return new Response(JSON.stringify({ error: 'pro_required', upgrade: true }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) {
    return new Response(JSON.stringify({ error: 'Server misconfigured: GROQ_API_KEY missing' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const sessionId = body.sessionId || crypto.randomUUID();
  const startedAt = Date.now();

  // SSE response — manually constructed ReadableStream since the
  // Vercel Edge / Node runtime doesn't expose an out-of-the-box helper.
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      // A client that disconnected makes enqueue/close throw. That must never be mistaken for a
      // tool failure (it would inject a "tools unavailable" note after a completed write), and it
      // must never skip cost recording or persistence: both are wrapped and never throw.
      let clientGone = false;
      const send = (obj: unknown) => {
        if (clientGone) return;
        try { controller.enqueue(encoder.encode(sseEvent(obj))); } catch { clientGone = true; }
      };
      const closeStream = () => {
        try { controller.close(); } catch { clientGone = true; }
      };

      try {
        // Tell client which session this exchange belongs to right away
        send({ type: 'session', sessionId });

        // Load ONLY the bidder profile for context. The ENTIRE RAG corpus — the 8-year
        // teaching/curriculum chunks AND the podcast episodes — was REMOVED (Eric 2026-08-02:
        // "not just the podcast, the 8-year corpus training, anything not related to the data core
        // we should remove. No one wants to learn here"). Ask Mindy on the map answers from the
        // DATA CORE (live SAM/awards/agencies/firms/forecasts/recompete tools), not from a
        // teaching knowledge base. No RAG retrieval, no teaching context, no citation chips.
        const profile = await loadBidderProfile(auth.email!);
        const userProfileBlock = formatProfileForPrompt(profile);
        const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
        const systemPrompt = SYSTEM_PROMPT_TEMPLATE.replace('{today}', today).replace('{userProfile}', userProfileBlock);

        const messages: Array<{ role: string; content: string }> = [
          { role: 'system', content: systemPrompt },
        ];

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
        (messages as any[]).push({ role: 'user', content: userTurn });

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
        const capabilityNote = capabilityPlannerNote(message);
        // What the customer has said in this conversation (for the stated-filters guard).
        const conversationText = [...history.filter((h) => h.role === 'user').map((h) => String(h.content || '')), message].join('\n');
        const toolRoundMessages: Array<{ role: string; content: string }> = [
          { role: 'system', content: capabilityNote ? `${systemPrompt}\n\n${capabilityNote}` : systemPrompt },
        ];
        for (const h of history) {
          if (h.role === 'user' || h.role === 'assistant') {
            toolRoundMessages.push({ role: h.role, content: String(h.content || '').slice(0, 2000) });
          }
        }
        toolRoundMessages.push({ role: 'user', content: message });

        const openaiKeyEarly = process.env.OPENAI_API_KEY;
        const overBudgetEarly = await isUserOverBudget(email).catch(() => false);
        const chatModelEarly = overBudgetEarly
          ? (process.env.LLM_OPENAI_MODEL || 'gpt-4o-mini')
          : (process.env.CHAT_OPENAI_MODEL || 'gpt-4o');

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
          notices: string[];
        } = { planner: null, planner_attempts: [], tools_offered: 0, tool_executions: [], answer: null, notices: [] };
        if (capabilityNote) turnTrace.notices.push('capability_interpreted');
        const notify = (code: string, text: string) => {
          turnTrace.notices.push(code);
          send({ type: 'notice', code, message: text });
        };
        let plannerUnavailable = false;
        // Index of an assistant tool_calls turn whose results have not all been appended yet.
        let pendingToolTurnIdx: number | null = null;
        const renderedRecords: RenderedRecords[] = [];
        try {
          const tier0Runtime = makeTier0Tools(getSupabase(), auth.email!);
          const executor = createChatToolExecutor({
            userEmail: auth.email!,
            chatSessionId: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId) ? sessionId : null,
            tier0: { defs: TIER0_TOOL_DEFS, names: TIER0_TOOL_NAMES, execute: (n, a) => tier0Runtime.execute(n, a) },
          });
          // Offered tools are filtered by the chat tool policy (blocked tools are never shown).
          const ALL_TOOL_DEFS = executor.offeredToolDefs();
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
            try {
              if (t.provider === 'anthropic') {
                const sys = toolRoundMessages.find((m) => m.role === 'system')?.content || '';
                const convo = toolRoundMessages
                  .filter((m) => m.role === 'user' || m.role === 'assistant')
                  .map((m) => ({ role: m.role, content: m.content }));
                const forced = OPP_INTENT && anthropicSupportsForcedToolChoice(t.model);
                const cbody: Record<string, unknown> = {
                  model: t.model, max_tokens: TOOL_ROUND_MAX_TOKENS, system: sys,
                  messages: convo, tools: anthropicTools, tool_choice: forced ? { type: 'any' } : { type: 'auto' },
                };
                if (/haiku-4-5|sonnet-4-|opus-4-[0-5]|claude-3/i.test(t.model)) cbody.temperature = 0;
                const cr = await fetch('https://api.anthropic.com/v1/messages', {
                  method: 'POST',
                  headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
                  body: JSON.stringify(cbody),
                });
                if (cr.ok) return { ok: true, json: anthropicToOpenAiChoice(await cr.json()) };
                return { ok: false, status: cr.status, detail: (await cr.text().catch(() => '')).slice(0, 300) };
              }
              const r = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  model: t.model, messages: toolRoundMessages, temperature: 0, max_tokens: TOOL_ROUND_MAX_TOKENS,
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
          const resolved = resolvePlannerChain(process.env, { overBudget: overBudgetEarly });
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
            const rawCalls = (choice?.tool_calls ?? []) as Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const u = (first.json as any)?.usage;
            toolProvider = first.provider; toolModel = first.model;
            if (u) toolUsageForCost = { prompt_tokens: u.prompt_tokens, completion_tokens: u.completion_tokens };
            if (Array.isArray(rawCalls) && rawCalls.length > 0) {
              // Every call gets a stable id so each result pairs with its call.
              const displayOffsets = new Map<string, number>();
              const toolCalls = rawCalls.map((tc, i) => {
                const id = tc.id || `call_${i}`;
                const prepared = prepareChatToolArgs(String(tc.function?.name || ''), String(tc.function?.arguments ?? ''));
                if (prepared.displayOffset) displayOffsets.set(id, prepared.displayOffset);
                // Stated filters only: drop a state the conversation never implied (deterministic).
                const guarded = guardUnstatedStates(prepared.args, conversationText);
                for (const r of guarded.removed) turnTrace.notices.push(`unstated_filter_removed:${tc.function?.name}:${r}`);
                return { ...tc, id, type: 'function' as const, function: { ...tc.function, arguments: guarded.args } };
              });
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              pendingToolTurnIdx = (messages as any[]).push({ role: 'assistant', content: choice.content ?? null, tool_calls: toolCalls }) - 1;
              const results = await executor.executeRound(toolCalls, { provider: first.provider, model: first.model });
              for (const r of results) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (messages as any[]).push({ role: 'tool', tool_call_id: r.tool_call_id, content: r.content });
              }
              pendingToolTurnIdx = null;
              turnTrace.tool_executions = results.map((r) => r.record);
              // PR E: verified record lists are rendered from the tool data, not reproduced by the model.
              for (const r of results) {
                if (r.record.status !== 'success' || ![EXPIRING_TOOL, PAST_CONTRACTS_TOOL, BUYING_OFFICES_TOOL].includes(r.record.tool)) continue;
                try {
                  const parsed = JSON.parse(r.content);
                  const rendered = r.record.tool === EXPIRING_TOOL
                    ? renderExpiringRecords(parsed, { offset: displayOffsets.get(r.tool_call_id) ?? 0 })
                    : r.record.tool === BUYING_OFFICES_TOOL ? renderBuyingOffices(parsed) : renderStatusChecks(parsed);
                  if (rendered) renderedRecords.push(rendered);
                } catch (renderErr) {
                  console.error('[chat] record render failed:', renderErr);
                }
              }
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
              if (results.some((r) => r.record.status === 'failed')) {
                notify('lookup_failed', 'One of the data lookups failed, so this answer may be incomplete.');
              }
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
        if (toolProvider) {
          void recordLlmUsage({ userEmail: auth.email, tool: 'chat_tool_round', provider: toolProvider, model: toolModel, usage: toolUsageForCost || undefined });
        }
        // ── end Tier-0 tool round ──
        if (renderedRecords.length) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (messages as any[]).push({
            role: 'system',
            content:
              'VERIFIED RECORD LIST: the records below were rendered from the tool data and have ALREADY been shown to the user verbatim, directly above your reply. '
              + 'Do NOT list, repeat or renumber the records, and do not restate identifiers, dates or amounts that are not in this list. '
              + 'Write 2 to 6 sentences of analysis: what stands out (soonest end dates, agencies, incumbents, task orders versus contracts, anything not applied). '
              + 'Do not restate per-record details from the list; if you refer to one, use the list\'s exact wording and numbers (no rounding), and never write "no ... contracts" unless a list line says none were found. '
              + 'For a status list: if several awards match, do not treat one as THE contract unless the records identify it; say which are active and which expired (with end dates) and name any successor candidate. '
              + 'If you state the total, use exactly the count in the list header. If the header says the list is not complete, say so and tell the user how to continue (call the same tool with the same filters plus display_offset).\n\n'
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
        const openaiKey = openaiKeyEarly;
        const chatModel = chatModelEarly;
        const streamFrom = (url: string, key: string, model: string) => fetch(url, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
          // stream_options.include_usage → OpenAI/Groq emit a final usage-only
          // chunk after the deltas. Without it, a streaming call returns NO usage
          // object, so cost attribution (esp. gpt-4o Chat) would log $0. The extra
          // frame is usage-only (empty choices) and the SSE parser already tolerates it.
          body: JSON.stringify({ model, messages, temperature: TEMPERATURE, max_tokens: MAX_TOKENS, stream: true, stream_options: { include_usage: true } }),
        });

        let groqRes: Response | null = null;
        // Track which provider/model actually served the response for cost attribution.
        let usedProvider = 'groq';
        let usedModel = GROQ_MODEL;
        let answerFallback = false;
        if (openaiKey) {
          const r = await streamFrom('https://api.openai.com/v1/chat/completions', openaiKey, chatModel);
          if (r.ok && r.body) { groqRes = r; usedProvider = 'openai'; usedModel = chatModel; }
          else {
            // The answer step needs no tools, so the existing Groq fallback is kept, but it is
            // no longer silent.
            const detail = (await r.text().catch(() => '')).slice(0, 300);
            void recordProviderEvent({ kind: 'answer_fallback', provider: 'openai', model: chatModel, status: r.status, detail, userEmail: auth.email!, next: `groq:${GROQ_MODEL}` });
          }
        }
        if (!groqRes && !providerApprovedForPrivate('groq')) {
          // The fallback provider is not approved for private data: fail visibly instead of
          // sending this turn's context to it.
          void recordProviderEvent({ kind: 'answer_failure', provider: 'openai', model: chatModel, detail: 'answer fallback blocked: groq is not on the approved list for private data', userEmail: auth.email! });
          send({ type: 'error', message: 'Mindy could not answer right now. Please try again in a moment.' });
          send({ type: 'done' });
          closeStream();
          return;
        }
        if (!groqRes) {
          answerFallback = true;
          groqRes = await streamFrom('https://api.groq.com/openai/v1/chat/completions', groqKey || '', GROQ_MODEL);
          usedProvider = 'groq';
          usedModel = GROQ_MODEL;
        }

        if (!groqRes.ok || !groqRes.body) {
          const errText = await groqRes.text().catch(() => '(no body)');
          void recordProviderEvent({ kind: 'answer_failure', provider: usedProvider, model: usedModel, status: groqRes.status, detail: errText.slice(0, 300), userEmail: auth.email! });
          send({ type: 'error', message: `AI ${groqRes.status}: ${errText.slice(0, 200)}` });
          send({ type: 'done' });
          closeStream();
          return;
        }

        let assistantContent = '';
        if (renderedRecords.length) {
          const recordBlock = `${renderedRecords.map((r) => r.text).join('\n\n')}\n\n`;
          assistantContent = recordBlock;
          send({ type: 'token', content: recordBlock });
          turnTrace.notices.push('records_rendered');
        }
        const modelTextStart = assistantContent.length;
        let tokensUsed: number | null = null;
        // Full usage object (prompt/completion split) for cost attribution.
        let usageForCost: { prompt_tokens?: number; completion_tokens?: number } | null = null;
        const reader = groqRes.body.getReader();
        const decoder = new TextDecoder();
        let leftover = '';
        let finishReason: string | null = null;

        while (true) {
          // Nobody is reading: stop the provider stream instead of generating unread tokens.
          if (clientGone) { await reader.cancel().catch(() => {}); break; }
          const { done, value } = await reader.read();
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
                send({ type: 'token', content: delta });
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
        turnTrace.answer = { provider: usedProvider, model: usedModel, finish_reason: finishReason, fallback: answerFallback };
        if (finishReason === 'length') {
          turnTrace.notices.push('truncated');
          send({ type: 'truncated', message: 'This answer hit its length limit and was cut off. Ask Mindy to continue, or narrow the question.' });
        }
        const citedSources: CitedSource[] = [];
        send({ type: 'citations', sources: citedSources });
        send({ type: 'done' });
        closeStream();

        // Cost attribution — this route calls the LLM provider directly (bypasses
        // callLLM), so log usage explicitly. Fire-and-forget; never throws.
        void recordLlmUsage({
          userEmail: auth.email,
          tool: 'chat',
          provider: usedProvider,
          model: usedModel,
          usage: usageForCost || undefined,
        });

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
        send({ type: 'error', message: String((err as Error)?.message || 'Stream failed') });
        send({ type: 'done' });
        closeStream();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // disable nginx buffering if behind a proxy
    },
  });
}
