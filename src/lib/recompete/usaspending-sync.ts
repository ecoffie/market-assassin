/**
 * USASpending -> recompete_opportunities sync.
 *
 * Shared by the admin route (incremental, a NAICS slice at a time so it fits a
 * serverless timeout) and scripts/sync-recompete-full.mjs (full sweep).
 *
 * Constraints of the spending_by_award endpoint, all verified empirically on
 * 2026-07-16. Each one silently corrupts the sync if "simplified" away:
 *
 * 1. award_type_codes MUST come from ONE group per request. Mixing contract
 *    codes (A/B/C/D) with IDV codes (IDV_A..IDV_E) returns
 *    {"message": "'award_type_codes' must only contain types from one group."}
 *    -- an ERROR, not an empty result set.
 *
 * 2. Contracts and IDVs have DIFFERENT FIELD SCHEMAS. IDVs have no 'End Date'
 *    (their nearest equivalent is 'Last Date to Order'), and use 'Description'
 *    / 'naics_code' / 'psc_code' where contracts use 'Award Description' /
 *    'NAICS Code' / 'Product or Service Code'. Requesting a contract field on
 *    an IDV query yields undefined, not an error -- which reads exactly like
 *    "no data" and drops every IDV on the floor. Hence AWARD_GROUPS below.
 *
 * 3. 'Type of Set Aside', 'Extent Competed' and 'Number of Offers Received'
 *    come back NULL from this endpoint even when requested. They exist only on
 *    the per-award detail endpoint (one HTTP call per award). We deliberately
 *    do NOT map them: writing a null that a reader could mistake for "no
 *    set-aside" is worse than leaving the column untouched. See issue #280.
 *
 * 4. There is no period-of-performance-end filter. time_period filters on
 *    action_date; passing date_type 'period_of_performance_current_end_date'
 *    500s their server. So the end-date window is applied client-side, and we
 *    sort by the group's date field descending to reach the window quickly.
 *
 * 5. `sort` must name a field that is also present in `fields`.
 */

const SEARCH_URL = 'https://api.usaspending.gov/api/v2/search/spending_by_award/';
const PAGE_LIMIT = 100; // endpoint max

/**
 * Per-group query schema. `dateField` is the column we treat as the
 * period-of-performance end.
 *
 * NOTE on IDVs: 'Last Date to Order' is the vehicle's ordering deadline, NOT a
 * period-of-performance end, and IDV 'Award Amount' is typically 0 (an IDV is
 * a ceiling, not an obligation). They are therefore synced only when
 * includeIdvs is set, and are exempt from the minValue floor.
 */
export const AWARD_GROUPS = {
  contracts: {
    codes: ['A', 'B', 'C', 'D'] as const,
    dateField: 'End Date',
    naicsField: 'NAICS Code',
    naicsDescField: 'NAICS Description',
    descField: 'Award Description',
    pscField: 'Product or Service Code',
    officeField: 'Awarding Office Name',
    applyMinValue: true,
  },
  idvs: {
    codes: ['IDV_A', 'IDV_B', 'IDV_C', 'IDV_D', 'IDV_E'] as const,
    dateField: 'Last Date to Order',
    naicsField: 'naics_code',
    naicsDescField: 'naics_description',
    descField: 'Description',
    pscField: 'psc_code',
    officeField: null, // IDV mappings expose no awarding office name
    applyMinValue: false,
  },
} as const;

export type AwardGroupName = keyof typeof AWARD_GROUPS;

export interface SyncedContract {
  contract_id: string;
  award_id: string;
  piid: string;
  incumbent_name: string;
  incumbent_uei: string | null;
  awarding_agency: string;
  awarding_sub_agency: string | null;
  awarding_office: string | null;
  funding_agency: string | null;
  naics_code: string | null;
  naics_description: string | null;
  psc_code: string | null;
  description: string | null;
  total_obligation: number;
  potential_total_value: number | null;
  period_of_performance_start: string | null;
  period_of_performance_current_end: string | null;
  place_of_performance_state: string | null;
  place_of_performance_city: string | null;
  contract_type: string | null;
  data_source: string;
  source_url: string;
  last_synced_at: string;
}

export interface FetchOptions {
  naics: string;
  monthsAhead: number;
  minValue: number;
  /** IDVs are excluded by default -- see the AWARD_GROUPS note. */
  includeIdvs?: boolean;
  /**
   * Safety valve on pagination depth per group. Hitting it means the window
   * was NOT fully covered; fetchExpiringForNaics reports that via
   * `truncatedGroups` rather than quietly returning a short list.
   */
  maxPages?: number;
  fetchImpl?: typeof fetch;
  onPage?: (info: { naics: string; group: AwardGroupName; page: number; got: number; oldest: string | null }) => void;
}

export interface FetchResult {
  contracts: SyncedContract[];
  /**
   * Groups that ran out of page budget before reaching today. A non-empty
   * array means this NAICS is INCOMPLETE -- callers must surface it, never
   * treat the result as a full sweep.
   */
  truncatedGroups: AwardGroupName[];
}

function nullIfEmpty(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function fieldsFor(group: (typeof AWARD_GROUPS)[AwardGroupName]): string[] {
  return [
    'Award ID',
    'Recipient Name',
    'Recipient UEI',
    'Awarding Agency',
    'Awarding Sub Agency',
    'Funding Agency',
    'Award Amount',
    'Start Date',
    'Place of Performance State Code',
    'Contract Award Type',
    group.dateField,
    group.naicsField,
    group.naicsDescField,
    group.descField,
    group.pscField,
    ...(group.officeField ? [group.officeField] : []),
  ];
}

/**
 * One page of one award-type group. Throws on API error rather than returning
 * [] -- an error coerced to an empty page is indistinguishable from "no more
 * results" and silently truncates the sync.
 */
async function fetchPage(params: {
  naics: string;
  group: (typeof AWARD_GROUPS)[AwardGroupName];
  page: number;
  fetchImpl: typeof fetch;
}): Promise<{ results: Record<string, unknown>[]; hasNext: boolean }> {
  const { naics, group, page, fetchImpl } = params;

  const response = await fetchImpl(SEARCH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filters: { award_type_codes: group.codes, naics_codes: [naics] },
      fields: fieldsFor(group),
      page,
      limit: PAGE_LIMIT,
      sort: group.dateField,
      order: 'desc',
    }),
  });

  const raw = await response.text();
  let payload: {
    results?: Record<string, unknown>[];
    page_metadata?: { hasNext?: boolean };
    message?: string;
    detail?: string;
  } | null = null;
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = null;
  }

  if (!response.ok || !payload || payload.message || payload.detail) {
    const reason = payload?.message || payload?.detail || `HTTP ${response.status}: ${raw.slice(0, 160)}`;
    throw new Error(
      `USASpending failed for NAICS ${naics} [${group.codes.join(',')}] page ${page}: ${reason}`
    );
  }

  return { results: payload.results || [], hasNext: !!payload.page_metadata?.hasNext };
}

/**
 * Every award for one NAICS whose period of performance ends inside the
 * window. Results are sorted by end date descending, so we page down from the
 * far future and stop as soon as a page ends before today.
 */
export async function fetchExpiringForNaics(options: FetchOptions): Promise<FetchResult> {
  const {
    naics,
    monthsAhead,
    minValue,
    includeIdvs = false,
    maxPages = 400,
    fetchImpl = fetch,
    onPage,
  } = options;

  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const horizon = new Date(today);
  horizon.setMonth(horizon.getMonth() + monthsAhead);
  const horizonStr = horizon.toISOString().slice(0, 10);
  const syncedAt = new Date().toISOString();

  const groupNames: AwardGroupName[] = includeIdvs ? ['contracts', 'idvs'] : ['contracts'];
  const byContractId = new Map<string, SyncedContract>();
  const truncatedGroups: AwardGroupName[] = [];

  for (const groupName of groupNames) {
    const group = AWARD_GROUPS[groupName];
    let reachedEnd = false;

    for (let page = 1; page <= maxPages; page++) {
      const { results, hasNext } = await fetchPage({ naics, group, page, fetchImpl });

      let oldestOnPage: string | null = null;

      for (const award of results) {
        const endDateStr = nullIfEmpty(award[group.dateField]);
        if (!endDateStr) continue;
        if (!oldestOnPage || endDateStr < oldestOnPage) oldestOnPage = endDateStr;

        if (endDateStr <= todayStr || endDateStr > horizonStr) continue;

        const amount = Number.parseFloat(String(award['Award Amount'] ?? '0'));
        const safeAmount = Number.isFinite(amount) ? amount : 0;
        if (group.applyMinValue && safeAmount < minValue) continue;

        const piid = nullIfEmpty(award['Award ID']);
        if (!piid) continue;

        // generated_internal_id is the globally unique award key. A PIID is
        // NOT unique across agencies, which is why contract_id must not be it.
        const contractId = nullIfEmpty(award['generated_internal_id']) || piid;

        byContractId.set(contractId, {
          contract_id: contractId,
          award_id: piid,
          piid,
          incumbent_name: nullIfEmpty(award['Recipient Name']) || 'Unknown',
          incumbent_uei: nullIfEmpty(award['Recipient UEI']),
          awarding_agency: nullIfEmpty(award['Awarding Agency']) || 'Unknown',
          awarding_sub_agency: nullIfEmpty(award['Awarding Sub Agency']),
          awarding_office: group.officeField ? nullIfEmpty(award[group.officeField]) : null,
          funding_agency: nullIfEmpty(award['Funding Agency']),
          naics_code: nullIfEmpty(award[group.naicsField]) || naics,
          naics_description: nullIfEmpty(award[group.naicsDescField]),
          psc_code: nullIfEmpty(award[group.pscField]),
          description: nullIfEmpty(award[group.descField]),
          total_obligation: safeAmount,
          potential_total_value: safeAmount || null,
          period_of_performance_start: nullIfEmpty(award['Start Date']),
          period_of_performance_current_end: endDateStr,
          place_of_performance_state: nullIfEmpty(award['Place of Performance State Code']),
          place_of_performance_city: null, // not in the IDV mapping; omitted for parity
          contract_type: nullIfEmpty(award['Contract Award Type']),
          data_source: groupName === 'idvs' ? 'usaspending-sync-idv' : 'usaspending-sync',
          source_url: `https://www.usaspending.gov/award/${contractId}`,
          last_synced_at: syncedAt,
        });
      }

      onPage?.({ naics, group: groupName, page, got: results.length, oldest: oldestOnPage });

      // Sorted end-date descending: once a whole page sits at or before today,
      // every later page is older still.
      if (oldestOnPage && oldestOnPage <= todayStr) { reachedEnd = true; break; }
      if (!hasNext || results.length === 0) { reachedEnd = true; break; }
    }

    // Ran out of page budget while still above today -> the window is only
    // partially covered for this group. Say so loudly.
    if (!reachedEnd) truncatedGroups.push(groupName);
  }

  return { contracts: [...byContractId.values()], truncatedGroups };
}
