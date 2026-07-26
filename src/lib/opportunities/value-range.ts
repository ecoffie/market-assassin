/**
 * Comparable-award value range for an opportunity — the grounded "price" hook.
 *
 * SAM open-opportunity notices almost never carry a dollar value, so we DERIVE a range from
 * REAL award history (USASpending `spending_by_award`): recent awards matching the opp's
 * NAICS (+ agency + PSC), from which we take the MEDIAN and the 25th–75th percentile (IQR).
 * That yields an honest "contracts like this at this agency typically run $X–$Y (median $Z)."
 *
 * NO fabrication: every figure is a real award amount. If we can't find enough comparables,
 * we return null and the card shows nothing (never an invented number). The predecessor's own
 * contract value (from find-predecessor) is a STRONGER anchor and is preferred by the caller
 * when present — this is the broad fallback.
 */

const API_URL = 'https://api.usaspending.gov/api/v2/search/spending_by_award/';
// Contracts only (A/B/C/D). We fetch a sizable sample, sorted by amount, to build a distribution.
const AWARD_TYPE_CODES = ['A', 'B', 'C', 'D'];
const FIELDS = ['Award Amount', 'Start Date'];

export interface ValueRange {
  low: number;        // 25th percentile
  median: number;     // 50th
  high: number;       // 75th percentile
  n: number;          // # of comparable awards the range is built from
  basis: string;      // human label of what was matched (e.g. "541512 at DEPT OF DEFENSE")
  source: 'comparable_awards';
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function normNaics(naics: string | null): string[] {
  if (!naics) return [];
  return [...new Set(
    naics.split(/[,\s]+/).map((c) => c.replace(/\D/g, '')).filter((c) => c.length >= 2 && c.length <= 6),
  )];
}

/**
 * Fetch recent comparable awards (last ~3 FY) for NAICS (+ agency) and compute the value range.
 * Returns null if fewer than MIN_SAMPLE awards are found (not enough to be meaningful).
 */
export async function getComparableAwardRange(
  naics: string | null,
  agency: string | null,
  opts: { psc?: string | null; timeoutMs?: number } = {},
): Promise<ValueRange | null> {
  const codes = normNaics(naics);
  if (!codes.length) return null; // NAICS is the minimum key
  const MIN_SAMPLE = 5;

  const now = new Date();
  const start = new Date(now.getFullYear() - 3, now.getMonth(), now.getDate());
  const filters: Record<string, unknown> = {
    award_type_codes: AWARD_TYPE_CODES,
    naics_codes: { require: codes },
    time_period: [{ start_date: start.toISOString().slice(0, 10), end_date: now.toISOString().slice(0, 10) }],
    award_amounts: [{ lower_bound: 1000 }], // drop $0 / micro noise
  };
  if (agency) filters.agencies = [{ type: 'awarding', tier: 'toptier', name: agency }];
  if (opts.psc) filters.psc_codes = { require: [String(opts.psc).trim().toUpperCase()] };

  // Sort by DATE (most recent), NOT by amount — sorting by amount desc + limit fetches only the
  // biggest whales and inflates the "median" wildly (541512@DoD looked like $148M). Recent-first
  // gives a representative sample of what contracts like this actually run.
  const body = {
    filters, fields: FIELDS, page: 1, limit: 100, sort: 'Start Date', order: 'desc', subawards: false,
  };

  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 14000);
  let amounts: number[] = [];
  try {
    const resp = await fetch(API_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal,
    });
    // THROW on an upstream error/rate-limit (429/5xx/abort) so the caller can distinguish it from
    // a genuine "no comparables found" (which returns null). A backfill must NOT stamp a "no range"
    // sentinel on a rate-limit — that's a false negative that would never retry.
    if (!resp.ok) throw new Error(`usaspending ${resp.status}`);
    const data = await resp.json();
    amounts = ((data.results || []) as Record<string, unknown>[])
      .map((r) => parseFloat(r['Award Amount'] as string) || 0)
      .filter((v) => v >= 1000);
  } finally {
    clearTimeout(to);
  }

  // If agency-scoped came back thin, retry NAICS-only (broader) once.
  if (amounts.length < MIN_SAMPLE && agency) {
    return getComparableAwardRange(naics, null, opts);
  }
  if (amounts.length < MIN_SAMPLE) return null;

  const sorted = amounts.slice().sort((a, b) => a - b);
  return {
    low: Math.round(percentile(sorted, 0.25)),
    median: Math.round(percentile(sorted, 0.5)),
    high: Math.round(percentile(sorted, 0.75)),
    n: sorted.length,
    basis: `${codes.join(', ')}${agency ? ` at ${agency}` : ''}`,
    source: 'comparable_awards',
  };
}
