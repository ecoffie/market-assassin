/**
 * Compliance-matrix extraction — the shared engine behind BOTH the in-app proposal
 * route (`/api/app/proposal/compliance`) and the MCP tool (`extract_compliance_matrix`).
 *
 * Harvest every explicit shall/must/required obligation, instruction and evaluation
 * factor from a solicitation into a structured matrix. The LLM only PROPOSES rows —
 * `src/lib/proposal/matrix-verification.ts` decides which ones survive. LLM-backed (Groq llama-3.3 via the
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
import { recoverMissingSourceSpecs } from '@/lib/proposal/matrix-source-coverage';

export const GROQ_MODEL = process.env.PROPOSAL_GROQ_MODEL || 'llama-3.3-70b-versatile';

/** Cap source text per extraction. 50K chars ~ 12K tokens, well under llama 3.3's
 *  window and enough coverage without rate-limit pain. */
export const MAX_INPUT_CHARS = 50000;

/**
 * If the RFP is longer than the cap, keep the front matter AND a window
 * around Section 3.0 / SOW / PWS. Truncating the first 50K chars dropped
 * the named technical specs (LOA, flight deck, SCIF, berthing, magazine)
 * while the pasted full text still produced them.
 */
export function prioritizeExtractionWindows(text: string, maxChars = MAX_INPUT_CHARS): {
  text: string;
  truncated: boolean;
  kept_section_3: boolean;
  /** [start, end) offsets of the ORIGINAL text that the window kept. */
  ranges: Array<[number, number]>;
} {
  const sectionRe = /(?:^|\n)\s*(?:section\s*)?3\.0\b|statement of work|performance work statement/i;
  const idx = text.search(sectionRe);
  const hasSection = idx >= 0;
  if (text.length <= maxChars) {
    return { text, truncated: false, kept_section_3: hasSection, ranges: [[0, text.length]] };
  }
  if (!hasSection || idx < maxChars) {
    return {
      text: text.slice(0, maxChars), truncated: true, kept_section_3: hasSection && idx < maxChars,
      ranges: [[0, maxChars]],
    };
  }
  const marker = '\n\n--- SECTION 3.0 WINDOW ---\n\n';
  const specBudget = Math.max(8_000, maxChars - Math.floor(maxChars * 0.5) - marker.length);
  const headBudget = maxChars - specBudget - marker.length;
  const head = text.slice(0, headBudget);
  const spec = text.slice(idx, idx + specBudget);
  return {
    text: `${head}${marker}${spec}`, truncated: true, kept_section_3: true,
    ranges: [[0, headBudget], [idx, Math.min(text.length, idx + specBudget)]],
  };
}

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
- Instructions to offerors, evaluation factors/basis for award, and SOW/PWS obligations — wherever this solicitation places them (UCF Sections L/M/C, FAR 52.212-1/52.212-2 provisions, an SF 1442 block, or plain headings)
- Submission deadlines, page limits, formatting rules, copies required, portal/method
- Required certifications, representations, reps & certs
- Past performance volume, technical volume, price volume requirements
- Evaluation factors and their relative weights
- Section C / 3.0 technical specifications when present: dimensions and envelopes (LOA, beam, draft), facilities (flight deck, SCIF, berthing, magazine, fuel storage), performance, and each named spec as its own technical row. Do not skip a named technical spec because an admin shall already filled the 15-row floor.

Return ONLY valid JSON in this exact shape, no prose, no markdown fences:
{
  "requirements": [
    {
      "id": "REQ-001",
      "requirement": "Short one-line statement of what bidder must do",
      "category": "submission" | "evaluation" | "technical" | "past_performance" | "pricing" | "admin" | "other",
      "section": "2.15",         // optional — the heading label EXACTLY as printed above the quote; omit if none
      "source_quote": "..."       // REQUIRED — 12-40 words copied character-for-character from the source
    }
  ]
}

Rules:
- Extract every named technical specification in Section C / 3.0 as its own row. Coverage of those specs is the completeness test — not the row count.
- Aim for 15-50 requirements. Skip vague or aspirational language.
- One requirement per row. Split compound "shall" sentences into separate rows.
- Use stable ids REQ-001, REQ-002, ... in document order.
- Prefer crisp imperatives in "requirement" ("Submit Past Performance volume in PDF, max 25 pages").
- source_quote is the evidence a reviewer will check against the document: copy it verbatim (no rewording, no added words, no "..." unless you truly skipped text). It must contain every number, date, amount, and section/clause reference that the "requirement" states. If you cannot quote it, do not emit the row.
- "section" is ONLY a label printed in the document as the heading above the quote (e.g. "2.15", "E.1", "52.212-1"). Copy it exactly — never add a prefix (write "2.15", not "C.2.15"), never use a clause's paragraph letter ("(l)", "(m)") as a section, and never cite "Section L", "Section M" or "Section C" unless those words are printed in this document. When unsure, omit "section".
- Rows from a table (e.g. a submittal log): quote the table text that carries the item and its section/spec column; do not attach a sentence from elsewhere as the quote.`;

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
  /** [start, end) offsets of the input text the model actually saw. */
  windowRanges: Array<[number, number]>;
  /** Named source-spec anchors recovered deterministically after the LLM pass. */
  recovered_source_specs?: string[];
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
  const windowed = prioritizeExtractionWindows(text);
  const truncated = windowed.truncated;
  const inputText = windowed.text;

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
  const llmRequirements = merged
    .filter((r) => {
      const k = (r.requirement || '').toLowerCase().replace(/\s+/g, ' ').slice(0, 80);
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((r) => ({
      ...r,
      category: normalizeCategory(r.category as string | undefined, r.requirement),
    }));

  // Named Section 3.0 specs (LOA, flight deck, SCIF, …) often appear as capability
  // lines without shall/must — the LLM skips them. Recover from the source sentence
  // so completeness is not luck-dependent (SCIF on notice 6552b25b…).
  const recovered = recoverMissingSourceSpecs(text, llmRequirements);
  const requirements = recovered.requirements.map((r, i) => ({
    ...r,
    id: `REQ-${String(i + 1).padStart(3, '0')}`,
    category: normalizeCategory(
      (r as ComplianceRequirement).category as string | undefined,
      (r as ComplianceRequirement).requirement,
    ),
  })) as ComplianceRequirement[];

  return {
    requirements,
    ok,
    model: GROQ_MODEL,
    inputChars: inputText.length,
    originalChars,
    truncated,
    windowRanges: windowed.ranges,
    recovered_source_specs: recovered.recovered_ids,
  };
}
