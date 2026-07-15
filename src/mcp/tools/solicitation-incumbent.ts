/**
 * MCP tool: get_solicitation_incumbent
 *
 * Paste a SAM solicitation # (e.g. 140L6226Q0013) or notice UUID → open notice
 * metadata + the LIKELY prior award (who / $ / expiry). This is the Chat path
 * for "was this awarded before and to whom?"
 *
 * Wraps src/lib/usaspending/solicitation-incumbent.ts. Credits: 2.
 */
import {
  resolveSolicitationIncumbent,
  type SolicitationIncumbentResult,
} from '@/lib/usaspending/solicitation-incumbent';
import { mcpFlags } from '@/lib/mcp/flags';

export interface SolicitationIncumbentInput {
  /** Solicitation number (e.g. 140L6226Q0013) OR 32-char notice UUID. */
  solicitation_number?: string;
  /** Alias — same as solicitation_number (models often pass notice_id). */
  notice_id?: string;
}

export type SolicitationIncumbentToolResult = SolicitationIncumbentResult & {
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string[] };
};

export async function getSolicitationIncumbent(
  input: SolicitationIncumbentInput,
): Promise<SolicitationIncumbentToolResult> {
  const q = String(input.solicitation_number || input.notice_id || '').trim();
  if (!q) {
    return {
      queried: '',
      notice: null,
      incumbent: null,
      prior_awards: [],
      summary: null,
      _meta: {
        grounded_notice: false,
        grounded_incumbent: false,
        degraded: false,
        notice_source: null,
      },
    };
  }

  const result = (await resolveSolicitationIncumbent(q)) as SolicitationIncumbentToolResult;

  if (mcpFlags.aiHint) {
    const { notice, incumbent, _meta } = result;
    result._ai_hint = {
      summary: _meta.degraded && !notice
        ? 'Notice lookup degraded (SAM/cache unreachable) — retry; do NOT conclude the solicitation does not exist.'
        : notice && incumbent
        ? `Open ${notice.solicitation_number || notice.notice_id}: "${notice.title || 'untitled'}". Likely prior award: ${incumbent.recipientName} (${incumbent.awardId}) at $${Math.round(incumbent.ceiling || incumbent.obligated || 0).toLocaleString()}, expires ${incumbent.popPotentialEnd || '?'}.`
        : notice
        ? `Found open notice ${notice.solicitation_number || notice.notice_id}${notice.title ? ` — "${notice.title}"` : ''}, but no clear prior award on USASpending.`
        : `No SAM notice matched "${q}". Do not invent an opportunity or prior awardee.`,
      how_to_use: notice
        ? 'Lead with the open solicitation (title, agency, deadline, set-aside). Then present the incumbent as LIKELY prior award (best-match inference), citing PIID, recipient, ceiling/obligated, and expiry verbatim. Link to notice.ui_link and incumbent.usaSpendingUrl when present.'
        : 'Say the solicitation number was not found; ask the user to confirm the number or paste the SAM title.',
      key_caveats: [
        'Prior award is inferred (title/NAICS/agency match) — not a certified predecessor link on the RFQ.',
        'Solicitation numbers are NOT award PIIDs — do not call get_award_detail with the RFQ number.',
        ...(_meta.grounded_incumbent ? [] : ['No grounded incumbent — do not invent who held it or at what price.']),
      ],
    };
  }

  return result;
}
