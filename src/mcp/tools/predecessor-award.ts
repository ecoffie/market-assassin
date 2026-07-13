/**
 * MCP tool: find_predecessor_award — the likely INCUMBENT contract behind an open
 * opportunity.
 *
 * SAM solicitations don't link to the prior contract, so we infer it: the largest
 * recent award matching the opportunity's NAICS + agency (+ title, when given) is
 * almost always the incumbent being recompeted. Returns its full award detail so the
 * agent can cite real numbers — incumbent name, ceiling, expiry, parent vehicle — plus
 * an honest match-confidence.
 *
 * Reuses src/lib/usaspending/find-predecessor.ts (the same inference the app's
 * IncumbentIntel + bid/no-bid grounding use). Public USASpending data (commodity,
 * metered). credits: 2. `_meta` always ships; `_ai_hint` OFF by default.
 */
import { findPredecessorAward, summarizePredecessor } from '@/lib/usaspending/find-predecessor';
import type { AwardDetail } from '@/lib/usaspending/award-detail';
import { mcpFlags } from '@/lib/mcp/flags';

export interface PredecessorAwardInput {
  /** The opportunity's NAICS code (4-6 digit). */
  naics_code?: string;
  /** The buying agency name, e.g. "Department of Defense". Sharpens the match. */
  agency_name?: string;
  /** The opportunity title — sharpens the match to high confidence when present. */
  title?: string;
}

export interface PredecessorAwardResult {
  queried: { naics_code?: string; agency_name?: string; title?: string };
  incumbent: (AwardDetail & { matchConfidence: 'high' | 'medium' | 'low' }) | null;
  summary: string | null;
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string[] };
  _meta: { grounded: boolean; degraded: boolean; confidence: 'high' | 'medium' | 'low' | null };
}

export async function findPredecessor(input: PredecessorAwardInput): Promise<PredecessorAwardResult> {
  const naics = String(input.naics_code ?? '').trim();
  const agency = String(input.agency_name ?? '').trim();
  const title = String(input.title ?? '').trim();

  let incumbent: (AwardDetail & { matchConfidence: 'high' | 'medium' | 'low' }) | null = null;
  let degraded = false;
  try {
    incumbent = await findPredecessorAward({
      naicsCode: naics || undefined,
      agencyName: agency || undefined,
      keyword: title || undefined,
    });
  } catch (err) {
    degraded = true;
    console.error('[mcp:find_predecessor_award] lookup failed:', err);
  }

  const grounded = !!incumbent;
  const result: PredecessorAwardResult = {
    queried: { ...(naics ? { naics_code: naics } : {}), ...(agency ? { agency_name: agency } : {}), ...(title ? { title } : {}) },
    incumbent,
    summary: incumbent ? summarizePredecessor(incumbent) : null,
    _meta: { grounded, degraded, confidence: incumbent?.matchConfidence ?? null },
  };

  if (mcpFlags.aiHint) {
    result._ai_hint = {
      summary: degraded
        ? 'USASpending could not be reached (temporary error) — retry; do NOT conclude there is no incumbent.'
        : grounded
        ? `Likely incumbent (${incumbent!.matchConfidence} confidence): ${incumbent!.recipientName}${incumbent!.ceiling ? `, ceiling $${incumbent!.ceiling.toLocaleString()}` : ''}.`
        : 'No matching prior award found. Do not invent an incumbent.',
      how_to_use: grounded
        ? 'Present as the LIKELY incumbent (best-match inference, not a certified link) at the stated confidence. Cite the summary + award fields verbatim.'
        : 'No grounded match; say the incumbent is unknown rather than guessing.',
      key_caveats: [
        'This is a NAICS+agency(+title) inference, not a certified predecessor link — always labeled "likely".',
        ...(grounded ? [] : ['Zero matches — any named incumbent would be ungrounded.']),
      ],
    };
  }

  return result;
}
