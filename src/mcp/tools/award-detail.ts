/**
 * MCP tool: get_award_detail — the full USASpending detail for one federal award.
 *
 * Turns a PIID (contract number) OR a USASpending generated_internal_id into the
 * award's real shape: obligated → ceiling (base_and_all_options_value, the true prize
 * size), the parent IDV/vehicle you must hold to compete, period of performance (the
 * recompete-timing window), recipient, NAICS/PSC, and the funding account.
 *
 * Reuses the Award Intelligence spine (src/lib/usaspending/award-detail.ts) — the same
 * resolver the app's award drawer + bid/no-bid grounding use. Public USASpending data
 * (commodity, metered). Transport-agnostic pure fn — same pattern as the other tools.
 *
 * Data-first: `_meta` (grounded/degraded) ALWAYS ships. `_ai_hint` is OFF by default
 * (mcpFlags.aiHint). credits: 2 (a resolve + a detail fetch; both free upstream).
 */
import { fetchAwardDetail, resolvePiidToId, type AwardDetail } from '@/lib/usaspending/award-detail';
import { mcpFlags } from '@/lib/mcp/flags';

export interface AwardDetailInput {
  /** Contract number (PIID), e.g. "140F0822D0024". */
  piid?: string;
  /** USASpending generated_internal_id, if you already have it (skips the resolve). */
  id?: string;
}

export interface AwardDetailResult {
  queried: { piid?: string; id?: string };
  award: AwardDetail | null;
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string[] };
  _meta: {
    grounded: boolean; // an award was resolved + fetched
    degraded: boolean; // the wrapper errored (USASpending unreachable) — not a genuine miss
    resolved_id: string | null;
  };
}

export async function getAwardDetail(input: AwardDetailInput): Promise<AwardDetailResult> {
  const piid = String(input.piid ?? '').trim();
  const rawId = String(input.id ?? '').trim();
  let degraded = false;
  let id: string | null = rawId || null;
  let award: AwardDetail | null = null;

  try {
    if (!id && piid) id = await resolvePiidToId(piid);
    if (id) award = await fetchAwardDetail(id);
  } catch (err) {
    degraded = true;
    console.error('[mcp:get_award_detail] lookup failed:', err);
  }

  const grounded = !!award;
  const result: AwardDetailResult = {
    queried: { ...(piid ? { piid } : {}), ...(rawId ? { id: rawId } : {}) },
    award,
    _meta: { grounded, degraded, resolved_id: id },
  };

  if (mcpFlags.aiHint) {
    result._ai_hint = {
      summary: degraded
        ? `USASpending could not be reached for ${piid || rawId || 'this award'} (temporary error) — retry; do NOT state the award doesn't exist.`
        : grounded
        ? `${award!.recipientName} holds ${award!.awardId} — ${award!.ceiling ? `ceiling $${award!.ceiling.toLocaleString()}` : 'ceiling n/a'}${award!.popPotentialEnd ? `, expires ${award!.popPotentialEnd}` : ''}${award!.parentIdvPiid ? `, under vehicle ${award!.parentIdvPiid}` : ''}.`
        : `No USASpending award matched ${piid || rawId}. Do not invent award figures.`,
      how_to_use: grounded
        ? 'Cite obligated→ceiling as the prize size, the parent IDV as the gate to compete, and popPotentialEnd as the recompete window. All figures trace to the returned award object.'
        : 'No grounded award; say so rather than inventing numbers.',
      key_caveats: grounded
        ? ['Figures are the award as reported to USASpending; verify against the solicitation.']
        : ['No award returned — any figures would be ungrounded.'],
    };
  }

  return result;
}
