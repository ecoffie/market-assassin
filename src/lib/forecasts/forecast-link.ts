/**
 * classifyForecastLink — what a forecast's stored source_url actually points at.
 *
 * Reported 2026-11-22: forecast "View details" links opened an agency homepage or an API root, not the
 * forecast. Origin: SOURCE + PRESENTATION. Almost no publisher gives a per-record URL — the ingests store
 * one constant per feed (DHS/HHS JSON APIs, DOJ/NASA/DOE/SSA/Navy/DHS spreadsheet files), and the Gateway
 * agencies' per-row "Solicitation Link" points at a solicitation, not the forecast. Tools passed the raw
 * value through as `source_url`, so hosts rendered an API endpoint as "View details".
 *
 * Rule: never fabricate a record link. Each URL gets an honest scope:
 *   related_solicitation — a per-row link a publisher gave (Gateway "Solicitation Link"): the related
 *                          solicitation, NOT the forecast record.
 *   source_file          — the publisher's whole forecast file (every record), not this record.
 *   source_listing       — a general agency forecast page, not this record.
 *   none                 — nothing a person can open. An API endpoint is never a human link: it maps to
 *                          the publisher's listing page only where that page is documented in this repo.
 * No current publisher yields a forecast-record URL, so there is deliberately no 'record' scope.
 */
export type ForecastLinkScope = 'related_solicitation' | 'source_file' | 'source_listing' | 'none';

export interface ForecastLink {
  /** A URL a person can open, or null. Never an API endpoint. */
  url: string | null;
  scope: ForecastLinkScope;
  /** Plain label for the link — says what it is NOT when it is not the record. */
  label: string | null;
}

/** Human listing pages for publishers whose stored URL is an API endpoint (documented in src/lib/forecasts). */
const API_HOST_LISTING: Record<string, string> = {
  'apfs-cloud.dhs.gov': 'https://apfs-cloud.dhs.gov/forecast/', // scrapers/DHS-USAGE.md
  'apfs-era.dhs.gov': 'https://apfs-cloud.dhs.gov/forecast/',
  'osdbu.hhs.gov': 'https://osdbu.hhs.gov/industry/opportunity-forecast', // hhs-forecast.ts
};

const LISTING_LABEL = 'Agency forecast listing (general page, not this record)';
const FILE_LABEL = 'Agency forecast file (all records, not this record)';

function parse(u: string): URL | null {
  try {
    const url = new URL(u);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

export function classifyForecastLink(row: { source_url?: unknown; external_id?: unknown }): ForecastLink {
  const raw = typeof row.source_url === 'string' ? row.source_url.trim() : '';
  const url = raw ? parse(raw) : null;
  if (!url) return { url: null, scope: 'none', label: null };
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();

  if (/\/api(\/|$)/.test(path) || host.startsWith('api.')) {
    const listing = API_HOST_LISTING[host] ?? null;
    return listing ? { url: listing, scope: 'source_listing', label: LISTING_LABEL } : { url: null, scope: 'none', label: null };
  }
  if (/\.(csv|xlsx?|pdf|zip)$/.test(path) || /\/dl$/.test(path)) {
    return { url: url.toString(), scope: 'source_file', label: FILE_LABEL };
  }
  const isGateway = typeof row.external_id === 'string' && row.external_id.startsWith('GW-');
  if (isGateway) {
    return { url: url.toString(), scope: 'related_solicitation', label: 'Related solicitation (published by the agency with this forecast)' };
  }
  return { url: url.toString(), scope: 'source_listing', label: LISTING_LABEL };
}

/** The customer-facing link fields every forecast surface emits (replaces the raw stored source_url). */
export function forecastLinkFields(row: { source_url?: unknown; external_id?: unknown }): {
  source_url: string | null;
  source_link_scope: ForecastLinkScope;
  source_link_label: string | null;
} {
  const l = classifyForecastLink(row);
  return { source_url: l.url, source_link_scope: l.scope, source_link_label: l.label };
}
