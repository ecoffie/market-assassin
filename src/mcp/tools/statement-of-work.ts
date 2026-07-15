/**
 * MCP tool: extract_statement_of_work — pull the SOW / PWS / SOO out of a solicitation
 * as clean text a bidder can hand to subs for pricing. Complements extract_compliance_matrix
 * (requirements) and get_solicitation_documents (which returns a CLASSIFIED sow_text only
 * when a standalone SOW doc exists): this one applies heading-boundary detection over the
 * COMBINED/inline body, so it recovers the SOW even when it's buried in a Section C blob,
 * and falls back to a CLIN-derived "scope at a glance" from the pricing schedule.
 *
 * Two inputs (pass one): `notice_id` (fetches the SOW/body/attachment text server-side) OR
 * `rfp_text` (the solicitation text directly). Wraps the shared
 * src/lib/proposal/sow-extraction.ts detectors. tier: metered, credits: 2. `_meta` always
 * ships; `_ai_hint` OFF by default.
 */
import { extractSow, buildClinScope } from '@/lib/proposal/sow-extraction';
import { getSolicitationDocuments } from '@/lib/sam/solicitation-documents';
import { mcpFlags } from '@/lib/mcp/flags';

export interface StatementOfWorkInput {
  rfp_text?: string;
  notice_id?: string;
}

export interface StatementOfWorkResult {
  found: boolean;
  title: string;
  sow_text: string;
  clin_scope: string | null;
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string[] };
  _meta: {
    grounded: boolean;
    degraded: boolean;
    source: 'notice_id' | 'text' | 'none';
    notice_id?: string;
    method: 'sow_heading' | 'classified_sow' | 'clin_scope' | 'none';
    sow_chars: number;
    has_clin_scope: boolean;
  };
}

/** Fetch a notice's combined body + attachment text, plus any classified sow_text
 *  as a fallback. Mirrors the compliance-matrix notice fetch. */
async function textFromNotice(
  noticeId: string,
): Promise<{ combined: string; classifiedSow: string; degraded: boolean }> {
  try {
    const docs = await getSolicitationDocuments({ noticeId });
    const parts: string[] = [];
    if (docs.description) parts.push(docs.description);
    for (const d of docs.documents) {
      if (d.extracted_text) parts.push(`--- ${d.filename || 'attachment'} ---\n${d.extracted_text}`);
    }
    return { combined: parts.join('\n\n').trim(), classifiedSow: (docs.sow_text || '').trim(), degraded: false };
  } catch (err) {
    console.error('[statement-of-work] notice fetch failed', noticeId, err);
    return { combined: '', classifiedSow: '', degraded: true };
  }
}

export async function extractStatementOfWork(input: StatementOfWorkInput): Promise<StatementOfWorkResult> {
  const noticeId = (input.notice_id || '').trim();
  const rfpText = (input.rfp_text || '').trim();

  let combined = rfpText;
  let classifiedSow = '';
  let source: 'notice_id' | 'text' | 'none' = rfpText ? 'text' : 'none';
  let fetchDegraded = false;

  if (!rfpText && noticeId) {
    const fetched = await textFromNotice(noticeId);
    combined = fetched.combined;
    classifiedSow = fetched.classifiedSow;
    fetchDegraded = fetched.degraded;
    source = 'notice_id';
  }

  const buildMiss = (): StatementOfWorkResult => {
    const result: StatementOfWorkResult = {
      found: false,
      title: 'Statement of Work',
      sow_text: '',
      clin_scope: null,
      _meta: {
        grounded: false,
        degraded: fetchDegraded,
        source: noticeId ? 'notice_id' : source,
        notice_id: noticeId || undefined,
        method: 'none',
        sow_chars: 0,
        has_clin_scope: false,
      },
    };
    if (mcpFlags.aiHint) {
      result._ai_hint = {
        summary: fetchDegraded
          ? `Could not fetch documents for notice ${noticeId} (source errored) — temporarily unavailable, not "no SOW".`
          : noticeId
            ? `No standalone SOW/PWS block found in notice ${noticeId}, and no CLIN schedule to reconstruct from — the scope is likely spread across attachments. Try get_solicitation_documents to pull the raw files.`
            : 'Provide rfp_text (the solicitation text) or a notice_id to extract the SOW from.',
        how_to_use: 'No SOW was recovered — do NOT invent scope. Pull the raw docs (get_solicitation_documents) and inspect.',
        key_caveats: ['grounded=false means no SOW block was detected, not that the RFP has no scope of work.'],
      };
    }
    return result;
  };

  if (!combined && !classifiedSow) return buildMiss();

  // Priority: regex-detect the SOW block in the combined body → a classified standalone
  // SOW doc → a CLIN-derived scope from the pricing text. Honest miss if none.
  const regex = combined ? extractSow(combined) : { found: false, title: 'Statement of Work', body: '' };
  const clin = combined ? buildClinScope(combined) : null;

  let found = false;
  let title = 'Statement of Work';
  let sowText = '';
  let method: StatementOfWorkResult['_meta']['method'] = 'none';

  if (regex.found) {
    found = true;
    title = regex.title;
    sowText = regex.body;
    method = 'sow_heading';
  } else if (classifiedSow.length >= 400) {
    found = true;
    sowText = classifiedSow;
    method = 'classified_sow';
  } else if (clin) {
    found = true;
    title = 'Scope at a Glance (from the CLINs)';
    sowText = clin;
    method = 'clin_scope';
  }

  if (!found) return buildMiss();

  const result: StatementOfWorkResult = {
    found: true,
    title,
    sow_text: sowText,
    clin_scope: clin,
    _meta: {
      grounded: true,
      degraded: false,
      source,
      notice_id: source === 'notice_id' ? noticeId : undefined,
      method,
      sow_chars: sowText.length,
      has_clin_scope: clin !== null,
    },
  };

  if (mcpFlags.aiHint) {
    result._ai_hint = {
      summary:
        method === 'clin_scope'
          ? 'No standalone SOW heading was found — reconstructed a scope-at-a-glance from the CLIN/pricing schedule. Treat it as a summary, not the full scope.'
          : method === 'classified_sow'
            ? `Returned the classified standalone SOW document (${sowText.length} chars).`
            : `Extracted the ${title} block (${sowText.length} chars) by heading-boundary detection.`,
      how_to_use:
        'Use sow_text as the scope of work to brief subcontractors or seed a technical response. When method=clin_scope, it is a CLIN summary — confirm against the full solicitation + drawings before relying on it.',
      key_caveats: [
        'The SOW is detected by heading boundaries; a solicitation with unusual formatting may under- or over-capture — verify the start/end against the source.',
        'This returns the SCOPE text only, not the Section L/M instructions or evaluation factors — pair with extract_compliance_matrix for the full requirement set.',
        'clin_scope is reconstructed from the pricing schedule, not the narrative SOW — it lists what to price, not full performance detail.',
      ],
    };
  }
  return result;
}
