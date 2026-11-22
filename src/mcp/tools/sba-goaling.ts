/**
 * MCP tool: get_sba_goaling_share — the "is this a good small-business market?" read:
 * the STATUTORY government-wide small-business goals (fixed law) set against an agency's
 * ACTUAL set-aside obligations from USASpending, per socioeconomic category, with the
 * gap and a meets/below flag.
 *
 * The statutory goals (15 U.S.C. § 644(g)) are the verified government-wide MINIMUMS:
 *   Small Business 23% · WOSB 5% · SDB/8(a) 5% · SDVOSB 3% · HUBZone 3%.
 * The actuals come from the same live USASpending aggregates behind get_agency_spending_detail.
 *
 * IMPORTANT honesty line: the actuals measure dollars obligated through the set-aside CODES,
 * which is a FLOOR on — not identical to — the SBA Scorecard's total small-business
 * achievement (small firms also win full-and-open). The tool says so; it never claims to be
 * the official Scorecard number, and it does not invent an agency's own negotiated goals.
 *
 * Wraps the pure src/lib/usaspending/agency-spending-detail.ts (USASpending only, no LLM).
 * tier: metered, credits: 10. `_meta` always ships; `_ai_hint` OFF by default.
 */
import { getAgencySpendingDetail, setAsideIncompleteReason } from '@/lib/usaspending/agency-spending-detail';
import { mcpFlags } from '@/lib/mcp/flags';

export interface SbaGoalingInput {
  agency: string;
  fiscal_year?: number;
}

/**
 * Government-wide statutory goals and the actual each is scored on. Matching is by explicit source, never by
 * bucket label:
 *   - 'combined': the 23% small-business row is scored on set_aside_share, the sum of EVERY set-aside-code
 *     bucket (SBA/SBP + 8(a) + SDVOSB + WOSB + HUBZone + VA's VOSB). It used to match /small business/i
 *     against the SBA/SBP bucket alone (VA FY2026: 0.6% while set_aside_share was 9.4%).
 *   - { code }: a program row is the bucket that carries that set-aside code.
 */
const STATUTORY_GOALS: Array<{ category: string; goal_pct: number; source: 'combined' | { code: string } }> = [
  { category: 'Small Business (prime)', goal_pct: 23, source: 'combined' },
  { category: '8(a) / SDB', goal_pct: 5, source: { code: '8A' } },
  { category: 'SDVOSB', goal_pct: 3, source: { code: 'SDVOSBC' } },
  { category: 'WOSB / EDWOSB', goal_pct: 5, source: { code: 'WOSB' } },
  { category: 'HUBZone', goal_pct: 3, source: { code: 'HZC' } },
];

export interface GoalingRow {
  category: string;
  goal_pct: number;
  /** null when that category's USASpending lookup failed — unknown, never 0 / "below goal". */
  actual_setaside_pct: number | null;
  gap_pct: number | null; // actual − goal (negative = below the statutory goal)
  meets_goal: boolean | null;
}

export interface SbaGoalingResult {
  agency: string | null;
  fiscal_year: number;
  total_obligated: number | null;
  spending_scope: 'REQUESTED' | 'PARENT_SERVICE' | 'NOT_ESTABLISHED';
  recipient_small_business_share: number | null;
  goals: GoalingRow[] | null; // null = agency unmatched (no scorecard) — never a fabricated all-zeros (FM-U03)
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string[] };
  _meta: {
    grounded: boolean;
    degraded: boolean;
    fiscal_year: number;
    small_business_setaside_share: number | null;
    recipient_small_business_share: number | null;
    meets_small_business_goal: boolean | null; // null = unknown (unmatched); NOT false=failed (FM-U03)
    basis: string;
    /** Set when a set-aside bucket lookup failed: result_state becomes 'partial'. Billing unchanged. */
    incomplete_reason?: string;
  };
}

const BASIS = 'set-aside-CODE obligations (USASpending) vs. statutory government-wide goals — a FLOOR on true small-business achievement, NOT the official SBA Scorecard (small firms also win full-and-open dollars this does not count). The Small Business (prime) row is the COMBINED set-aside-code share (every set-aside program summed); it is not SBA Scorecard achievement — recipient_small_business_share is the broader read of who won. recipient_small_business_share is a third metric (who won). Neither share is the 23% goaling figure (different eligible-dollar base). toptier_code 097 on a Navy row is the DoD parent, not a claim the dollars are all of DoD.';

export async function getSbaGoalingShare(input: SbaGoalingInput): Promise<SbaGoalingResult> {
  const detail = await getAgencySpendingDetail({ agency: input.agency, fiscalYear: input.fiscal_year });
  const resolved = detail.agency !== null;
  const requestedTotal = typeof detail.total_obligated === 'number' ? detail.total_obligated : null;
  const parentService = detail.spending.scope === 'PARENT_SERVICE';
  // SYSCOM dollars are NOT_ESTABLISHED — do not score NAVSEA against Navy set-aside share.
  const grounded = resolved && !detail.degraded && !parentService && typeof requestedTotal === 'number' && requestedTotal > 0;

  // FM-U03 (Eric/QA 2026-07-29): when the agency doesn't resolve (or reported $0), emit NO scorecard.
  // Building the goals off an empty breakdown produced all-ZEROS rows — every category read "below
  // goal", overstating failure as if the agency achieved nothing (it just wasn't matched). A null
  // goals array is the honest "no data" — never a fabricated 0/5.
  const goals: GoalingRow[] | null = !grounded
    ? null
    : STATUTORY_GOALS.map((g) => {
        // set_aside_share is already null when any bucket lookup failed: unknown, never 0.
        const code = g.source === 'combined' ? null : g.source.code;
        const actual = code === null
          ? detail.set_aside_share
          : detail.set_aside_breakdown.find((s) => s.codes.includes(code))?.pct_of_total ?? null;
        if (actual === null) return { category: g.category, goal_pct: g.goal_pct, actual_setaside_pct: null, gap_pct: null, meets_goal: null };
        const gap = Math.round((actual - g.goal_pct) * 10) / 10;
        return { category: g.category, goal_pct: g.goal_pct, actual_setaside_pct: actual, gap_pct: gap, meets_goal: actual >= g.goal_pct };
      });

  const sbRow = goals?.find((g) => /prime/i.test(g.category));
  // meets_goal is null (unknown) when there's no scorecard — NOT false (which reads as "failed").
  // A failed bucket makes the combined share unknown, so meets is unknown too (null), not false.
  const meetsSb = grounded ? (sbRow?.meets_goal ?? null) : null;

  const result: SbaGoalingResult = {
    agency: detail.agency,
    fiscal_year: detail.fiscal_year,
    total_obligated: requestedTotal,
    spending_scope: detail.spending.scope,
    recipient_small_business_share: detail.recipient_small_business_share,
    goals,
    _meta: {
      grounded,
      degraded: detail.degraded,
      fiscal_year: detail.fiscal_year,
      small_business_setaside_share: detail.set_aside_share,
      recipient_small_business_share: detail.recipient_small_business_share,
      meets_small_business_goal: meetsSb,
      basis: BASIS,
      ...(grounded && setAsideIncompleteReason(detail.set_aside_breakdown) ? { incomplete_reason: setAsideIncompleteReason(detail.set_aside_breakdown)! } : {}),
    },
  };

  if (mcpFlags.aiHint) {
    result._ai_hint = {
      summary: detail.degraded
        ? 'The USASpending totals were unavailable — treat as temporarily down, not as $0 of small-business spend. Retry shortly.'
        : parentService
          ? `${detail.agency} command-level spending is NOT_ESTABLISHED. Parent-service set-aside/recipient shares are labeled on get_agency_spending_detail — do not score them as this command vs the 23% statutory goal.`
          : !grounded
          ? `No toptier agency matched "${input.agency}" (or spend is not established). Do NOT invent a share.`
          : `${detail.agency} FY${detail.fiscal_year}: set-aside-code share ${detail.set_aside_share}% (a floor, not the SBA Scorecard). Recipient small-business share ${detail.recipient_small_business_share}%. Neither is the 23% statutory goaling figure.`,
      how_to_use:
        'Use goal_pct vs. actual_setaside_pct per category to gauge how set-aside-friendly this buyer is. A category ABOVE its goal signals an agency that leans into that program (a friendlier entry for that certification); consistently BELOW can mean either a hard market or headroom the agency is under pressure to fill.',
      key_caveats: [
        'The goals are the STATUTORY government-wide minimums (23/5/5/3/3), not this agency\'s own SBA-negotiated targets — those vary and are not asserted here.',
        'Actuals are dollars through set-aside CODES — a FLOOR on, not identical to, the official SBA Scorecard small-business achievement (small firms also win full-and-open). This is not the Scorecard number.',
        'recipient_small_business_share (who won) is a different metric from set-aside share (how it was competed). Do not compare either to 23% as if they shared a denominator.',
        'toptier_code 097 on a Navy row is the Department of Defense parent in USASpending, not a claim these dollars are all of DoD. Navy subtier FY2025 contracts measured $176.56B vs DoD $491.77B.',
        '8(a) and SDVOSB/WOSB/HUBZone buckets can overlap in eligibility; each row is measured independently against its own goal.',
      ],
    };
  }
  return result;
}
