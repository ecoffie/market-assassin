/**
 * MCP tool: extract_compliance_matrix — harvest every shall/must/required obligation
 * + Section L/M/C requirement from a solicitation into a structured compliance matrix.
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
 * parallel). tier: metered, credits: 3. `_meta` always ships; `_ai_hint` OFF by default.
 */
import { extractComplianceMatrixFromText, type ComplianceRequirement } from '@/lib/proposal/compliance-matrix';
import { getSolicitationDocuments } from '@/lib/sam/solicitation-documents';
import { mcpFlags } from '@/lib/mcp/flags';

export interface ComplianceMatrixInput {
  rfp_text?: string;
  notice_id?: string;
  /** LLM cost attribution (the MCP caller's verified email). */
  userEmail?: string | null;
}

export interface ComplianceMatrixResult {
  requirements: ComplianceRequirement[];
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string[] };
  _meta: {
    grounded: boolean;
    degraded: boolean;
    source: 'notice_id' | 'text' | 'none';
    notice_id?: string;
    count: number;
    truncated: boolean;
    model: string;
  };
}

/** Build the source text for a notice: SOW + notice body + each attachment's extracted
 *  text, so the extractor sees the requirements wherever they live. */
async function textFromNotice(noticeId: string): Promise<{ text: string; degraded: boolean }> {
  try {
    const docs = await getSolicitationDocuments({ noticeId });
    const parts: string[] = [];
    if (docs.sow_text) parts.push(docs.sow_text);
    if (docs.description) parts.push(docs.description);
    for (const d of docs.documents) {
      if (d.extracted_text) parts.push(`--- ${d.filename || 'attachment'} ---\n${d.extracted_text}`);
    }
    return { text: parts.join('\n\n').trim(), degraded: false };
  } catch (err) {
    console.error('[compliance-matrix] notice fetch failed', noticeId, err);
    return { text: '', degraded: true };
  }
}

export async function extractComplianceMatrix(input: ComplianceMatrixInput): Promise<ComplianceMatrixResult> {
  const noticeId = (input.notice_id || '').trim();
  let sourceText = (input.rfp_text || '').trim();
  let source: 'notice_id' | 'text' | 'none' = sourceText ? 'text' : 'none';
  let fetchDegraded = false;

  // notice_id path: fetch the solicitation text server-side (only when no explicit text).
  if (!sourceText && noticeId) {
    const fetched = await textFromNotice(noticeId);
    sourceText = fetched.text;
    fetchDegraded = fetched.degraded;
    source = 'notice_id';
  }

  if (!sourceText) {
    // Nothing to work from — honest miss (or a fetch error). Never fabricate.
    const result: ComplianceMatrixResult = {
      requirements: [],
      _meta: {
        grounded: false,
        degraded: fetchDegraded,
        source: noticeId ? 'notice_id' : 'none',
        notice_id: noticeId || undefined,
        count: 0,
        truncated: false,
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
        key_caveats: ['grounded=false means nothing was extracted, not that the RFP has no requirements.'],
      };
    }
    return result;
  }

  const ex = await extractComplianceMatrixFromText(sourceText, { userEmail: input.userEmail ?? null });
  const grounded = ex.requirements.length > 0;

  const result: ComplianceMatrixResult = {
    requirements: ex.requirements,
    _meta: {
      grounded,
      degraded: !ex.ok, // every chunk failed → provider down, distinct from empty
      source,
      notice_id: source === 'notice_id' ? noticeId : undefined,
      count: ex.requirements.length,
      truncated: ex.truncated,
      model: ex.model,
    },
  };

  if (mcpFlags.aiHint) {
    result._ai_hint = {
      summary: !ex.ok
        ? 'The extraction model was unavailable on every chunk — treat as temporarily unavailable, not as "no requirements". Retry shortly.'
        : !grounded
        ? 'No explicit requirements were found in the provided text — it may be a synopsis or cover page rather than the Section L/M/C body. Supply the full solicitation.'
        : `${ex.requirements.length} requirement(s) extracted${ex.truncated ? ' (input was truncated to the first 50K chars — long RFP; consider extracting sections separately)' : ''}. Each carries a category and, when detected, a section label and a verbatim source_quote.`,
      how_to_use:
        'Use this as the compliance matrix: every row is one obligation the bid must address (category = submission/evaluation/technical/past_performance/pricing/admin/other; section = the L/M/C clause when detected). Build the proposal outline from it; where a source_quote is present, verify it against the RFP.',
      key_caveats: [
        'Every requirement is derived from the provided solicitation text; when a source_quote is present it is verbatim. Do not add requirements the RFP does not state.',
        'Single-doc extraction: it does NOT merge amendments over the base RFP. Pass the amendment text too (or the full package) if closing dates/specs were revised.',
        'Truncated at 50K chars per call — for a very long RFP, extract Section L, M, and C separately for full coverage.',
      ],
    };
  }
  return result;
}
