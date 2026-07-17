/**
 * Annual federal OBLIGATIONS for a company — the per-fiscal-year FLOW, rolled up
 * to the PARENT so it survives a segment-reporting reader.
 *
 * ── Why this exists (measured 2026-07-17) ────────────────────────────────────
 * `spending_by_award` (what search_past_contracts uses) returns each award's
 * LIFETIME amount — a STOCK. `time_period` there only selects WHICH awards come
 * back; it does not scope the amount. Proof: award SAQMMA11F0233 returns an
 * identical $2,087,211,598 in an FY2023 window AND an FY2024 window, and its
 * period of performance ENDED 2021-08-08. Summing those books the same $2.09B
 * into every year, from an award that wasn't performing in either.
 *
 * ── Why it is built THIS way (three wrong versions came first) ───────────────
 * The obvious fix — summing `spending_by_category/recipient` over a name search
 * — is also wrong, and worse because it looks approximately right.
 * `recipient_search_text` is FUZZY, so the total becomes an artifact of your own
 * entity cap:
 *     L3HARRIS FY2023:  limit 1 → $1.48B · limit 5 → $4.05B · limit 25 → $7.29B
 * and by 25 it had swept in CAE USA INC., a different company. A figure that
 * moves when you change a LIMIT is not a measurement.
 *
 * So: resolve the name/UEI to USASpending's own PARENT record (`recipient_level`
 * 'P') and ask `spending_over_time` for one aggregate per FY. No per-entity rows
 * → nothing to cap → no artifact. Verified stable: FY2023 $7.42B, FY2024 $7.24B,
 * FY2025 $7.30B. The parent mapping is USASpending's own (it correctly includes
 * Aerojet Rocketdyne, which L3Harris acquired in 2023) — not our guess.
 *
 * The recipient_id filter is genuinely applied, not silently ignored — verified
 * against a control: with the parent id the top row is L3Harris ($1.48B);
 * without it, Lockheed ($32.45B).
 */
import { CONTRACT_AWARD_TYPE_CODES } from '@/lib/market/spend-query';
import { fiscalYearTimePeriod, latestCompleteFiscalYear } from '@/lib/utils/fiscal-year';

const RECIPIENT_URL = 'https://api.usaspending.gov/api/v2/recipient/';
const OVER_TIME_URL = 'https://api.usaspending.gov/api/v2/search/spending_over_time/';

/** Default series length, inclusive of toFy. */
const DEFAULT_SERIES_YEARS = 3;
/** A long series is a wide window; USASpending 400s on absurd ranges. */
const MAX_SERIES_YEARS = 10;

export interface AnnualObligationsOptions {
  /** Company name or UEI. Resolved to USASpending's parent recipient record. */
  recipient: string;
  fromFy?: number;
  toFy?: number;
  naics?: string;
  agency?: string;
}

export interface ResolvedRecipient {
  name: string;
  uei: string | null;
  /** 'P' = parent (rolls up subsidiaries), 'C' = child, 'R' = standalone. */
  level: string | null;
  id: string;
  /** FALSE when no parent record existed and we fell back to a child/standalone. */
  is_parent: boolean;
}

export interface FiscalYearObligation {
  fiscal_year: number;
  label: string;
  /** Obligations recorded INSIDE this FY, for the whole parent family. */
  obligated: number;
  /** TRUE when the FY has not ended — still accruing, will rise. */
  partial: boolean;
}

export interface AnnualObligationsResult {
  query: string;
  resolved: ResolvedRecipient | null;
  years: FiscalYearObligation[];
  total: number;
  degraded: boolean;
}

/**
 * Resolve a name/UEI to USASpending's recipient record, PREFERRING the parent.
 * Sorted by amount desc, so the first 'P' is the real parent, not a same-named
 * shell.
 */
async function resolveParent(query: string): Promise<{ rec: ResolvedRecipient | null; degraded: boolean }> {
  let res: Response;
  try {
    res = await fetch(RECIPIENT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword: query, limit: 25, order: 'desc', sort: 'amount', award_type: 'contracts' }),
    });
  } catch (e) {
    console.error('[annual-obligations] recipient lookup threw:', e instanceof Error ? e.message : e);
    return { rec: null, degraded: true };
  }
  if (!res.ok) {
    console.error(`[annual-obligations] recipient lookup ${res.status}`);
    return { rec: null, degraded: true };
  }

  let rows: Array<Record<string, unknown>>;
  try {
    rows = ((await res.json()) as { results?: Array<Record<string, unknown>> }).results ?? [];
  } catch {
    return { rec: null, degraded: true };
  }
  // Empty = a genuine miss (name doesn't match USASpending), NOT an error. The
  // caller must be able to tell those apart, so degraded stays false.
  if (!rows.length) return { rec: null, degraded: false };

  // A small firm may have only a child/standalone record — a legitimate answer,
  // but flagged so nobody reads it as a consolidated rollup.
  const parent = rows.find((r) => r.recipient_level === 'P');
  const pick = parent ?? rows[0];
  return {
    rec: {
      name: String(pick.name ?? query),
      uei: (pick.uei as string) ?? null,
      level: (pick.recipient_level as string) ?? null,
      id: String(pick.id ?? ''),
      is_parent: pick.recipient_level === 'P',
    },
    degraded: false,
  };
}

export async function getRecipientAnnualObligations(
  opts: AnnualObligationsOptions,
): Promise<AnnualObligationsResult> {
  const query = opts.recipient.trim();
  if (!query) return { query: '', resolved: null, years: [], total: 0, degraded: false };

  const currentFy = latestCompleteFiscalYear();
  const toFy = opts.toFy ?? currentFy;
  const requestedFrom = opts.fromFy ?? toFy - (DEFAULT_SERIES_YEARS - 1);
  if (toFy < requestedFrom) return { query, resolved: null, years: [], total: 0, degraded: false };
  const fromFy = toFy - requestedFrom + 1 > MAX_SERIES_YEARS ? toFy - (MAX_SERIES_YEARS - 1) : requestedFrom;

  const { rec, degraded: resolveDegraded } = await resolveParent(query);
  if (!rec?.id) return { query, resolved: rec, years: [], total: 0, degraded: resolveDegraded };

  const filters: Record<string, unknown> = {
    award_type_codes: CONTRACT_AWARD_TYPE_CODES,
    recipient_id: rec.id,
    time_period: [{
      start_date: fiscalYearTimePeriod(fromFy).start_date,
      end_date: fiscalYearTimePeriod(toFy).end_date,
    }],
  };
  if (opts.naics) {
    const code = opts.naics.replace(/\D/g, '');
    if (code.length >= 2) filters.naics_codes = { require: [code] };
  }
  if (opts.agency) filters.agencies = [{ type: 'awarding', tier: 'toptier', name: opts.agency }];

  // ONE call: group=fiscal_year returns an aggregate per FY for the whole parent
  // family. No per-entity rows, so nothing to cap and nothing to truncate.
  let years: FiscalYearObligation[] = [];
  let degraded = resolveDegraded;
  try {
    const res = await fetch(OVER_TIME_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group: 'fiscal_year', filters }),
    });
    if (!res.ok) throw new Error(`spending_over_time ${res.status}`);
    const body = (await res.json()) as {
      results?: Array<{ time_period?: { fiscal_year?: string | number }; aggregated_amount?: number }>;
    };
    years = (body.results ?? [])
      .map((r) => {
        const fy = Number(r.time_period?.fiscal_year);
        return { fiscal_year: fy, label: `FY${fy}`, obligated: r.aggregated_amount ?? 0, partial: fy > currentFy };
      })
      .filter((y) => Number.isFinite(y.fiscal_year))
      .sort((a, b) => a.fiscal_year - b.fiscal_year);
  } catch (e) {
    console.error('[annual-obligations] spending_over_time failed:', e instanceof Error ? e.message : e);
    degraded = true;
  }

  return { query, resolved: rec, years, total: years.reduce((s, y) => s + y.obligated, 0), degraded };
}
