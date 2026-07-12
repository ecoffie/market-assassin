/**
 * POST /api/app/chat — Mindy Chat v1
 *
 * RAG-backed Q&A streamed via Server-Sent Events. Pipeline:
 *   1. Auth via requireUserAuth (Supabase session, MI 2FA token, or
 *      signed email token)
 *   2. Parallel-fetch:
 *        - RAG chunks for the user's message (1,000+ docs: Eric's
 *          teaching corpus + podcast interviews)
 *        - Bidder profile (NAICS, business type, set-asides) so Mindy
 *          can personalize her answer
 *   3. Build system prompt + history + context window
 *   4. Stream Groq Llama 3.3 70B response (temperature 0.3 for
 *      citation faithfulness)
 *   5. After the stream completes, fire-and-forget persistence:
 *      upsert session + insert user msg + insert assistant msg with
 *      cited sources, tokens, and latency
 *
 * v1 scope (#117): single-session UX, authenticated only, no agent
 * loop. v1.1 backlog: anonymous demo + warmer temp + history sidebar.
 *
 * SSE event types emitted:
 *   - { type: 'session', sessionId }   — emitted once at the start
 *   - { type: 'token', content }       — streamed Llama deltas
 *   - { type: 'citations', sources }   — emitted once at the end
 *   - { type: 'done' }                 — terminator
 *   - { type: 'error', message }       — on failure
 */

import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyUserOwnsEmail } from '@/lib/api-auth';
import { hasProAccess } from '@/lib/access/resolve-access';
import { retrieveRagContext, type RagChunkResult } from '@/lib/rag/retrieve';
import { retrievePodcastEpisodes, formatPodcastCardsForPrompt, type PodcastEpisodeCard } from '@/lib/rag/podcast-search';
import { loadBidderProfile, formatProfileForPrompt } from '@/lib/proposal/loaders';
import { isUserOverBudget, recordLlmUsage } from '@/lib/llm/usage-cost';
import { makeTier0Tools, TIER0_TOOL_DEFS, TIER0_TOOL_NAMES } from '@/lib/chat/tier0-tools';
import { makeTier1Tools, TIER1_TOOL_DEFS } from '@/lib/chat/tier1-tools';

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
const MAX_TOKENS = 1024;          // chat responses are conversational, not essays
const RAG_LIMIT = 6;              // ~6 chunks → ~3000 chars context
const RAG_MAX_CHARS = 5000;
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

interface CitedSource {
  title: string;
  url: string | null;
  doc_type: string;
  source_path: string | null;
  // For internal docs (course_material, etc) where we don't have a
  // public URL but DO have the full text in mindy_rag_documents, the
  // client can fetch /api/app/rag-doc?id=<document_id> to render the
  // doc in an inline drawer.
  document_id: string | null;
}

function sseEvent(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

const SYSTEM_PROMPT_TEMPLATE = `You are Mindy — an AI assistant for federal small-business contractors.

VOICE:
- Direct, plain language. Federal acronyms are fine (NAICS, OSBP, FAR, IDIQ, 8(a), HUBZone, WOSB, SDVOSB, SAM, GSA). Tech/sales jargon (TAL, ICP, ABM, GTM) is not.
- NEVER say "I'm an AI" or "as a language model". You're Mindy.
- NEVER mention specific people by name when citing the knowledge base (e.g. say "Episode 326" not "Eric's episode 326"; say "the guest" or "a small business owner" not the host's name).
- Keep responses tight. Most answers are 3-6 sentences or a short numbered list. No essays.

GROUNDING:
- The CONTEXT block below contains two kinds of material:
  1. Teaching/transcript chunks — full quotes from federal contracting curriculum + podcast interviews.
  2. PODCAST EPISODES — structured summary cards (guest, agencies, NAICS, set-asides, lessons) for episode-level discovery.
- Use this context to ground your answers. DO NOT add inline citation markers (no [→ Episode 326], no [→ Day 14], no bracket refs at all). The UI surfaces the sources you used as clickable chips below your answer automatically — that's the user's path to the docs.
- Write naturally as if you read the material and are explaining it. Reference podcasts by guest name when natural ("Ryan Atencio explains how to..."), not by episode number.
- If the context doesn't contain what's needed, say so directly: "I don't have that in my knowledge base — try the [X] panel for that." DO NOT invent federal programs, agency names, or contract values.

YOUR DATA TOOLS:
Their OWN account (private):
- get_my_pipeline — the user's tracked pursuits (titles, agencies, deadlines, stages). Call it when they ask about THEIR pipeline, pursuits, deadlines, or what they're bidding/tracking.
- search_my_vault — the user's OWN Vault: company identity, past performance (contracts/CPARS), capabilities. Call it when they ask about their own experience/past performance/capabilities, or want you to reference their real record.
Live federal market (public):
- search_sam_opportunities — currently-open SAM.gov opportunities by keyword (+ optional NAICS / set-aside). Call it when they ask what opportunities/RFPs/solicitations are open or available in a topic or their market.
- get_market_vocabulary — the distinctive buyer words/phrases that win in a NAICS. Call it when they ask what keywords to search, how buyers describe a market, or how to phrase a capability statement for a NAICS.
- When a tool returns count 0 / has_any false, say so plainly — NEVER invent a pursuit, opportunity, contract, agency, deadline, or term. Ground every specific (title, agency, deadline, dollar, solicitation #) ONLY in what the tool actually returned.
- The pipeline/Vault tools return only THIS signed-in user's data. Do not claim to see anyone else's.

SCOPE:
- You answer questions about US federal contracting — set-asides, certifications, SAM.gov, capability statements, teaming, proposals, market intel, GovCon BD.
- For off-topic queries (general business advice, personal stuff, non-federal contracts), redirect: "I'm focused on federal contracting — try [X] for that." Do NOT cite any sources on off-topic redirects — just redirect plainly.

WRITING STYLE:
- NEVER use bracketed placeholders like "[Company Name]" or "[Your Business]" in responses. If you don't have the user's company name, write generic advice using "your company" or "your business" instead.
- Default to second person ("you / your") — you're talking TO the user, not ABOUT a hypothetical bidder.

USER PROFILE (use to personalize answers when relevant; if blank, write generically using "your company"):
{userProfile}`;

function buildContextBlock(chunks: RagChunkResult[], podcastCards: PodcastEpisodeCard[] = []): string {
  const parts: string[] = [];
  if (chunks.length) {
    parts.push(chunks
      .map((c, i) => {
        const label = c.doc_title || c.source_path || `Source ${i + 1}`;
        const type = c.doc_type ? `[${c.doc_type}]` : '';
        return `### Source ${i + 1}: ${label} ${type}\n${c.chunk_text.trim()}`;
      })
      .join('\n\n'));
  }
  if (podcastCards.length) {
    parts.push(`## PODCAST EPISODES (overview — use for "find episodes about X" type questions):\n\n${formatPodcastCardsForPrompt(podcastCards)}`);
  }
  return parts.join('\n\n');
}

function chunksToCitations(chunks: RagChunkResult[]): CitedSource[] {
  return chunks.map(c => ({
    title: c.doc_title || c.source_path || 'Source',
    // Old source_paths use the `libsyn:` prefix as a sentinel. Strip
    // it to a proper https:// URL — earlier versions wrote `https:`
    // without the slashes, which Safari treats as same-origin and
    // 404s on getmindy.ai. Force `https://` here.
    url: c.source_path?.startsWith('libsyn:')
      ? c.source_path.replace(/^libsyn:/, 'https://')
      : null,
    doc_type: c.doc_type || 'misc',
    source_path: c.source_path,
    document_id: c.document_id,
  }));
}

function podcastCardsToCitations(cards: PodcastEpisodeCard[]): CitedSource[] {
  return cards.map(c => ({
    // Show the episode TITLE — far more useful to the listener than a bare
    // number (Eric). Prefix the number for context when both exist.
    title: c.episode_title
      ? (c.episode_number ? `Ep ${c.episode_number}: ${c.episode_title}` : c.episode_title)
      : (c.episode_number ? `Episode ${c.episode_number}` : 'GovCon Giants Podcast'),
    url: c.episode_url,
    doc_type: 'podcast_interview',
    source_path: c.episode_url,
    // Podcast cards don't carry the underlying mindy_rag_documents.id
    // here — the libsyn URL is the click target. document_id stays null
    // so the chip falls through to opening the libsyn link.
    document_id: null,
  }));
}

/**
 * Filter chunks to only those Mindy actually cited inline via [→ X].
 * Fuzzy-matches the bracket label against each chunk's doc_title so
 * we don't have to worry about exact-match formatting from the LLM.
 *
 * Returns empty array when no inline citations were used — that's the
 * intended behavior for off-topic redirects and "I don't have that"
 * fallbacks. Better to show nothing than a misleading source chip.
 */
/**
 * Build the "Documents referenced" chip set the UI shows under the
 * answer. We no longer use Mindy's inline brackets (they confused the
 * UX — users clicked refs that didn't navigate). Instead we surface
 * the top retrieved sources directly: chunks first (since they're
 * ranked by relevance), then podcast cards if they're new.
 *
 * Deduped by title + capped at MAX_CITATIONS so the chip strip stays
 * tight on mobile. Off-topic redirects skip retrieval entirely so
 * `chunks`+`podcastCards` will be empty in that case and we return [].
 */
const MAX_CITATIONS = 6;
function buildCitationChips(chunks: RagChunkResult[], podcastCards: PodcastEpisodeCard[]): CitedSource[] {
  const all = [...chunksToCitations(chunks), ...podcastCardsToCitations(podcastCards)];
  const seen = new Set<string>();
  const out: CitedSource[] = [];
  for (const c of all) {
    const key = (c.title || '').toLowerCase().trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(c);
    if (out.length >= MAX_CITATIONS) break;
  }
  return out;
}

async function persistExchange(params: {
  email: string;
  sessionId: string;
  userMessage: string;
  assistantMessage: string;
  citedSources: CitedSource[];
  tokensUsed: number | null;
  latencyMs: number;
}) {
  const supabase = getSupabase();

  // Upsert session (create if missing, bump updated_at + message_count if present)
  const { data: existing } = await supabase
    .from('mindy_chat_sessions')
    .select('id, message_count')
    .eq('id', params.sessionId)
    .maybeSingle();

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

  // Insert both messages
  await supabase.from('mindy_chat_messages').insert([
    {
      session_id: params.sessionId,
      role: 'user',
      content: params.userMessage,
      cited_sources: [],
    },
    {
      session_id: params.sessionId,
      role: 'assistant',
      content: params.assistantMessage,
      cited_sources: params.citedSources,
      tokens_used: params.tokensUsed,
      latency_ms: params.latencyMs,
    },
  ]);
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
  if (!(await hasProAccess(auth.email))) {
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
      const send = (obj: unknown) => controller.enqueue(encoder.encode(sseEvent(obj)));

      try {
        // Tell client which session this exchange belongs to right away
        send({ type: 'session', sessionId });

        // Parallel-fetch context: chunk-level RAG + episode-level
        // podcast metadata + bidder profile. The podcast helper searches
        // structured fields (guest, agency, NAICS, set-aside, summary)
        // and is cheap — empty result when no podcast-shaped tokens
        // appear in the query.
        const [chunks, podcastCards, profile] = await Promise.all([
          retrieveRagContext({
            query: message,
            limit: RAG_LIMIT,
            maxChars: RAG_MAX_CHARS,
            maxPerDoc: 1,
          }),
          retrievePodcastEpisodes({ query: message, limit: 4 }),
          loadBidderProfile(auth.email!),
        ]);

        const contextBlock = buildContextBlock(chunks, podcastCards);
        const userProfileBlock = formatProfileForPrompt(profile);
        const systemPrompt = SYSTEM_PROMPT_TEMPLATE.replace('{userProfile}', userProfileBlock);

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

        // The current user message — append CONTEXT to it (not as separate
        // turn) so Mindy sees it as "for THIS question, here's the corpus".
        const userTurn = contextBlock
          ? `${message}\n\n---\nCONTEXT (federal contracting teaching + podcast quotes + episode summaries):\n${contextBlock}`
          : message;
        // messages is heterogeneous once tools enter (assistant tool_calls +
        // role:'tool' results), so type it loosely for the tool round.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (messages as any[]).push({ role: 'user', content: userTurn });

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
        // called, messages is untouched and v1 behaviour is byte-for-byte
        // preserved. Phase-0 spike proved both gpt-4o and the 8b Groq fallback do
        // this reliably (scripts/spike-chat-v2-toolcall.mjs).
        let toolProvider = ''; let toolModel = '';
        let toolUsageForCost: { prompt_tokens?: number; completion_tokens?: number } | null = null;
        try {
          const tier0 = makeTier0Tools(getSupabase(), auth.email!);
          const tier1 = makeTier1Tools(getSupabase());
          // Route a called tool to the toolset that owns it. Tier-0 names are the
          // private set; everything else in the combined defs is Tier-1.
          const execTool = (name: string, args: Record<string, unknown>) =>
            TIER0_TOOL_NAMES.has(name) ? tier0.execute(name, args) : tier1.execute(name, args);
          const ALL_TOOL_DEFS = [...TIER0_TOOL_DEFS, ...TIER1_TOOL_DEFS];
          const toolReqBody = (model: string) => JSON.stringify({
            model, messages, temperature: 0, max_tokens: 512,
            tools: ALL_TOOL_DEFS, tool_choice: 'auto',
          });
          const callToolRound = async (): Promise<{ provider: string; model: string; json: unknown } | null> => {
            if (openaiKeyEarly) {
              const r = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST', headers: { Authorization: `Bearer ${openaiKeyEarly}`, 'Content-Type': 'application/json' },
                body: toolReqBody(chatModelEarly),
              });
              if (r.ok) return { provider: 'openai', model: chatModelEarly, json: await r.json() };
            }
            const g = await fetch('https://api.groq.com/openai/v1/chat/completions', {
              method: 'POST', headers: { Authorization: `Bearer ${groqKey || ''}`, 'Content-Type': 'application/json' },
              body: toolReqBody(GROQ_MODEL),
            });
            if (g.ok) return { provider: 'groq', model: GROQ_MODEL, json: await g.json() };
            return null;
          };

          const first = await callToolRound();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const choice = (first?.json as any)?.choices?.[0]?.message;
          const toolCalls = choice?.tool_calls as Array<{ id?: string; function?: { name?: string; arguments?: string } }> | undefined;
          if (first && Array.isArray(toolCalls) && toolCalls.length > 0) {
            toolProvider = first.provider; toolModel = first.model;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const u = (first.json as any)?.usage;
            if (u) toolUsageForCost = { prompt_tokens: u.prompt_tokens, completion_tokens: u.completion_tokens };
            // Append the assistant's tool-call turn verbatim, then each tool result.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (messages as any[]).push({ role: 'assistant', content: choice.content ?? null, tool_calls: toolCalls });
            for (const tc of toolCalls) {
              let args: Record<string, unknown> = {};
              try { args = JSON.parse(tc.function?.arguments || '{}'); } catch { args = {}; }
              const result = await execTool(tc.function?.name || '', args);
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (messages as any[]).push({ role: 'tool', tool_call_id: tc.id || 'call_0', content: JSON.stringify(result) });
            }
          }
        } catch (toolErr) {
          // Tool round is best-effort: on any failure, fall through to the plain
          // RAG stream. A tool hiccup must never break the chat.
          console.error('[chat] tier0 tool round failed (continuing without tools):', toolErr);
        }
        // Log the tool-round LLM spend separately (fire-and-forget).
        if (toolProvider) {
          void recordLlmUsage({ userEmail: auth.email, tool: 'chat_tool_round', provider: toolProvider, model: toolModel, usage: toolUsageForCost || undefined });
        }
        // ── end Tier-0 tool round ──

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
        if (openaiKey) {
          const r = await streamFrom('https://api.openai.com/v1/chat/completions', openaiKey, chatModel);
          if (r.ok && r.body) { groqRes = r; usedProvider = 'openai'; usedModel = chatModel; }
        }
        if (!groqRes) {
          groqRes = await streamFrom('https://api.groq.com/openai/v1/chat/completions', groqKey || '', GROQ_MODEL);
          usedProvider = 'groq';
          usedModel = GROQ_MODEL;
        }

        if (!groqRes.ok || !groqRes.body) {
          const errText = await groqRes.text().catch(() => '(no body)');
          send({ type: 'error', message: `AI ${groqRes.status}: ${errText.slice(0, 200)}` });
          send({ type: 'done' });
          controller.close();
          return;
        }

        let assistantContent = '';
        let tokensUsed: number | null = null;
        // Full usage object (prompt/completion split) for cost attribution.
        let usageForCost: { prompt_tokens?: number; completion_tokens?: number } | null = null;
        const reader = groqRes.body.getReader();
        const decoder = new TextDecoder();
        let leftover = '';

        while (true) {
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
        const citedSources = isRedirect ? [] : buildCitationChips(chunks, podcastCards);
        send({ type: 'citations', sources: citedSources });
        send({ type: 'done' });
        controller.close();

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
        }).catch(err => console.error('[chat] persist failed:', err));
      } catch (err) {
        console.error('[chat] stream error:', err);
        send({ type: 'error', message: String((err as Error)?.message || 'Stream failed') });
        send({ type: 'done' });
        controller.close();
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
