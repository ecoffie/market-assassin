/**
 * MCP tool: extract_compliance_matrix — harvest the shall/must/required obligations,
 * instructions and evaluation factors from a solicitation into a compliance matrix.
 * The foundation of the proposal chain: search_sam_opportunities → notice_id →
 * get_solicitation_documents → extract_compliance_matrix → the agent drafts.
 *
 * Two inputs (pass one): `notice_id` (fetches the SOW/body/attachment text server-side
 * via the solicitation-documents lib — makes the chain one-shot) OR `rfp_text` (the
 * agent supplies the solicitation text directly). Single-doc only — the multi-doc /
 * amendment-precedence mode needs a logged-in user's private pursuit pipeline and stays
 * inside Mindy (the vault boundary).
 *
 * Wraps the shared src/lib/proposal/compliance-matrix.ts engine (LLM-backed, chunked +
 * parallel). tier: metered, credits: 20. `_meta` always ships; `_ai_hint` OFF by default.
 *
 * TRUTH CONTRACT (Poteto "Compliance Matrix Truth", 2026-09-22): the LLM only PROPOSES
 * rows. Every row is then checked against the source text Mindy actually holds
 * (matrix-verification.ts — deterministic, no second LLM). `requirements` carries only
 * rows whose quote verifies in a located document and supports the row; a section
 * label survives only when the document prints it as the enclosing heading.
 * Paraphrased quotes come back as `interpretations` with the real source sentence;
 * everything else is in `withheld` with a reason. `requirement` is Mindy's reading;
 * `source_quote` is the source's words — the two are never blended.
 */
import {
  extractComplianceMatrixFromPackage,
  type ComplianceRequirement,
  type DocumentPlan,
  type PackageDocument,
  type WindowOutcome,
} from '@/lib/proposal/compliance-matrix';
import { mergeVerifiedByEvidence, type MergeSummary } from '@/lib/proposal/matrix-merge';
import {
  verifyComplianceMatrix,
  type InterpretedRow,
  type MatrixSourceDoc,
  type MatrixVerificationSummary,
  type VerifiedRow,
  type WithheldRow,
} from '@/lib/proposal/matrix-verification';
import { auditSourceSpecCoverage, type SourceSpecCoverage } from '@/lib/proposal/matrix-source-coverage';
import { getSolicitationDocuments } from '@/lib/sam/solicitation-documents';
import { assembleNoticeSourceText } from '@/lib/sam/notice-identity';
import { summarizeSourceCoverage, coverageCaveat, type SourceCoverage } from '@/lib/sam/source-coverage';
import { mcpFlags } from '@/lib/mcp/flags';

export interface ComplianceMatrixInput {
  rfp_text?: string;
  notice_id?: string;
  /** LLM cost attribution (the MCP caller's verified email). */
  userEmail?: string | null;
}

/**
 * What the extractor actually did with the package. Every readable document has a
 * disposition; every requirement-bearing document is split into windows, and every
 * character NOT processed is listed in uncovered_ranges with the reason.
 */
export interface ExtractionCoverage {
  /** Chars of stored text across every document in the package. */
  source_chars: number;
  /** Chars in documents classified requirement-bearing (disposition 'extract'). */
  relevant_chars: number;
  /** Chars of requirement-bearing text a model call successfully processed. */
  chars_read: number;
  /** True only when every requirement-bearing document was processed in full. */
  complete: boolean;
  documents_total: number;
  /** Requirement-bearing documents processed in full. */
  documents_processed: number;
  windows_planned: number;
  windows_succeeded: number;
  windows_failed: number;
  /** Requirement-bearing text that was NOT processed — requirements there are UNKNOWN. */
  uncovered_ranges: Array<{ document_id: string; filename: string; char_start: number; char_end: number; reason: WindowOutcome['status'] }>;
  documents: Array<{
    filename: string;
    document_id: string;
    chars: number;
    chars_read: number;
    fully_read: boolean;
    disposition: DocumentPlan['disposition'];
    reason?: string;
    windows: number;
    /** Chars classified (not sent to the model) inside an extracted document, and why. */
    reference_chars?: number;
    reference_reason?: string;
  }>;
}

export interface ComplianceMatrixResult {
  /** TRUSTED rows only — each quote verified verbatim (or harmless normalization) in its source_doc. */
  requirements: VerifiedRow<ComplianceRequirement>[];
  /** Supported paraphrases: the model's quote was not verbatim; source_evidence IS. Not quotes. */
  interpretations: InterpretedRow<ComplianceRequirement>[];
  /** Candidates that could not be verified against the source, with the reason. */
  withheld: WithheldRow<ComplianceRequirement>[];
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string[] };
  _meta: {
    grounded: boolean;
    degraded: boolean;
    source: 'notice_id' | 'text' | 'none';
    notice_id?: string;
    count: number;
    truncated: boolean;
    truncated_attachments?: number;
    /**
     * A non-zero count proves retrieval/extraction ran. Completeness vs the RFP
     * is unproven whenever attachments or source text were truncated, OR when
     * named source specs (LOA, flight deck, SCIF, berthing, magazine) are in
     * the source and missing from the matrix. Row count is not coverage.
     */
    extraction_completeness: 'unproven' | 'source_text' | 'partial' | 'unavailable';
    /** Why the matrix is not (or is) a complete read — each reason names what is missing. */
    completeness_reasons?: string[];
    /** Overlap duplicates collapsed + rows withheld for evidence outside their window. */
    merge?: MergeSummary;
    source_spec_coverage?: SourceSpecCoverage;
    /** Spec ids recovered from source after the LLM missed them (e.g. SCIF). */
    recovered_source_specs?: string[];
    resolved_notice_id?: string;
    model: string;
    /** What the SOURCE text was missing (distinct from `truncated`, the LLM cap). */
    source_coverage?: SourceCoverage;
    /** How much of the source the extraction model actually read, per document. */
    extraction_coverage?: ExtractionCoverage;
    /** Verified vs withheld counts from the deterministic source-text gate. */
    verification?: MatrixVerificationSummary;
    /** Amendment/modification documents in the package (identity preserved; not merged). */
    amendments_detected?: string[];
    /** How to read the row fields. */
    truth_contract?: string;
  };
}

const TRUTH_CONTRACT =
  'requirements[] are verified rows: source_quote is the solicitation\'s own words, found in source_doc at ' +
  'verification.found_in (character range; pages are not available). requirement is Mindy\'s reading of that ' +
  'quote, not source language. section appears only when the document prints it as the heading above the quote. ' +
  'interpretations[] carry source_evidence (verbatim) with Mindy\'s paraphrase — never present them as quotes. ' +
  'withheld[] could not be verified and must not be presented as requirements.';

const AMENDMENT_RE = /\b(amend(ment)?|amd|sf[\s_+-]*30|modification|mod\s*\d)/i;

/** Union length of [start,end) ranges. */
function unionLength(ranges: Array<[number, number]>): number {
  const r = [...ranges].sort((a, b) => a[0] - b[0]);
  let n = 0;
  let cur: [number, number] | null = null;
  for (const [a, b] of r) {
    if (!cur || a > cur[1]) { if (cur) n += cur[1] - cur[0]; cur = [a, b]; } else cur[1] = Math.max(cur[1], b);
  }
  if (cur) n += cur[1] - cur[0];
  return n;
}

/** Package coverage from the plan + the outcome of every window. */
export function packageCoverage(
  docs: PackageDocument[],
  plan: DocumentPlan[],
  windows: WindowOutcome[],
): ExtractionCoverage {
  const documents: ExtractionCoverage['documents'] = [];
  const uncovered: ExtractionCoverage['uncovered_ranges'] = [];
  let source = 0; let relevant = 0; let read = 0; let processed = 0;
  for (const p of plan) {
    const len = docs.find((d) => d.document_id === p.document_id)?.text.length ?? 0;
    source += len;
    const mine = windows.filter((w) => w.document_id === p.document_id);
    const ok = mine.filter((w) => w.status === 'ok').flatMap((w) => w.segments ?? [[w.char_start, w.char_end] as [number, number]]);
    const refs = p.reference_ranges ?? [];
    const r = p.disposition === 'extract' ? unionLength(ok) : 0;
    // Classified ranges (bid-schedule line items) are CONSIDERED, not unread.
    const considered = [...ok, ...refs];
    const full = p.disposition === 'extract' && unionLength(considered) >= len;
    if (p.disposition === 'extract') {
      relevant += len - unionLength(refs); read += r; if (full) processed++;
      // Complement of what was processed or classified, attributed to the window that failed there.
      let at = 0;
      for (const [a, b] of [...considered].sort((x, y) => x[0] - y[0])) {
        if (a > at) {
          const culprit = mine.find((w) => w.status !== 'ok' && w.char_start < a && w.char_end > at);
          uncovered.push({ document_id: p.document_id, filename: p.filename, char_start: at, char_end: a, reason: culprit?.status ?? 'failed' });
        }
        at = Math.max(at, b);
      }
      if (at < len) {
        const culprit = mine.find((w) => w.status !== 'ok' && w.char_end > at);
        uncovered.push({ document_id: p.document_id, filename: p.filename, char_start: at, char_end: len, reason: culprit?.status ?? 'failed' });
      }
    }
    documents.push({
      filename: p.filename, document_id: p.document_id, chars: len, chars_read: r, fully_read: full,
      disposition: p.disposition, ...(p.reason ? { reason: p.reason } : {}), windows: p.windows,
      ...(refs.length ? { reference_chars: unionLength(refs), reference_reason: p.reference_reason } : {}),
    });
  }
  return {
    source_chars: source,
    relevant_chars: relevant,
    chars_read: read,
    complete: uncovered.length === 0 && plan.some((p) => p.disposition === 'extract'),
    documents_total: plan.length,
    documents_processed: processed,
    windows_planned: windows.length,
    windows_succeeded: windows.filter((w) => w.status === 'ok').length,
    windows_failed: windows.filter((w) => w.status !== 'ok').length,
    uncovered_ranges: uncovered,
    documents,
  };
}

/** Build the source text for a notice: SOW + notice body + each attachment's extracted
 *  text, so the extractor sees the requirements wherever they live. */
async function textFromNotice(noticeId: string): Promise<{
  text: string;
  docs: MatrixSourceDoc[];
  /** The same documents (same text, same order) + doc_kind, for the package extractor. */
  packageDocs: PackageDocument[];
  solicitationNumber: string | null;
  amendments: string[];
  degraded: boolean;
  truncated_attachments: number;
  resolved_notice_id?: string;
  coverage: SourceCoverage | null;
}> {
  try {
    const docs = await getSolicitationDocuments({ noticeId, textMode: 'full' });
    const srcCoverage = summarizeSourceCoverage(docs);
    const assembled = assembleNoticeSourceText({
      sow_text: docs.source_text ? null : docs.sow_text,
      description: docs.source_text ? null : docs.description,
      documents: docs.source_text ? [] : docs.documents,
    });
    const text = (docs.source_text || assembled.text).trim();
    // Document identity survives into verification: each quote is located in a
    // named document, never in the flattened blob.
    const sourceDocs: MatrixSourceDoc[] = [];
    const kinds = new Map<string, string | null>([['notice_sow', 'notice'], ['notice_description', 'notice']]);
    for (const [id, body] of [['notice_sow', docs.sow_text], ['notice_description', docs.description]] as const) {
      const t = (body || '').trim();
      if (t && !/^https?:\/\//i.test(t)) {
        sourceDocs.push({ document_id: id, filename: id === 'notice_sow' ? 'Notice SOW text' : 'Notice description', text: t, role: 'notice_description' });
      }
    }
    for (const d of docs.documents) {
      if ((d.extracted_text || '').trim()) {
        sourceDocs.push({ document_id: d.document_id, filename: d.filename, text: d.extracted_text, role: 'attachment' });
        kinds.set(d.document_id, d.doc_kind ?? null);
      }
    }
    return {
      text,
      docs: sourceDocs,
      packageDocs: sourceDocs.map((d) => ({ document_id: d.document_id, filename: d.filename, text: d.text, doc_kind: kinds.get(d.document_id) ?? null })),
      solicitationNumber: docs.solicitation_number ?? null,
      amendments: docs.documents
        .filter((d) => d.doc_kind === 'amendment' || AMENDMENT_RE.test(d.filename))
        .map((d) => d.filename),
      degraded: docs.degraded,
      truncated_attachments: docs.truncated_attachments ?? assembled.truncated_attachments,
      resolved_notice_id: docs.notice_id,
      coverage: srcCoverage,
    };
  } catch (err) {
    console.error('[compliance-matrix] notice fetch failed', noticeId, err);
    return { text: '', docs: [], packageDocs: [], solicitationNumber: null, amendments: [], degraded: true, truncated_attachments: 0, coverage: null };
  }
}

/**
 * Whole-tool wall-clock budget. The hosted MCP route's maxDuration is 60s; the package
 * fetch (a cold notice is downloaded + extracted on demand) and the post-extraction
 * gate/merge share it, so the extraction deadline is what is LEFT of this budget.
 */
const TOOL_BUDGET_MS = 50_000;
const MIN_EXTRACTION_MS = 12_000;

export async function extractComplianceMatrix(input: ComplianceMatrixInput): Promise<ComplianceMatrixResult> {
  const startedAt = Date.now();
  const noticeId = (input.notice_id || '').trim();
  let sourceText = (input.rfp_text || '').trim();
  let source: 'notice_id' | 'text' | 'none' = sourceText ? 'text' : 'none';
  let fetchDegraded = false;
  let truncatedAttachments = 0;
  let sourceCoverage: SourceCoverage | null = null;
  let resolvedNoticeId: string | undefined;
  let amendments: string[] = [];
  let sourceDocs: MatrixSourceDoc[] = sourceText
    ? [{ document_id: 'rfp_text', filename: 'Provided rfp_text', text: sourceText, role: 'rfp_text' }]
    : [];
  let packageDocs: PackageDocument[] = sourceDocs.map((d) => ({ document_id: d.document_id, filename: d.filename, text: d.text, doc_kind: null }));
  let solicitationNumber: string | null = null;

  // notice_id path: fetch the solicitation text server-side (only when no explicit text).
  if (!sourceText && noticeId) {
    const fetched = await textFromNotice(noticeId);
    sourceText = fetched.text;
    fetchDegraded = fetched.degraded;
    truncatedAttachments = fetched.truncated_attachments;
    sourceCoverage = fetched.coverage;
    resolvedNoticeId = fetched.resolved_notice_id;
    sourceDocs = fetched.docs;
    packageDocs = fetched.packageDocs;
    solicitationNumber = fetched.solicitationNumber;
    amendments = fetched.amendments;
    source = 'notice_id';
  }

  if (!sourceText) {
    // Nothing to work from — honest miss (or a fetch error). Never fabricate.
    const result: ComplianceMatrixResult = {
      requirements: [],
      interpretations: [],
      withheld: [],
      _meta: {
        grounded: false,
        degraded: fetchDegraded,
        source: noticeId ? 'notice_id' : 'none',
        notice_id: noticeId || undefined,
        resolved_notice_id: resolvedNoticeId,
        count: 0,
        truncated: false,
        truncated_attachments: truncatedAttachments,
        extraction_completeness: 'unavailable',
        completeness_reasons: [fetchDegraded ? 'the solicitation package could not be fetched' : 'no readable solicitation text'],
        source_spec_coverage: { present_in_source: [], extracted: [], missing_from_matrix: [] },
        model: '',
      },
    };
    if (mcpFlags.aiHint) {
      result._ai_hint = {
        summary: fetchDegraded
          ? `Could not fetch documents for notice ${noticeId} (source errored) — treat as temporarily unavailable, not as "no requirements".`
          : noticeId
          ? `Notice ${noticeId} has no extractable SOW/attachment text yet — pass the RFP text directly via rfp_text, or try get_solicitation_documents first.`
          : 'Provide rfp_text (the solicitation text) or a notice_id to extract from.',
        how_to_use: 'No matrix was produced — do NOT invent requirements. Get the solicitation text (get_solicitation_documents) and retry.',
        key_caveats: [
'grounded=false means nothing was extracted, not that the RFP has no requirements.'],
      };
    }
    return result;
  }

  // PACKAGE → DISPOSITION → WINDOWS → EXTRACT: every requirement-bearing document is
  // read in full; each candidate carries the window (document + range) that produced it.
  const ex = await extractComplianceMatrixFromPackage(packageDocs, {
    userEmail: input.userEmail ?? null,
    solicitationNumber,
    deadlineMs: Math.max(MIN_EXTRACTION_MS, TOOL_BUDGET_MS - (Date.now() - startedAt)),
  });
  // The gate (frozen): only rows provable against the source Mindy holds reach `requirements`.
  // source_doc on every windowed candidate is the window's own document, so the gate's
  // source_mismatch check also proves the quote came from the document being read.
  const sourceIncomplete = !!sourceCoverage && !sourceCoverage.complete;
  const gated = verifyComplianceMatrix([...ex.candidates, ...ex.recovered], sourceDocs, { sourceIncomplete });
  // MERGE after the gate: identity is verified evidence, never model text or model ids.
  const changeDocs = new Set(packageDocs.filter((d) => d.doc_kind === 'amendment' || d.doc_kind === 'qa').map((d) => d.document_id));
  const verified = mergeVerifiedByEvidence(gated, packageDocs.map((d) => d.document_id), changeDocs);
  const summary = {
    ...gated.summary,
    requirements_verified: verified.requirements.length,
    interpretations: verified.interpretations.length,
    candidates_withheld: verified.withheld.length,
    withheld_by_reason: verified.withheld.reduce<Record<string, number>>((m, w) => {
      m[w.withheld_reason] = (m[w.withheld_reason] ?? 0) + 1; return m;
    }, {}),
  };
  const grounded = verified.requirements.length > 0;
  const extractedText = packageDocs.filter((d) => ex.documents.find((p) => p.document_id === d.document_id)?.disposition === 'extract').map((d) => d.text).join('\n\n');
  const coverage = auditSourceSpecCoverage(extractedText || sourceText, verified.requirements);
  const extraction = packageCoverage(packageDocs, ex.documents, ex.windows);

  // Completeness is a claim about coverage AND verification, never about row count.
  const reasons: string[] = [];
  const notOk = ex.windows.filter((w) => w.status !== 'ok');
  if (notOk.length) {
    const files = [...new Set(extraction.uncovered_ranges.map((u) => u.filename))];
    reasons.push(`${notOk.length} of ${ex.windows.length} extraction windows did not complete (${[...new Set(notOk.map((w) => w.status))].join('/')}) — requirements in ${files.join(', ')} ${extraction.uncovered_ranges.map((u) => `chars ${u.char_start}–${u.char_end}`).join('; ')} are UNKNOWN, not absent`);
  }
  if (sourceIncomplete) reasons.push('some package documents were unreadable or partially read');
  if (truncatedAttachments > 0) reasons.push(`${truncatedAttachments} attachment(s) truncated at the source`);
  if (coverage.missing_from_matrix.length) reasons.push(`named source specs missing from the matrix: ${coverage.missing_from_matrix.join(', ')}`);
  if (verified.withheld.length) reasons.push(`${verified.withheld.length} candidate(s) withheld — what they point at could not be verified`);
  if (verified.interpretations.length) reasons.push(`${verified.interpretations.length} row(s) are interpretations, not verified quotes`);
  const completeness: ComplianceMatrixResult['_meta']['extraction_completeness'] = !ex.ok
    ? 'unavailable'
    : notOk.length || !extraction.complete
    ? 'partial'
    : reasons.length
    ? 'unproven'
    : 'source_text';
  if (!ex.ok) reasons.unshift('the extraction model was unavailable on every window');

  const result: ComplianceMatrixResult = {
    requirements: verified.requirements,
    interpretations: verified.interpretations,
    withheld: verified.withheld,
    _meta: {
      grounded,
      // Every window failed → provider down. Nothing verified AND a window failed → the
      // missing rows may be in the failed range: a system failure, never "no requirements"
      // (Credit Integrity then classifies it non-billable, unchanged).
      degraded: !ex.ok || (!grounded && notOk.length > 0),
      source,
      notice_id: source === 'notice_id' ? (resolvedNoticeId || noticeId) : undefined,
      resolved_notice_id: resolvedNoticeId,
      count: verified.requirements.length,
      truncated: !extraction.complete || truncatedAttachments > 0,
      truncated_attachments: truncatedAttachments,
      extraction_completeness: completeness,
      completeness_reasons: reasons,
      merge: verified.summary,
      source_spec_coverage: coverage,
      ...(ex.recovered_source_specs?.length
        ? { recovered_source_specs: ex.recovered_source_specs }
        : {}),
      // The models that ACTUALLY answered (the provider chain can fall through).
      model: ex.models.join(', '),
      ...(sourceCoverage ? { source_coverage: sourceCoverage } : {}),
      extraction_coverage: extraction,
      verification: summary,
      amendments_detected: amendments,
      truth_contract: TRUTH_CONTRACT,
    },
  };

  if (mcpFlags.aiHint) {
    result._ai_hint = {
      summary: !ex.ok
        ? 'The extraction model was unavailable on every chunk — treat as temporarily unavailable, not as "no requirements". Retry shortly.'
        : !grounded
        ? 'No explicit requirements were found in the provided text — it may be a synopsis or cover page rather than the Section L/M/C body. Supply the full solicitation.'
        : `${verified.requirements.length} requirement(s) verified against the source; ${verified.withheld.length} candidate(s) withheld because their source language could not be verified${verified.interpretations.length ? `; ${verified.interpretations.length} returned as interpretations with the real source sentence` : ''}. Mindy processed ${extraction.documents_processed} of ${extraction.documents.filter((d) => d.disposition === 'extract').length} requirement-bearing document(s) (${extraction.chars_read.toLocaleString()} of ${extraction.relevant_chars.toLocaleString()} relevant characters)${extraction.complete ? '' : ' — this is NOT the solicitation\'s complete requirement set'}.${extraction.documents.some((d) => d.disposition !== 'extract' && d.disposition !== 'empty') ? ` Not extracted by design: ${extraction.documents.filter((d) => d.disposition !== 'extract' && d.disposition !== 'empty').map((d) => `${d.filename} (${d.disposition})`).join(', ')}.` : ''}${
            sourceCoverage && !sourceCoverage.complete
              ? ` PARTIAL SOURCE: ${sourceCoverage.documents_partial} document(s) partially read, ${sourceCoverage.documents_unreadable} unreadable — this is not the solicitation's complete requirement set.`
              : ''
          } Each verified row carries a source_quote found verbatim in its source_doc.`,
      how_to_use:
        'requirements[] are the trusted matrix (category = submission/evaluation/technical/past_performance/pricing/admin/other; section only when the document prints it). Quote source_quote as the solicitation\'s words and requirement as Mindy\'s reading. Present interpretations[] as paraphrases with their source_evidence, and never present withheld[] as requirements.',
      key_caveats: [
        // Source-level gap FIRST: a matrix built from a partial read must not be
        // read as the solicitation's full requirement set.
        ...(sourceCoverage && coverageCaveat(sourceCoverage) ? [coverageCaveat(sourceCoverage) as string] : []),
        'Every trusted source_quote was located in the stored source text by a deterministic check; requirement wording is an interpretation. Do not add requirements the RFP does not state.',
        'Completeness is source-spec coverage (LOA, flight deck, SCIF, berthing, magazine when those strings are in the source), not the row count. missing_from_matrix means those specs were in the RFP and not extracted.',
        ...(amendments.length
          ? [`AMENDMENTS PRESENT (${amendments.join(', ')}): rows keep their source_doc, but superseded base language is NOT resolved — a base row and its amendment may both appear. Check each against the latest amendment.`]
          : ['No amendment documents were in the package Mindy holds.']),
        'Every requirement-bearing document is read in overlapping windows; _meta.extraction_coverage.uncovered_ranges lists any text that was NOT processed — requirements there are UNKNOWN, not absent. extraction_completeness=source_text is the only complete state.',
      ],
    };
  }
  return result;
}
