/**
 * DARPA research opportunities from the public Grants.gov search2 API.
 *
 * Measured 2026-11-19: POST https://api.grants.gov/v1/api/search2 with the
 * DOD-DARPA-* agency filter returned errorcode 0 and hitCount 4, all attributed
 * to DARPA offices (including Young Faculty Award 2027, which a hardcoded list
 * from April 2026 did not have). A non-DARPA hit is dropped. Zero attributed
 * rows is a failure, not an empty success. This module does not invent NAICS,
 * amounts, or dates.
 */

export const DARPA_GRANTS_SEARCH_URL = 'https://api.grants.gov/v1/api/search2';

/** Cap. The live filter returned 4. A larger page is still not a bulk reimport. */
export const DARPA_GRANTS_ROW_CAP = 25;

export const DARPA_AGENCY_FILTER = [
  'DOD-DARPA-DSO',
  'DOD-DARPA-BTO',
  'DOD-DARPA-TTO',
  'DOD-DARPA-I2O',
  'DOD-DARPA-MTO',
  'DOD-DARPA-STO',
  'DOD-DARPA-IPTO',
].join('|');

export interface DarpaGrantHit {
  id: string;
  number: string;
  title: string;
  agencyCode: string;
  agency: string;
  openDate: string;
  closeDate: string;
  oppStatus: string;
  docType: string;
}

export interface DarpaGrantParse {
  hits: DarpaGrantHit[];
  /** Source-reported total. Null when the payload did not say — never coerced to 0. */
  hitCount: number | null;
  error?: string;
}

function str(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

export function darpaHitsFromSearch(payload: unknown): DarpaGrantParse {
  if (!payload || typeof payload !== 'object') {
    return { hits: [], hitCount: null, error: 'Grants.gov payload was not an object' };
  }
  const root = payload as { errorcode?: unknown; msg?: unknown; data?: unknown };
  if (root.errorcode !== 0) {
    return {
      hits: [],
      hitCount: null,
      error: `Grants.gov errorcode ${String(root.errorcode)}: ${str(root.msg) || 'search failed'}`,
    };
  }
  const data = root.data;
  if (!data || typeof data !== 'object') {
    return { hits: [], hitCount: null, error: 'Grants.gov search had no data object' };
  }
  const bag = data as { hitCount?: unknown; oppHits?: unknown };
  const hitCount = typeof bag.hitCount === 'number' && Number.isFinite(bag.hitCount) ? bag.hitCount : null;
  if (!Array.isArray(bag.oppHits)) {
    return { hits: [], hitCount, error: 'Grants.gov oppHits was not an array' };
  }
  const hits: DarpaGrantHit[] = [];
  for (const raw of bag.oppHits) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const agencyCode = str(row.agencyCode);
    if (!agencyCode.startsWith('DOD-DARPA-')) continue;
    const number = str(row.number);
    const title = str(row.title);
    if (!number || !title) continue;
    hits.push({
      id: str(row.id),
      number,
      title,
      agencyCode,
      agency: str(row.agency),
      openDate: str(row.openDate),
      closeDate: str(row.closeDate),
      oppStatus: str(row.oppStatus),
      docType: str(row.docType),
    });
  }
  if (hits.length === 0) {
    return {
      hits: [],
      hitCount,
      error: hitCount === 0
        ? 'Grants.gov DARPA filter returned 0 opportunities'
        : 'Grants.gov returned no rows attributed to a DOD-DARPA agency code',
    };
  }
  return { hits: hits.slice(0, DARPA_GRANTS_ROW_CAP), hitCount };
}

export function darpaSearchBody(): Record<string, unknown> {
  return {
    rows: DARPA_GRANTS_ROW_CAP,
    oppStatuses: 'forecasted|posted',
    agencies: DARPA_AGENCY_FILTER,
  };
}
