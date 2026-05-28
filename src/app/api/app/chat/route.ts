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
import { requireUserAuth } from '@/lib/api-auth';
import { retrieveRagContext, type RagChunkResult } from '@/lib/rag/retrieve';
import { loadBidderProfile, formatProfileForPrompt } from '@/lib/proposal/loaders';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const GROQ_MODEL = 'llama-3.3-70b-versatile';
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
- The CONTEXT block below contains real federal contracting teaching material + podcast interviews with small-business winners. Prefer answers grounded in this material.
- When you draw on a context chunk, reference it inline as [→ <doc title>]. Example: "Most first-time 8(a) winners start as subs [→ Episode 326]."
- If the context doesn't contain what's needed, say so directly: "I don't have that in my knowledge base — try the [X] panel for that." DO NOT invent federal programs, agency names, or contract values.

SCOPE:
- You answer questions about US federal contracting — set-asides, certifications, SAM.gov, capability statements, teaming, proposals, market intel, GovCon BD.
- For off-topic queries (general business advice, personal stuff, non-federal contracts), redirect: "I'm focused on federal contracting — try [X] for that."

USER PROFILE (use to personalize answers when relevant):
{userProfile}`;

function buildContextBlock(chunks: RagChunkResult[]): string {
  if (!chunks.length) return '';
  return chunks
    .map((c, i) => {
      const label = c.doc_title || c.source_path || `Source ${i + 1}`;
      const type = c.doc_type ? `[${c.doc_type}]` : '';
      return `### Source ${i + 1}: ${label} ${type}\n${c.chunk_text.trim()}`;
    })
    .join('\n\n');
}

function chunksToCitations(chunks: RagChunkResult[]): CitedSource[] {
  return chunks.map(c => ({
    title: c.doc_title || c.source_path || 'Source',
    url: c.source_path?.startsWith('libsyn:')
      ? c.source_path.replace(/^libsyn:/, 'https:')
      : null,
    doc_type: c.doc_type || 'misc',
    source_path: c.source_path,
  }));
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
  // Parse body first (auth helper consumes it via clone)
  let body: ChatRequest;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
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

  // Auth — same pattern as every other /app/* route
  const auth = await requireUserAuth(request);
  if (!auth.authenticated || !auth.email) {
    return new Response(JSON.stringify({ error: auth.error || 'Unauthorized' }), {
      status: 401,
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

        // Parallel-fetch context: RAG + bidder profile
        const [chunks, profile] = await Promise.all([
          retrieveRagContext({
            query: message,
            limit: RAG_LIMIT,
            maxChars: RAG_MAX_CHARS,
            maxPerDoc: 1,
          }),
          loadBidderProfile(auth.email!),
        ]);

        const contextBlock = buildContextBlock(chunks);
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
          ? `${message}\n\n---\nCONTEXT (real federal contracting teaching + podcast quotes):\n${contextBlock}`
          : message;
        messages.push({ role: 'user', content: userTurn });

        // Stream from Groq
        const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${groqKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: GROQ_MODEL,
            messages,
            temperature: TEMPERATURE,
            max_tokens: MAX_TOKENS,
            stream: true,
          }),
        });

        if (!groqRes.ok || !groqRes.body) {
          const errText = await groqRes.text().catch(() => '(no body)');
          send({ type: 'error', message: `Groq ${groqRes.status}: ${errText.slice(0, 200)}` });
          send({ type: 'done' });
          controller.close();
          return;
        }

        let assistantContent = '';
        let tokensUsed: number | null = null;
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
            } catch {
              // Ignore unparseable lines — Groq occasionally sends keep-alives
            }
          }
        }

        // Emit citations after the response completes (v1 heuristic:
        // cite every chunk passed to the model)
        const citedSources = chunksToCitations(chunks);
        send({ type: 'citations', sources: citedSources });
        send({ type: 'done' });
        controller.close();

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
