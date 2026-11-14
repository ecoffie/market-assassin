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
import { isoDay } from '@/lib/usaspending/freshness';
import { usaSpendingAwardingAgencyFilter } from '@/lib/usaspending/awarding-agency-filter';
import { officeRemainder, looksLikeOffice, resolveAwardingOffices } from '@/lib/usaspending/office-resolve';
import type { IgnoredArg } from '@/lib/mcp/result-contract';
import { normalizeStateCode } from '@/lib/utils/us-states';
import { mcpFlags } from '@/lib/mcp/flags';

import { getAwardDetail } from './award-detail';

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
  /**
   * Also report status (active / expired), days to end and a likely-successor check for the top
   * matches (up to STATUS_CHECK_MAX), in the same call. "Is X still active / who replaced it" in
   * one step instead of a second get_award_detail call per award.
   */
  include_status?: boolean;
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
  /** Present when include_status was requested: one entry per checked award (top matches). */
  status_checks?: Array<{
    award_id: string;
    status: string;
    days_until_end: number | null;
    end_date: string | null;
    successor: unknown;
    error?: string;
  }>;
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

const ABBREVIATIONS: Record<string, string> = {
  id: 'identification', it: 'information technology', mgmt: 'management', maint: 'maintenance',
  svc: 'services', svcs: 'services', ops: 'operations', hq: 'headquarters',
};

/**
 * Alternative phrasings of a keyword for a retry after an empty exact-phrase search: (1) without words
 * the agency filter already covers ("Navy ID card" with agency Navy -> "ID card"), (2) with common
 * abbreviations spelled out ("ID card" -> "identification card"). Never adds a new concept.
 */
export function keywordVariants(keyword: string, agency?: string): string[] {
  const words = keyword.trim().split(/\s+/).filter(Boolean);
  const agencyWords = new Set(String(agency ?? '').toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 3 && !['the', 'and', 'department', 'of'].includes(w)));
  const stripped = words.filter((w) => !agencyWords.has(w.toLowerCase().replace(/[^a-z]/g, '')));
  const base = stripped.length ? stripped : words;
  const expanded = base.map((w) => ABBREVIATIONS[w.toLowerCase()] ?? w);
  const out: string[] = [];
  for (const v of [base.join(' '), expanded.join(' ')]) {
    if (v && v.toLowerCase() !== keyword.trim().toLowerCase() && !out.some((o) => o.toLowerCase() === v.toLowerCase())) out.push(v);
  }
  return out;
}

/** Awards checked for status/successor when include_status is set (each check is a detail fetch). */
export const STATUS_CHECK_MAX = 3;

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

  // Office part of the agency phrase ("USACE Memphis District"): resolve it to awarding-office codes
  // and filter by contract-number prefix server-side, instead of silently widening to the agency.
  let officePrefix: string | undefined;
  let officeApplied: Record<string, unknown> | null = null;
  if (!piidPrefix && input.agency) {
    const remainder = officeRemainder(input.agency);
    if (looksLikeOffice(input.agency, remainder)) {
      const subtier = usaSpendingAwardingAgencyFilter(input.agency);
      const r = await resolveAwardingOffices(input.agency, subtier.tier === 'subtier' ? subtier.name : null);
      if (r.offices.length) {
        officeApplied = { requested: r.remainder, candidates: r.offices.map((o) => `${o.code} ${o.name}`) };
      } else {
        ignored.push({
          arg: 'agency', value: String(r.remainder), reason: 'unsupported_value',
          detail: `the office "${r.remainder}" could not be resolved to an awarding office${r.error ? ` (${r.error})` : ''}; results cover the whole agency, not that office`,
        });
      }
      if (r.offices.length) {
        // Try each candidate code (most offices have one contracting code); keep the first with awards.
        for (const o of r.offices) {
          const probe = await searchAwardsByLocation({
            state, stateScope: requestedScope, naics: input.naics, psc: input.psc, agency: input.agency, recipient: input.recipient,
            minValue: input.min_value, dateFrom: input.date_from, dateTo: input.date_to, includeIdv: input.include_idv, limit: 1,
            keyword, piidPrefix: normalizePiidPrefix(o.code) ?? undefined,
          });
          if (probe.awards.length) { officePrefix = normalizePiidPrefix(o.code) ?? undefined; officeApplied = { ...(officeApplied ?? {}), code: o.code, name: o.name }; break; }
        }
        if (!officePrefix) {
          ignored.push({ arg: 'agency', value: String(r.remainder), reason: 'unsupported_value', detail: `office candidates ${r.offices.map((o) => o.code).join(', ')} had no awards in scope; results cover the whole agency` });
          officeApplied = null;
        }
      }
    }
  }
  const effectivePrefix = piidPrefix ?? officePrefix;

  const runSearch = (stateScope: StateScope) => searchAwardsByLocation({
    state, stateScope,
    naics: input.naics, psc: input.psc, agency: input.agency, recipient: input.recipient,
    minValue: input.min_value, dateFrom: input.date_from, dateTo: input.date_to,
    includeIdv: input.include_idv, limit: input.limit,
    keyword, piidPrefix: effectivePrefix,
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

  // KEYWORD RETRY-ON-ZERO (acc6 R5): USASpending keyword search is an exact phrase, so "Navy ID card"
  // found nothing although three Navy awards read "IDENTIFICATION CARD ...". When a keyword search is
  // empty, retry with the words already covered by the agency filter removed and common abbreviations
  // spelled out; the retry is reported in applied_filters.keyword_retry, never hidden.
  let keywordRetry: { requested: string; used: string } | null = null;
  if (keyword && res.awards.length === 0 && !res.degraded) {
    for (const variant of keywordVariants(keyword, input.agency).slice(0, 2)) {
      const retry = await searchAwardsByLocation({
        state, stateScope: scope, naics: input.naics, psc: input.psc, agency: input.agency, recipient: input.recipient,
        minValue: input.min_value, dateFrom: input.date_from, dateTo: input.date_to, includeIdv: input.include_idv, limit: input.limit,
        keyword: variant, piidPrefix: effectivePrefix,
      });
      if (retry.awards.length) { res = retry; keywordRetry = { requested: keyword, used: variant }; break; }
    }
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
    applied.date_to = input.date_to || isoDay(new Date()); // federal business day (US Eastern), one date basis
  }
  if (input.include_idv) applied.include_idv = true;
  if (res.textFilters?.keyword) applied.keyword = res.textFilters.keyword;
  if (res.textFilters?.piid_prefix) applied.piid_prefix = res.textFilters.piid_prefix;
  if (officeApplied) applied.office = officeApplied;
  if (keywordRetry) applied.keyword_retry = keywordRetry;
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
  if (input.include_status && result.awards.length) {
    result.status_checks = await Promise.all(
      result.awards.slice(0, STATUS_CHECK_MAX).map(async (row) => {
        try {
          const d = await getAwardDetail({ piid: row.awardId });
          return {
            award_id: row.awardId,
            status: d.status,
            days_until_end: d.days_until_end,
            end_date: d.status_basis?.end_date_used ?? null,
            successor: d.successor,
          };
        } catch (err) {
          return { award_id: row.awardId, status: 'unknown', days_until_end: null, end_date: null, successor: null, error: String((err as Error)?.message || err).slice(0, 120) };
        }
      }),
    );
    if (result._meta.applied_filters) (result._meta.applied_filters as Record<string, unknown>).include_status = true;
    else result._meta.applied_filters = { include_status: true };
  }
  return result;
}
