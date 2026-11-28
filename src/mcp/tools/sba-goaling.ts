/**
 * MCP tool: get_sba_goaling_share — the "is this a good small-business market?" read:
 * the STATUTORY government-wide small-business goals (fixed law) set against an agency's
 * ACTUAL set-aside obligations from USASpending, per socioeconomic category, with the
 * gap and an above/below flag. It is a SET-ASIDE-BASED INDICATOR, not an official SBA goaling scorecard.
 *
 * The statutory goals (15 U.S.C. § 644(g)) are the verified government-wide MINIMUMS:
 *   Small Business 23% · WOSB 5% · SDB/8(a) 5% · SDVOSB 3% through FY2024, 5% from FY2025 (Pub. L. 118-31 §863) ·
 *   HUBZone 3%. The goal is chosen by the FISCAL YEAR scored (src/lib/sba/statutory-goals.ts).
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
import { statutoryGoalPct, STATUTORY_GOAL_SOURCE, type StatutoryGoalKey } from '@/lib/sba/statutory-goals';

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
export type GoalingKey = StatutoryGoalKey;

// Category text is read by consumers: MRR section 12 keys on `key` (falling back to /prime/i, so "prime"
// stays in the combined row's text), and every other row keeps its program name.
// goal_pct comes from statutoryGoalPct(key, fiscal year): SDVOSB is 3% through FY2024 and 5% from FY2025.
const STATUTORY_GOALS: Array<{ key: GoalingKey; category: string; source: 'combined' | { code: string } }> = [
  { key: 'small_business', category: 'Small Business (prime): combined set-aside-code share', source: 'combined' },
  { key: 'sdb_8a', category: '8(a) / SDB', source: { code: '8A' } },
  { key: 'sdvosb', category: 'SDVOSB', source: { code: 'SDVOSBC' } },
  { key: 'wosb', category: 'WOSB / EDWOSB', source: { code: 'WOSB' } },
  { key: 'hubzone', category: 'HUBZone', source: { code: 'HZC' } },
];

/** Every row is a set-aside-code share measured against a statutory goal: an indicator, never the SBA Scorecard. */
export const GOALING_MEASURE = 'set_aside_code_share' as const;
export const GOALING_INDICATOR = 'Set-aside indicator, not the SBA Scorecard' as const;

export interface GoalingRow {
  /** Stable row id for consumers; category text is display only. */
  key: GoalingKey;
  category: string;
  /** What actual_setaside_pct measures: dollars under set-aside codes ÷ agency contract obligations. */
  measure: typeof GOALING_MEASURE;
  indicator: typeof GOALING_INDICATOR;
  goal_pct: number;
  /** null when that category's USASpending lookup failed — unknown, never 0 / "below goal". */
  actual_setaside_pct: number | null;
  gap_pct: number | null; // actual − goal (negative = below the statutory goal)
  /** The set-aside indicator vs the statutory goal — NOT a claim the agency met (or missed) its SBA goal. */
  meets_goal: boolean | null;
  /** Plain reading of meets_goal; always says "set-aside indicator". */
  status_label: string;
}

/** Never "meets the SBA goal": the wording names the set-aside indicator every time. */
export function goalingStatusLabel(goalPct: number, meets: boolean | null): string {
  if (meets === null) return `Set-aside indicator unavailable (unknown, not below the ${goalPct}% goal)`;
  return meets
    ? `Set-aside indicator at or above the ${goalPct}% statutory goal (not SBA Scorecard achievement)`
    : `Set-aside indicator below the ${goalPct}% statutory goal (not SBA Scorecard achievement)`;
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
    /** The combined SET-ASIDE INDICATOR vs 23% — not whether the agency met its SBA goal. null = unknown (FM-U03). */
    meets_small_business_goal: boolean | null;
    basis: string;
    /** Where the goal percentages come from, including the FY2025 SDVOSB change. */
    goal_source: string;
    /** Set when a set-aside bucket lookup failed: result_state becomes 'partial'. Billing unchanged. */
    incomplete_reason?: string;
  };
}

const BASIS = 'SET-ASIDE INDICATOR: set-aside-CODE obligations (USASpending) vs. statutory government-wide goals — a FLOOR on true small-business achievement, NOT the official SBA Scorecard (small firms also win full-and-open dollars this does not count). The Small Business (prime) row is the COMBINED set-aside-code share (every set-aside program summed). recipient_small_business_share is a separate, broader read of who won (small-business recipients, set-aside or not). Neither share is the 23% goaling figure (different eligible-dollar base). toptier_code 097 on a Navy row is the DoD parent, not a claim the dollars are all of DoD.';

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
        const goalPct = statutoryGoalPct(g.key, detail.fiscal_year);
        const base = { key: g.key, category: g.category, measure: GOALING_MEASURE, indicator: GOALING_INDICATOR, goal_pct: goalPct };
        if (actual === null) return { ...base, actual_setaside_pct: null, gap_pct: null, meets_goal: null, status_label: goalingStatusLabel(goalPct, null) };
        const gap = Math.round((actual - goalPct) * 10) / 10;
        const meets = actual >= goalPct;
        return { ...base, actual_setaside_pct: actual, gap_pct: gap, meets_goal: meets, status_label: goalingStatusLabel(goalPct, meets) };
      });

  const sbRow = goals?.find((g) => g.key === 'small_business');
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
      goal_source: STATUTORY_GOAL_SOURCE,
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
        'Each row is a set-aside indicator, not the SBA Scorecard: say "set-aside indicator above/below the goal", never "meets the SBA goal". Use goal_pct vs. actual_setaside_pct per category to gauge how set-aside-friendly this buyer is. A category ABOVE its goal signals an agency that leans into that program (a friendlier entry for that certification); consistently BELOW can mean either a hard market or headroom the agency is under pressure to fill.',
      key_caveats: [
        `The goals are the STATUTORY government-wide minimums for FY${detail.fiscal_year} (SB 23 · SDB 5 · WOSB 5 · SDVOSB ${statutoryGoalPct('sdvosb', detail.fiscal_year)} · HUBZone 3; SDVOSB is 3% through FY2024 and 5% from FY2025, Pub. L. 118-31 §863), not this agency's own SBA-negotiated targets — those vary and are not asserted here.`,
        'Actuals are dollars through set-aside CODES — a FLOOR on, not identical to, the official SBA Scorecard small-business achievement (small firms also win full-and-open). This is not the Scorecard number.',
        'recipient_small_business_share (who won) is a different metric from set-aside share (how it was competed). Do not compare either to 23% as if they shared a denominator.',
        'toptier_code 097 on a Navy row is the Department of Defense parent in USASpending, not a claim these dollars are all of DoD. Navy subtier FY2025 contracts measured $176.56B vs DoD $491.77B.',
        '8(a) and SDVOSB/WOSB/HUBZone buckets can overlap in eligibility; each row is measured independently against its own goal.',
      ],
    };
  }
  return result;
}
