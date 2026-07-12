/**
 * Pure logic for the /api/app/auto-setup ("Set up my Mindy") route — extracted so it's
 * unit-testable and can't silently drift. These are the exact rules tied to the route's
 * prior regressions (it was hot-fixed twice): the merge/dedup, the billions clamp, the
 * DoDAAC office-code guard, and the empty-vs-failed branch. The route imports these; the
 * tests lock them.
 */

/** Subset of a find-agencies result the auto-setup logic reads. */
export interface ScanAgency {
  name?: string;
  contractingOffice?: string;
  setAsideSpending?: number;
  contractCount?: number;
  officeId?: string;
  // (other fields flow through untouched by these helpers)
  [k: string]: unknown;
}

/**
 * Merge agency lists from multiple market scans into one ranked list:
 * dedup by name+contractingOffice (case-insensitive), keep the entry with the HIGHEST
 * set-aside spend per key, and sort spend-descending so the top buyers lead.
 */
export function mergeScanAgencies(agencyLists: ScanAgency[][]): ScanAgency[] {
  const byKey = new Map<string, ScanAgency>();
  for (const list of agencyLists) {
    for (const a of list || []) {
      const key = `${(a.name || '').toLowerCase()}|${(a.contractingOffice || '').toLowerCase()}`;
      const prev = byKey.get(key);
      if (!prev || (a.setAsideSpending || 0) > (prev.setAsideSpending || 0)) byKey.set(key, a);
    }
  }
  return Array.from(byKey.values()).sort(
    (x, y) => (y.setAsideSpending || 0) - (x.setAsideSpending || 0),
  );
}

/**
 * Clamp set-aside spend to a safe integer: round, and cap at 9,000,000,000 — so a
 * billions value can't overflow a bigint/int column, silently reject the row, and kill
 * the whole batch (the original silent-failure bug).
 */
export function clampSetAsideSpending(n: number | undefined | null): number {
  return Math.min(Math.round(Number(n) || 0), 9_000_000_000);
}

/**
 * A valid `office_code` is ONLY a real 6-char DoDAAC (leading letter + 5 alphanumerics).
 * The FPDS path can emit postcode-ish junk ("GU22", "CA09") we must NOT persist — return
 * null for anything that isn't a genuine DoDAAC.
 */
export function validOfficeCode(raw: string | undefined | null): string | null {
  const up = String(raw || '').toUpperCase().trim();
  return /^[A-Z][A-Z0-9]{5}$/.test(up) ? up : null;
}

/**
 * When a merged scan yields ZERO agencies, distinguish "every scan errored" (502 — a
 * real failure to surface) from "genuinely no matches" (200) — the silent-failure fix.
 */
export function emptyScanOutcome(
  scanErrorCount: number,
  requestCount: number,
): { allFailed: boolean; status: 200 | 502 } {
  const allFailed = scanErrorCount > 0 && scanErrorCount === requestCount;
  return { allFailed, status: allFailed ? 502 : 200 };
}
