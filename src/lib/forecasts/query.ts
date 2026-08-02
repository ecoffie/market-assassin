/**
 * Agency-forecast query — a focused query for the MCP tool
 * (`get_agency_forecasts`) and any caller wanting raw forecast rows.
 *
 * Lifted from the core of src/app/api/forecasts/route.ts WITHOUT the route's
 * UI-only machinery (DoD early-signal injection, NAICS-vocabulary enrichment,
 * set-aside/agency aggregations, POC redaction, camelCase field renaming). Just
 * the filtered read of `agency_forecasts`, soonest-award first.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export interface ForecastQueryInput {
  /** NAICS code(s), comma-separated; ≤4 chars = prefix, else exact. */
  naics?: string;
  /** Source agency, case-insensitive partial (comma-separated OR). */
  agency?: string;
  /** Place-of-performance state (full name matches best; ILIKE on pop_state). */
  state?: string;
  /** Set-aside type, case-insensitive partial. */
  setAside?: string;
  /** Fiscal year — "FY2026" or "2026". */
  fiscalYear?: string;
  /** Free-text over title + description. */
  search?: string;
  /**
   * Hide forecasts whose fiscal year has already passed. Default TRUE — a buy
   * planned for FY2024 is history, not pipeline, and showing it beside a FY2027
   * item with no visible difference is what makes the list read as stale.
   * Rows with NO fiscal year are KEPT either way: unknown timing is not the same
   * as past timing, and dropping them would hide 85% of the corpus.
   */
  includePast?: boolean;
  limit?: number;
}

export interface ForecastRow {
  id: string;
  title: string;
  description: string | null;
  agency: string | null;
  department: string | null;
  office: string | null;
  naics_code: string | null;
  naics_description: string | null;
  psc_code: string | null;
  fiscal_year: string | null;
  quarter: string | null;
  award_date: string | null;
  value_min: number | null;
  value_max: number | null;
  value_range: string | null;
  set_aside_type: string | null;
  contract_type: string | null;
  incumbent_name: string | null;
  pop_state: string | null;
  status: string | null;
}

export interface ForecastQueryResult {
  forecasts: ForecastRow[];
  total: number;
  degraded: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function orForNaics(terms: string[]): string {
  return terms
    .map((t) => (t.length <= 4 ? `naics_code.ilike.${t}%` : `naics_code.eq.${t}`))
    .join(',');
}


/**
 * Fiscal year as a comparable NUMBER, or null.
 *
 * The column is free text from 13 different agency portals and arrives as
 * "FY2026" (6,692), "2026" (90), "FY26" (5), "TBD" (5). A plain string sort
 * scatters the same year — "2026" sorts before "FY2026" — so ordering has to
 * happen on a parsed value, not the raw column.
 */
export function fiscalYearNumber(fy?: string | null): number | null {
  if (!fy) return null;
  const m = String(fy).match(/(\d{2,4})/);
  if (!m) return null;                       // "TBD" and friends
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  if (n >= 2000 && n <= 2100) return n;      // 2026 / FY2026
  if (n >= 20 && n <= 99) return 2000 + n;   // FY26
  return null;
}

/** Current US federal fiscal year (starts Oct 1). */
export function currentFiscalYear(now = new Date()): number {
  return now.getUTCMonth() >= 9 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
}

/**
 * Sortable timing key for a forecast, best-available signal first.
 *
 * WHY NOT anticipated_award_date: it is populated on 93 of 9,973 rows (0.9%).
 * The query used to ORDER BY it, so 99% of the corpus fell into one nulls-last
 * bucket in arbitrary order — "soonest first" was decorative. Coverage, measured
 * 2026-07-31: fiscal_year 81% · quarter 14% · solicitation_date 8% · award 0.9%.
 *
 * Returns a number where SMALLER = sooner, and a large sentinel for rows with no
 * timing at all (85% of the corpus) so they sort last instead of first.
 */
export function forecastTimingKey(r: {
  fiscal_year?: string | null;
  anticipated_quarter?: string | null;
  solicitation_date?: string | null;
  anticipated_award_date?: string | null;
}): number {
  const NO_TIMING = 9_999_99;
  const exact = r.anticipated_award_date || r.solicitation_date;
  const fy = fiscalYearNumber(r.fiscal_year);
  if (exact) {
    const t = Date.parse(exact);
    // Express an exact date as FY*100 + month-ish so it interleaves with FY+quarter.
    if (Number.isFinite(t)) {
      const d = new Date(t);
      const efy = d.getUTCMonth() >= 9 ? d.getUTCFullYear() + 1 : d.getUTCFullYear();
      return efy * 100 + (d.getUTCMonth() + 1);
    }
  }
  if (fy) {
    const qm = String(r.anticipated_quarter || '').match(/([1-4])/);
    const q = qm ? Number(qm[1]) : 0;
    // Q1..Q4 -> a month-ish offset inside the FY so quarters order correctly.
    return fy * 100 + (q ? q * 3 : 50);
  }
  return NO_TIMING;
}

export async function queryForecasts(input: ForecastQueryInput): Promise<ForecastQueryResult> {
  const limit = Math.min(Math.max(Number(input.limit) || 25, 1), 200);
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let q = supabase
    .from('agency_forecasts')
    .select(
      'id,title,description,source_agency,department,contracting_office,naics_code,naics_description,psc_code,fiscal_year,anticipated_quarter,anticipated_award_date,solicitation_date,estimated_value_min,estimated_value_max,estimated_value_range,set_aside_type,contract_type,incumbent_name,pop_state,status',
      { count: 'exact' },
    );

  const naicsTerms = (input.naics || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (naicsTerms.length === 1) {
    const t = naicsTerms[0];
    q = t.length <= 4 ? q.ilike('naics_code', `${t}%`) : q.eq('naics_code', t);
  } else if (naicsTerms.length > 1) {
    q = q.or(orForNaics(naicsTerms));
  }

  const agencyTerms = (input.agency || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (agencyTerms.length === 1) {
    q = q.ilike('source_agency', `%${agencyTerms[0]}%`);
  } else if (agencyTerms.length > 1) {
    q = q.or(agencyTerms.map((a) => `source_agency.ilike.%${a}%`).join(','));
  }

  const state = (input.state || '').trim();
  if (state) q = q.ilike('pop_state', `%${state}%`);

  const setAside = (input.setAside || '').trim();
  if (setAside) q = q.ilike('set_aside_type', `%${setAside}%`);

  const fy = (input.fiscalYear || '').trim().replace(/^fy/i, '');
  if (fy) q = q.ilike('fiscal_year', `%${fy}%`);

  const search = (input.search || '').trim();
  if (search) q = q.or(`title.ilike.%${search}%,description.ilike.%${search}%`);

  // EXCLUDE PAST FISCAL YEARS IN SQL, not just in memory below.
  //
  // The in-memory filter alone was starving whole agencies: OVERFETCH caps the
  // fetch at 500 rows, and if an agency's corpus is mostly historical, those
  // 500 are consumed by past-dated rows that the filter then discards. Measured
  // 2026-08-01: HHS holds 3,643 rows of which 2,954 are FY2020-2025, so the
  // tool returned **8 of 689** usable forecasts. Treasury and NAVY were skewed
  // the same way.
  //
  // fiscal_year is inconsistent free text ("FY2026" / "2026" / "FY26"), so this
  // can't be a numeric comparison — it's a NOT-LIKE against each stale year,
  // which is exact for 4-digit forms and leaves anything unparseable in place.
  // Rows with NO fiscal year still survive: unknown timing is not past timing.
  if (!input.includePast) {
    const thisFyNum = currentFiscalYear();
    // A NULL fiscal_year must SURVIVE — unknown timing is not past timing, and
    // most of the corpus is undated (DOE is 100% undated; filtering it with a
    // bare NOT-LIKE emptied that agency completely, because in Postgres
    // `col NOT LIKE x` is NULL, not TRUE, for a NULL col).
    //
    // WHITELIST future years rather than blacklisting stale ones. Measured
    // against HHS (truth: 689 future-or-null of 3,643):
    //   or(is.null, not.ilike each stale)  → 3,643  (an .or of negations is
    //                                        true for every row — no filter)
    //   chained .not per year              →   687  (drops NULLs: in Postgres
    //                                        `col NOT LIKE x` is NULL, not TRUE)
    //   or(is.null, ilike each FUTURE)     →   689  ✓ exact
    const future: string[] = [];
    for (let y = thisFyNum; y <= thisFyNum + 15; y++) future.push(`fiscal_year.ilike.%${y}%`);
    q = q.or(`fiscal_year.is.null,${future.join(',')}`);
  }

  // Ordering happens in code on forecastTimingKey, not in SQL: the only columns
  // Postgres could sort on are ~1-8% populated, and the best signal (fiscal_year)
  // is inconsistent free text ("FY2026" / "2026" / "FY26") that string-sorts wrong.
  // Over-fetch so the in-memory sort has the real candidates to choose from,
  // then slice to `limit`.
  const OVERFETCH = 500;
  q = q.limit(Math.max(limit, OVERFETCH));

  const { data, count, error } = await q;
  if (error) {
    console.error('[forecasts:query] supabase error:', error.message);
    return { forecasts: [], total: 0, degraded: true };
  }

  // Drop already-past fiscal years unless asked for. Rows with NO fiscal year
  // survive — unknown timing is not past timing (85% of the corpus is undated,
  // and hiding it would empty the panel).
  const thisFy = currentFiscalYear();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rowsRaw: any[] = (data || []).filter((r: any) => {
    if (input.includePast) return true;
    const fy = fiscalYearNumber(r.fiscal_year);
    return fy === null || fy >= thisFy;
  });

  // Soonest-first on the best timing signal each row actually has.
  rowsRaw.sort((a, b) => forecastTimingKey(a) - forecastTimingKey(b));
  const rows = rowsRaw.slice(0, limit);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const forecasts: ForecastRow[] = rows.map((r: any) => ({
    id: r.id,
    title: r.title,
    description: r.description ?? null,
    agency: r.source_agency ?? null,
    department: r.department ?? null,
    office: r.contracting_office ?? null,
    naics_code: r.naics_code ?? null,
    naics_description: r.naics_description ?? null,
    psc_code: r.psc_code ?? null,
    fiscal_year: r.fiscal_year ?? null,
    quarter: r.anticipated_quarter ?? null,
    award_date: r.anticipated_award_date ?? null,
    value_min: r.estimated_value_min ?? null,
    value_max: r.estimated_value_max ?? null,
    value_range: r.estimated_value_range ?? null,
    set_aside_type: r.set_aside_type ?? null,
    contract_type: r.contract_type ?? null,
    incumbent_name: r.incumbent_name ?? null,
    pop_state: r.pop_state ?? null,
    status: r.status ?? null,
  }));

  // `count` is now the POST-filter total: the past-FY exclusion runs in SQL
  // above, so Postgres counts only rows the user can actually see. Previously
  // this was capped at `rowsRaw.length`, which meant it reported the OVERFETCH
  // ceiling instead of the truth — NAVY showed "500" against 8,699 real rows.
  //
  // The in-memory filter below is kept as a belt-and-braces pass for fiscal-year
  // spellings the SQL NOT-LIKE can't express (e.g. a bare "FY25"), so `count`
  // can still overstate by that small residue; clamp only when it does.
  const filteredTotal = input.includePast
    ? (count ?? forecasts.length)
    : (count ?? rowsRaw.length);
  return { forecasts, total: filteredTotal, degraded: false };
}
