/**
 * MCP tool: get_solicitation_incumbent
 *
 * Paste a SAM solicitation # (e.g. 140L6226Q0013) or notice UUID → stored notice
 * (latest version; derived status) + the LIKELY prior award (who / $ / expiry).
 * Chat path for "was this awarded before and to whom?"
 *
 * Wraps src/lib/usaspending/solicitation-incumbent.ts. Credits: 20.
 */
import {
  resolveSolicitationIncumbent,
  type SolicitationIncumbentResult,
} from '@/lib/usaspending/solicitation-incumbent';
import { solicitationStatusLabel } from '@/lib/sam/resolve-solicitation';
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
    const statusBit = notice ? solicitationStatusLabel(notice.status ?? 'unknown') : '';
    result._ai_hint = {
      summary: _meta.degraded && !notice
        ? 'Notice lookup degraded (SAM/cache unreachable) — retry; do NOT conclude the solicitation does not exist.'
        : notice && _meta.grounded_incumbent && incumbent
        ? `${statusBit} ${notice.solicitation_number || notice.notice_id}: "${notice.title || 'untitled'}". Supported prior award: ${incumbent.recipientName} (${incumbent.awardId}).`
        : notice && incumbent
        ? `Found ${statusBit.toLowerCase()} ${notice.solicitation_number || notice.notice_id}${notice.title ? ` — "${notice.title}"` : ''}. A prior-award CANDIDATE exists but is NOT identified as the incumbent (${_meta.incumbent_reason || 'insufficient title/PSC evidence'}). Do not name an incumbent from this match.`
        : notice
        ? `Found ${statusBit.toLowerCase()} ${notice.solicitation_number || notice.notice_id}${notice.title ? ` — "${notice.title}"` : ''}${notice.response_deadline ? `. Deadline ${notice.response_deadline}` : ''}${notice.deadline_conflict ? '. Other notices that share this solicitation number have a different deadline — compare against this notice UUID.' : ''}, but no supported prior award on USASpending.`
        : `No SAM notice matched "${q}". Do not invent an opportunity or prior awardee.`,
      how_to_use: notice
        ? 'Lead with the stored solicitation (title, agency, derived status, deadline, set-aside, amendment when present). Present a prior award only when grounded_incumbent is true. If deadline_conflict is true, other notices share this solicitation number — compare against this notice UUID. Link to notice.ui_link when present. Do not call it open unless status is open.'
        : 'Say the solicitation number was not found; ask the user to confirm the number or paste the SAM title.',
      key_caveats: [
        'Prior award is inferred (title/PSC overlap). NAICS agreement or disagreement is not evidence. Do not identify an incumbent unless grounded_incumbent is true.',
        'Solicitation numbers are NOT award PIIDs — do not call get_award_detail with the RFQ number.',
        'Status is derived from the latest stored version (active + deadline), never hardcoded as open.',
        ...(_meta.grounded_incumbent ? [] : ['No grounded incumbent — do not invent who held it or at what price.']),
      ],
    };
  }

  return result;
}
