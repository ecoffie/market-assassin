import { NextRequest, NextResponse } from 'next/server';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { logToolError, ToolNames, AIProviders, classifyError } from '@/lib/tool-errors';
import { normalizeCategory } from '@/lib/proposal/section-alignment';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { callLLM } from '@/lib/llm/call-llm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Large packages (13+ docs) ran the chunk extraction serially and blew past the
// default function limit — Eric saw it fail at 88s, then ~200s (Jun 26). Give it
// headroom AND parallelize the chunks below so it finishes in ~30-40s.
export const maxDuration = 300;

// Run an async fn over items with bounded concurrency, preserving input order.
async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = process.env.PROPOSAL_GROQ_MODEL || 'llama-3.3-70b-versatile';

// Cap source text we send to the model. 50K chars ~ 12K tokens, well under llama 3.3's window
// and lets us return useful coverage even on long RFPs without rate-limit pain.
const MAX_INPUT_CHARS = 50000;

interface ComplianceRequirement {
  id: string;
  requirement: string;
  category: 'submission' | 'evaluation' | 'technical' | 'past_performance' | 'pricing' | 'admin' | 'other';
  section?: string;
  source_quote?: string;
  source_doc?: string;   // which doc this came from (e.g. "Amendment 0004")
  revised?: boolean;     // true when an amendment changed this requirement
}

interface RequestBody {
  text?: string;
  fileName?: string;
  pipeline_id?: string;  // multi-doc mode: extract from base + amendments + Q&A
}

const SYSTEM_PROMPT = `You are a federal proposal compliance analyst. Read the solicitation excerpt and extract EVERY explicit requirement, instruction, or evaluation factor a bidder must address.

Look for:
- "shall", "must", "will", "required", "is required to" obligations
- Section L (Instructions to Offerors), Section M (Evaluation Factors), Section C (SOW/PWS)
- Submission deadlines, page limits, formatting rules, copies required, portal/method
- Required certifications, representations, reps & certs
- Past performance volume, technical volume, price volume requirements
- Evaluation factors and their relative weights

Return ONLY valid JSON in this exact shape, no prose, no markdown fences:
{
  "requirements": [
    {
      "id": "REQ-001",
      "requirement": "Short one-line statement of what bidder must do",
      "category": "submission" | "evaluation" | "technical" | "past_performance" | "pricing" | "admin" | "other",
      "section": "L.3.2",        // optional, omit if unknown
      "source_quote": "..."       // optional, ~12-25 words verbatim from the doc
    }
  ]
}

Rules:
- Aim for 15-50 requirements. Skip vague or aspirational language.
- One requirement per row. Split compound "shall" sentences into separate rows.
- Use stable ids REQ-001, REQ-002, ... in document order.
- Prefer crisp imperatives in "requirement" ("Submit Past Performance volume in PDF, max 25 pages").
- If a section/clause label is visible nearby (L.3, M-2, 52.212-1), put it in "section".`;

const GROQ_MODEL_FALLBACK = process.env.PROPOSAL_FALLBACK_MODEL || 'llama-3.1-8b-instant';

/** Split text into chunks ≤ maxChars, breaking at paragraph boundaries so a
 *  requirement isn't sliced mid-sentence. */
function chunkText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const chunks: string[] = [];
  const paras = text.split(/\n\s*\n/);
  let cur = '';
  for (const p of paras) {
    if ((cur + '\n\n' + p).length > maxChars && cur) { chunks.push(cur); cur = ''; }
    // a single huge paragraph (e.g. a wage table) — hard-split it.
    if (p.length > maxChars) {
      for (let i = 0; i < p.length; i += maxChars) chunks.push(p.slice(i, i + maxChars));
    } else {
      cur = cur ? `${cur}\n\n${p}` : p;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

// Amendments + Q&A don't use "shall" — they state CHANGES ("the purpose of this
// amendment is to extend the closing date to X", "Question 5: … Answer: …").
// A dedicated prompt catches those so revised deadlines/specs/answers aren't
// missed (Eric QC: amendments touched the deadline but extracted 0).
const AMENDMENT_PROMPT = `You are a federal proposal analyst reading an AMENDMENT or Q&A document. Extract every CHANGE or clarification a bidder must now follow:
- Revised dates (new closing/response date, extended deadline)
- Revised specifications, quantities, scope, or page limits
- Questions & their answers that change or clarify a requirement
- New documents/attachments that must be submitted
Phrase each as the CURRENT requirement (e.g. "Submit offers by the revised closing date of June 30, 2026", "Q12: tile must be commercial-grade per the answer").
Return ONLY JSON {"requirements":[{"id","requirement","category","section"}]} category in submission|evaluation|technical|past_performance|pricing|admin|other. Skip the SF30 boilerplate (copies, acknowledgment instructions). If the amendment makes no substantive change, return an empty array.`;

/** Extract requirements from ONE chunk. Uses the amendment/Q&A prompt when
 *  isChange. PROVIDER-AGNOSTIC via callLLM: Groq 70B → 8B → Claude → OpenAI →
 *  Grok, so a throttle on any one provider (Eric: Groq's paid tier is closed)
 *  falls through to the next instead of returning an empty matrix. */
async function extractChunk(_apiKey: string, fileName: string | undefined, chunk: string, isChange = false): Promise<ComplianceRequirement[] | null> {
  const prompt = isChange ? AMENDMENT_PROMPT : SYSTEM_PROMPT;
  try {
    const { text: raw } = await callLLM({
      system: prompt,
      user: `${isChange ? 'Amendment/Q&A' : 'Solicitation'}: ${fileName || 'untitled'}\n\n--- SOURCE TEXT ---\n${chunk}`,
      json: true,
      maxTokens: 4000,
      temperature: 0.2,
      job: 'extraction', // high volume — Groq only, never Claude
    });
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed.requirements) ? parsed.requirements : [];
  } catch (err) {
    console.warn('[compliance] chunk failed (all providers):', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Multi-doc extraction with AMENDMENT PRECEDENCE (Eric QC). Pull the pursuit's
 * classified docs (base solicitation + Q&A + amendments in order), extract
 * requirements from each, then merge: a later amendment that revises a base
 * requirement WINS and is flagged `revised`. Returns the current, accurate set.
 */
async function extractMultiDoc(apiKey: string, pipelineId: string, email: string): Promise<{ requirements: ComplianceRequirement[]; sources: string[]; cached?: boolean } | null> {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: docs } = await supabase
    .from('pursuit_documents')
    .select('filename, doc_kind, extracted_text, downloaded_at, notice_id, doc_source')
    .eq('pipeline_id', pipelineId)
    .in('doc_kind', ['solicitation', 'qa', 'amendment', 'instructions', 'eval_factors', 'sow_pws'])
    .not('extracted_text', 'is', null);
  if (!docs || docs.length === 0) return null;

  // SHARED CACHE (Eric: scaling — the matrix for a PUBLIC SAM notice is identical
  // for every user bidding it; extract once, serve all). Only cache when the
  // docs are public SAM attachments (a user's OWN uploads stay private). Key on
  // a content hash of the doc set so an amendment landing → new docs → new hash
  // → re-extract automatically.
  const noticeId = docs.find(d => d.notice_id)?.notice_id || '';
  const allPublic = docs.every(d => d.doc_source === 'sam_public');
  const sig = docs.map(d => `${d.filename}:${(d.extracted_text || '').length}`).sort().join('|');
  const contentHash = noticeId && allPublic
    ? crypto.createHash('sha256').update(`${noticeId}::${sig}`).digest('hex')
    : null;

  if (contentHash) {
    const { data: hit } = await supabase
      .from('compliance_matrix_cache')
      .select('requirements, doc_sources, hits')
      .eq('content_hash', contentHash)
      .maybeSingle();
    if (hit?.requirements) {
      // count the hit (fire-and-forget) and serve instantly — ~0 tokens.
      supabase.from('compliance_matrix_cache').update({ hits: (hit.hits || 0) + 1 }).eq('content_hash', contentHash).then(() => {});
      return { requirements: hit.requirements as ComplianceRequirement[], sources: (hit.doc_sources as string[]) || [], cached: true };
    }
  }

  // Order: base/scope first, amendments LAST (so they override) by amd number.
  const amdNum = (fn: string) => parseInt((fn.match(/amd[_ -]?(\d+)/i)?.[1]) || '0', 10);
  const ordered = [...docs].sort((a, b) => {
    const aw = a.doc_kind === 'amendment' ? 1000 + amdNum(a.filename || '') : 0;
    const bw = b.doc_kind === 'amendment' ? 1000 + amdNum(b.filename || '') : 0;
    return aw - bw;
  });

  // Merge into a map keyed by a normalized requirement signature. Amendments
  // overwrite a matching base requirement (flag revised); new amendment reqs add.
  const map = new Map<string, ComplianceRequirement>();
  const sources: string[] = [];
  const sigOf = (r: ComplianceRequirement) => (r.requirement || '').toLowerCase().replace(/\s+/g, ' ').slice(0, 60);

  // Build the chunk worklist across ALL docs IN PRECEDENCE ORDER (base first,
  // amendments last). Bounded per-doc AND globally so a 13-doc package can't spawn
  // hundreds of serial LLM calls and time out (Eric, Jun 26). Chunks are then
  // extracted in PARALLEL (bounded) and merged back in order, so amendments still
  // override base requirements.
  const MAX_CHUNKS_PER_DOC = 30;   // 30 × 14K ≈ 420K chars covered per doc
  // High ceiling so coverage isn't cut (a 13-doc package needs ~120 chunks for its
  // 286 requirements — Eric, Jun 26). Speed comes from PARALLELISM below, not from
  // dropping chunks: ~120 chunks ÷ 6 concurrent ≈ 60s vs the old ~300s serial.
  const MAX_TOTAL_CHUNKS = 200;
  const EXTRACT_CONCURRENCY = 6;
  type ChunkTask = { docIndex: number; label: string; isAmendment: boolean; isChange: boolean; filename?: string; chunk: string };
  const tasks: ChunkTask[] = [];
  ordered.forEach((doc, docIndex) => {
    const text = doc.extracted_text || '';
    const label = doc.doc_kind === 'amendment'
      ? `Amendment ${String(amdNum(doc.filename || '')).padStart(4, '0')}`
      : (doc.doc_kind || 'document');
    const isChange = doc.doc_kind === 'amendment' || doc.doc_kind === 'qa';
    const chunks = chunkText(text, 14000).slice(0, MAX_CHUNKS_PER_DOC);
    for (const c of chunks) {
      if (tasks.length >= MAX_TOTAL_CHUNKS) break;
      tasks.push({ docIndex, label, isAmendment: doc.doc_kind === 'amendment', isChange, filename: doc.filename, chunk: c });
    }
  });

  const taskResults = await mapPool(tasks, EXTRACT_CONCURRENCY, (t) => extractChunk(apiKey, t.filename, t.chunk, t.isChange));

  // Merge in task order (== precedence order) so amendments overwrite base.
  const perDocCount = new Map<number, number>();
  taskResults.forEach((reqs, i) => {
    if (!reqs) return;
    const t = tasks[i];
    perDocCount.set(t.docIndex, (perDocCount.get(t.docIndex) || 0) + reqs.length);
    for (const r of reqs) {
      const sig = sigOf(r);
      if (!sig) continue;
      const tagged = { ...r, source_doc: t.label, revised: t.isAmendment && map.has(sig) };
      map.set(sig, tagged);
    }
  });
  ordered.forEach((_, docIndex) => {
    const count = perDocCount.get(docIndex) || 0;
    if (count) sources.push(`${tasks.find(t => t.docIndex === docIndex)?.label || 'document'} (${count})`);
  });
  const requirements = Array.from(map.values()).map((r, i) => ({ ...r, id: `REQ-${String(i + 1).padStart(3, '0')}` }));
  // Store in the shared cache so the next user bidding this notice is instant +
  // free (only for public SAM doc sets).
  if (contentHash && requirements.length > 0) {
    supabase.from('compliance_matrix_cache').upsert({
      content_hash: contentHash,
      notice_id: noticeId,
      requirements,
      doc_sources: sources,
      req_count: requirements.length,
      model: GROQ_MODEL,
    }, { onConflict: 'content_hash' }).then(() => {}, () => {});
  }

  return { requirements, sources };
}

export async function POST(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email');
  if (!email) {
    return NextResponse.json({ success: false, error: 'email query param is required' }, { status: 400 });
  }

  const authSession = requireMIAuthSession(request, email);
  if (!authSession.ok) return authSession.response;

  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  // Any one provider key is enough — callLLM falls through the chain.
  const apiKey = process.env.GROQ_API_KEY || '';
  if (!process.env.GROQ_API_KEY && !process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY && !process.env.GROK_API_KEY) {
    return NextResponse.json(
      { success: false, error: 'AI service not configured' },
      { status: 500 }
    );
  }

  // MULTI-DOC mode (Eric QC: amendments revise the base — deadlines/specs — so a
  // base-only matrix is STALE and would pass a non-compliant bid). When a
  // pipeline_id is sent, extract from base solicitation + AMENDMENTS + Q&A, and
  // merge with AMENDMENT PRECEDENCE (later amendments win; flag what changed).
  let sourceText = (body.text || '').trim();
  let multiDocResult: { requirements: ComplianceRequirement[]; sources: string[]; cached?: boolean } | null = null;
  if (body.pipeline_id && email) {
    multiDocResult = await extractMultiDoc(apiKey, body.pipeline_id, email);
  }
  if (!multiDocResult && !sourceText) {
    return NextResponse.json(
      { success: false, error: 'No source text provided. Upload an RFP first.' },
      { status: 400 }
    );
  }

  const wasTruncated = sourceText.length > MAX_INPUT_CHARS;
  const inputText = wasTruncated ? sourceText.slice(0, MAX_INPUT_CHARS) : sourceText;

  try {
    let merged: ComplianceRequirement[];
    let anyOk: boolean;
    let docSources: string[] = [];
    if (multiDocResult) {
      merged = multiDocResult.requirements;
      anyOk = merged.length > 0;
      docSources = multiDocResult.sources;
    } else {
      // Single-doc (legacy): chunk the flat text, extract IN PARALLEL, merge.
      const chunks = chunkText(inputText, 14000).slice(0, 48);
      merged = [];
      anyOk = false;
      const chunkResults = await mapPool(chunks, 6, (chunk) => extractChunk(apiKey, body.fileName, chunk));
      for (const reqs of chunkResults) {
        if (reqs !== null) { anyOk = true; merged.push(...reqs); }
      }
    }
    void docSources;
    const response = { ok: anyOk, status: anyOk ? 200 : 500 };

    if (!response.ok) {
      await logToolError({
        tool: ToolNames.PROPOSAL_ASSIST,
        errorType: 'api_error',
        errorMessage: 'compliance extraction failed on all chunks',
        requestPath: '/api/app/proposal/compliance',
        aiProvider: AIProviders.GROQ,
        aiModel: GROQ_MODEL,
      });
      return NextResponse.json(
        { success: false, error: 'AI service error. Try again.' },
        { status: 500 }
      );
    }

    // Dedupe near-identical requirements across chunks; re-id in order.
    const seen = new Set<string>();
    const deduped = merged.filter(r => {
      const k = (r.requirement || '').toLowerCase().replace(/\s+/g, ' ').slice(0, 80);
      if (!k || seen.has(k)) return false; seen.add(k); return true;
    }).map((r, i) => ({ ...r, id: `REQ-${String(i + 1).padStart(3, '0')}` }));
    const parsed: { requirements?: ComplianceRequirement[] } = { requirements: deduped };

    // Normalize categories — the model often ignores our enum and uses the
    // doc's own headings ("Project Objectives") which broke alignment + would
    // mislead the compliance referee (Eric's QC catch). Remap to our 7 so every
    // requirement routes to a real section.
    const rawReqs = Array.isArray(parsed.requirements) ? parsed.requirements : [];
    const requirements = rawReqs.map((r) => ({
      ...r,
      category: normalizeCategory(r.category as string | undefined, r.requirement),
    }));

    return NextResponse.json({
      success: true,
      requirements,
      meta: {
        model: GROQ_MODEL,
        inputChars: inputText.length,
        // Multi-doc mode chunks each doc fully (no 50K slice), so it's not
        // truncated; the single-doc legacy path still reports its cap.
        truncated: multiDocResult ? false : wasTruncated,
        originalChars: sourceText.length,
        count: requirements.length,
        sources: multiDocResult?.sources,
        multiDoc: !!multiDocResult,
        cached: multiDocResult?.cached || false,
      },
    });
  } catch (err) {
    console.error('[proposal/compliance] exception:', err);
    const errAsError = err instanceof Error ? err : new Error(String(err));
    await logToolError({
      tool: ToolNames.PROPOSAL_ASSIST,
      errorType: classifyError(errAsError),
      errorMessage: errAsError.message,
      requestPath: '/api/app/proposal/compliance',
      aiProvider: AIProviders.GROQ,
      aiModel: GROQ_MODEL,
    });
    return NextResponse.json(
      { success: false, error: 'Compliance extraction failed. Try again.' },
      { status: 500 }
    );
  }
}
