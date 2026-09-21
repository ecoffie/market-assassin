/**
 * NASA forecast — the FROZEN source field contract.
 *
 * THE SOURCE. `AcqForecastNew.xlsx`, sheet "Forecast", 46 columns, 147 rows.
 * The published page is a DataTables JS shell; it LOADS this workbook. The prior
 * classification "REPAIR_REQUIRED — page loads, JS shell, 0 data rows, needs a
 * dynamic fetch" was half right: the shell is real, but no browser is needed —
 * the data is a static XLSX named in the page's own NAFNEW.js.
 *
 * ⚠️ FOUR LEGACY MAPPINGS WERE WRONG AND ARE REPAIRED HERE. Each was proven
 * against the live corpus, not assumed:
 *
 *  1. naics_description held a PSC description ("236220" -> "MAINT/REPAIR/REBUILD
 *     OF EQUIPMENT- ELECTRICAL") while every other agency stores the official
 *     NAICS title. psc_code/psc_description were empty on all 225 rows.
 *  2. poc_email/poc_name must come from TechnicalPOC — a NAMED INDIVIDUAL, as on
 *     DOJ/HHS/DHS/NAVY. An earlier draft mapped SmallBusinessSpecialistEmail,
 *     which matched 0/37 held rows and would have replaced 145 real technical
 *     contacts with center mailboxes.
 *  3. bureau/contracting_office/program_office all hold the CENTER (37/37
 *     measured). HQMissionDirectorate is a different organisational axis and is
 *     deliberately UNMODELLED rather than overwriting one of these.
 *  4. description comes from Description[43] ONLY — 147/147 populated, avg 366
 *     chars, matching the held value 31/37. Summary[29] is populated 110/147,
 *     matches 1/37, and is left UNMODELLED. No fallback, no concatenation.
 */

/** Column indexes in the NASA "Forecast" sheet. */
export const NASA_COL = {
  buyingOffice: 0, acquisitionStatus: 3, awardedOrWithdrawn: 4, sourceId: 6,
  title: 7, technicalPocEmail: 8, technicalPocName: 9,
  popState: 10, popCountry: 11, naics: 12, pscCode: 13, pscDesc: 14,
  missionDirectorate: 15, naicsDesc: 16,
  sbSpecialistName: 18, sbSpecialistEmail: 19,
  fyAward: 20, qtrAward: 21, estValue: 23, popCity: 24,
  setAside: 25, contractType: 26, summary: 29, extentCompeted: 39, description: 43,
} as const;

/** Source-owned. ONE list drives BOTH the diff and the update payload. */
export const NASA_SOURCE_OWNED_FIELDS = [
  'title', 'description', 'naics_code', 'naics_description', 'psc_code', 'psc_description',
  'bureau', 'contracting_office', 'program_office',
  'estimated_value_range', 'estimated_value_min',
  'contract_type', 'set_aside_type', 'competition_type',
  'poc_name', 'poc_email', 'pop_state', 'pop_city', 'pop_country', 'status',
] as const;

/** Mindy's interpretation of NASA's FY/quarter inputs — never overwritten by sync. */
export const NASA_DERIVED_FIELDS = ['fiscal_year', 'anticipated_quarter'] as const;

/**
 * Fields whose held value is a PROVEN legacy mis-mapping. Null-over-value
 * protection does NOT apply to these: preserving a value that sits in the wrong
 * semantic field is preserving an error.
 */
export const NASA_LEGACY_REPAIR_FIELDS = ['naics_description', 'psc_code', 'psc_description'] as const;

const BLANK = /^(n\/?a|tbd|to be determined|none|null|unknown|-{1,}|\.)$/i;

export function nasaCell(v: unknown): string | null {
  if (v === null || v === undefined || typeof v === 'boolean') return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return !s || BLANK.test(s) ? null : s;
}

/** "541715" or "541715--Title" -> the 6-digit code. */
export function nasaNaics(v: unknown): string | null {
  const s = nasaCell(v); if (!s) return null;
  return /^(\d{6})/.exec(s)?.[1] ?? s;
}

/** "$2.1M - $5M" -> 2100000. */
export function nasaValueMin(v: unknown): number | null {
  const s = nasaCell(v); if (!s) return null;
  const m = /\$\s*([\d.]+)\s*([KMB])?/i.exec(s); if (!m) return null;
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] || '').toUpperCase() as 'K' | 'M' | 'B'] ?? 1;
  return Math.round(Number(m[1]) * mult);
}

/**
 * LIFECYCLE PRECEDENCE, measured across all 147 rows:
 *   N/A × Revised 110 · Awarded × Awarded 16 · N/A × New 11
 *   Withdrawn × Withdrawn 8 · (null) × Revised 1 · N/A × Awarded 1
 * The two columns agree 24/25 times; SourceID 10072 is the lone one-sided case
 * (AwardedOrWithdrawn "N/A", AcquisitionStatus "Awarded"), so EITHER field
 * asserting a terminal state is authoritative.
 *
 * ⚠️ Lifecycle is NOT membership. NASA keeps publishing Withdrawn/Awarded rows in
 * AcqForecastNew.xlsx, so they remain part of the 147 current population.
 */
export function nasaStatus(awardedOrWithdrawn: unknown, acquisitionStatus: unknown): string | null {
  const a = nasaCell(awardedOrWithdrawn);
  const s = nasaCell(acquisitionStatus);
  if (a === 'Withdrawn' || s === 'Withdrawn') return 'Withdrawn';
  if (a === 'Awarded' || s === 'Awarded') return 'Awarded';
  return s;
}

export interface NasaMapped { sourceId: string; fields: Record<string, unknown>; derived: Record<string, unknown> }

export function mapNasaRow(r: unknown[]): NasaMapped | null {
  const sourceId = nasaCell(r[NASA_COL.sourceId]);
  if (!sourceId) return null;   // no identity -> never a fabricated key
  const center = nasaCell(r[NASA_COL.buyingOffice]);
  const fy = nasaCell(r[NASA_COL.fyAward]);
  return {
    sourceId,
    fields: {
      external_id: sourceId,
      title: nasaCell(r[NASA_COL.title]),
      description: nasaCell(r[NASA_COL.description]),      // [43] ONLY
      naics_code: nasaNaics(r[NASA_COL.naics]),
      naics_description: nasaCell(r[NASA_COL.naicsDesc]),  // official NAICS title
      psc_code: nasaCell(r[NASA_COL.pscCode]),
      psc_description: nasaCell(r[NASA_COL.pscDesc]),
      bureau: center, contracting_office: center, program_office: center,
      estimated_value_range: nasaCell(r[NASA_COL.estValue]),
      estimated_value_min: nasaValueMin(r[NASA_COL.estValue]),
      contract_type: nasaCell(r[NASA_COL.contractType]),
      set_aside_type: nasaCell(r[NASA_COL.setAside]),
      competition_type: nasaCell(r[NASA_COL.extentCompeted]),
      poc_name: nasaCell(r[NASA_COL.technicalPocName]),    // NAMED individual
      poc_email: nasaCell(r[NASA_COL.technicalPocEmail]),
      pop_state: nasaCell(r[NASA_COL.popState]),
      pop_city: nasaCell(r[NASA_COL.popCity]),
      pop_country: nasaCell(r[NASA_COL.popCountry]) === 'United States' ? 'USA' : nasaCell(r[NASA_COL.popCountry]),
      status: nasaStatus(r[NASA_COL.awardedOrWithdrawn], r[NASA_COL.acquisitionStatus]),
    },
    derived: {
      fiscal_year: fy && /^\d{4}$/.test(fy) && Number(fy) >= 2020 && Number(fy) <= 2040 ? `FY${fy}` : null,
      anticipated_quarter: /^Q[1-4]$/.test(nasaCell(r[NASA_COL.qtrAward]) ?? '') ? nasaCell(r[NASA_COL.qtrAward]) : null,
    },
  };
}
