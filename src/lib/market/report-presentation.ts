/**
 * Presentation truth for generate_market_report (Poteto, 2026-09-22).
 *
 * Each helper turns a row the report already HAS into the row a customer should
 * SEE — without adding intelligence. They exist because the production report
 * printed values that did not mean what their labels said:
 *
 *   - a forecast listing ingested by two pipelines (`7799` and `GW-L:7799`) was
 *     shown twice as two opportunities;
 *   - a DHS boolean (`"true"`) rendered in the Set-aside column as if it were a
 *     set-aside category;
 *   - `estimated_recompete_date` — PoP end minus 12 months, the date capture should
 *     START (MINDY-006) — read as "when the recompete happens", and was already in
 *     the past for every row in the table.
 */

// ── Forecast identity ────────────────────────────────────────────────────────
// The shared rule lives in src/lib/forecasts/forecast-identity.ts (also used by FIND
// coming_soon). Re-exported here so report callers keep one import.
export { forecastIdentity, dedupeForecasts } from '@/lib/forecasts/forecast-identity';

// ── Forecast set-aside ───────────────────────────────────────────────────────

/**
 * A set-aside CATEGORY a reader can act on, or null when the source value does not
 * establish one.
 *
 * `true`/`false`/`yes`/`no` are flags from a source column whose meaning is not a
 * category (736 rows, all DHS). Mapping `true` to "Small Business" would be a guess,
 * so it is null ("not stated"). Recognised spellings collapse to one label; anything
 * else is an agency's own category text and passes through unchanged — relabelling
 * a real value would be its own kind of fabrication.
 */
export function normalizeForecastSetAside(raw: unknown): string | null {
  const v = String(raw ?? '').trim();
  if (!v) return null;
  const k = v.toLowerCase().replace(/\s+/g, ' ');
  if (/^(true|false|yes|no|y|n|tbd|to be determined|unknown|n\/a|na|-|—)$/.test(k)) return null;
  if (/^(none|no set[- ]?aside( used)?|full (and|&) open(\/unrestricted)?|unrestricted)$/.test(k)) return 'Full & Open';
  if (/service[- ]disabled|sdvosb/.test(k)) return 'SDVOSB';
  if (/hub ?zone/.test(k)) return 'HUBZone';
  if (/\bedwosb\b/.test(k)) return 'EDWOSB';
  if (/\bwosb\b|women[- ]owned/.test(k)) return 'WOSB';
  if (/8\s*\(?a\)?/.test(k)) return /sole source/.test(k) ? '8(a) Sole Source' : '8(a)';
  if (/veteran/.test(k)) return 'Veteran-Owned';
  if (/^other than small/.test(k)) return 'Other Than Small Business';
  // Only a PLAIN small-business set-aside collapses. Strip the set-aside boilerplate
  // and require nothing else to remain — "Indian Small Business Economic Enterprise"
  // is its own category and must not be relabelled as generic Small Business.
  const core = k.replace(/set[- ]?aside|total|partial|[-–—:,()]/g, ' ').replace(/\s+/g, ' ').trim();
  if (core === 'sb' || core === 'small business') return /partial/.test(k) ? 'Small Business (partial)' : 'Small Business';
  return v;
}

// ── Recompete timing ─────────────────────────────────────────────────────────

type RecompeteLike = {
  contract_id?: string | null;
  estimated_recompete_date?: string | null;
  [k: string]: unknown;
};

export type PresentedRecompete<T> = Omit<T, 'estimated_recompete_date'> & {
  /** PoP end minus 12 calendar months — when capture work should START (MINDY-006). */
  capture_start_date: string | null;
  /** True when that date is already behind us: capture is overdue, not upcoming. */
  capture_start_passed: boolean | null;
};

/**
 * Rename the capture-start date to what it is. The value is unchanged (the shared
 * query's MINDY-006 definition is correct for the pipelines that use it); only the
 * report's LABEL changes, because "estimated_recompete_date: 2025-09-23" beside a
 * contract ending 2026-09-23 tells a contractor the recompete already happened.
 */
export function presentRecompete<T extends RecompeteLike>(row: T, now: Date = new Date()): PresentedRecompete<T> {
  const { estimated_recompete_date, ...rest } = row;
  // The shared query carries the suggested capture start under its own name (annotate.ts) and
  // always nulls estimated_recompete_date. A raw DB row's estimated_recompete_date is the trigger's
  // PoP end − 12mo — the same derived capture start — so it is used only as that, never as a
  // recompete date.
  const named = typeof row.capture_start_date === 'string' && row.capture_start_date ? row.capture_start_date : null;
  const legacy = typeof estimated_recompete_date === 'string' && estimated_recompete_date ? estimated_recompete_date : null;
  const capture = (named ?? legacy)?.slice(0, 10) ?? null;
  const today = now.toISOString().slice(0, 10);
  return {
    ...(rest as Omit<T, 'estimated_recompete_date'>),
    capture_start_date: capture,
    capture_start_passed: capture ? capture < today : null,
  };
}

/** One row per contract. contract_id is the table's unique key, so this is a guard, not a merge. */
export function dedupeRecompetes<T extends RecompeteLike>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    const k = String(r.contract_id ?? '');
    if (!k) return true;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
