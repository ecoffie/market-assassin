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

const API_URL = 'https://api.usaspending.gov/api/v2/search/spending_by_award/';

// Standard prime-contract award types (definitive contracts, POs, delivery
// orders, BPA calls). IDV vehicles are a SEPARATE group (can't mix in one call).
const CONTRACT_CODES = ['A', 'B', 'C', 'D'];
const IDV_CODES = ['IDV_A', 'IDV_B', 'IDV_B_A', 'IDV_B_B', 'IDV_B_C', 'IDV_C', 'IDV_D', 'IDV_E'];

export type StateScope = 'pop' | 'recipient' | 'both';

export interface AwardsByLocationOptions {
  state?: string;                 // 2-letter code (normalized upstream)
  stateScope?: StateScope;        // default 'pop'
  naics?: string;                 // 6-digit exact or 2-5 digit prefix
  psc?: string;
  agency?: string;                // awarding agency (toptier) name
  recipient?: string;             // recipient name keyword
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
  naicsCode: string;
  naicsDescription: string;
  pscCode: string;
  pscDescription: string;
  recipientState: string;
  popState: string;
  awardType: string;
  generatedId: string;
  usaSpendingUrl: string;
}

export interface AwardsByLocationResult {
  awards: AwardRow[];
  count: number;
  /** Approximate matched total across the fired requests (page_metadata sum). */
  totalEstimate: number;
  requestsFired: number;
  degraded: boolean;
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
  if (opts.psc) filters.psc_codes = { require: [opts.psc.trim().toUpperCase()] };
  if (opts.agency) filters.agencies = [{ type: 'awarding', tier: 'toptier', name: opts.agency }];
  if (opts.recipient) filters.recipient_search_text = [opts.recipient.trim()];
  if (locationFilter) Object.assign(filters, locationFilter);

  const body = {
    filters,
    fields: FIELDS,
    page: 1,
    limit: perRequestLimit,
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
      return { rows: [], total: 0, ok: false };
    }
    const data = await resp.json();
    const rows: AwardRow[] = (data.results || []).map((c: Record<string, unknown>) => {
      const gid = (c['generated_internal_id'] || c['generated_unique_award_id'] || '') as string;
      const awardId = (c['Award ID'] as string) || '';
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
        naicsCode: (c['NAICS Code'] as string) || '',
        naicsDescription: (c['NAICS Description'] as string) || '',
        pscCode: (c['Product or Service Code'] as string) || '',
        pscDescription: (c['Product or Service Code Description'] as string) || '',
        recipientState: (c['Recipient State Code'] as string) || '',
        popState: (c['Place of Performance State Code'] as string) || '',
        awardType: (c['Contract Award Type'] as string) || '',
        generatedId: gid,
        usaSpendingUrl: gid
          ? `https://www.usaspending.gov/award/${gid}`
          : `https://www.usaspending.gov/keyword_search/${encodeURIComponent(awardId)}`,
      };
    });
    return { rows, total: data.page_metadata?.total ?? rows.length, ok: true };
  } catch (err) {
    console.error('[usaspending:awards-search] fetch failed:', err);
    return { rows: [], total: 0, ok: false };
  }
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

  const groups: string[][] = opts.includeIdv ? [CONTRACT_CODES, IDV_CODES] : [CONTRACT_CODES];
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
  for (const r of results) {
    if (r.ok) anyOk = true;
    totalEstimate += r.total;
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

  return {
    awards: merged,
    count: merged.length,
    totalEstimate: total,
    requestsFired: jobs.length,
    degraded: !anyOk,
  };
}
