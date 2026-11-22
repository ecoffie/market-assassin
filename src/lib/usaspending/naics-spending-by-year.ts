/**
 * Federal contract spending for an INDUSTRY (NAICS) per FISCAL YEAR, with how much of
 * it SMALL BUSINESSES won and how much went through small-business SET-ASIDES.
 *
 * Why this exists: before it, Mindy could give small-business share per AGENCY
 * (get_agency_spending_detail / get_sba_goaling_share) and dollars per COMPANY per year
 * (get_recipient_annual_obligations), but nothing answered "how big is NAICS X each year,
 * and how much of it do small businesses win?" Hosts ended up stitching rough numbers from
 * tools that measure something else and told users to treat the ranking as directional.
 *
 * Source: USASpending `spending_over_time` grouped by fiscal_year (the same live data behind
 * the other spend tools). Three calls per request:
 *   1. total obligations            — contracts A/B/C/D, the NAICS, the FY range
 *   2. won by small businesses      — + recipient_type_names: ['small_business']
 *   3. through SB set-aside codes   — + set_aside_type_codes (SB, 8(a), SDVOSB, WOSB, HUBZone)
 *
 * NAICS is EXACT for a 6-digit code (never swept to the subsector — CLAUDE.md market rule);
 * a 2–5 digit code is passed as a prefix, which USASpending treats as the hierarchy.
 *
 * Honesty rules:
 *   - A call that FAILED makes its column null for every year (never 0) and sets degraded.
 *   - A call that SUCCEEDED with no row for a year is a real $0 for that year.
 *   - "small_business_won" is dollars obligated to firms USASpending classifies as small
 *     business at award time. It is the closest public proxy to SBA goaling achievement but
 *     is NOT the official SBA Scorecard number.
 */
import { latestCompleteFiscalYear } from '@/lib/utils/fiscal-year';
import { normalizeStateCode } from '@/lib/utils/us-states';

const OVER_TIME_URL = 'https://api.usaspending.gov/api/v2/search/spending_over_time/';
const CONTRACT_AWARD_TYPES = ['A', 'B', 'C', 'D'];
/** Every small-business set-aside code family (matches agency-spending-detail SET_ASIDE_BUCKETS). */
export const SB_SET_ASIDE_CODES = ['SBA', 'SBP', '8A', '8AN', 'SDVOSBC', 'SDVOSBS', 'WOSB', 'EDWOSB', 'HZC', 'HZS'];
export const MAX_FY_SPAN = 10;
export const MAX_NAICS = 10;
/** USASpending's searchable award history starts at FY2008. */
const MIN_FY = 2008;

export interface NaicsSpendingInput {
  naics: string | string[];
  from_fy?: number;
  to_fy?: number;
  /** Optional 2-letter state or full name — filters PLACE OF PERFORMANCE. */
  state?: string;
}

export interface NaicsFiscalYearRow {
  fiscal_year: number;
  total_obligated: number | null;
  small_business_won: number | null;
  small_business_won_pct: number | null;
  sb_set_aside_obligated: number | null;
  sb_set_aside_pct: number | null;
}

export interface NaicsSpendingResult {
  naics: string[];
  invalid_naics: string[];
  state: string | null;
  from_fy: number;
  to_fy: number;
  years: NaicsFiscalYearRow[];
  totals: {
    total_obligated: number | null;
    small_business_won: number | null;
    small_business_won_pct: number | null;
    sb_set_aside_obligated: number | null;
    sb_set_aside_pct: number | null;
  };
  validation_error: string | null;
  failed: Array<'total' | 'small_business' | 'set_aside'>;
  trace: string[];
}

type Fetcher = typeof fetch;

export function normalizeNaicsList(input: string | string[]): { valid: string[]; invalid: string[] } {
  const raw = (Array.isArray(input) ? input : String(input ?? '').split(/[,\s]+/))
    .map((s) => String(s).trim())
    .filter(Boolean);
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const c of raw) {
    if (/^\d{2,6}$/.test(c)) {
      if (!valid.includes(c)) valid.push(c);
    } else {
      invalid.push(c);
    }
  }
  return { valid, invalid };
}

export function resolveFyRange(from?: number, to?: number, now: Date = new Date()): { from: number; to: number; error: string | null } {
  const latest = latestCompleteFiscalYear(now);
  const t = Number.isFinite(to) ? Math.trunc(to as number) : latest;
  const f = Number.isFinite(from) ? Math.trunc(from as number) : t - 4;
  if (t > latest + 1) return { from: f, to: t, error: `to_fy ${t} is in the future (latest complete FY is ${latest}).` };
  if (f < MIN_FY) return { from: f, to: t, error: `from_fy must be ${MIN_FY} or later.` };
  if (f > t) return { from: f, to: t, error: 'from_fy must be <= to_fy.' };
  if (t - f + 1 > MAX_FY_SPAN) return { from: f, to: t, error: `At most ${MAX_FY_SPAN} fiscal years per call.` };
  return { from: f, to: t, error: null };
}

const pct = (part: number | null, whole: number | null): number | null =>
  part === null || whole === null || whole <= 0 ? null : Math.round((part / whole) * 1000) / 10;

async function overTime(
  filters: Record<string, unknown>,
  fetcher: Fetcher,
): Promise<Map<number, number>> {
  const res = await fetcher(OVER_TIME_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ group: 'fiscal_year', filters }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`spending_over_time → ${res.status}`);
  const j = (await res.json()) as { results?: Array<{ aggregated_amount?: number | null; time_period?: { fiscal_year?: string | number } }> };
  if (!Array.isArray(j.results)) throw new Error('spending_over_time → no results array');
  const out = new Map<number, number>();
  for (const r of j.results) {
    const fy = Number(r.time_period?.fiscal_year);
    if (Number.isFinite(fy)) out.set(fy, Number(r.aggregated_amount) || 0);
  }
  return out;
}

export async function getNaicsSpendingByYear(
  input: NaicsSpendingInput,
  fetcher: Fetcher = fetch,
  now: Date = new Date(),
): Promise<NaicsSpendingResult> {
  const { valid, invalid } = normalizeNaicsList(input.naics);
  const range = resolveFyRange(input.from_fy, input.to_fy, now);
  const state = input.state ? normalizeStateCode(input.state) : null;
  const trace: string[] = [];

  const empty = (validation_error: string): NaicsSpendingResult => ({
    naics: valid,
    invalid_naics: invalid,
    state,
    from_fy: range.from,
    to_fy: range.to,
    years: [],
    totals: { total_obligated: null, small_business_won: null, small_business_won_pct: null, sb_set_aside_obligated: null, sb_set_aside_pct: null },
    validation_error,
    failed: [],
    trace,
  });

  if (valid.length === 0) return empty('Provide at least one NAICS code (2–6 digits).');
  if (valid.length > MAX_NAICS) return empty(`At most ${MAX_NAICS} NAICS codes per call.`);
  if (range.error) return empty(range.error);
  if (input.state && !state) return empty(`Unrecognized state "${input.state}". Use a 2-letter code or full state name.`);

  const base: Record<string, unknown> = {
    time_period: [{ start_date: `${range.from - 1}-10-01`, end_date: `${range.to}-09-30` }],
    award_type_codes: CONTRACT_AWARD_TYPES,
    naics_codes: { require: valid },
  };
  if (state) base.place_of_performance_locations = [{ country: 'USA', state }];

  const run = (label: string, extra: Record<string, unknown>) =>
    overTime({ ...base, ...extra }, fetcher).catch((e) => {
      trace.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    });

  const [total, sb, setAside] = await Promise.all([
    run('total', {}),
    run('small_business', { recipient_type_names: ['small_business'] }),
    run('set_aside', { set_aside_type_codes: SB_SET_ASIDE_CODES }),
  ]);

  const failed: NaicsSpendingResult['failed'] = [];
  if (!total) failed.push('total');
  if (!sb) failed.push('small_business');
  if (!setAside) failed.push('set_aside');

  // A succeeded call with no row for a year = real $0. A failed call = null (unknown).
  const at = (m: Map<number, number> | null, fy: number): number | null => (m ? m.get(fy) ?? 0 : null);
  const years: NaicsFiscalYearRow[] = [];
  for (let fy = range.from; fy <= range.to; fy++) {
    const t = at(total, fy);
    const s = at(sb, fy);
    const a = at(setAside, fy);
    years.push({
      fiscal_year: fy,
      total_obligated: t,
      small_business_won: s,
      small_business_won_pct: pct(s, t),
      sb_set_aside_obligated: a,
      sb_set_aside_pct: pct(a, t),
    });
  }

  const sum = (k: 'total_obligated' | 'small_business_won' | 'sb_set_aside_obligated'): number | null =>
    years.some((y) => y[k] === null) ? null : years.reduce((acc, y) => acc + (y[k] as number), 0);
  const tTot = sum('total_obligated');
  const sTot = sum('small_business_won');
  const aTot = sum('sb_set_aside_obligated');

  return {
    naics: valid,
    invalid_naics: invalid,
    state,
    from_fy: range.from,
    to_fy: range.to,
    years,
    totals: {
      total_obligated: tTot,
      small_business_won: sTot,
      small_business_won_pct: pct(sTot, tTot),
      sb_set_aside_obligated: aTot,
      sb_set_aside_pct: pct(aTot, tTot),
    },
    validation_error: null,
    failed,
    trace,
  };
}
