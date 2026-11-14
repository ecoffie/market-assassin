/**
 * MCP tool: search_past_contracts — awarded federal PRIME contracts by LOCATION
 * (place of performance / recipient HQ / both) + NAICS / PSC / agency / recipient
 * / value / date. The "what contracts were awarded in <state>" lookup.
 *
 * Wraps src/lib/usaspending/awards-search.ts (USASpending spending_by_award,
 * live, authoritative). Distinct from search_idv_contracts (vehicles + task
 * orders) and get_contractor_award_history (a single named firm). credits: 5
 * (live USASpending search). `_meta` always ships; `_ai_hint` OFF by default.
 */
import { searchAwardsByLocation, normalizePiidPrefix, type AwardRow, type StateScope } from '@/lib/usaspending/awards-search';
import { assessPublicationLag, fetchUsaSpendingLastUpdated } from '@/lib/usaspending/freshness';
import { usaSpendingAwardingAgencyFilter } from '@/lib/usaspending/awarding-agency-filter';
import type { IgnoredArg } from '@/lib/mcp/result-contract';
import { normalizeStateCode } from '@/lib/utils/us-states';
import { mcpFlags } from '@/lib/mcp/flags';

export interface PastContractsToolInput {
  state?: string;
  /** 'pop' (place of performance, default) | 'recipient' (HQ) | 'both' (union). */
  state_scope?: StateScope;
  naics?: string;
  psc?: string;
  agency?: string;
  recipient?: string;
  min_value?: number;
  date_from?: string;
  date_to?: string;
  include_idv?: boolean;
  limit?: number;
  /** Free-text keyword / phrase (USASpending keyword search over description, award id, recipient). */
  keyword?: string;
  /** Contract-number prefix, e.g. an office DoDAAC like "W912EQ" or "N00189". */
  piid_prefix?: string;
}

export interface PastContractsToolResult {
  queried: Record<string, string | number | boolean>;
  awards: AwardRow[];
  /**
   * What `awardAmount` IS. Measured 2026-07-17: an unlabelled number invites
   * "your data is wrong" — and here it invites a wrong ACCOUNTING figure.
   */
  basis: {
    award_amount: string;
    date_filter: string;
    do_not: string;
  };
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string[] };
  _meta: {
    grounded: boolean;
    degraded: boolean;
    count: number;
    total: number;
    state_scope: StateScope;
    /** True when the default 'pop' scope returned 0 and we auto-retried the widest scope (FM-05). */
    auto_widened?: boolean;
    requests_fired: number;
    /** Every filter that shaped the query, with the value actually sent (and how text filters ran). */
    applied_filters?: Record<string, unknown>;
    ignored_args?: IgnoredArg[];
    /** USASpending's own last-load date (only fetched when a date window was requested). */
    as_of?: string | null;
    /** Set when the requested window falls inside the DoD publication lag. */
    lag_note?: string;
    incomplete_reason?: string;
    result_state?: 'partial';
    /**
     * Field honesty for USASpending gaps. naicsCode/pscCode are SOURCE only;
     * queried_* carry the filter. recipientState is HQ — popState is place of
     * performance and does not establish recipient HQ when HQ is empty.
     */
    field_status: {
      naics: 'source_or_empty';
      psc: 'source_or_empty';
      recipient_state: 'source_or_empty';
      pop_state: 'place_of_performance_not_recipient_hq';
      note: string;
    };
  };
}

export async function searchPastContracts(input: PastContractsToolInput): Promise<PastContractsToolResult> {
  const requestedScope: StateScope = input.state_scope ?? 'pop';
  // Accept "Florida" or "FL"; drop an unrecognized value rather than filter on junk.
  const state = input.state ? normalizeStateCode(input.state) ?? undefined : undefined;
  const ignored: IgnoredArg[] = [];
  if (input.state && !state) {
    ignored.push({ arg: 'state', value: String(input.state), reason: 'invalid_value', detail: 'not a recognized US state; no state filter was applied' });
  }
  const keyword = typeof input.keyword === 'string' && input.keyword.trim() ? input.keyword.trim() : undefined;
  const piidPrefix = input.piid_prefix ? normalizePiidPrefix(input.piid_prefix) ?? undefined : undefined;
  if (input.piid_prefix && !piidPrefix) {
    ignored.push({ arg: 'piid_prefix', value: String(input.piid_prefix), reason: 'invalid_value', detail: 'expected 2-17 letters/digits (e.g. "W912EQ"); no prefix filter was applied' });
  }

  const hasWindow = !!(input.date_from || input.date_to);
  // Freshness is only fetched when a date window was asked for (best-effort; null on failure).
  const asOfPromise: Promise<string | null> = hasWindow ? fetchUsaSpendingLastUpdated() : Promise.resolve(null);

  const runSearch = (stateScope: StateScope) => searchAwardsByLocation({
    state, stateScope,
    naics: input.naics, psc: input.psc, agency: input.agency, recipient: input.recipient,
    minValue: input.min_value, dateFrom: input.date_from, dateTo: input.date_to,
    includeIdv: input.include_idv, limit: input.limit,
    keyword, piidPrefix,
  });

  let scope = requestedScope;
  let res = await runSearch(scope);

  // WIDEN-ON-ZERO (FM-05, Eric/QA 2026-07-28): the default 'pop' scope filters by place of performance,
  // which is SPARSE/irrelevant for a code-only query — e.g. PSC 1385 (EOD tools) returned empty under
  // 'pop' though real awards exist under recipient scope. If the DEFAULT scope came back empty and the
  // caller didn't EXPLICITLY pin a scope, auto-retry the widest scope ('both' = pop ∪ recipient) and
  // report that we widened, rather than handing back a misleading empty.
  const autoWidened =
    !input.state_scope && res.awards.length === 0 && !res.degraded && scope !== 'both';
  if (autoWidened) {
    scope = 'both';
    res = await runSearch(scope);
  }

  const grounded = res.awards.length > 0;
  const queried: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries({
    state,
    state_scope: scope,
    naics: input.naics,
    psc: input.psc,
    agency: input.agency,
    recipient: input.recipient,
    include_idv: input.include_idv,
  })) {
    if (v !== undefined && v !== '') queried[k] = v as string | number | boolean;
  }

  if (keyword) queried.keyword = keyword;
  if (piidPrefix) queried.piid_prefix = piidPrefix;

  // Everything that shaped the query, as sent (P1 result contract).
  const applied: Record<string, unknown> = {};
  if (state) applied.state = { value: state, scope };
  if (input.naics) applied.naics = input.naics;
  if (input.psc) applied.psc = String(input.psc).trim().toUpperCase();
  if (input.agency) applied.agency = usaSpendingAwardingAgencyFilter(input.agency);
  if (input.recipient) applied.recipient = input.recipient;
  if (input.min_value !== undefined) applied.min_value = input.min_value;
  if (hasWindow) {
    applied.date_from = input.date_from || '2000-01-01';
    applied.date_to = input.date_to || new Date().toISOString().slice(0, 10);
  }
  if (input.include_idv) applied.include_idv = true;
  if (res.textFilters?.keyword) applied.keyword = res.textFilters.keyword;
  if (res.textFilters?.piid_prefix) applied.piid_prefix = res.textFilters.piid_prefix;
  if (res.textFilters?.scanned_rows !== undefined) {
    applied.prefix_scan = { scanned_rows: res.textFilters.scanned_rows, truncated: !!res.textFilters.scan_truncated };
  }

  const asOf = await asOfPromise;
  const lag = assessPublicationLag({ dateFrom: input.date_from, dateTo: input.date_to, agency: input.agency, asOf });
  const incompleteReasons: string[] = [];
  if (lag.applies && lag.note) incompleteReasons.push(lag.note);
  if (res.textFilters?.scan_truncated) {
    incompleteReasons.push(
      `The piid_prefix population was larger than the ${res.textFilters.scanned_rows} rows scanned for the keyword match (largest awards first); smaller matching awards may be missing. Narrow with a date window or drop the keyword.`,
    );
  }

  const result: PastContractsToolResult = {
    queried,
    awards: res.awards,
    basis: {
      award_amount:
        "The award's LIFETIME total to date — a stock, not an annual figure. NOT scoped to date_from/date_to.",
      date_filter:
        'date_from/date_to select WHICH awards return (by transaction activity); they do NOT scope awardAmount. An award can be returned for a year it was not performing.',
      do_not:
        'Do NOT sum awardAmount to derive annual revenue or a fiscal-year share — the same lifetime total comes back in every window, so it double-counts. Use get_recipient_annual_obligations for per-year flows.',
    },
    _meta: {
      grounded,
      degraded: res.degraded,
      count: res.count,
      total: res.totalEstimate,
      state_scope: scope,
      ...(autoWidened ? { auto_widened: true } : {}),
      requests_fired: res.requestsFired,
      applied_filters: applied,
      ...(ignored.length ? { ignored_args: ignored } : {}),
      ...(hasWindow ? { as_of: asOf } : {}),
      ...(lag.applies && lag.note ? { lag_note: lag.note } : {}),
      ...(incompleteReasons.length ? { incomplete_reason: incompleteReasons.join(' ') } : {}),
      // A window inside the publication lag is never a verified zero, even with 0 rows.
      ...(incompleteReasons.length ? { result_state: 'partial' as const } : {}),
      field_status: {
        naics: 'source_or_empty',
        psc: 'source_or_empty',
        recipient_state: 'source_or_empty',
        pop_state: 'place_of_performance_not_recipient_hq',
        note:
          'naicsCode/pscCode/recipientState are USASpending source fields (empty when the API returns null). queriedNaics/queriedPsc are the filter you sent — not award evidence. popState is place of performance only; it does not establish recipient HQ.',
      },
    },
  };

  if (mcpFlags.aiHint) {
    const top = res.awards[0];
    const where =
      scope === 'both' ? 'performed in OR awarded to a firm in' : scope === 'recipient' ? 'awarded to a firm HQ’d in' : 'performed in';
    result._ai_hint = {
      summary: res.degraded
        ? 'USASpending award search errored — retry; do not state there are no awards.'
        : grounded
        ? `${autoWidened ? '(auto-widened to state_scope:"both" — the default place-of-performance scope returned 0) ' : ''}${res.count} of ~${res.totalEstimate} awards ${where} ${state ?? 'the filtered scope'}. Top: ${top.recipientName} — $${Math.round(top.awardAmount).toLocaleString()} (${top.agency}).`
        : lag.applies
        ? `No published awards matched yet. ${lag.note}`
        : `No awards matched${autoWidened ? ' even after auto-widening to state_scope:"both"' : ''}. Broaden the NAICS/PSC or widen the date range.`,
      how_to_use: grounded
        ? 'Historical prime awards (already awarded, not open bids). recipientName = who won; popState = where the work is done; use get_award_detail on generatedId for the full record, or get_contractor_award_history on a recipient to size them up.'
        : 'No grounded results; say none matched rather than inventing an award.',
      key_caveats: [
        'Place-of-performance state is well-populated on awards, but a firm can perform in a state it is not HQ’d in — state_scope controls which side you match.',
        'These are AWARDED contracts (past), not open solicitations. For open opportunities use search_sam_opportunities.',
        'awardAmount is the award’s LIFETIME total — NOT annual, and NOT scoped by date_from/date_to. The identical amount comes back in every window (measured), so summing these for a yearly figure double-counts. For per-fiscal-year flows use get_recipient_annual_obligations.',
        'date_from/date_to select which awards return, by transaction activity — an award whose period of performance already ENDED can still appear in a later window.',
      ],
    };
  }
  return result;
}
