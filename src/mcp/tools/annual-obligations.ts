/**
 * MCP tool: get_recipient_annual_obligations — a company's federal obligations
 * PER FISCAL YEAR (the flow), rolled up to the parent. For revenue-share,
 * segment-reporting and concentration work.
 *
 * The one question search_past_contracts CANNOT answer: that tool returns each
 * award's LIFETIME amount, unchanged by its date filter, so summing it gives a
 * figure with no accounting meaning. See src/lib/usaspending/annual-obligations.ts
 * for the measured proof and for why a name-search sum is also wrong.
 * credits: 2 (two live USASpending calls). `_meta` always ships; `_ai_hint` OFF
 * by default.
 */
import { getRecipientAnnualObligations, type FiscalYearObligation, type ResolvedRecipient } from '@/lib/usaspending/annual-obligations';
import { mcpFlags } from '@/lib/mcp/flags';

export interface AnnualObligationsToolInput {
  recipient: string;
  from_fy?: number;
  to_fy?: number;
  naics?: string;
  agency?: string;
}

export interface AnnualObligationsToolResult {
  queried: Record<string, string | number>;
  /** WHO these numbers are for — never assume the query matched what you meant. */
  resolved: ResolvedRecipient | null;
  years: FiscalYearObligation[];
  total: number;
  /** What the numbers ARE. An unlabelled figure invites "your data is wrong". */
  basis: {
    measure: string;
    scope: string;
    source: string;
    award_types: string;
    caveat: string;
  };
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string[] };
  _meta: {
    grounded: boolean;
    degraded: boolean;
    years_returned: number;
    rolled_up_to_parent: boolean;
  };
}

export async function getAnnualObligations(
  input: AnnualObligationsToolInput,
): Promise<AnnualObligationsToolResult> {
  const res = await getRecipientAnnualObligations({
    recipient: input.recipient,
    fromFy: input.from_fy,
    toFy: input.to_fy,
    naics: input.naics,
    agency: input.agency,
  });

  // grounded = a real company resolved AND at least one FY has dollars. Rows of
  // $0 are a genuine "no federal obligations", not a grounded answer.
  const grounded = Boolean(res.resolved) && res.years.some((y) => y.obligated > 0);
  const isParent = res.resolved?.is_parent ?? false;

  const queried: Record<string, string | number> = { recipient: res.query };
  for (const [k, v] of Object.entries({
    from_fy: input.from_fy,
    to_fy: input.to_fy,
    naics: input.naics,
    agency: input.agency,
  })) {
    if (v !== undefined && v !== '') queried[k] = v as string | number;
  }

  const result: AnnualObligationsToolResult = {
    queried,
    resolved: res.resolved,
    years: res.years,
    total: res.total,
    basis: {
      measure: 'Obligations recorded WITHIN each federal fiscal year (Oct 1 – Sep 30). A flow, not a ceiling.',
      scope: isParent
        ? "Consolidated across the PARENT's whole corporate family, using USASpending's own parent/child mapping (so subsidiaries and acquisitions are included)."
        : 'This recipient only — USASpending had NO parent record for it, so nothing is rolled up. If the company has subsidiaries, they are NOT in these figures.',
      source: 'USASpending spending_over_time (group=fiscal_year) filtered by parent recipient_id. One aggregate per year — no per-entity list, so nothing is capped or truncated.',
      award_types: 'Prime contracts only (award_type_codes A, B, C, D). Excludes grants, loans, and IDV vehicles.',
      caveat:
        'Federal obligations are NOT recognized revenue: obligation timing can lead or lag revenue recognition, and this is prime-only — a firm can earn federal money as a subcontractor without appearing here at all.',
    },
    _meta: {
      grounded,
      degraded: res.degraded,
      years_returned: res.years.length,
      rolled_up_to_parent: isParent,
    },
  };

  if (mcpFlags.aiHint) {
    const series = res.years.map((y) => `${y.label} $${Math.round(y.obligated).toLocaleString()}`).join(', ');
    result._ai_hint = {
      summary: res.degraded
        ? 'USASpending errored — retry. Do NOT report a partial series as complete, and do not state the company has no federal work.'
        : !res.resolved
        ? `No USASpending recipient matched "${res.query}". Try the exact legal entity name or the UEI before concluding there is no federal work — do not report $0.`
        : grounded
        ? `${res.resolved.name}${isParent ? ' (parent, consolidated)' : ' (no parent record — this entity only)'}: ${series}.`
        : `${res.resolved.name} resolved, but no prime obligations in the requested years.`,
      how_to_use: grounded
        ? 'ANNUAL flows — safe to compare year over year and to set against a segment disclosure. Do NOT sum search_past_contracts award amounts to get this: those are lifetime totals and double-count.'
        : 'No grounded results; say none matched rather than inventing a figure.',
      key_caveats: [
        'Obligations ≠ recognized revenue. Timing can lead or lag, and this is prime-only — subcontract earnings never appear.',
        isParent
          ? "Consolidated to the parent via USASpending's own mapping, which follows current ownership — an acquired subsidiary's history rolls up under the acquirer."
          : 'NO parent record existed, so nothing was rolled up. Subsidiaries are excluded — check before treating this as a company-wide figure.',
        'A fiscal year newer than the latest complete one is flagged partial — it is still accruing and will rise.',
      ],
    };
  }
  return result;
}
