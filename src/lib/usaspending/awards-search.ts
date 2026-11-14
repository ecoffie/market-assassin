/**
 * Past-contract (AWARD) search by LOCATION — the "what federal contracts were
 * awarded in <state>" lookup that Mindy was missing (it indexed awards by
 * agency/NAICS/company but not geography). Backed by USASpending
 * spending_by_award (the authoritative prime-award corpus; free upstream).
 *
 * Location is matched on PLACE OF PERFORMANCE by default (where the work is
 * done — the usual meaning of "contracts in Florida"), or RECIPIENT location
 * (the awardee's HQ state), or BOTH (union). USASpending ANDs its filters and
 * forbids mixing contract + IDV award-type groups in one request, so "both"
 * scopes — and IDV inclusion — are run as separate parallel requests and merged
 * + deduped here (same pattern as the SAM.gov parallel-NAICS rule).
 *
 * Place-of-performance state is an FPDS-required field, so it is well populated
 * on awards (unlike SAM opportunity notices, where pop_state is ~36% filled).
 */

import { CONTRACT_CODES, IDV_CODES } from '@/lib/usaspending/award-type-codes';
import { usaSpendingAwardingAgencyFilter } from '@/lib/usaspending/awarding-agency-filter';

const API_URL = 'https://api.usaspending.gov/api/v2/search/spending_by_award/';

// CONTRACT_CODES / IDV_CODES: shared canonical groups (cannot mix in one call).

export type StateScope = 'pop' | 'recipient' | 'both';

export interface AwardsByLocationOptions {
  state?: string;                 // 2-letter code (normalized upstream)
  stateScope?: StateScope;        // default 'pop'
  naics?: string;                 // 6-digit exact or 2-5 digit prefix
  psc?: string;
  agency?: string;                // awarding agency name (military departments map to sub-tier)
  recipient?: string;             // recipient name keyword
  /**
   * Free-text keyword (USASpending `filters.keywords`, matched as one phrase against award
   * description, award id and recipient). When `piidPrefix` is also given the server query is the
   * prefix and this keyword is matched client-side against description + recipient (USASpending
   * ORs multiple keywords, so both cannot be sent together without losing the AND).
   */
  keyword?: string;
  /**
   * Contract-number (PIID) prefix, e.g. "W912EQ" (an office DoDAAC). Sent to USASpending as a
   * keyword (which matches award ids by prefix) and then enforced client-side: only rows whose
   * Award ID starts with the prefix are kept.
   */
  piidPrefix?: string;
  minValue?: number;
  dateFrom?: string;              // action-date lower bound (YYYY-MM-DD)
  dateTo?: string;
  includeIdv?: boolean;           // also return IDV vehicles (default false)
  limit?: number;                 // merged results returned (default 25, max 100)
}

export interface AwardRow {
  awardId: string;
  recipientName: string;
  recipientUei: string;
  awardAmount: number;
  description: string;
  startDate: string;
  endDate: string;
  agency: string;
  subAgency: string;
  awardingOffice: string;
  /** Source NAICS only — never stamped from the query filter. Empty when USASpending returns null. */
  naicsCode: string;
  naicsDescription: string;
  /** Source PSC only — never stamped from the query filter. */
  pscCode: string;
  pscDescription: string;
  /** Recipient HQ state. Empty when source null — do NOT treat popState as a substitute. */
  recipientState: string;
  /** Place of performance state (not recipient HQ). */
  popState: string;
  awardType: string;
  generatedId: string;
  usaSpendingUrl: string;
  /** Exact filter the caller sent; not source evidence that the award carries this NAICS. */
  queriedNaics?: string;
  queriedPsc?: string;
}

export interface AwardsByLocationResult {
  awards: AwardRow[];
  count: number;
  /** Approximate matched total across the fired requests (page_metadata sum). */
  totalEstimate: number;
  requestsFired: number;
  degraded: boolean;
  /** How keyword / piid_prefix were applied (server-side vs client-side), for _meta.applied_filters. */
  textFilters?: {
    keyword?: { value: string; applied: 'server_keyword' | 'client_side_description_recipient' };
    piid_prefix?: { value: string; applied: 'server_keyword_plus_client_prefix_check' };
    /** Rows scanned server-side before client-side filtering (both-filter mode only). */
    scanned_rows?: number;
    /** True when the server-side scan stopped at the page cap with more rows remaining. */
    scan_truncated?: boolean;
  };
}

/** Pages scanned per request when a client-side keyword filter runs over a PIID-prefix query. */
export const PREFIX_SCAN_MAX_PAGES = 15;
const PREFIX_SCAN_PAGE_SIZE = 100;
const PREFIX_SCAN_BATCH = 5;

/** Normalize a PIID prefix; returns null when it is not a plausible prefix (2-17 alphanumerics). */
export function normalizePiidPrefix(raw: string | undefined | null): string | null {
  const v = String(raw ?? '').replace(/[\s-]/g, '').toUpperCase();
  return /^[A-Z0-9]{2,17}$/.test(v) ? v : null;
}

/**
 * Client-side keyword match used only in prefix+keyword mode: the whole phrase appears, or every
 * significant word (3+ chars) appears as a word prefix, in the description or recipient name.
 */
export function rowMatchesKeyword(row: Pick<AwardRow, 'description' | 'recipientName'>, keyword: string): boolean {
  const hay = `${row.description} ${row.recipientName}`.toLowerCase();
  const phrase = keyword.trim().toLowerCase();
  if (!phrase) return true;
  if (hay.includes(phrase)) return true;
  const words = phrase.split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
  if (!words.length) return false;
  // words contain only [a-z0-9] (split above), so no regex escaping is needed.
  return words.every((w) => new RegExp(`\\b${w}`).test(hay));
}

const FIELDS = [
  'Award ID',
  'Recipient Name',
  'Recipient UEI',
  'Award Amount',
  'Description',
  'Start Date',
  'End Date',
  'Awarding Agency',
  'Awarding Sub Agency',
  'Awarding Office',
  'NAICS Code',
  'NAICS Description',
  'Product or Service Code',
  'Product or Service Code Description',
  'Contract Award Type',
  'Recipient State Code',
  'Place of Performance State Code',
  // generated_internal_id is the id the award-detail API + /award/ deep link need
  // (generated_unique_award_id is null for contracts/IDVs). Request both.
  'generated_internal_id',
  'generated_unique_award_id',
];

interface FireResult {
  rows: AwardRow[];
  total: number;
  ok: boolean;
  scanned?: number;
  truncated?: boolean;
}

/** USASpending spending_by_award often returns NAICS/PSC/office/state as null
 *  even when those columns were requested and the FILTER matched. Measured
 *  2026-09-20: naics=336612 returned awards with `NAICS Code: null` on every
 *  sampled row. Keep source fields empty when null — never stamp the filter into
 *  naicsCode/pscCode (that made query criteria look like award evidence). Carry
 *  the filter separately as queriedNaics/queriedPsc. popState is place of
 *  performance and must not be read as recipient HQ. */
export function mapAwardRow(
  c: Record<string, unknown>,
  filter: { naics?: string; psc?: string } = {},
): AwardRow {
  const gid = (c['generated_internal_id'] || c['generated_unique_award_id'] || '') as string;
  const awardId = (c['Award ID'] as string) || '';
  const sourceNaics = String(c['NAICS Code'] || '').trim();
  const sourcePsc = String(c['Product or Service Code'] || '').trim();
  const qNaics = String(filter.naics || '').trim();
  const qPsc = String(filter.psc || '').trim().toUpperCase();
  return {
    awardId,
    recipientName: (c['Recipient Name'] as string) || '',
    recipientUei: (c['Recipient UEI'] as string) || '',
    awardAmount: parseFloat(c['Award Amount'] as string) || 0,
    description: (c['Description'] as string) || '',
    startDate: (c['Start Date'] as string) || '',
    endDate: (c['End Date'] as string) || '',
    agency: (c['Awarding Agency'] as string) || '',
    subAgency: (c['Awarding Sub Agency'] as string) || '',
    awardingOffice: (c['Awarding Office'] as string) || '',
    naicsCode: sourceNaics,
    naicsDescription: (c['NAICS Description'] as string) || '',
    pscCode: sourcePsc,
    pscDescription: (c['Product or Service Code Description'] as string) || '',
    recipientState: (c['Recipient State Code'] as string) || '',
    popState: (c['Place of Performance State Code'] as string) || '',
    awardType: (c['Contract Award Type'] as string) || '',
    generatedId: gid,
    usaSpendingUrl: gid
      ? `https://www.usaspending.gov/award/${gid}`
      : `https://www.usaspending.gov/keyword_search/${encodeURIComponent(awardId)}`,
    ...(qNaics ? { queriedNaics: qNaics } : {}),
    ...(qPsc ? { queriedPsc: qPsc } : {}),
  };
}

/** One spending_by_award POST for a single (award-type group, state filter). */
async function fireOne(
  awardTypeCodes: string[],
  locationFilter: Record<string, unknown> | null,
  opts: AwardsByLocationOptions,
  perRequestLimit: number,
): Promise<FireResult> {
  const filters: Record<string, unknown> = {
    award_type_codes: awardTypeCodes,
    award_amounts: [{ lower_bound: opts.minValue ?? 0 }],
  };

  if (opts.dateFrom || opts.dateTo) {
    filters.time_period = [{
      start_date: opts.dateFrom || '2000-01-01',
      end_date: opts.dateTo || new Date().toISOString().split('T')[0],
    }];
  }

  if (opts.naics) {
    const codes = [...new Set(
      opts.naics.split(/[,\s]+/).map((c) => c.replace(/\D/g, '')).filter((c) => c.length >= 2 && c.length <= 6),
    )];
    if (codes.length) filters.naics_codes = { require: codes };
  }
  // PSC on spending_by_award is a FLAT array of codes — NOT the { require: [...] } tiered form that
  // naics_codes takes. Passing { require: ['1385'] } 422s: "'1385' is not a valid type (array)"
  // (the tiered form wants an array-of-arrays hierarchy path). That 422 made the tool report
  // degraded=true and return empty for a valid PSC (FM-05, Eric/QA 2026-07-28 — psc 1385 EOD tools:
  // the flat form returns Parsons $106M / KBR $84M). Flat array is correct here.
  if (opts.psc) filters.psc_codes = [opts.psc.trim().toUpperCase()];
  if (opts.agency) filters.agencies = [usaSpendingAwardingAgencyFilter(opts.agency)];
  if (opts.recipient) filters.recipient_search_text = [opts.recipient.trim()];
  const prefix = normalizePiidPrefix(opts.piidPrefix);
  const keyword = opts.keyword?.trim() || '';
  // USASpending ORs entries in `keywords`, so prefix + keyword cannot both go server-side.
  // Prefix is the narrower, office-anchored key: send it, then match the keyword client-side.
  if (prefix) filters.keywords = [prefix];
  else if (keyword) filters.keywords = [keyword];
  if (locationFilter) Object.assign(filters, locationFilter);

  const scanMode = !!(prefix && keyword);
  const pageSize = scanMode ? PREFIX_SCAN_PAGE_SIZE : perRequestLimit;

  const fetchPage = async (page: number): Promise<{ rows: AwardRow[]; total: number | null; hasNext: boolean; ok: boolean }> => {
    const body = {
      filters,
      fields: FIELDS,
      page,
      limit: pageSize,
      sort: 'Award Amount',
      order: 'desc',
      subawards: false,
    };
    try {
      const resp = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        console.error(`[usaspending:awards-search] ${resp.status} for ${JSON.stringify(awardTypeCodes)}`);
        return { rows: [], total: null, hasNext: false, ok: false };
      }
      const data = await resp.json();
      const rows: AwardRow[] = (data.results || []).map((c: Record<string, unknown>) => mapAwardRow(c, opts));
      return { rows, total: data.page_metadata?.total ?? null, hasNext: !!data.page_metadata?.hasNext, ok: true };
    } catch (err) {
      console.error('[usaspending:awards-search] fetch failed:', err);
      return { rows: [], total: null, hasNext: false, ok: false };
    }
  };

  const keepPrefix = (rows: AwardRow[]) => (prefix ? rows.filter((r) => r.awardId.toUpperCase().startsWith(prefix)) : rows);

  if (!scanMode) {
    const p = await fetchPage(1);
    if (!p.ok) return { rows: [], total: 0, ok: false };
    const rows = keepPrefix(p.rows);
    // With a prefix check the server total can include non-prefix keyword hits; report what we kept
    // unless the server total is the only signal of more rows.
    const total = prefix ? (p.hasNext ? Math.max(rows.length, p.total ?? rows.length) : rows.length) : (p.total ?? rows.length);
    return { rows, total, ok: true };
  }

  // Scan mode: page the prefix population (batches of parallel pages), keep keyword matches.
  const kept: AwardRow[] = [];
  let scanned = 0;
  let anyOk = false;
  let more = true;
  let page = 1;
  while (more && page <= PREFIX_SCAN_MAX_PAGES) {
    const batch: number[] = [];
    for (let i = 0; i < PREFIX_SCAN_BATCH && page <= PREFIX_SCAN_MAX_PAGES; i++) batch.push(page++);
    const pages = await Promise.all(batch.map(fetchPage));
    more = false;
    for (const p of pages) {
      if (!p.ok) continue;
      anyOk = true;
      scanned += p.rows.length;
      kept.push(...keepPrefix(p.rows).filter((r) => rowMatchesKeyword(r, keyword)));
    }
    const last = pages[pages.length - 1];
    more = !!(last?.ok && last.hasNext);
  }
  if (!anyOk) return { rows: [], total: 0, ok: false, scanned: 0, truncated: false };
  return { rows: kept, total: kept.length, ok: true, scanned, truncated: more };
}

function locationFiltersFor(state: string | undefined, scope: StateScope): (Record<string, unknown> | null)[] {
  if (!state) return [null];
  const pop = { place_of_performance_locations: [{ country: 'USA', state }] };
  const rec = { recipient_locations: [{ country: 'USA', state }] };
  if (scope === 'recipient') return [rec];
  if (scope === 'both') return [pop, rec];
  return [pop];
}

/**
 * Search awarded prime contracts (and optionally IDV vehicles) filtered by
 * location + NAICS/PSC/agency/recipient/value/date. Fires one request per
 * (award-type group × state filter) and merges/dedupes by award id.
 */
export async function searchAwardsByLocation(opts: AwardsByLocationOptions = {}): Promise<AwardsByLocationResult> {
  const scope: StateScope = opts.stateScope ?? 'pop';
  const state = opts.state?.trim().toUpperCase() || undefined;
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);

  const groups: string[][] = opts.includeIdv
    ? [[...CONTRACT_CODES], [...IDV_CODES]]
    : [[...CONTRACT_CODES]];
  const locFilters = locationFiltersFor(state, scope);

  // Cartesian product of (award-type group × location filter). Fetch `limit`
  // from each so the merged top-N is complete after sorting.
  const jobs: Promise<FireResult>[] = [];
  for (const g of groups) {
    for (const loc of locFilters) {
      jobs.push(fireOne(g, loc, { ...opts, state }, limit));
    }
  }
  const results = await Promise.all(jobs);

  // Merge + dedupe by generatedId (fallback awardId). Keep the larger amount.
  const byId = new Map<string, AwardRow>();
  let totalEstimate = 0;
  let anyOk = false;
  let scanned = 0;
  let scanTruncated = false;
  for (const r of results) {
    if (r.ok) anyOk = true;
    totalEstimate += r.total;
    scanned += r.scanned ?? 0;
    if (r.truncated) scanTruncated = true;
    for (const row of r.rows) {
      const key = row.generatedId || row.awardId || `${row.recipientUei}:${row.awardAmount}`;
      const prev = byId.get(key);
      if (!prev || row.awardAmount > prev.awardAmount) byId.set(key, row);
    }
  }

  const merged = [...byId.values()].sort((a, b) => b.awardAmount - a.awardAmount).slice(0, limit);
  // With a single request the page_metadata total is exact; when we union
  // multiple requests it double-counts overlap, so only trust it for one job.
  const total = results.length === 1 ? totalEstimate : Math.max(totalEstimate, merged.length);

  const prefix = normalizePiidPrefix(opts.piidPrefix);
  const keyword = opts.keyword?.trim() || '';
  const textFilters: AwardsByLocationResult['textFilters'] = {};
  if (prefix) textFilters.piid_prefix = { value: prefix, applied: 'server_keyword_plus_client_prefix_check' };
  if (keyword) textFilters.keyword = { value: keyword, applied: prefix ? 'client_side_description_recipient' : 'server_keyword' };
  if (prefix && keyword) {
    textFilters.scanned_rows = scanned;
    textFilters.scan_truncated = scanTruncated;
  }

  return {
    awards: merged,
    count: merged.length,
    totalEstimate: total,
    requestsFired: jobs.length,
    degraded: !anyOk,
    ...(prefix || keyword ? { textFilters } : {}),
  };
}
