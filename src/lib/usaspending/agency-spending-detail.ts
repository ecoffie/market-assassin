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
import { DOD_SUBTIER_ALIASES } from '@/lib/usaspending/awarding-agency-filter';
import {
  identityEstablishedEqual,
  resolveIdentitySpendingGrain,
  type CommandSpendingStatus,
  type RequestedIdentity,
  type SpendingScope,
} from '@/lib/gov-contacts/agency-identity';

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

export interface NestedSpending {
  scope: SpendingScope;
  scope_name: string | null;
  total: number | null;
}

export interface AgencySpendingDetailResult {
  agency: string | null;
  toptier_code: string | null;
  fiscal_year: number;
  window: { start_date: string; end_date: string };
  /**
   * Dollars at the REQUESTED grain only. Null when the requested entity is a
   * command whose own spend is NOT_ESTABLISHED — parent-service dollars live
   * on `spending`, never here.
   */
  total_obligated: number | null;
  sub_agencies: SubAgencySlice[];
  set_aside_breakdown: SetAsideSlice[];
  /** Sum of all set-aside buckets ÷ total — the small-business share of contract $. */
  small_business_share: number | null;
  requested_identity: RequestedIdentity;
  spending: NestedSpending;
  command_spending: { status: CommandSpendingStatus };
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

// FM-U09 aliases live in awarding-agency-filter.ts (shared with spending_by_award).

function findDod(list: Array<{ name: string; toptierCode: string; abbreviation: string }>) {
  return list.find((a) => a.toptierCode === '097' || identityEstablishedEqual(a.name, 'Department of Defense'));
}

/** Exact / alias / acronym only. Substring containment cannot establish a toptier. */
async function resolveToptier(
  input: string,
): Promise<{ name: string; toptierCode: string; subAgency?: string } | null> {
  const raw = input.trim();
  if (!raw) return null;
  const list = await agencyList();
  const rl = raw.toLowerCase();
  const dod = findDod(list);
  const alias = DOD_SUBTIER_ALIASES.find((x) => x.re.test(raw));
  if (alias && dod) {
    return { name: dod.name, toptierCode: dod.toptierCode, subAgency: alias.subAgency };
  }
  return (
    list.find((a) => a.name.toLowerCase() === rl) ||
    list.find((a) => a.abbreviation && a.abbreviation.toLowerCase() === rl) ||
    list.find((a) => acronymOf(a.name) === raw.toUpperCase().replace(/[^A-Z]/g, '')) ||
    list.find((a) => identityEstablishedEqual(a.name, raw)) ||
    null
  );
}

interface CategoryRow { name?: string; amount?: number }

async function spendingByCategory(
  category: 'awarding_agency' | 'awarding_subagency',
  agencyName: string,
  window: { start_date: string; end_date: string },
  setAsideCodes?: string[],
  subAgency?: string,
): Promise<CategoryRow[]> {
  // FM-U09: when a military-department sub-tier is requested (Navy/Army/AF under DoD 097), USASpending's
  // agency filter uses tier:'subtier' with the sub-agency NAME directly (verified: Navy → $135B). The
  // toptier name is NOT passed in that case (a `subtier` sub-field 400s).
  const agencyFilter = subAgency
    ? { type: 'awarding', tier: 'subtier', name: subAgency }
    : { type: 'awarding', tier: 'toptier', name: agencyName };
  const filters: Record<string, unknown> = {
    agencies: [agencyFilter],
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

const EMPTY_IDENTITY: RequestedIdentity = { command: null, service: null, parent: null };

function emptyResult(
  fy: number,
  window: { start_date: string; end_date: string },
  trace: string[],
  extras: Partial<AgencySpendingDetailResult> = {},
): AgencySpendingDetailResult {
  return {
    agency: null,
    toptier_code: null,
    fiscal_year: fy,
    window,
    total_obligated: null,
    sub_agencies: [],
    set_aside_breakdown: [],
    small_business_share: null,
    requested_identity: EMPTY_IDENTITY,
    spending: { scope: 'NOT_ESTABLISHED', scope_name: null, total: null },
    command_spending: { status: 'NOT_APPLICABLE' },
    degraded: false,
    trace,
    ...extras,
  };
}

export async function getAgencySpendingDetail(input: AgencySpendingDetailInput): Promise<AgencySpendingDetailResult> {
  const trace: string[] = [];
  const fy = input.fiscalYear || latestCompleteFiscalYear();
  const window = fiscalYearTimePeriod(fy);
  const grain = resolveIdentitySpendingGrain(input.agency || '');

  if (grain.established) {
    trace.push(
      `identity "${input.agency}" → command=${grain.identity.command ?? 'none'} ` +
      `service=${grain.identity.service ?? 'none'} parent=${grain.identity.parent ?? 'none'} ` +
      `spend=${grain.spendingScope}`,
    );
  }

  let resolved: { name: string; toptierCode: string; subAgency?: string } | null = null;
  try {
    if (grain.serviceFetch) {
      const list = await agencyList();
      const dod = findDod(list);
      if (!dod) {
        trace.push('DoD toptier 097 missing from USASpending agency list');
      } else {
        resolved = { name: dod.name, toptierCode: dod.toptierCode, subAgency: grain.serviceFetch.subAgency };
      }
    } else if (grain.toptierName) {
      resolved = await resolveToptier(grain.toptierName);
    } else if (!grain.established) {
      resolved = await resolveToptier(input.agency || '');
    }
  } catch (e) {
    trace.push(`agency resolve failed: ${e instanceof Error ? e.message : String(e)}`);
    return emptyResult(fy, window, trace, {
      agency: grain.displayName,
      requested_identity: grain.identity,
      spending: { scope: grain.spendingScope, scope_name: grain.spendingScopeName, total: null },
      command_spending: { status: grain.commandSpending },
      degraded: true,
    });
  }

  if (grain.established && grain.spendingScope === 'NOT_ESTABLISHED') {
    trace.push(`command spend NOT_ESTABLISHED for "${grain.displayName}" — not borrowing parent dollars`);
    return emptyResult(fy, window, trace, {
      agency: grain.displayName,
      requested_identity: grain.identity,
      spending: { scope: 'NOT_ESTABLISHED', scope_name: null, total: null },
      command_spending: { status: 'NOT_ESTABLISHED' },
    });
  }

  if (!resolved) {
    trace.push(`no toptier agency matched "${input.agency}"`);
    return emptyResult(fy, window, trace, grain.established
      ? {
          agency: grain.displayName,
          requested_identity: grain.identity,
          spending: { scope: grain.spendingScope, scope_name: grain.spendingScopeName, total: null },
          command_spending: { status: grain.commandSpending },
        }
      : {});
  }

  const sub = resolved.subAgency;
  const displayName = grain.displayName || sub || resolved.name;
  trace.push(`resolved "${input.agency}" → ${displayName}${sub ? ` (sub-tier under ${resolved.name})` : ''} (${resolved.toptierCode})`);

  const [totalRows, subRows, ...bucketRows] = await Promise.all([
    spendingByCategory('awarding_agency', resolved.name, window, undefined, sub).catch((e) => { trace.push(`total: ${e.message}`); return null; }),
    spendingByCategory('awarding_subagency', resolved.name, window, undefined, sub).catch((e) => { trace.push(`subagency: ${e.message}`); return null; }),
    ...SET_ASIDE_BUCKETS.map((b) =>
      spendingByCategory('awarding_agency', resolved!.name, window, b.codes, sub).catch((e) => { trace.push(`${b.label}: ${e.message}`); return null; }),
    ),
  ]);

  const identityFields = grain.established
    ? {
        requested_identity: grain.identity,
        command_spending: { status: grain.commandSpending } as { status: CommandSpendingStatus },
      }
    : {
        requested_identity: {
          command: null,
          service: sub || null,
          parent: sub ? 'Department of Defense' : displayName,
        } satisfies RequestedIdentity,
        command_spending: { status: 'NOT_APPLICABLE' as const },
      };

  if (totalRows === null) {
    return emptyResult(fy, window, trace, {
      agency: displayName,
      toptier_code: resolved.toptierCode,
      ...identityFields,
      spending: { scope: grain.established ? grain.spendingScope : 'REQUESTED', scope_name: grain.spendingScopeName || displayName, total: null },
      degraded: true,
    });
  }

  const total = (totalRows || []).reduce((s, r) => s + (r.amount || 0), 0);
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 1000) / 10 : 0);
  const parentService = grain.spendingScope === 'PARENT_SERVICE';

  const sub_agencies: SubAgencySlice[] = parentService
    ? []
    : (subRows || [])
      .map((r) => ({ name: r.name || '', amount: r.amount || 0, pct_of_total: pct(r.amount || 0) }))
      .filter((s) => s.name && s.amount > 0 && s.name.toLowerCase() !== resolved!.name.toLowerCase())
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 15);

  const set_aside_breakdown: SetAsideSlice[] = parentService
    ? []
    : SET_ASIDE_BUCKETS.map((b, i) => {
      const rows = bucketRows[i];
      const amount = (rows || []).reduce((s, r) => s + (r.amount || 0), 0);
      return { label: b.label, codes: b.codes, amount, pct_of_total: pct(amount) };
    });

  const sbTotal = set_aside_breakdown.reduce((s, b) => s + b.amount, 0);
  const small_business_share = parentService
    ? null
    : (total > 0 ? Math.round((sbTotal / total) * 1000) / 10 : 0);

  const spendingScope: SpendingScope = grain.established ? grain.spendingScope : 'REQUESTED';
  const spendingScopeName = grain.established ? grain.spendingScopeName : displayName;

  return {
    agency: displayName,
    toptier_code: resolved.toptierCode,
    fiscal_year: fy,
    window,
    total_obligated: parentService ? null : total,
    sub_agencies,
    set_aside_breakdown,
    small_business_share,
    ...identityFields,
    spending: {
      scope: spendingScope,
      scope_name: spendingScopeName,
      total,
    },
    degraded: false,
    trace,
  };
}
