import { NextRequest, NextResponse } from 'next/server';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { logToolError, ToolNames, AIProviders, classifyError } from '@/lib/tool-errors';
import { normalizeCategory } from '@/lib/proposal/section-alignment';

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
}

interface RequestBody {
  text?: string;
  fileName?: string;
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

/** Extract requirements from ONE chunk. 70B first; fall back to 8B on rate-
 *  limit / too-large. Returns [] on parse failure, null on hard failure. */
async function extractChunk(apiKey: string, fileName: string | undefined, chunk: string): Promise<ComplianceRequirement[] | null> {
  const call = async (model: string) => fetch(GROQ_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Solicitation: ${fileName || 'untitled'}\n\n--- SOURCE TEXT ---\n${chunk}` },
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

  const sourceText = (body.text || '').trim();
  if (!sourceText) {
    return NextResponse.json(
      { success: false, error: 'No source text provided. Upload an RFP first.' },
      { status: 400 }
    );
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { success: false, error: 'AI service not configured' },
      { status: 500 }
    );
  }

  const wasTruncated = sourceText.length > MAX_INPUT_CHARS;
  const inputText = wasTruncated ? sourceText.slice(0, MAX_INPUT_CHARS) : sourceText;

  try {
    // CHUNKED extraction (Eric QC: a real 89K-char solicitation returned
    // "Request too large" on 70B + 429'd on rate limit → the matrix was silently
    // empty). Split into ~14K chunks, extract per chunk (8B fallback on rate-
    // limit/too-large), merge + dedupe.
    const chunks = chunkText(inputText, 14000);
    const merged: ComplianceRequirement[] = [];
    let anyOk = false;
    for (const chunk of chunks) {
      const reqs = await extractChunk(apiKey, body.fileName, chunk);
      if (reqs !== null) { anyOk = true; merged.push(...reqs); }
    }
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
