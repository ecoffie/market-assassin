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

// ═══════════════════════════════════════════════════════════════════════════════
// PACKAGE COVERAGE (Poteto "Compliance Matrix Completeness", 2026-09-22)
//
// The single-text path above reads at most MAX_INPUT_CHARS of a flattened package.
// On the gold master (VA 36C24226Q0857) that was 50,000 of 257,724 chars: Section E
// (52.212-1 addendum + every 52.212-2 evaluation factor) and six attachments were
// never seen by the model. The package path below reads every RELEVANT document in
// full, one document at a time, so document identity is structural, not inferred:
//
//   PACKAGE → DISPOSITION → WINDOWS → EXTRACT (parallel, deadline) → candidates
//
// Merge/dedupe happen AFTER the frozen truth gate (see mergeVerifiedByEvidence),
// because identity is evidence — a verified character range — never model text.
// ═══════════════════════════════════════════════════════════════════════════════

/** Window size per extraction call (unchanged from the single-text path). */
export const WINDOW_CHARS = 14_000;
/**
 * Overlap between consecutive windows of one document. MEASURED on the gold master:
 * the longest obligation-bearing sentence is 1,924 chars (p99 886), so a 2,000-char
 * overlap guarantees every such sentence lies wholly inside at least one window.
 */
export const WINDOW_OVERLAP_CHARS = 2_000;
/** Hard ceiling on windows per run; beyond it the uncovered range is REPORTED. */
export const MAX_PACKAGE_WINDOWS = 40;
/** All windows of a typical package run at once — latency is one wave, not N/6. */
export const PACKAGE_CONCURRENCY = 16;
/** Extraction deadline, leaving headroom under the 60s MCP route budget. */
export const PACKAGE_DEADLINE_MS = 42_000;

export interface PackageDocument {
  document_id: string;
  filename: string;
  text: string;
  doc_kind?: string | null;
}

/**
 * What the extractor did with a document. Every readable document gets exactly one
 * disposition, so "not read" is always a stated decision, never a silent drop.
 *  extract            — requirement-bearing; read in full by the model
 *  reference_data     — a data payload (wage determination rate tables). The
 *                       OBLIGATION to comply lives in the contract clauses, which are
 *                       extracted; thousands of rate lines are not matrix rows.
 *  duplicate          — byte-identical (whitespace-normalized) to an earlier document
 *  foreign_instrument — the document declares a different contract/solicitation
 *                       number and never names this one (a misfiled upload)
 *  empty              — no readable text
 */
export type DocumentDisposition = 'extract' | 'reference_data' | 'duplicate' | 'foreign_instrument' | 'empty';

export interface DocumentPlan {
  document_id: string;
  filename: string;
  chars: number;
  disposition: DocumentDisposition;
  reason?: string;
  windows: number;
  /**
   * Ranges inside an EXTRACTED document that were classified, not sent to the model
   * (a spreadsheet's bid-schedule line items). Considered, with a reason — never
   * silently unread.
   */
  reference_ranges?: Array<[number, number]>;
  reference_reason?: string;
}

export interface ExtractionWindow {
  window_id: string;
  document_id: string;
  filename: string;
  /** [char_start, char_end) of the document's own stored text (the hull of segments). */
  char_start: number;
  char_end: number;
  is_change: boolean;
  /** When set, the model reads ONLY these ranges (joined by newlines), not the hull. */
  segments?: Array<[number, number]>;
}

/**
 * Spreadsheet dumps ("=== Sheet: …" + CSV) mix bid-schedule LINE ITEMS with the notes
 * that carry real requirements. On the gold master the only statement that demolition
 * must meet ICRA Level 4 lives in a pricing-sheet note, while sending the whole sheet
 * made the model enumerate every line item until it hit its output cap (4,000 tokens,
 * truncated JSON → a failed window, every run). This splits CSV records (respecting
 * quoted multi-line cells) into line items (first cell is an item number) and the rest.
 * Returns null when the document is not a spreadsheet dump or has no line items.
 */
export function splitSpreadsheetLineItems(text: string): { notes: Array<[number, number]>; items: Array<[number, number]> } | null {
  if (!/^\s*=== Sheet:/.test(text)) return null;
  const records: Array<[number, number]> = [];
  let start = 0; let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') inQ = !inQ;
    else if (ch === '\n' && !inQ) { records.push([start, i + 1]); start = i + 1; }
  }
  if (start < text.length) records.push([start, text.length]);
  const notes: Array<[number, number]> = [];
  const items: Array<[number, number]> = [];
  const push = (arr: Array<[number, number]>, r: [number, number]) => {
    const last = arr[arr.length - 1];
    if (last && last[1] === r[0]) last[1] = r[1]; else arr.push([r[0], r[1]]);
  };
  for (const r of records) {
    const rec = text.slice(r[0], r[1]);
    if (/^\s*"?\d{1,4}(\.\d+)?"?\s*,/.test(rec)) push(items, r);
    else if (rec.replace(/[\s,"]/g, '')) push(notes, r);
    else push(items, r); // empty filler rows: nothing to read
  }
  return items.length ? { notes, items } : null;
}

/** Group segments into windows of at most `size` characters of segment text. */
function segmentWindows(segments: Array<[number, number]>, size = WINDOW_CHARS): Array<Array<[number, number]>> {
  const out: Array<Array<[number, number]>> = [];
  let cur: Array<[number, number]> = []; let n = 0;
  for (const seg of segments) {
    for (const [a, b] of planDocumentWindowsRange(seg, size)) {
      if (n + (b - a) > size && cur.length) { out.push(cur); cur = []; n = 0; }
      cur.push([a, b]); n += b - a;
    }
  }
  if (cur.length) out.push(cur);
  return out;
}
/** A single oversized segment is split into plain size-bounded pieces. */
function planDocumentWindowsRange([a, b]: [number, number], size: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = a; i < b; i += size) out.push([i, Math.min(b, i + size)]);
  return out;
}

/**
 * Deterministic window ranges over one document. Windows are WINDOW_CHARS long and
 * overlap by WINDOW_OVERLAP_CHARS; each end snaps back to a paragraph (or sentence)
 * break inside the overlap zone so a requirement is rarely cut, and the overlap
 * covers the case where it is.
 */
export function planDocumentWindows(
  text: string,
  size = WINDOW_CHARS,
  overlap = WINDOW_OVERLAP_CHARS,
): Array<[number, number]> {
  const n = text.length;
  if (n === 0) return [];
  if (n <= size) return [[0, n]];
  const out: Array<[number, number]> = [];
  let start = 0;
  while (start < n) {
    let end = Math.min(n, start + size);
    if (end < n) {
      const zone = text.slice(end - overlap, end);
      const para = zone.lastIndexOf('\n\n');
      const sent = zone.search(/[.;:]\s[^.;:]*$/);
      const cut = para >= 0 ? para + 2 : sent >= 0 ? sent + 2 : -1;
      if (cut > 0) end = end - overlap + cut;
    }
    out.push([start, end]);
    if (end >= n) break;
    const next = end - overlap;
    start = next > start ? next : end; // always advance
  }
  return out;
}

const squashWs = (s: string) => s.replace(/\s+/g, ' ').trim();
const idToken = (s: string) => s.replace(/[^A-Za-z0-9]/g, '').toUpperCase();

/** Labeled instrument numbers a document declares about ITSELF ("Contract Number: X"). */
function declaredInstruments(text: string): string[] {
  const re = /\b(?:contract|solicitation|order|piid)\s*(?:number|no\.?|#)\s*[:\-]\s*([A-Z0-9][A-Z0-9-]{8,20})/gi;
  const out = new Set<string>();
  for (const m of text.slice(0, 6000).matchAll(re)) out.add(idToken(m[1]));
  return [...out];
}

export function classifyPackageDocument(
  doc: PackageDocument,
  ctx: { solicitationNumber?: string | null; seen: Map<string, string> },
): { disposition: DocumentDisposition; reason?: string } {
  const body = doc.text.trim();
  if (!body) return { disposition: 'empty', reason: 'no readable text' };
  const sig = squashWs(body);
  const dup = ctx.seen.get(sig);
  if (dup) return { disposition: 'duplicate', reason: `identical text to ${dup}` };
  ctx.seen.set(sig, doc.filename);
  if (doc.doc_kind === 'wage_det' || /General Decision Number\s*:/i.test(body.slice(0, 3000))) {
    return {
      disposition: 'reference_data',
      reason: 'wage determination rate tables — the obligation to pay them is a contract clause, extracted from the solicitation body',
    };
  }
  const sol = idToken(ctx.solicitationNumber || '');
  const structural = new Set(['sow_pws', 'amendment', 'solicitation', 'qa']);
  if (sol.length >= 8 && !structural.has(String(doc.doc_kind || ''))) {
    const declared = declaredInstruments(body);
    const namesThis = idToken(body).includes(sol);
    const foreign = declared.find((d) => d !== sol);
    if (declared.length && foreign && !declared.includes(sol) && !namesThis) {
      return {
        disposition: 'foreign_instrument',
        reason: `declares instrument ${foreign}, never names solicitation ${ctx.solicitationNumber}`,
      };
    }
  }
  return { disposition: 'extract' };
}

export function planPackageExtraction(
  docs: PackageDocument[],
  opts: { solicitationNumber?: string | null; maxWindows?: number } = {},
): { documents: DocumentPlan[]; windows: ExtractionWindow[]; dropped: ExtractionWindow[] } {
  const seen = new Map<string, string>();
  const documents: DocumentPlan[] = [];
  const all: ExtractionWindow[] = [];
  for (const d of docs) {
    const c = classifyPackageDocument(d, { solicitationNumber: opts.solicitationNumber, seen });
    const isChange = d.doc_kind === 'amendment' || d.doc_kind === 'qa';
    const sheet = c.disposition === 'extract' ? splitSpreadsheetLineItems(d.text) : null;
    let count = 0;
    if (sheet) {
      segmentWindows(sheet.notes).forEach((segs, i) => {
        all.push({
          window_id: `${d.document_id}#w${i + 1}`, document_id: d.document_id, filename: d.filename,
          char_start: segs[0][0], char_end: segs[segs.length - 1][1], is_change: isChange, segments: segs,
        });
        count++;
      });
    } else if (c.disposition === 'extract') {
      planDocumentWindows(d.text).forEach(([s, e], i) => {
        all.push({ window_id: `${d.document_id}#w${i + 1}`, document_id: d.document_id, filename: d.filename, char_start: s, char_end: e, is_change: isChange });
        count++;
      });
    }
    documents.push({
      document_id: d.document_id, filename: d.filename, chars: d.text.trim().length, disposition: c.disposition,
      ...(c.reason ? { reason: c.reason } : {}), windows: count,
      ...(sheet ? {
        reference_ranges: sheet.items,
        reference_reason: 'bid-schedule line items (item, quantity, unit-price cells) — the obligation to price them is stated in the solicitation; notes in the sheet ARE extracted',
      } : {}),
    });
  }
  const cap = opts.maxWindows ?? MAX_PACKAGE_WINDOWS;
  return { documents, windows: all.slice(0, cap), dropped: all.slice(cap) };
}

/** A candidate row + the window that produced it (chunk identity, step 9). */
export type WindowedRequirement = ComplianceRequirement & {
  extraction_window: { window_id: string; document_id: string; char_start: number; char_end: number };
};

export interface WindowOutcome {
  window_id: string;
  document_id: string;
  filename: string;
  char_start: number;
  char_end: number;
  segments?: Array<[number, number]>;
  status: 'ok' | 'failed' | 'deadline' | 'not_scheduled';
  rows: number;
  model?: string;
}

export interface PackageExtraction {
  candidates: WindowedRequirement[];
  recovered: ComplianceRequirement[];
  recovered_source_specs: string[];
  documents: DocumentPlan[];
  windows: WindowOutcome[];
  ok: boolean;
  /** Models that ACTUALLY answered (the provider chain may fall through). */
  models: string[];
  elapsed_ms: number;
}

/** extractChunk with the answering model surfaced (provenance for _meta.model). */
async function extractWindow(
  fileName: string,
  chunk: string,
  isChange: boolean,
  userEmail: string | null,
): Promise<{ rows: ComplianceRequirement[]; model?: string } | null> {
  try {
    const { text: raw, model, provider } = await callLLM({
      system: isChange ? AMENDMENT_PROMPT : SYSTEM_PROMPT,
      user: `${isChange ? 'Amendment/Q&A' : 'Solicitation'}: ${fileName || 'untitled'}\n\n--- SOURCE TEXT ---\n${chunk}`,
      json: true,
      maxTokens: 4000,
      temperature: 0.2,
      job: 'extraction',
      tool: 'proposal_compliance',
      userEmail,
    });
    const parsed = JSON.parse(raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
    return { rows: Array.isArray(parsed.requirements) ? parsed.requirements : [], model: model || provider };
  } catch (err) {
    console.warn('[compliance] window failed (all providers):', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Read every relevant document of a package in full. Each window's candidates carry
 * `source_doc` = the window's own document (so the truth gate's source_mismatch check
 * enforces that a quote came from the document the model was reading) plus
 * `extraction_window`. A window that fails or misses the deadline is REPORTED — its
 * range is never read as "no requirements there".
 */
export async function extractComplianceMatrixFromPackage(
  docs: PackageDocument[],
  opts: {
    userEmail?: string | null;
    solicitationNumber?: string | null;
    deadlineMs?: number;
    concurrency?: number;
    maxWindows?: number;
  } = {},
): Promise<PackageExtraction> {
  const t0 = Date.now();
  const deadlineAt = t0 + (opts.deadlineMs ?? PACKAGE_DEADLINE_MS);
  const plan = planPackageExtraction(docs, { solicitationNumber: opts.solicitationNumber, maxWindows: opts.maxWindows });
  const byId = new Map(docs.map((d) => [d.document_id, d]));

  const outcomes: WindowOutcome[] = plan.windows.map((w) => ({
    window_id: w.window_id, document_id: w.document_id, filename: w.filename,
    char_start: w.char_start, char_end: w.char_end, ...(w.segments ? { segments: w.segments } : {}), status: 'deadline', rows: 0,
  }));
  const results = await mapPool(plan.windows, opts.concurrency ?? PACKAGE_CONCURRENCY, async (w, i) => {
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) return null; // stays 'deadline'
    const src = byId.get(w.document_id)!.text;
    const text = w.segments ? w.segments.map(([a, b]) => src.slice(a, b)).join('\n') : src.slice(w.char_start, w.char_end);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<'deadline'>((res) => { timer = setTimeout(() => res('deadline'), remaining); });
    const r = await Promise.race([extractWindow(w.filename, text, w.is_change, opts.userEmail ?? null), late]);
    clearTimeout(timer);
    if (r === 'deadline') return null;
    if (r === null) { outcomes[i].status = 'failed'; return null; }
    outcomes[i].status = 'ok';
    outcomes[i].rows = r.rows.length;
    outcomes[i].model = r.model;
    return r;
  });

  const candidates: WindowedRequirement[] = [];
  const models = new Set<string>();
  results.forEach((r, i) => {
    if (!r) return;
    const w = plan.windows[i];
    if (r.model) models.add(r.model);
    for (const row of r.rows) {
      candidates.push({
        ...row,
        category: normalizeCategory(row.category as string | undefined, row.requirement),
        source_doc: w.filename, // provenance, not the model's guess
        extraction_window: { window_id: w.window_id, document_id: w.document_id, char_start: w.char_start, char_end: w.char_end },
      });
    }
  });
  for (const w of plan.dropped) {
    outcomes.push({ window_id: w.window_id, document_id: w.document_id, filename: w.filename, char_start: w.char_start, char_end: w.char_end, status: 'not_scheduled', rows: 0 });
  }

  // Named Section 3.0 specs the model skipped, recovered from the extracted documents.
  const extractedText = plan.documents.filter((d) => d.disposition === 'extract').map((d) => byId.get(d.document_id)!.text).join('\n\n');
  const rec = recoverMissingSourceSpecs(extractedText, candidates);
  const recovered = rec.requirements.slice(candidates.length) as ComplianceRequirement[];

  return {
    candidates,
    recovered,
    recovered_source_specs: rec.recovered_ids,
    documents: plan.documents,
    windows: outcomes,
    ok: outcomes.some((o) => o.status === 'ok'),
    models: [...models],
    elapsed_ms: Date.now() - t0,
  };
}
