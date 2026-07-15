/**
 * Compliance-matrix extraction — the shared engine behind BOTH the in-app proposal
 * route (`/api/app/proposal/compliance`) and the MCP tool (`extract_compliance_matrix`).
 *
 * Harvest every explicit shall/must/required obligation + Section L/M/C requirement
 * from a solicitation into a structured matrix. LLM-backed (Groq llama-3.3 via the
 * provider-agnostic callLLM chain), chunked + extracted in PARALLEL so a long RFP
 * finishes in ~30-40s instead of timing out.
 *
 * Factored out of the route (Jul 2026) so the single-doc path is a pure, transport-
 * agnostic fn — no auth, no NextResponse, no private-pipeline dependency. The route
 * keeps its own multi-doc/amendment-precedence mode (which needs a logged-in user's
 * pursuit_documents); this lib is the primitives + the single-doc flow they share.
 */
import { normalizeCategory } from '@/lib/proposal/section-alignment';
import { callLLM } from '@/lib/llm/call-llm';

export const GROQ_MODEL = process.env.PROPOSAL_GROQ_MODEL || 'llama-3.3-70b-versatile';

/** Cap source text per extraction. 50K chars ~ 12K tokens, well under llama 3.3's
 *  window and enough coverage without rate-limit pain. */
export const MAX_INPUT_CHARS = 50000;

export interface ComplianceRequirement {
  id: string;
  requirement: string;
  category: 'submission' | 'evaluation' | 'technical' | 'past_performance' | 'pricing' | 'admin' | 'other';
  section?: string;
  source_quote?: string;
  source_doc?: string; // which doc this came from (e.g. "Amendment 0004")
  revised?: boolean; // true when an amendment changed this requirement
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

// Amendments + Q&A don't use "shall" — they state CHANGES ("the purpose of this
// amendment is to extend the closing date to X", "Question 5: … Answer: …"). A
// dedicated prompt catches those so revised deadlines/specs/answers aren't missed
// (Eric QC: amendments touched the deadline but extracted 0).
const AMENDMENT_PROMPT = `You are a federal proposal analyst reading an AMENDMENT or Q&A document. Extract every CHANGE or clarification a bidder must now follow:
- Revised dates (new closing/response date, extended deadline)
- Revised specifications, quantities, scope, or page limits
- Questions & their answers that change or clarify a requirement
- New documents/attachments that must be submitted
Phrase each as the CURRENT requirement (e.g. "Submit offers by the revised closing date of June 30, 2026", "Q12: tile must be commercial-grade per the answer").
Return ONLY JSON {"requirements":[{"id","requirement","category","section"}]} category in submission|evaluation|technical|past_performance|pricing|admin|other. Skip the SF30 boilerplate (copies, acknowledgment instructions). If the amendment makes no substantive change, return an empty array.`;

/** Run an async fn over items with bounded concurrency, preserving input order. */
export async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
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

/** Split text into chunks ≤ maxChars, breaking at paragraph boundaries so a
 *  requirement isn't sliced mid-sentence. */
export function chunkText(text: string, maxChars: number): string[] {
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

/** Extract requirements from ONE chunk. Uses the amendment/Q&A prompt when isChange.
 *  PROVIDER-AGNOSTIC via callLLM: Groq 70B → 8B → Claude → OpenAI → Grok, so a
 *  throttle on any one provider falls through instead of returning an empty matrix.
 *  Returns null on a hard failure (so the caller can distinguish "provider down"
 *  from "genuinely no requirements"). `userEmail` attributes LLM cost to the caller. */
export async function extractChunk(
  fileName: string | undefined,
  chunk: string,
  isChange = false,
  userEmail: string | null = null,
): Promise<ComplianceRequirement[] | null> {
  const prompt = isChange ? AMENDMENT_PROMPT : SYSTEM_PROMPT;
  try {
    const { text: raw } = await callLLM({
      system: prompt,
      user: `${isChange ? 'Amendment/Q&A' : 'Solicitation'}: ${fileName || 'untitled'}\n\n--- SOURCE TEXT ---\n${chunk}`,
      json: true,
      maxTokens: 4000,
      temperature: 0.2,
      job: 'extraction', // high volume — Groq only, never Claude
      tool: 'proposal_compliance',
      userEmail,
    });
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed.requirements) ? parsed.requirements : [];
  } catch (err) {
    console.warn('[compliance] chunk failed (all providers):', err instanceof Error ? err.message : err);
    return null;
  }
}

export interface MatrixExtraction {
  requirements: ComplianceRequirement[];
  ok: boolean; // at least one chunk returned (distinguishes provider-down from empty)
  model: string;
  inputChars: number;
  originalChars: number;
  truncated: boolean;
}

/**
 * Single-doc compliance-matrix extraction from flat text: truncate to the input cap,
 * chunk, extract each chunk IN PARALLEL, merge, dedupe near-identical requirements,
 * normalize categories to the 7-way enum, and re-id in order. Pure — no auth, no IO
 * beyond the LLM calls. `ok=false` means every chunk failed (provider down), distinct
 * from `requirements=[]` (genuinely nothing to extract).
 */
export async function extractComplianceMatrixFromText(
  text: string,
  opts: { fileName?: string; userEmail?: string | null } = {},
): Promise<MatrixExtraction> {
  const originalChars = text.length;
  const truncated = originalChars > MAX_INPUT_CHARS;
  const inputText = truncated ? text.slice(0, MAX_INPUT_CHARS) : text;

  const chunks = chunkText(inputText, 14000).slice(0, 48);
  const chunkResults = await mapPool(chunks, 6, (chunk) => extractChunk(opts.fileName, chunk, false, opts.userEmail ?? null));

  let ok = false;
  const merged: ComplianceRequirement[] = [];
  for (const reqs of chunkResults) {
    if (reqs !== null) { ok = true; merged.push(...reqs); }
  }

  // Dedupe near-identical requirements across chunks; re-id; normalize categories to
  // our 7-way enum (the model often echoes the doc's own headings, which breaks
  // downstream alignment — Eric QC).
  const seen = new Set<string>();
  const requirements = merged
    .filter((r) => {
      const k = (r.requirement || '').toLowerCase().replace(/\s+/g, ' ').slice(0, 80);
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((r, i) => ({
      ...r,
      id: `REQ-${String(i + 1).padStart(3, '0')}`,
      category: normalizeCategory(r.category as string | undefined, r.requirement),
    }));

  return { requirements, ok, model: GROQ_MODEL, inputChars: inputText.length, originalChars, truncated };
}
