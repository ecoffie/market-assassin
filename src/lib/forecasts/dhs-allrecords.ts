/**
 * DHS.gov APFS_forecast_allRecords — public CSV/XLSX parser.
 *
 * Official public replacement for apfs-cloud.dhs.gov/api/forecast (which now
 * serves migration HTML). Research record:
 *   research_notes/Forecast refresh readiness/dhs_replacement.md
 *
 * Identity: raw APFS Number (`F…`) only — never a synthetic agency prefix.
 * Star-stripped via canonicalDhsApfsNumber so republish flags stay out of the key.
 */
import * as XLSX from 'xlsx';
import { canonicalDhsApfsNumber } from './dhs-identity';

/** Full public forecast dump (preferred). */
export const DHS_ALLRECORDS_CSV_URL =
  'https://www.dhs.gov/xlibrary/daily-contract-opportunities-report/APFS_forecast_allRecords.csv';

/** XLSX twin of the same dump (DOE-parity fetch style). */
export const DHS_ALLRECORDS_XLSX_URL =
  'https://www.dhs.gov/xlibrary/daily-contract-opportunities-report/APFS_forecast_allRecords.xlsx';

/** Recent-updates slice — NOT the fleet source until proven a true subset. */
export const DHS_7DAY_CSV_URL =
  'https://www.dhs.gov/xlibrary/daily-contract-opportunities-report/APFS_forecast_7day.csv';

export const DHS_ALLRECORDS_SOURCE_TYPE = 'dhs_gov_csv';

const BLANK = /^(tbd|tba|n\/?a|na|none|null|unknown|-{1,}|\.)$/i;

export function dhsCell(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  if (!s || BLANK.test(s)) return null;
  return s;
}

/** "$10M - $19M" / "$500K - $999K" → [min, max] dollars; nulls when unparseable. */
export function dhsParseDollarRange(v: unknown): [number | null, number | null] {
  const s = (dhsCell(v) || '').toLowerCase();
  if (!s) return [null, null];
  const mult = (u: string) => (u === 'b' ? 1e9 : u === 'm' ? 1e6 : u === 'k' ? 1e3 : 1);
  const nums = [...s.matchAll(/\$?\s*([\d.,]+)\s*([bmk])?/g)]
    .map((m) => Number(m[1].replace(/,/g, '')) * mult(m[2] || ''))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!nums.length) return [null, null];
  return [nums[0], nums.length > 1 ? nums[nums.length - 1] : null];
}

/** "336411 - Aircraft Manufacturing" → [code, description]. */
export function dhsSplitNaics(v: unknown): { code: string | null; description: string | null } {
  const s = dhsCell(v);
  if (!s) return { code: null, description: null };
  const m = /^(\d{2,6})\s*[-–—]\s*(.+)$/.exec(s);
  if (m) return { code: m[1], description: m[2].trim() || null };
  const digits = /^(\d{6})\b/.exec(s);
  return { code: digits?.[1] ?? s, description: null };
}

/**
 * Public file carries "Q3 2027"; the API carried bare "Q3". Extract Q[1-4] only —
 * the year is NOT stuffed into anticipated_quarter.
 */
export function dhsAwardQuarter(v: unknown): string | null {
  const s = dhsCell(v);
  if (!s) return null;
  return s.match(/Q[1-4]/i)?.[0]?.toUpperCase() ?? null;
}

/** ISO date (YYYY-MM-DD) from a cell; null when unparseable. */
export function dhsIsoDate(v: unknown): string | null {
  const s = dhsCell(v);
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
}

/** Header text → canonical internal key (CSV headers are stable; fuzzy for XLSX drift). */
export function dhsAllrecordsFieldFor(header: string): string | null {
  const h = header.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!h) return null;
  if (h === 'apfs number' || h === 'apfs') return 'apfs';
  if (h === 'forecast id' || h === 'forecast_id') return 'forecast_id';
  if (h === 'naics') return 'naics';
  if (h === 'component') return 'component';
  if (h === 'title') return 'title';
  if (h === 'contract type') return 'contract_type';
  if (h === 'contract vehicle') return 'contract_vehicle';
  if (h === 'dollar range') return 'dollar_range';
  if (h === 'small business set aside') return 'set_aside';
  if (h === 'small business program') return 'sb_program';
  if (h === 'contract status') return 'contract_status';
  if (h === 'contract number') return 'contract_number';
  if (h === 'contractor') return 'contractor';
  if (h === 'place of performance city') return 'pop_city';
  if (h === 'place of performance state') return 'pop_state';
  if (h === 'period of performance start') return 'pop_start';
  if (h === 'period of performance end') return 'pop_end';
  if (h === 'primary contact first name') return 'poc_first';
  if (h === 'primary contact last name') return 'poc_last';
  if (h === 'primary contact phone') return 'poc_phone';
  if (h === 'primary contact email') return 'poc_email';
  if (h === 'requirements office') return 'requirements_office';
  if (h === 'description') return 'description';
  if (h === 'award quarter') return 'award_quarter';
  if (h === 'award date') return 'award_date';
  if (h === 'estimated solicitation release') return 'solicitation_release';
  if (h === 'forecast published') return 'forecast_published';
  if (h === 'forecast previously published') return 'forecast_previously_published';
  return null;
}

export interface DhsAllrecordsParsedRow {
  /** Canonical APFS Number — raw `F…`, never prefixed. */
  apfsNumber: string;
  forecastId?: string;
  title: string;
  description?: string;
  component?: string;
  requirementsOffice?: string;
  naicsCode?: string;
  naicsDescription?: string;
  contractType?: string;
  contractVehicle?: string;
  dollarRange?: string;
  estimatedValueMin?: number | null;
  estimatedValueMax?: number | null;
  setAside?: string;
  sbProgram?: string;
  contractStatus?: string;
  contractNumber?: string;
  contractor?: string;
  popCity?: string;
  popState?: string;
  popStart?: string;
  popEnd?: string;
  pocFirst?: string;
  pocLast?: string;
  pocPhone?: string;
  pocEmail?: string;
  awardQuarter?: string;
  awardDate?: string;
  solicitationRelease?: string;
  raw: Record<string, string>;
}

export interface DhsAllrecordsParseResult {
  rows: DhsAllrecordsParsedRow[];
  skipped: number;
  headerRow: number;
  /** Rows with no usable APFS Number — counted, never guessed. */
  missingApfs: number;
}

function findHeaderRow(aoa: unknown[][]): number {
  for (let i = 0; i < Math.min(aoa.length, 20); i++) {
    const cells = (aoa[i] || []).map((c) => String(c ?? '').toLowerCase());
    if (cells.some((c) => c.includes('apfs number') || c === 'apfs number')) return i;
  }
  return -1;
}

/** Parse workbook / CSV bytes into typed rows. */
export function parseDhsAllrecordsBuffer(buf: Buffer | Uint8Array): DhsAllrecordsParseResult {
  const wb = XLSX.read(buf, { type: 'buffer', raw: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as unknown[][];
  return parseDhsAllrecordsAoa(aoa);
}

/** Pure AOA parse — hermetic unit tests feed this directly. */
export function parseDhsAllrecordsAoa(aoa: unknown[][]): DhsAllrecordsParseResult {
  const headerRow = findHeaderRow(aoa);
  if (headerRow === -1) return { rows: [], skipped: 0, headerRow: -1, missingApfs: 0 };

  const headers = (aoa[headerRow] || []).map((h) => String(h ?? ''));
  const map = headers.map(dhsAllrecordsFieldFor);
  const rows: DhsAllrecordsParsedRow[] = [];
  let skipped = 0;
  let missingApfs = 0;

  for (let i = headerRow + 1; i < aoa.length; i++) {
    const r = aoa[i] || [];
    if (!r.some((c) => String(c ?? '').trim())) continue;

    const raw: Record<string, string> = {};
    const get = (field: string): string | null => {
      const idx = map.indexOf(field);
      if (idx < 0) return null;
      return dhsCell(r[idx]);
    };
    for (let c = 0; c < headers.length; c++) {
      const key = map[c] || headers[c] || `col_${c}`;
      const val = dhsCell(r[c]);
      if (val) raw[key] = val;
    }

    const apfs = canonicalDhsApfsNumber(get('apfs'));
    if (!apfs) {
      missingApfs++;
      skipped++;
      continue;
    }

    const title = get('title') || get('contract_vehicle') || '(untitled forecast)';
    const naics = dhsSplitNaics(get('naics'));
    const dollarRange = get('dollar_range');
    const [vmin, vmax] = dhsParseDollarRange(dollarRange);

    rows.push({
      apfsNumber: apfs,
      forecastId: get('forecast_id') || undefined,
      title,
      description: get('description') || undefined,
      component: get('component') || undefined,
      requirementsOffice: get('requirements_office') || undefined,
      naicsCode: naics.code || undefined,
      naicsDescription: naics.description || undefined,
      contractType: get('contract_type') || undefined,
      contractVehicle: get('contract_vehicle') || undefined,
      dollarRange: dollarRange || undefined,
      estimatedValueMin: vmin,
      estimatedValueMax: vmax,
      setAside: get('set_aside') || undefined,
      sbProgram: get('sb_program') || undefined,
      contractStatus: get('contract_status') || undefined,
      contractNumber: get('contract_number') || undefined,
      contractor: get('contractor') || undefined,
      popCity: get('pop_city') || undefined,
      popState: get('pop_state') || undefined,
      popStart: dhsIsoDate(get('pop_start')) || undefined,
      popEnd: dhsIsoDate(get('pop_end')) || undefined,
      pocFirst: get('poc_first') || undefined,
      pocLast: get('poc_last') || undefined,
      pocPhone: get('poc_phone') || undefined,
      pocEmail: get('poc_email') || undefined,
      awardQuarter: dhsAwardQuarter(get('award_quarter')) || undefined,
      awardDate: dhsIsoDate(get('award_date')) || undefined,
      solicitationRelease: dhsIsoDate(get('solicitation_release')) || undefined,
      raw,
    });
  }

  return { rows, skipped, headerRow, missingApfs };
}

/**
 * Map a parsed public-file row onto agency_forecasts columns.
 * Mirrors sync-forecasts `fetchDHS` field intent, adapted to CSV column names.
 */
export function dhsAllrecordsToDbRow(
  r: DhsAllrecordsParsedRow,
  opts: { sourceUrl?: string } = {},
): Record<string, unknown> & { external_id: string } {
  const pocName = [r.pocFirst, r.pocLast].filter(Boolean).join(' ') || null;
  const component = r.component || null;
  return {
    external_id: r.apfsNumber,
    title: r.title,
    description: r.description ?? null,
    bureau: component,
    contracting_office: component,
    program_office: r.requirementsOffice || component,
    naics_code: r.naicsCode ?? null,
    naics_description: r.naicsDescription ?? null,
    anticipated_quarter: r.awardQuarter ?? null,
    anticipated_award_date: r.awardDate ?? null,
    solicitation_date: r.solicitationRelease ?? null,
    estimated_value_min: r.estimatedValueMin ?? null,
    estimated_value_max: r.estimatedValueMax ?? null,
    estimated_value_range: r.dollarRange ?? null,
    contract_type: r.contractType ?? null,
    set_aside_type: r.setAside || r.sbProgram || null,
    incumbent_name: r.contractor ?? null,
    incumbent_contract_number: r.contractNumber ?? null,
    performance_end_date: r.popEnd ?? null,
    poc_name: pocName,
    poc_email: r.pocEmail ?? null,
    poc_phone: r.pocPhone ?? null,
    pop_state: r.popState ?? null,
    pop_city: r.popCity ?? null,
    status: r.contractStatus || 'forecast',
    source_url: opts.sourceUrl ?? DHS_ALLRECORDS_CSV_URL,
  };
}
