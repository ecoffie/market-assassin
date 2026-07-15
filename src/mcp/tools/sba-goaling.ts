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
 * tier: metered, credits: 2. `_meta` always ships; `_ai_hint` OFF by default.
 */
import { getAgencySpendingDetail } from '@/lib/usaspending/agency-spending-detail';
import { mcpFlags } from '@/lib/mcp/flags';

export interface SbaGoalingInput {
  agency: string;
  fiscal_year?: number;
}

/** Government-wide statutory goals, keyed to the set-aside buckets the spending lib reports. */
const STATUTORY_GOALS: Array<{ category: string; goal_pct: number; matches: RegExp }> = [
  { category: 'Small Business (prime)', goal_pct: 23, matches: /small business/i },
  { category: '8(a) / SDB', goal_pct: 5, matches: /8\(a\)/i },
  { category: 'SDVOSB', goal_pct: 3, matches: /sdvosb/i },
  { category: 'WOSB / EDWOSB', goal_pct: 5, matches: /wosb/i },
  { category: 'HUBZone', goal_pct: 3, matches: /hubzone/i },
];

export interface GoalingRow {
  category: string;
  goal_pct: number;
  actual_setaside_pct: number;
  gap_pct: number; // actual − goal (negative = below the statutory goal)
  meets_goal: boolean;
}

export interface SbaGoalingResult {
  agency: string | null;
  fiscal_year: number;
  total_obligated: number;
  goals: GoalingRow[];
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string[] };
  _meta: {
    grounded: boolean;
    degraded: boolean;
    fiscal_year: number;
    small_business_setaside_share: number;
    meets_small_business_goal: boolean;
    basis: string;
  };
}

const BASIS = 'set-aside obligations (USASpending) vs. statutory government-wide goals';

export async function getSbaGoalingShare(input: SbaGoalingInput): Promise<SbaGoalingResult> {
  const detail = await getAgencySpendingDetail({ agency: input.agency, fiscalYear: input.fiscal_year });
  const resolved = detail.agency !== null;
  const grounded = resolved && detail.total_obligated > 0 && !detail.degraded;

  // Map each statutory goal to the agency's actual set-aside pct for that bucket.
  const goals: GoalingRow[] = STATUTORY_GOALS.map((g) => {
    const slice = detail.set_aside_breakdown.find((s) => g.matches.test(s.label));
    const actual = slice ? slice.pct_of_total : 0;
    const gap = Math.round((actual - g.goal_pct) * 10) / 10;
    return { category: g.category, goal_pct: g.goal_pct, actual_setaside_pct: actual, gap_pct: gap, meets_goal: actual >= g.goal_pct };
  });

  const sbRow = goals.find((g) => /prime/i.test(g.category));
  const meetsSb = sbRow?.meets_goal ?? false;

  const result: SbaGoalingResult = {
    agency: detail.agency,
    fiscal_year: detail.fiscal_year,
    total_obligated: detail.total_obligated,
    goals,
    _meta: {
      grounded,
      degraded: detail.degraded,
      fiscal_year: detail.fiscal_year,
      small_business_setaside_share: detail.small_business_share,
      meets_small_business_goal: meetsSb,
      basis: BASIS,
    },
  };

  if (mcpFlags.aiHint) {
    result._ai_hint = {
      summary: detail.degraded
        ? 'The USASpending totals were unavailable — treat as temporarily down, not as $0 of small-business spend. Retry shortly.'
        : !grounded
          ? `No toptier agency matched "${input.agency}" (or it reported $0) — no goaling read. Do NOT invent a share.`
          : `${detail.agency} obligated ${detail.small_business_share}% of contract dollars through small-business set-asides in FY${detail.fiscal_year} — ${meetsSb ? 'at or above' : 'below'} the 23% statutory goal. ${goals.filter((g) => g.meets_goal).length}/5 socioeconomic goals met on set-aside dollars.`,
      how_to_use:
        'Use goal_pct vs. actual_setaside_pct per category to gauge how set-aside-friendly this buyer is. A category ABOVE its goal signals an agency that leans into that program (a friendlier entry for that certification); consistently BELOW can mean either a hard market or headroom the agency is under pressure to fill.',
      key_caveats: [
        'The goals are the STATUTORY government-wide minimums (23/5/5/3/3), not this agency\'s own SBA-negotiated targets — those vary and are not asserted here.',
        'Actuals are dollars through set-aside CODES — a FLOOR on, not identical to, the official SBA Scorecard small-business achievement (small firms also win full-and-open). This is not the Scorecard number.',
        '8(a) and SDVOSB/WOSB/HUBZone buckets can overlap in eligibility; each row is measured independently against its own goal.',
      ],
    };
  }
  return result;
}
