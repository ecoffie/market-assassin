/**
 * Agency spending DETAIL — the "who inside this department buys, and can a small
 * business actually win here" read. Complements get_agency_intel (identity + top NAICS)
 * with two things it doesn't have:
 *   1. sub-agency (component) breakdown — which components spend the money, and
 *   2. set-aside distribution — how much of the agency's contract dollars go out as
 *      Small Business / 8(a) / SDVOSB / WOSB / HUBZone set-asides (the small-business
 *      "easy entry" signal), + the overall small-business share.
 *
 * All figures are live USASpending contract obligations (award_type_codes A/B/C/D) for
 * the chosen fiscal year. Uses spending_by_category filtered to ONE agency — a single
 * agency-value row is that agency's exact total, and the same call + set_aside_type_codes
 * gives each bucket's exact total (accurate, not a top-N sum). No LLM.
 */
import { fetchAllUSASpendingAgencies } from '@/lib/utils/agency-list-builder';
import { fiscalYearTimePeriod, latestCompleteFiscalYear } from '@/lib/utils/fiscal-year';

const USASPENDING = 'https://api.usaspending.gov/api/v2';
const CONTRACT_AWARD_TYPES = ['A', 'B', 'C', 'D'];

// Set-aside buckets → the working USASpending set_aside_type_codes (verified live
// 2026-06-18, mirrors src/lib/utils/usaspending-helpers.ts setAsideMap/veteranMap).
const SET_ASIDE_BUCKETS: Array<{ label: string; codes: string[] }> = [
  { label: 'Small Business (total set-aside)', codes: ['SBA', 'SBP'] },
  { label: '8(a)', codes: ['8A', '8AN'] },
  { label: 'SDVOSB', codes: ['SDVOSBC', 'SDVOSBS'] },
  { label: 'WOSB / EDWOSB', codes: ['WOSB', 'EDWOSB'] },
  { label: 'HUBZone', codes: ['HZC', 'HZS'] },
];

export interface AgencySpendingDetailInput {
  agency: string;
  fiscalYear?: number;
}

export interface SetAsideSlice { label: string; codes: string[]; amount: number; pct_of_total: number }
export interface SubAgencySlice { name: string; amount: number; pct_of_total: number }

export interface AgencySpendingDetailResult {
  agency: string | null;
  toptier_code: string | null;
  fiscal_year: number;
  window: { start_date: string; end_date: string };
  total_obligated: number;
  sub_agencies: SubAgencySlice[];
  set_aside_breakdown: SetAsideSlice[];
  /** Sum of all set-aside buckets ÷ total — the small-business share of contract $. */
  small_business_share: number;
  degraded: boolean;
  trace: string[];
}

// Cached toptier agency list (canonical name + code) — one fetch per process warm-up.
let _agencyList: Array<{ name: string; toptierCode: string; abbreviation: string }> | null = null;
async function agencyList() {
  if (!_agencyList) {
    const all = await fetchAllUSASpendingAgencies();
    _agencyList = all.map((a) => ({ name: a.name, toptierCode: a.toptierCode, abbreviation: a.abbreviation }));
  }
  return _agencyList;
}

function acronymOf(name: string): string {
  const skip = new Set(['OF', 'THE', 'AND', 'FOR', '&', '-']);
  return name.toUpperCase().replace(/[^A-Z\s&-]/g, ' ').split(/\s+/).filter((w) => w && !skip.has(w)).map((w) => w[0]).join('');
}

async function resolveAgency(input: string): Promise<{ name: string; toptierCode: string } | null> {
  const raw = input.trim();
  if (!raw) return null;
  const list = await agencyList();
  const rl = raw.toLowerCase();
  // exact name → abbreviation → acronym → contains
  return (
    list.find((a) => a.name.toLowerCase() === rl) ||
    list.find((a) => a.abbreviation && a.abbreviation.toLowerCase() === rl) ||
    list.find((a) => acronymOf(a.name) === raw.toUpperCase().replace(/[^A-Z]/g, '')) ||
    (raw.length >= 4 ? list.find((a) => a.name.toLowerCase().includes(rl) || rl.includes(a.name.toLowerCase())) : undefined) ||
    null
  );
}

interface CategoryRow { name?: string; amount?: number }

async function spendingByCategory(
  category: 'awarding_agency' | 'awarding_subagency',
  agencyName: string,
  window: { start_date: string; end_date: string },
  setAsideCodes?: string[],
): Promise<CategoryRow[]> {
  const filters: Record<string, unknown> = {
    agencies: [{ type: 'awarding', tier: 'toptier', name: agencyName }],
    time_period: [window],
    award_type_codes: CONTRACT_AWARD_TYPES,
  };
  if (setAsideCodes && setAsideCodes.length) filters.set_aside_type_codes = setAsideCodes;
  const res = await fetch(`${USASPENDING}/search/spending_by_category/${category}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filters, category, limit: category === 'awarding_subagency' ? 50 : 5, page: 1 }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`spending_by_category/${category} → ${res.status}`);
  const j = (await res.json()) as { results?: CategoryRow[] };
  return j.results || [];
}

export async function getAgencySpendingDetail(input: AgencySpendingDetailInput): Promise<AgencySpendingDetailResult> {
  const trace: string[] = [];
  const fy = input.fiscalYear || latestCompleteFiscalYear();
  const window = fiscalYearTimePeriod(fy);

  const empty: AgencySpendingDetailResult = {
    agency: null, toptier_code: null, fiscal_year: fy, window,
    total_obligated: 0, sub_agencies: [], set_aside_breakdown: [], small_business_share: 0,
    degraded: false, trace,
  };

  let resolved: { name: string; toptierCode: string } | null = null;
  try {
    resolved = await resolveAgency(input.agency || '');
  } catch (e) {
    trace.push(`agency resolve failed: ${e instanceof Error ? e.message : String(e)}`);
    return { ...empty, degraded: true };
  }
  if (!resolved) {
    trace.push(`no toptier agency matched "${input.agency}"`);
    return empty;
  }
  trace.push(`resolved "${input.agency}" → ${resolved.name} (${resolved.toptierCode})`);

  // Total + sub-agency breakdown + each set-aside bucket, in parallel. Each is an exact
  // single-value aggregate (agency-filtered), so no top-N under-count.
  const [totalRows, subRows, ...bucketRows] = await Promise.all([
    spendingByCategory('awarding_agency', resolved.name, window).catch((e) => { trace.push(`total: ${e.message}`); return null; }),
    spendingByCategory('awarding_subagency', resolved.name, window).catch((e) => { trace.push(`subagency: ${e.message}`); return null; }),
    ...SET_ASIDE_BUCKETS.map((b) =>
      spendingByCategory('awarding_agency', resolved!.name, window, b.codes).catch((e) => { trace.push(`${b.label}: ${e.message}`); return null; }),
    ),
  ]);

  if (totalRows === null) {
    // The core total failed — report degraded rather than a misleading 0.
    return { ...empty, agency: resolved.name, toptier_code: resolved.toptierCode, degraded: true };
  }

  const total = (totalRows || []).reduce((s, r) => s + (r.amount || 0), 0);
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 1000) / 10 : 0);

  const sub_agencies: SubAgencySlice[] = (subRows || [])
    .map((r) => ({ name: r.name || '', amount: r.amount || 0, pct_of_total: pct(r.amount || 0) }))
    // Drop the parent self-row (single-component agencies report only themselves) so
    // DoD keeps its real components and VA honestly shows no sub-agency split.
    .filter((s) => s.name && s.amount > 0 && s.name.toLowerCase() !== resolved!.name.toLowerCase())
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 15);

  const set_aside_breakdown: SetAsideSlice[] = SET_ASIDE_BUCKETS.map((b, i) => {
    const rows = bucketRows[i];
    const amount = (rows || []).reduce((s, r) => s + (r.amount || 0), 0);
    return { label: b.label, codes: b.codes, amount, pct_of_total: pct(amount) };
  });

  // Small-business share = sum of the non-overlapping set-aside buckets ÷ total. The
  // buckets are mutually exclusive by set_aside code, so summing is a valid total.
  const sbTotal = set_aside_breakdown.reduce((s, b) => s + b.amount, 0);
  const small_business_share = total > 0 ? Math.round((sbTotal / total) * 1000) / 10 : 0;

  return {
    agency: resolved.name,
    toptier_code: resolved.toptierCode,
    fiscal_year: fy,
    window,
    total_obligated: total,
    sub_agencies,
    set_aside_breakdown,
    small_business_share,
    degraded: false,
    trace,
  };
}
