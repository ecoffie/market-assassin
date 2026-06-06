import { NextRequest, NextResponse } from 'next/server';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { logToolError, ToolNames, AIProviders, classifyError } from '@/lib/tool-errors';
import { normalizeCategory } from '@/lib/proposal/section-alignment';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
 *  isChange. 70B first; fall back to 8B on rate-limit/too-large. */
async function extractChunk(apiKey: string, fileName: string | undefined, chunk: string, isChange = false): Promise<ComplianceRequirement[] | null> {
  const prompt = isChange ? AMENDMENT_PROMPT : SYSTEM_PROMPT;
  const call = async (model: string) => fetch(GROQ_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: `${isChange ? 'Amendment/Q&A' : 'Solicitation'}: ${fileName || 'untitled'}\n\n--- SOURCE TEXT ---\n${chunk}` },
      ],
      temperature: 0.2,
      max_tokens: 4000,
      response_format: { type: 'json_object' },
    }),
  });

  let res = await call(GROQ_MODEL);
  // 429 (rate limit) OR 413/400 "request too large" → fall back to 8B.
  if ((res.status === 429 || res.status === 413 || res.status === 400) && GROQ_MODEL !== GROQ_MODEL_FALLBACK) {
    res = await call(GROQ_MODEL_FALLBACK);
  }
  if (!res.ok) { console.warn('[compliance] chunk failed:', res.status); return null; }
  const j = await res.json();
  const raw = j.choices?.[0]?.message?.content || '';
  try {
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed.requirements) ? parsed.requirements : [];
  } catch { return []; }
}

/**
 * Multi-doc extraction with AMENDMENT PRECEDENCE (Eric QC). Pull the pursuit's
 * classified docs (base solicitation + Q&A + amendments in order), extract
 * requirements from each, then merge: a later amendment that revises a base
 * requirement WINS and is flagged `revised`. Returns the current, accurate set.
 */
async function extractMultiDoc(apiKey: string, pipelineId: string, email: string): Promise<{ requirements: ComplianceRequirement[]; sources: string[] } | null> {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: docs } = await supabase
    .from('pursuit_documents')
    .select('filename, doc_kind, extracted_text, downloaded_at')
    .eq('pipeline_id', pipelineId)
    .in('doc_kind', ['solicitation', 'qa', 'amendment', 'instructions', 'eval_factors', 'sow_pws'])
    .not('extracted_text', 'is', null);
  if (!docs || docs.length === 0) return null;

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
  for (const doc of ordered) {
    const text = (doc.extracted_text || '').slice(0, MAX_INPUT_CHARS);
    const label = doc.doc_kind === 'amendment'
      ? `Amendment ${String(amdNum(doc.filename || '')).padStart(4, '0')}`
      : (doc.doc_kind || 'document');
    const isChange = doc.doc_kind === 'amendment' || doc.doc_kind === 'qa';
    const chunks = chunkText(text, 14000);
    const reqs: ComplianceRequirement[] = [];
    for (const c of chunks) { const r = await extractChunk(apiKey, doc.filename, c, isChange); if (r) reqs.push(...r); }
    if (reqs.length) sources.push(`${label} (${reqs.length})`);
    for (const r of reqs) {
      const sig = sigOf(r);
      if (!sig) continue;
      const isAmendment = doc.doc_kind === 'amendment';
      const tagged = { ...r, source_doc: label, revised: isAmendment && map.has(sig) };
      map.set(sig, tagged); // later docs (amendments) overwrite → precedence
    }
  }
  const requirements = Array.from(map.values()).map((r, i) => ({ ...r, id: `REQ-${String(i + 1).padStart(3, '0')}` }));
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

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
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
  let multiDocResult: { requirements: ComplianceRequirement[]; sources: string[] } | null = null;
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
      // Single-doc (legacy): chunk the flat text, extract, merge.
      const chunks = chunkText(inputText, 14000);
      merged = [];
      anyOk = false;
      for (const chunk of chunks) {
        const reqs = await extractChunk(apiKey, body.fileName, chunk);
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
        truncated: wasTruncated,
        originalChars: sourceText.length,
        count: requirements.length,
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
