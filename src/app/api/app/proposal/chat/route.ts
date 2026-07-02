/**
 * Proposal Assist — Manual Drive chat (PRD-proposal-manual-mode.md, v1).
 *
 * A Perplexity-style proposal LLM: the user uploads project files + has a Vault,
 * then types what they want ("draft the technical approach using our NAVSEA past
 * performance", "what does the RFP require for past performance?"). This streams
 * a response GROUNDED IN THE USER'S OWN DOCS (the uploaded RFP text + their
 * Vault) — NOT the global knowledge base (a proposal must not cite random
 * training content).
 *
 * Reuses the Mindy Chat SSE/Groq engine; the difference is the CONTEXT source.
 *
 * Body: { email, message, rfpText?, rfpFileName?, history? }
 * SSE: { type:'token', content } … { type:'done' }
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { callLLM } from '@/lib/llm/call-llm';
import { isUserOverBudget } from '@/lib/llm/usage-cost';
import { createClient } from '@supabase/supabase-js';
import { loadBidderProfile, formatProfileForPrompt, loadVaultContext } from '@/lib/proposal/loaders';
import { retrieveRagContext, formatChunksForPrompt } from '@/lib/rag/retrieve';

// RAG-as-standard: Manual Drive answers are informed by Mindy's real proposal
// corpus (winning technical/pricing/past-perf volumes, templates, cap
// statements) — the same de-facto standard Auto mode uses — so "draft the
// technical approach" reflects how real proposal volumes are built, not just
// the user's Vault. STYLE reference only; never copy verbatim.
const PROPOSAL_DOC_TYPES = ['technical_volume', 'pricing_volume', 'past_performance', 'proposal_template', 'cap_statement', 'sources_sought_loi'];

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const GROQ_MODEL = 'llama-3.1-8b-instant';
const TEMPERATURE = 0.4;        // a touch more deterministic for proposal copy
const MAX_TOKENS = 4000;        // ~3,000 words — was 1400 (~1,000), which truncated
                                // requirement breakdowns + drafted sections. gpt-4o-mini
                                // (the primary) supports 16K out; 4K is the substance/cost balance.
const HISTORY_LIMIT = 6;
const RFP_MAX_CHARS = 200000;   // accept the FULL combined doc text (we select
                                // the relevant slices below, not first-8K)
const RFP_CONTEXT_BUDGET = 60000; // chars of RFP in the prompt (~15K tokens) — more
                                  // relevant excerpts reach the model so answers go
                                  // deeper on long docs. Well within gpt-4o-mini's 128K. Claude (primary
                                  // for Manual Drive) has the window for it, so
                                  // feed more so the answer's section is present

/**
 * Pick the parts of a big solicitation most RELEVANT to the user's question
 * (Eric QC: asking "how many projects / dollar amount" got generic fluff because
 * the chat only saw the first 8K of a 350K doc). Splits into windows, scores
 * each by keyword overlap with the question, returns the top windows up to a
 * char budget — so specific numbers deep in the doc actually reach the model.
 */
function selectRelevantRfp(rfpText: string, question: string, budget: number): string {
  if (rfpText.length <= budget) return rfpText;
  const WIN = 2000;
  const windows: { text: string; score: number; idx: number }[] = [];
  // Question keywords (drop short/stop words).
  const stop = new Set(['the', 'and', 'for', 'are', 'you', 'what', 'how', 'many', 'this', 'that', 'with', 'need', 'does', 'have', 'can', 'will', 'about', 'tell', 'give', 'into']);
  const terms = (question.toLowerCase().match(/[a-z0-9$]{3,}/g) || []).filter(t => !stop.has(t));
  // Always include intent keywords for common asks.
  const intent = /past[ _-]?perform|reference|project|dollar|value|amount|\$|price|deadline|due|page|submit|evaluat|award|set[ _-]?aside|naics|bond|licens|requir/i;
  for (let i = 0; i < rfpText.length; i += WIN) {
    const text = rfpText.slice(i, i + WIN + 400); // small overlap
    const low = text.toLowerCase();
    let score = 0;
    for (const t of terms) if (low.includes(t)) score += 2;
    if (intent.test(text)) score += 1;
    // Numbers/dollar figures are valuable for "how many / how much" questions.
    if (/\$[\d,]+|\b\d+\s*(projects?|years?|references?|contracts?)\b/i.test(text)) score += 2;
    windows.push({ text, score, idx: i });
  }
  // Always keep the first window (cover page / summary) + the top-scoring rest.
  const first = windows[0];
  const ranked = windows.slice(1).filter(w => w.score > 0).sort((a, b) => b.score - a.score);
  const chosen = [first, ...ranked];
  const out: string[] = [];
  let used = 0;
  // Re-order chosen by document position so it reads coherently.
  for (const w of chosen.sort((a, b) => a.idx - b.idx)) {
    if (used + w.text.length > budget) break;
    out.push(w.text); used += w.text.length;
  }
  return out.join('\n…\n');
}

const SYSTEM_PROMPT = `You are Mindy, a senior federal proposal writer helping a small-business contractor draft a response. You are in MANUAL mode — the user drives; do exactly what they ask.

Rules:
- ANSWER THE ACTUAL QUESTION FROM THE ACTUAL DOCUMENT. When the user asks something specific ("how many past-performance references", "what's the dollar threshold", "when is it due", "how many projects"), find the answer IN the RFP TEXT and quote/cite the exact number, date, or clause. Do NOT respond with a generic template or a list of section headings — that is a failure. If the specific answer is genuinely not in the provided excerpts, say "I don't see that specified in the parts of the solicitation I have — it may be deeper in the document; check section [X]" — never paper over it with generic advice.
- Ground EVERYTHING in the provided RFP TEXT and the user's VAULT (their real past performance, capabilities, identity). Do NOT invent contract numbers, agencies, dollar values, or experience the user doesn't have.
- Use the PROPOSAL CORPUS as the STANDARD for HOW to structure, format, and word a federal proposal volume (technical, pricing, past performance). Learn the structure and framing from it — but NEVER copy its phrasing verbatim, and never use its facts (those belong to the corpus author, not the user). When you advise on structure, you may note "a technical volume typically covers X, Y, Z."
- When a fact isn't in the RFP or Vault, write a clearly-marked [bracketed placeholder] for the user to fill — never fabricate.
- Write in the user's voice: concrete, specific, no marketing fluff, no "we are pleased to".
- When asked to draft a section, return clean prose ready to paste into the proposal. When asked a question about the RFP, answer directly and cite the relevant requirement.
- If the RFP text or Vault is missing what's needed, say so plainly and tell the user what to upload or add.
- Never say "as an AI" — you're Mindy.`;

function sseEvent(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

/**
 * Reuse what Auto mode already produced (Eric's insight): the pursuit's
 * extracted/classified docs + the CACHED compliance matrix. Returns the combined
 * RFP text + the structured requirements so the chat reasons over them instead
 * of re-extracting raw text every message.
 */
async function loadPursuitContext(pipelineId: string): Promise<{ rfpText: string; rfpFileName: string; requirements: Array<{ requirement: string; category?: string; section?: string }> }> {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: docs } = await supabase
    .from('pursuit_documents')
    .select('filename, doc_kind, extracted_text, notice_id')
    .eq('pipeline_id', pipelineId)
    .in('doc_kind', ['solicitation', 'qa', 'amendment', 'instructions', 'eval_factors', 'sow_pws', 'pricing'])
    .not('extracted_text', 'is', null);
  if (!docs || docs.length === 0) return { rfpText: '', rfpFileName: '', requirements: [] };

  const rfpText = docs.map(d => `=== ${d.filename} [${d.doc_kind}] ===\n${d.extracted_text}`).join('\n\n');
  const primary = docs.find(d => d.doc_kind === 'solicitation') || docs[0];
  // The cached compliance matrix = the solicitation's requirements, already
  // distilled. Reuse it so "what past-perf do I need?" is answered from
  // structure, not a 350K re-scan.
  let requirements: Array<{ requirement: string; category?: string; section?: string }> = [];
  const noticeId = docs.find(d => d.notice_id)?.notice_id;
  if (noticeId) {
    const { data: cache } = await supabase
      .from('compliance_matrix_cache')
      .select('requirements')
      .eq('notice_id', noticeId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (Array.isArray(cache?.requirements)) {
      requirements = (cache!.requirements as Array<{ requirement: string; category?: string; section?: string }>).slice(0, 200);
    }
  }
  return { rfpText, rfpFileName: primary?.filename || 'Solicitation', requirements };
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '').trim();
  const message = String(body.message || '').trim();
  if (!email || !message) {
    return NextResponse.json({ success: false, error: 'email and message are required' }, { status: 400 });
  }
  const auth = requireMIAuthSession(request, email);
  if (!auth.ok) return auth.response;

  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) {
    return NextResponse.json({ success: false, error: 'GROQ_API_KEY not configured' }, { status: 500 });
  }

  // REUSE what Auto mode already built (Eric: don't re-process — the docs are
  // extracted and the matrix is cached). When a pipeline_id is sent, load the
  // extracted docs + cached compliance requirements server-side instead of
  // re-sending 350K chars every message. Scales + cuts tokens + faster.
  const pipelineId = String(body.pipeline_id || '').trim();
  let rfpText = String(body.rfpText || '').slice(0, RFP_MAX_CHARS);
  let rfpFileName = String(body.rfpFileName || '');
  let cachedRequirements: Array<{ requirement: string; category?: string; section?: string }> = [];
  if (pipelineId) {
    const loaded = await loadPursuitContext(pipelineId);
    if (loaded.rfpText) { rfpText = loaded.rfpText; rfpFileName = loaded.rfpFileName || rfpFileName; }
    cachedRequirements = loaded.requirements;
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (obj: unknown) => controller.enqueue(encoder.encode(sseEvent(obj)));
      try {
        // Context = the user's OWN docs (profile + Vault + RFP) PLUS the
        // proposal RAG as the build standard. RAG query = the user's message +
        // a slice of the RFP so retrieval is relevant to what they're writing.
        const ragQuery = `${message}\n${rfpText.slice(0, 1500)}`.trim();
        const [profile, vault, ragChunks] = await Promise.all([
          loadBidderProfile(email),
          // 'exec_summary' pulls identity + past performance + capabilities.
          loadVaultContext(email, 'exec_summary'),
          retrieveRagContext({ query: ragQuery, docTypes: PROPOSAL_DOC_TYPES, limit: 4, maxChars: 3000, maxPerDoc: 1 })
            .catch(() => []),
        ]);

        const profileBlock = formatProfileForPrompt(profile);
        const vaultBlock = formatVaultForPrompt(vault);
        const ragBlock = formatChunksForPrompt(ragChunks);
        const sources: string[] = [];
        if (rfpText) sources.push(rfpFileName || 'Uploaded RFP');
        if (vault.has_any) sources.push('Your Vault (profile, past performance, capabilities)');
        if (cachedRequirements.length) sources.unshift(`${cachedRequirements.length} extracted requirements (cached matrix)`);
        if (ragChunks.length) sources.push(`Proposal corpus (${ragChunks.length} winning-volume references)`);
        send({ type: 'sources', sources });

        // The CACHED compliance requirements are the distilled solicitation —
        // put them FIRST so the chat answers specific questions ("how many past-
        // perf refs?") from structure, fast, before re-reading raw text.
        const reqBlock = cachedRequirements.length
          ? cachedRequirements.map((r, i) => `${i + 1}. [${r.category || 'other'}${r.section ? ` · ${r.section}` : ''}] ${r.requirement}`).join('\n')
          : '';
        // Select the RFP slices most relevant to the question (not first-8K) —
        // the fallback when the structured requirements don't cover the ask.
        const relevantRfp = rfpText ? selectRelevantRfp(rfpText, message, RFP_CONTEXT_BUDGET) : '';
        const contextParts = [
          reqBlock ? `EXTRACTED REQUIREMENTS (the solicitation's obligations, already parsed — answer specific questions from THIS first):\n${reqBlock}` : '',
          profileBlock ? `COMPANY PROFILE:\n${profileBlock}` : '',
          vaultBlock ? `VAULT:\n${vaultBlock}` : '',
          relevantRfp ? `RFP / SOLICITATION TEXT${rfpFileName ? ` (${rfpFileName})` : ''} — relevant excerpts:\n${relevantRfp}` : '',
          ragBlock ? `PROPOSAL CORPUS — how real winning volumes are built (STYLE reference, DO NOT copy verbatim):\n${ragBlock}` : '',
        ].filter(Boolean).join('\n\n---\n\n');

        const messages: Array<{ role: string; content: string }> = [
          { role: 'system', content: SYSTEM_PROMPT },
        ];
        const history = Array.isArray(body.history) ? body.history.slice(-HISTORY_LIMIT) : [];
        for (const h of history) {
          if (h.role === 'user' || h.role === 'assistant') {
            messages.push({ role: h.role, content: String(h.content || '').slice(0, 2000) });
          }
        }
        const userTurn = contextParts
          ? `${message}\n\n---\nUSE ONLY THIS CONTEXT (the user's own docs):\n${contextParts}`
          : `${message}\n\n(No RFP uploaded and Vault is empty — tell the user what to add.)`;
        messages.push({ role: 'user', content: userTurn });

        // Stream from Groq; on rate-limit/failure fall back to a non-streaming
        // provider (Claude/OpenAI) so the chat NEVER dies on a 429 (Eric QC).
        // GPT-4o-mini FIRST, STREAMING (Eric: Groq gave generic "no past-perf
        // requirement" filler; gpt-4o-mini extracts the exact clause like Claude,
        // but is scalable at $149 — Claude could run a $200 bill). Both speak the
        // OpenAI stream format → same SSE parser, streaming UX kept. Groq is the
        // cheap fallback; callLLM('reasoning') the deep fallback (Claude last).
        const openaiKey = process.env.OPENAI_API_KEY;
        // Proposal chat is the drafting assistant — it extracts exact clauses and
        // writes sections, so quality pays (Eric, Jul 2). Lead with full gpt-4o.
        // The per-user budget cap below already downgrades heavy users to Groq, so
        // the margin is protected even at the higher model. CHAT_OPENAI_MODEL env
        // can dial it back if needed.
        const chatModel = process.env.CHAT_OPENAI_MODEL || 'gpt-4o';
        const streamFrom = (url: string, key: string, model: string) => fetch(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, messages, temperature: TEMPERATURE, max_tokens: MAX_TOKENS, stream: true }),
        });
        let groqRes: Response | null = null;
        // Budget cap (#37): a user past their monthly LLM budget is downgraded to
        // cheap Groq (never blocked — degraded, not denied). Protects $149 margin.
        const overBudget = await isUserOverBudget(email).catch(() => false);
        if (openaiKey && !overBudget) {
          const r = await streamFrom('https://api.openai.com/v1/chat/completions', openaiKey, chatModel);
          if (r.ok && r.body) groqRes = r;
        }
        if (!groqRes) {
          groqRes = await streamFrom('https://api.groq.com/openai/v1/chat/completions', groqKey, GROQ_MODEL);
          if (groqRes.status === 429) groqRes = await streamFrom('https://api.groq.com/openai/v1/chat/completions', groqKey, 'llama-3.3-70b-versatile');
        }
        if (!groqRes.ok || !groqRes.body) {
          // Last resort: non-streaming callLLM (Claude/OpenAI) so chat never dies.
          try {
            const { text } = await callLLM({ system: SYSTEM_PROMPT, user: messages[messages.length - 1].content, maxTokens: MAX_TOKENS, temperature: TEMPERATURE, job: 'reasoning' });
            if (text?.trim()) { send({ type: 'token', content: text }); send({ type: 'done' }); controller.close(); return; }
          } catch { /* fall to error */ }
          send({ type: 'error', message: 'AI is busy right now — try again in a moment.' });
          send({ type: 'done' });
          controller.close();
          return;
        }

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
              const delta = JSON.parse(payload)?.choices?.[0]?.delta?.content;
              if (typeof delta === 'string' && delta.length > 0) send({ type: 'token', content: delta });
            } catch { /* keep-alive line */ }
          }
        }
        send({ type: 'done' });
        controller.close();
      } catch (e) {
        send({ type: 'error', message: (e as Error).message });
        send({ type: 'done' });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' },
  });
}

// Compact the Vault context into a prompt block.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatVaultForPrompt(vault: any): string {
  const out: string[] = [];
  if (vault?.identity) {
    const i = vault.identity;
    const id = [i.legal_name && `Legal name: ${i.legal_name}`, i.uei && `UEI: ${i.uei}`, i.cage_code && `CAGE: ${i.cage_code}`, Array.isArray(i.certifications) && i.certifications.length && `Certs: ${i.certifications.join(', ')}`, i.primary_naics && `NAICS: ${Array.isArray(i.primary_naics) ? i.primary_naics.join(', ') : i.primary_naics}`].filter(Boolean).join(' | ');
    if (id) out.push(`Identity: ${id}`);
    if (i.one_liner) out.push(`One-liner: ${i.one_liner}`);
  }
  if (vault?.past_performance?.length) {
    out.push('Past performance:');
    for (const p of vault.past_performance.slice(0, 6)) {
      out.push(`- ${p.contract_title || 'Contract'} (${p.agency || '—'}${p.contract_value ? `, $${Number(p.contract_value).toLocaleString()}` : ''}): ${String(p.scope_description || '').slice(0, 240)}`);
    }
  }
  if (vault?.capabilities?.length) {
    out.push('Capabilities:');
    for (const c of vault.capabilities.slice(0, 8)) {
      out.push(`- ${c.capability_name}: ${String(c.description || '').slice(0, 160)}`);
    }
  }
  return out.join('\n');
}
