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
import { extractComplianceMatrixFromText, type ComplianceRequirement } from '@/lib/proposal/compliance-matrix';
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

/** Per-document share of stored text the extractor actually read. */
export interface ExtractionCoverage {
  /** Chars of source text Mindy holds vs chars sent to the extraction model. */
  source_chars: number;
  chars_read: number;
  /** True only when the model saw every character of every document. */
  complete: boolean;
  documents: Array<{ filename: string; document_id: string; chars: number; chars_read: number; fully_read: boolean }>;
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
    extraction_completeness: 'unproven' | 'source_text';
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

/** Map each source document to the character range it occupies in the assembled text. */
function extractionCoverage(
  assembled: string,
  docs: MatrixSourceDoc[],
  windowRanges: Array<[number, number]>,
): ExtractionCoverage {
  const read = (a: number, b: number) =>
    windowRanges.reduce((n, [s, e]) => n + Math.max(0, Math.min(b, e) - Math.max(a, s)), 0);
  const out: ExtractionCoverage['documents'] = [];
  let cursor = 0;
  for (const d of docs) {
    const body = d.text.trim();
    if (!body) continue;
    const at = assembled.indexOf(body, d.role === 'attachment' ? assembled.indexOf(`--- ${d.filename} ---`, cursor) : cursor);
    if (at < 0) {
      out.push({ filename: d.filename, document_id: d.document_id, chars: body.length, chars_read: 0, fully_read: false });
      continue;
    }
    cursor = at + body.length;
    const r = read(at, at + body.length);
    out.push({ filename: d.filename, document_id: d.document_id, chars: body.length, chars_read: r, fully_read: r >= body.length });
  }
  const source_chars = assembled.length;
  const chars_read = read(0, source_chars);
  return { source_chars, chars_read, complete: chars_read >= source_chars && out.every((d) => d.fully_read), documents: out };
}

/** Build the source text for a notice: SOW + notice body + each attachment's extracted
 *  text, so the extractor sees the requirements wherever they live. */
async function textFromNotice(noticeId: string): Promise<{
  text: string;
  docs: MatrixSourceDoc[];
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
    for (const [id, body] of [['notice_sow', docs.sow_text], ['notice_description', docs.description]] as const) {
      const t = (body || '').trim();
      if (t && !/^https?:\/\//i.test(t)) {
        sourceDocs.push({ document_id: id, filename: id === 'notice_sow' ? 'Notice SOW text' : 'Notice description', text: t, role: 'notice_description' });
      }
    }
    for (const d of docs.documents) {
      if ((d.extracted_text || '').trim()) {
        sourceDocs.push({ document_id: d.document_id, filename: d.filename, text: d.extracted_text, role: 'attachment' });
      }
    }
    return {
      text,
      docs: sourceDocs,
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
    return { text: '', docs: [], amendments: [], degraded: true, truncated_attachments: 0, coverage: null };
  }
}

export async function extractComplianceMatrix(input: ComplianceMatrixInput): Promise<ComplianceMatrixResult> {
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

  // notice_id path: fetch the solicitation text server-side (only when no explicit text).
  if (!sourceText && noticeId) {
    const fetched = await textFromNotice(noticeId);
    sourceText = fetched.text;
    fetchDegraded = fetched.degraded;
    truncatedAttachments = fetched.truncated_attachments;
    sourceCoverage = fetched.coverage;
    resolvedNoticeId = fetched.resolved_notice_id;
    sourceDocs = fetched.docs;
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
        extraction_completeness: 'unproven',
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

  const ex = await extractComplianceMatrixFromText(sourceText, { userEmail: input.userEmail ?? null });
  // The gate: only rows provable against the source Mindy holds reach `requirements`.
  const sourceIncomplete = !!sourceCoverage && !sourceCoverage.complete;
  const verified = verifyComplianceMatrix(ex.requirements, sourceDocs, { sourceIncomplete });
  const grounded = verified.requirements.length > 0;
  const coverage = auditSourceSpecCoverage(sourceText, verified.requirements);
  const extraction = extractionCoverage(sourceText, sourceDocs, ex.windowRanges);
  const completenessUnproven =
    ex.truncated || truncatedAttachments > 0 || coverage.missing_from_matrix.length > 0 ||
    !extraction.complete || sourceIncomplete || verified.withheld.length > 0 || verified.interpretations.length > 0;

  const result: ComplianceMatrixResult = {
    requirements: verified.requirements,
    interpretations: verified.interpretations,
    withheld: verified.withheld,
    _meta: {
      grounded,
      degraded: !ex.ok, // every chunk failed → provider down, distinct from empty
      source,
      notice_id: source === 'notice_id' ? (resolvedNoticeId || noticeId) : undefined,
      resolved_notice_id: resolvedNoticeId,
      count: verified.requirements.length,
      truncated: ex.truncated || truncatedAttachments > 0,
      truncated_attachments: truncatedAttachments,
      extraction_completeness: completenessUnproven ? 'unproven' : 'source_text',
      source_spec_coverage: coverage,
      ...(ex.recovered_source_specs?.length
        ? { recovered_source_specs: ex.recovered_source_specs }
        : {}),
      model: ex.model,
      ...(sourceCoverage ? { source_coverage: sourceCoverage } : {}),
      extraction_coverage: extraction,
      verification: verified.summary,
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
        : `${verified.requirements.length} requirement(s) verified against the source; ${verified.withheld.length} candidate(s) withheld because their source language could not be verified${verified.interpretations.length ? `; ${verified.interpretations.length} returned as interpretations with the real source sentence` : ''}. The extractor read ${extraction.chars_read.toLocaleString()} of ${extraction.source_chars.toLocaleString()} source characters${ex.truncated ? ' — this is NOT the solicitation\'s complete requirement set' : ''}.${
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
        'The model reads at most 50K chars per call — see _meta.extraction_coverage for which documents were read; requirements in unread text are UNKNOWN, not absent.',
      ],
    };
  }
  return result;
}
