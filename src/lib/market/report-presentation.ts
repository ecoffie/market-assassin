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

type ForecastLike = {
  id?: string | null;
  external_id?: string | null;
  agency?: string | null;
  title?: string | null;
  description?: string | null;
  fiscal_year?: string | null;
  quarter?: string | null;
  naics_code?: string | null;
  value_min?: number | null;
  value_max?: number | null;
  incumbent_name?: string | null;
};

const norm = (v: unknown): string =>
  String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * The identity of ONE customer-visible forecast.
 *
 * Primary: the source listing id with the pipeline prefix stripped
 * (`GW-L:7799` and `7799` are the same Acquisition Gateway listing), scoped to the
 * agency so two agencies' numeric ids never collide.
 *
 * Fallback (no listing id): every field a reader could use to tell two rows apart —
 * title, FY, quarter, NAICS, value band, incumbent AND description. Deliberately NOT
 * title alone: Navy's three "OPF-L Delivery Order #3" rows share a title and value
 * band but name three different incumbents (AeroVironment, Anduril, Teledyne FLIR).
 * Those are three procurements, and collapsing them would delete two.
 */
export function forecastIdentity(f: ForecastLike): string {
  const listing = String(f.external_id ?? '').trim().replace(/^GW-L:/i, '');
  if (listing) return `listing|${norm(f.agency)}|${listing}`;
  return [
    'content',
    norm(f.agency), norm(f.title), norm(f.fiscal_year), norm(f.quarter), norm(f.naics_code),
    f.value_min ?? '', f.value_max ?? '', norm(f.incumbent_name), norm(f.description),
  ].join('|');
}

/** Keep the first row of each identity; report how many were cross-listed copies. */
export function dedupeForecasts<T extends ForecastLike>(rows: T[]): { rows: T[]; removed: number } {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    const k = forecastIdentity(r);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return { rows: out, removed: rows.length - out.length };
}

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
  const capture = typeof estimated_recompete_date === 'string' && estimated_recompete_date ? estimated_recompete_date.slice(0, 10) : null;
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
