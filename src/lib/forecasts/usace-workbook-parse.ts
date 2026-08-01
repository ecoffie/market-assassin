/**
 * Parse a USACE DIVISION acquisition-forecast WORKBOOK (one sheet per district).
 *
 * The real files turn out to be XLSX, not PDF — the Great Lakes & Ohio River
 * Division publishes all seven of its districts in one workbook (Buffalo,
 * Chicago, Detroit, Huntington, Louisville, Nashville, Pittsburgh; 480 rows,
 * Louisville alone 156). That is a far better artifact than a per-district PDF,
 * and it deserves real COLUMN mapping rather than the line-scanning the PDF
 * parser has to do.
 *
 * Headers vary across sheets (4 distinct layouts in the July 2026 file) but
 * only in their trailing extras — every sheet carries the same core columns. So
 * mapping is by header NAME, never by position: a district that adds a "Working
 * Notes" column must not shift every field after it.
 *
 * Values are deliberately preserved as published:
 *   - "$1M-$5M" is a RANGE and stays one; collapsing it to a point estimate
 *     would invent precision the government did not state.
 *   - "TBD" is NOT data. It appears constantly in NAICS/set-aside/vehicle and
 *     must become NULL, never the literal string "TBD" on a card.
 */
import { parseMoneyRange, parseFiscalYear, parseQuarter, parseSetAside, parseNaics } from './usace-district-parse';

export interface UsaceWorkbookRow {
  district: string;
  title: string;
  location?: string;
  naicsCode?: string;
  pscCode?: string;
  estimatedValueMin?: number;
  estimatedValueMax?: number;
  estimatedValueRange?: string;
  setAside?: string;
  contractVehicle?: string;
  awardType?: string;
  fiscalYear?: string;
  anticipatedQuarter?: string;
  advertiseDateRaw?: string;
  popState?: string;
  raw: Record<string, string>;
}

export interface UsaceSheetResult {
  sheet: string;
  rows: UsaceWorkbookRow[];
  /** Rows present but unusable (no project description) — surfaced, not hidden. */
  skipped: number;
}

/**
 * "TBD", "N/A", "-", "" all mean ABSENT. Storing them as text puts "TBD" in the
 * NAICS field and on the user's screen, which reads as data rather than a gap.
 */
export function cleanCell(v: unknown): string | undefined {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return undefined;
  if (/^(tbd|tbd\.|n\/?a|na|none|unknown|-{1,}|\.)$/i.test(s)) return undefined;
  return s;
}

/** Header text → canonical field key. Matching is fuzzy because districts
 *  punctuate headers differently ("Est $ Range" vs "Est. $ Range"). */
function fieldFor(header: string): string | null {
  const h = header.toLowerCase().replace(/[^a-z0-9$ ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!h) return null;
  if (h === 'district') return 'district';
  if (h.includes('project description') || h === 'description') return 'title';
  if (h.includes('project location') || h === 'location') return 'location';
  if (h.includes('range') || h.includes('est $')) return 'value';
  if (h.startsWith('naics')) return 'naics';
  if (h.startsWith('psc')) return 'psc';
  if (h.includes('set aside') || h.includes('setaside')) return 'setaside';
  if (h.includes('contract vehicle') || h === 'vehicle') return 'vehicle';
  if (h.includes('award type')) return 'awardtype';
  if (h.includes('advertise')) return 'advertise';
  if (h.includes('award date')) return 'awarddate';
  return null;
}

/** US state from "Cleveland (Ohio)" / "Lockport, IL" / "Oakland County Michigan". */
const STATE_NAMES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS',
  missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
  oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
};

export function parseLocationState(loc: string | undefined): string | undefined {
  if (!loc) return undefined;
  const l = loc.toLowerCase();
  for (const [name, code] of Object.entries(STATE_NAMES)) {
    if (new RegExp(`\\b${name}\\b`).test(l)) return code;
  }
  // Trailing 2-letter code ("Lockport, IL" / "Gary, IN").
  const m = /,\s*([A-Z]{2})\b/.exec(loc);
  if (m && Object.values(STATE_NAMES).includes(m[1])) return m[1];
  return undefined;
}

/**
 * Parse one sheet (one district) of the workbook.
 * `aoa` is the sheet as an array-of-arrays (XLSX.utils.sheet_to_json header:1).
 */
export function parseUsaceSheet(sheetName: string, aoa: unknown[][]): UsaceSheetResult {
  const rows: UsaceWorkbookRow[] = [];
  let skipped = 0;

  // Find the header row — usually row 0, but a district may prepend a title.
  let headerIdx = -1;
  for (let i = 0; i < Math.min(aoa.length, 8); i++) {
    const cells = (aoa[i] || []).map(c => String(c ?? '').toLowerCase());
    if (cells.some(c => c.includes('project description')) && cells.some(c => c.includes('district'))) {
      headerIdx = i; break;
    }
  }
  if (headerIdx === -1) return { sheet: sheetName, rows: [], skipped: 0 };

  const headers = (aoa[headerIdx] || []).map(h => String(h ?? ''));
  const map = headers.map(fieldFor);

  for (let i = headerIdx + 1; i < aoa.length; i++) {
    const r = aoa[i] || [];
    if (!r.some(c => String(c ?? '').trim())) continue;

    const get = (field: string): string | undefined => {
      const idx = map.indexOf(field);
      return idx === -1 ? undefined : cleanCell(r[idx]);
    };
    const raw: Record<string, string> = {};
    headers.forEach((h, j) => { const v = String(r[j] ?? '').trim(); if (h && v) raw[h] = v; });

    const title = get('title');
    // A row with no project description is not a forecast. Count it so a
    // low yield reads as "sheet has filler", not "parser missed rows".
    if (!title || title.length < 5) { skipped++; continue; }

    const valueRaw = get('value');
    const money = parseMoneyRange(valueRaw);
    const advertise = get('advertise');
    const location = get('location');

    rows.push({
      district: get('district') || sheetName,
      title,
      location,
      naicsCode: parseNaics(get('naics')),
      pscCode: get('psc'),
      estimatedValueMin: money.min,
      estimatedValueMax: money.max,
      estimatedValueRange: valueRaw,
      setAside: parseSetAside(get('setaside')),
      contractVehicle: get('vehicle'),
      awardType: get('awardtype'),
      // "FY26 Q3" and "Q1 FY26" both occur — parse each independently rather
      // than assuming an order.
      fiscalYear: parseFiscalYear(advertise),
      anticipatedQuarter: parseQuarter(advertise),
      advertiseDateRaw: advertise,
      popState: parseLocationState(location),
      raw,
    });
  }

  return { sheet: sheetName, rows, skipped };
}
