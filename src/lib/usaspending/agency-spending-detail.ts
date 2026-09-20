/**
 * Agency spending DETAIL — the "who inside this department buys, and can a small
 * business actually win here" read. Complements get_agency_intel (identity + top NAICS)
 * with two things it doesn't have:
 *   1. sub-agency (component) breakdown — which components spend the money, and
 *   2. set-aside distribution — how much of the agency's contract dollars go out as
 *      Small Business / 8(a) / SDVOSB / WOSB / HUBZone set-asides (the small-business
 *      "easy entry" signal).
 *
 * Small-business percentages are TWO different metrics and must not be mixed:
 *   set_aside_share              — competed as a small-business set-aside code
 *   recipient_small_business_share — won by a small-business recipient (USASpending
 *                                    recipient_type_names: small_business)
 * Neither is the SBA 23% goaling figure (different eligible-dollar base).
 *
 * Measured FY2025 (A/B/C/D): Navy subtier $176.56B; DoD toptier $491.77B;
 * Navy small-business recipients $22.13B (12.5%). Awarding_agency still labels
 * the Navy slice "Department of Defense" — toptier_code 097 is the parent, not
 * a claim that these dollars are all of DoD.
 *
 * All figures are live USASpending contract obligations for the fiscal year.
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
   * on `spending.total`, never here.
   */
  total_obligated: number | null;
  sub_agencies: SubAgencySlice[];
  set_aside_breakdown: SetAsideSlice[];
  /** Set-aside-code share (SBA+8(a)+SDVOSB+WOSB+HUBZone) ÷ requested total. Not goaling. */
  small_business_share: number | null;
  set_aside_share: number | null;
  /** Recipient-type small_business ÷ requested total. Not goaling, not set-aside. */
  recipient_small_business_amount: number | null;
  recipient_small_business_share: number | null;
  requested_identity: RequestedIdentity;
  spending: NestedSpending;
  command_spending: { status: CommandSpendingStatus };
  degraded: boolean;
  trace: string[];
}

const EMPTY_IDENTITY: RequestedIdentity = { command: null, service: null, parent: null };

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
  recipientTypeNames?: string[],
): Promise<CategoryRow[]> {
  // Navy/Army/AF under DoD 097: filter tier:'subtier' with the service NAME.
  // Measured FY2025: Navy subtier → $176.56B (not the stale $135B comment, not DoD $491.77B).
  const agencyFilter = subAgency
    ? { type: 'awarding', tier: 'subtier', name: subAgency }
    : { type: 'awarding', tier: 'toptier', name: agencyName };
  const filters: Record<string, unknown> = {
    agencies: [agencyFilter],
    time_period: [window],
    award_type_codes: CONTRACT_AWARD_TYPES,
  };
  if (setAsideCodes && setAsideCodes.length) filters.set_aside_type_codes = setAsideCodes;
  if (recipientTypeNames && recipientTypeNames.length) filters.recipient_type_names = recipientTypeNames;
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
    set_aside_share: null,
    recipient_small_business_amount: null,
    recipient_small_business_share: null,
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

  const parentService = grain.spendingScope === 'PARENT_SERVICE';

  const [totalRows, subRows, recipientSbRows, ...bucketRows] = await Promise.all([
    spendingByCategory('awarding_agency', resolved.name, window, undefined, sub).catch((e) => { trace.push(`total: ${e.message}`); return null; }),
    parentService
      ? Promise.resolve([] as CategoryRow[])
      : spendingByCategory('awarding_subagency', resolved.name, window, undefined, sub).catch((e) => { trace.push(`subagency: ${e.message}`); return null; }),
    spendingByCategory('awarding_agency', resolved.name, window, undefined, sub, ['small_business']).catch((e) => { trace.push(`recipient_sb: ${e.message}`); return null; }),
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

  const sub_agencies: SubAgencySlice[] = parentService
    ? []
    : (subRows || [])
      .map((r) => ({ name: r.name || '', amount: r.amount || 0, pct_of_total: pct(r.amount || 0) }))
      .filter((s) => s.name && s.amount > 0 && s.name.toLowerCase() !== resolved!.name.toLowerCase())
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 15);

  const set_aside_breakdown: SetAsideSlice[] = SET_ASIDE_BUCKETS.map((b, i) => {
      const rows = bucketRows[i];
      const amount = (rows || []).reduce((s, r) => s + (r.amount || 0), 0);
      return { label: b.label, codes: b.codes, amount, pct_of_total: pct(amount) };
    });

  const sbTotal = set_aside_breakdown.reduce((s, b) => s + b.amount, 0);
  const set_aside_share = total <= 0 ? null : Math.round((sbTotal / total) * 1000) / 10;
  const recipientAmount = recipientSbRows === null
    ? null
    : (recipientSbRows || []).reduce((s, r) => s + (r.amount || 0), 0);
  const recipientShare = recipientAmount == null || total <= 0
    ? null
    : Math.round((recipientAmount / total) * 1000) / 10;

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
    small_business_share: set_aside_share,
    set_aside_share,
    recipient_small_business_amount: recipientAmount,
    recipient_small_business_share: recipientShare,
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
