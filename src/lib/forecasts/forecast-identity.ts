/**
 * Forecast identity — ONE rule for every surface that lists agency_forecasts rows
 * (generate_market_report, FIND coming_soon). One fix = every surface.
 *
 * The same Acquisition Gateway listing reaches agency_forecasts through two ingests:
 *   - the Gateway CSV / listing ingest writes `GW-L:<Listing ID>` with separators
 *     normalised to `-` (gateway-forecast.ts gatewayExternalId) and a source_url;
 *   - the older FCO API import (scripts/import-forecasts-live.js) wrote the API's
 *     bare `field_source_listing_id`, which renders separators as `_`, with
 *     source_url null — under the SAME source_agency code (DOT, USDA, ...).
 *
 * Measured live 2026-11-23 (report m0MvDRsue6YHm0q9Xkx4mA, NAICS 237310 / VA):
 *   DOT  `GW-L:FHWA-2026-167` == `FHWA_2026_167`  ("VA ST FB KNGMN-WLKR GTS")
 *   USDA `GW-L:FY26-010880`   == `FY26_010880`    (GW & Jefferson NF road maintenance IDIQ)
 * Both pairs were shown twice with forecasts_duplicates_removed: 0, because the old
 * key only stripped `GW-L:` and compared the rest byte-for-byte.
 *
 * Identity = (source agency, listing id with `GW-L:` stripped, then normalised by
 * normalizeListingId — uppercase, separators removed). normalizeListingId is the
 * existing reconciliation rule for exactly this CSV-vs-API separator difference
 * (fco-census.ts: "A naive join reported USDA as 0-of-2,519 matched when the true
 * answer is 2,519-of-2,519"). Agency-scoped so two publishers' ids never collide.
 * NEVER title similarity: rows without a listing id fall back to a content key that
 * requires every distinguishing field to match.
 */
import { normalizeListingId } from './fco-census';

export type ForecastIdentityLike = {
  external_id?: string | null;
  /** Report rows (ForecastRow) carry source_agency as `agency`. */
  agency?: string | null;
  /** FIND / raw agency_forecasts rows. */
  source_agency?: string | null;
  title?: string | null;
  description?: string | null;
  fiscal_year?: string | null;
  quarter?: string | null;
  anticipated_quarter?: string | null;
  naics_code?: string | null;
  value_min?: number | null;
  value_max?: number | null;
  estimated_value_min?: number | null;
  estimated_value_max?: number | null;
  incumbent_name?: string | null;
  source_url?: string | null;
  /** Report rows: last_synced_at as `as_of`. */
  as_of?: string | null;
  last_synced_at?: string | null;
};

const GATEWAY_LISTING_PREFIX = /^GW-L:/i;

const norm = (v: unknown): string =>
  String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** The listing id with the gateway pipeline prefix stripped and separators/case normalised. */
export function forecastListingKey(externalId: unknown): string {
  return normalizeListingId(String(externalId ?? '').trim().replace(GATEWAY_LISTING_PREFIX, ''));
}

function agencyOf(f: ForecastIdentityLike): unknown {
  return f.source_agency ?? f.agency;
}

/**
 * The identity of ONE customer-visible forecast.
 *
 * Primary: agency + forecastListingKey(external_id).
 * Fallback (no listing id): every field a reader could use to tell two rows apart —
 * title, FY, quarter, NAICS, value band, incumbent AND description. Deliberately NOT
 * title alone: Navy's three "OPF-L Delivery Order #3" rows share a title and value
 * band but name three different incumbents. Those are three procurements.
 */
export function forecastIdentity(f: ForecastIdentityLike): string {
  const listing = forecastListingKey(f.external_id);
  if (listing) return `listing|${norm(agencyOf(f))}|${listing}`;
  return [
    'content',
    norm(agencyOf(f)), norm(f.title), norm(f.fiscal_year), norm(f.quarter ?? f.anticipated_quarter), norm(f.naics_code),
    f.value_min ?? f.estimated_value_min ?? '', f.value_max ?? f.estimated_value_max ?? '',
    norm(f.incumbent_name), norm(f.description),
  ].join('|');
}

/**
 * Which of two rows with the same identity to SHOW. Ordered by existing conventions:
 *   1. the `GW-L:` gateway-listing row — the canonical external_id
 *      (gateway-csv-reconcile.ts "Canonical identity: (source_agency, GW-L:<Listing ID>)";
 *      fco-census.ts "the canonical external_id stays the CSV form");
 *   2. a row with a source_url (a link a person can open) over one without;
 *   3. the most recently synced (last_synced_at — the only customer sync clock, query.ts).
 * Ties keep the earlier row, so ranking order is preserved.
 */
function preferenceRank(f: ForecastIdentityLike): [number, number, string] {
  return [
    GATEWAY_LISTING_PREFIX.test(String(f.external_id ?? '').trim()) ? 1 : 0,
    f.source_url ? 1 : 0,
    String(f.last_synced_at ?? f.as_of ?? ''),
  ];
}

function isBetter(candidate: ForecastIdentityLike, held: ForecastIdentityLike): boolean {
  const a = preferenceRank(candidate);
  const b = preferenceRank(held);
  if (a[0] !== b[0]) return a[0] > b[0];
  if (a[1] !== b[1]) return a[1] > b[1];
  return a[2] > b[2];
}

/**
 * One row per identity; the better-sourced twin takes the slot of the first occurrence
 * (so the caller's order is kept). `removed` counts the cross-listed copies dropped.
 *
 * `listingOnly`: merge ONLY on the listing id; rows without one always pass through.
 * FIND coming_soon uses it (it had no dedupe before, and its rows differ by pop_state,
 * which the content key does not carry). The market report keeps its content fallback.
 */
export function dedupeForecasts<T extends ForecastIdentityLike>(
  rows: T[],
  opts: { listingOnly?: boolean } = {},
): { rows: T[]; removed: number } {
  const slot = new Map<string, number>();
  const out: T[] = [];
  for (const r of rows) {
    if (opts.listingOnly && !forecastListingKey(r.external_id)) {
      out.push(r);
      continue;
    }
    const k = forecastIdentity(r);
    const i = slot.get(k);
    if (i === undefined) {
      slot.set(k, out.length);
      out.push(r);
    } else if (isBetter(r, out[i])) {
      out[i] = r;
    }
  }
  return { rows: out, removed: rows.length - out.length };
}
