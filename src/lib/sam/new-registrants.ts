/**
 * New SAM.gov registrants — businesses whose FIRST SAM registration falls in a date range.
 *
 * Source: sam_entities.initial_registration_date (SAM extract field idx 24, stored by
 * scripts/import-sam-entity-extract.mjs from parser v3). NULL = not backfilled yet, never "new".
 *
 * Grants-only registrants (purpose_of_registration = 'Z1') cannot receive a federal contract,
 * so they are excluded. A NULL purpose is UNKNOWN and is kept, labelled as such.
 *
 * Contact emails are NOT in SAM's public data, so this list carries none.
 */

export const NEW_REGISTRANT_COLUMNS = [
  'uei', 'cage_code', 'legal_business_name', 'dba_name',
  'physical_city', 'physical_state', 'physical_zip',
  'primary_naics', 'naics_codes', 'small_business_naics', 'certifications',
  'initial_registration_date', 'sam_registration_date', 'sam_activation_date',
  'purpose_of_registration', 'registration_status', 'entity_url', 'sam_url',
] as const;

export type NewRegistrantRow = Partial<Record<(typeof NEW_REGISTRANT_COLUMNS)[number], unknown>>;

/** Max days per export — keeps one request bounded. */
export const MAX_RANGE_DAYS = 92;

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function validYmd(s: string): boolean {
  if (!YMD.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * Resolve ?from=&to= (inclusive, YYYY-MM-DD). Defaults to the last 7 days ending `today`.
 * Returns an error string instead of guessing on bad input.
 */
export function resolveRegistrantRange(
  from: string | null | undefined,
  to: string | null | undefined,
  today: string,
): { from: string; to: string } | { error: string } {
  const end = (to || today).trim();
  let start = (from || '').trim();
  if (!validYmd(end)) return { error: `Invalid "to" date: ${end}` };
  if (!start) {
    const d = new Date(`${end}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 6);
    start = d.toISOString().slice(0, 10);
  }
  if (!validYmd(start)) return { error: `Invalid "from" date: ${start}` };
  if (start > end) return { error: '"from" is after "to"' };
  const days = (Date.parse(end) - Date.parse(start)) / 86_400_000 + 1;
  if (days > MAX_RANGE_DAYS) return { error: `Range is ${days} days; max is ${MAX_RANGE_DAYS}` };
  return { from: start, to: end };
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = Array.isArray(v) ? v.join('; ') : String(v);
  // Neutralise spreadsheet formulas (CSV injection) and quote every field.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

const PURPOSE_LABEL: Record<string, string> = {
  Z2: 'All awards (contracts + grants)',
  Z3: 'Intra-government only',
  Z4: 'All awards + intra-government',
  Z5: 'Grants + intra-government',
};

const HEADERS = [
  'Company', 'DBA', 'UEI', 'CAGE', 'City', 'State', 'ZIP',
  'Primary NAICS', 'All NAICS', 'Small-business NAICS', 'Certifications',
  'First SAM registration', 'Current registration', 'Activated',
  'Registered for', 'Status', 'Website', 'SAM.gov link',
];

/** Spreadsheet-ready CSV (CRLF line endings, BOM so Excel reads UTF-8). */
export function toRegistrantCsv(rows: NewRegistrantRow[]): string {
  const lines = [HEADERS.map(cell).join(',')];
  for (const r of rows) {
    const purpose = typeof r.purpose_of_registration === 'string' ? r.purpose_of_registration : null;
    lines.push([
      r.legal_business_name, r.dba_name, r.uei, r.cage_code,
      r.physical_city, r.physical_state, r.physical_zip,
      r.primary_naics, r.naics_codes, r.small_business_naics, r.certifications,
      r.initial_registration_date, r.sam_registration_date, r.sam_activation_date,
      purpose ? (PURPOSE_LABEL[purpose] ?? purpose) : 'Unknown',
      r.registration_status, r.entity_url, r.sam_url,
    ].map(cell).join(','));
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}
