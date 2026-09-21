/**
 * DOE (+ NNSA) acquisition forecast — a FETCHABLE monthly spreadsheet.
 *
 * Unlike every other stale source, DOE publishes a plain XLSX at a stable
 * energy.gov path with no WAF and no login (verified 2026-08-01: HTTP 200,
 * 135 KB, 870 rows). That makes it automatable, which matters more than the
 * row count: 15 of 17 forecast sources were last synced 36+ days ago because
 * their Puppeteer scrapers rotted, and a fetch-a-spreadsheet job cannot rot the
 * same way — a selector change breaks a scraper silently, a moved file 404s
 * loudly.
 *
 * The file is richer than most: it carries the CURRENT INCUMBENT and contract
 * number per line, which is what makes a forecast row useful for recompete
 * targeting rather than just a heads-up.
 *
 * LAYOUT: the first ~17 rows are disclaimer prose, so the header row is found
 * by content ("NAICS" + several populated cells), never by a fixed index — DOE
 * edits that preamble between monthly editions.
 */

/** Current public file. DOE updates it monthly under a dated directory. */
export const DOE_FORECAST_URL =
  'https://www.energy.gov/sites/default/files/2026-07/OSBP%20Acquisition%20Forecast%20Public%20Version%20for%20Web.xlsx';

export interface DoeForecastRow {
  title: string;
  naicsCode?: string;
  naicsDescription?: string;
  programOffice?: string;
  incumbentName?: string;
  incumbentContractNumber?: string;
  estimatedValueRange?: string;
  estimatedValueMin?: number;
  estimatedValueMax?: number;
  setAside?: string;
  contractType?: string;
  popState?: string;
  performanceEndDate?: string;
  raw: Record<string, string>;
}

const BLANK = /^(tbd|tbd\.|n\/?a|na|none|unknown|-{1,}|\.)$/i;

/** "TBD"/"N/A" mean ABSENT — storing them puts "TBD" on a card as if it were data. */
export function doeCell(v: unknown): string | undefined {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (!s || BLANK.test(s)) return undefined;
  return s;
}

/** Header text → canonical key. Fuzzy: DOE renames columns between editions
 *  ("Estimated Dollar Value" became "Estimated Value Range"). */
export function doeFieldFor(header: string): string | null {
  const h = header.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!h) return null;
  if (h.includes('acquisition description') || h === 'description') return 'title';
  if (h.startsWith('naics code')) return 'naics';
  if (h.startsWith('naics description')) return 'naicsdesc';
  // "New Program Office Calc" is a derived column — prefer the plain one, so
  // check for the exact-ish name first and let the calc variant fall through.
  if (h === 'program office') return 'office';
  if (h.includes('current incumbent')) return 'incumbent';
  if (h.includes('current contract number')) return 'contractnum';
  if (h.includes('estimated') && (h.includes('value') || h.includes('dollar'))) return 'value';
  if (h.includes('set aside')) return 'setaside';
  if (h.includes('contract type')) return 'contracttype';
  if (h.includes('place of performance')) return 'popstate';
  if (h.includes('performance end date')) return 'endsdate';
  return null;
}

/**
 * Excel serial date → ISO. DOE stores dates as serials (45597 = 2024-11-01),
 * which would otherwise be stored as the literal string "45597".
 */
export function excelSerialToIso(v: unknown): string | undefined {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 20000 || n > 80000) return undefined;
  // Excel epoch is 1899-12-30 (accounting for its 1900 leap-year bug).
  const ms = (n - 25569) * 86400 * 1000;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
}

/** Find the header row by CONTENT — DOE's disclaimer preamble varies in length. */
export function findDoeHeaderRow(aoa: unknown[][]): number {
  for (let i = 0; i < Math.min(aoa.length, 60); i++) {
    const row = (aoa[i] || []).map(c => String(c ?? '').toLowerCase());
    if (row.some(c => c.includes('naics')) && row.filter(Boolean).length >= 4) return i;
  }
  return -1;
}

export interface DoeParseResult {
  rows: DoeForecastRow[];
  skipped: number;
  headerRow: number;
}

export function parseDoeForecast(
  aoa: unknown[][],
  helpers: {
    parseMoneyRange: (s?: string | null) => { min?: number; max?: number };
    parseSetAside: (s?: string | null) => string | undefined;
    parseNaics: (s?: string | null) => string | undefined;
  },
): DoeParseResult {
  const headerRow = findDoeHeaderRow(aoa);
  if (headerRow === -1) return { rows: [], skipped: 0, headerRow: -1 };

  const headers = (aoa[headerRow] || []).map(h => String(h ?? ''));
  const map = headers.map(doeFieldFor);
  const rows: DoeForecastRow[] = [];
  let skipped = 0;

  for (let i = headerRow + 1; i < aoa.length; i++) {
    const r = aoa[i] || [];
    if (!r.some(c => String(c ?? '').trim())) continue;

    const get = (field: string): string | undefined => {
      const idx = map.indexOf(field);
      return idx === -1 ? undefined : doeCell(r[idx]);
    };
    const raw: Record<string, string> = {};
    headers.forEach((h, j) => { const v = String(r[j] ?? '').trim(); if (h && v) raw[h] = v; });

    const title = get('title');
    // No acquisition description = not a forecast line (footnotes, spacers).
    if (!title || title.length < 5) { skipped++; continue; }

    const valueRaw = get('value');
    const money = helpers.parseMoneyRange(valueRaw);
    const endIdx = map.indexOf('endsdate');

    rows.push({
      title,
      naicsCode: helpers.parseNaics(get('naics')),
      naicsDescription: get('naicsdesc'),
      programOffice: get('office'),
      incumbentName: get('incumbent'),
      incumbentContractNumber: get('contractnum'),
      estimatedValueRange: valueRaw,
      estimatedValueMin: money.min,
      estimatedValueMax: money.max,
      setAside: helpers.parseSetAside(get('setaside')),
      contractType: get('contracttype'),
      popState: get('popstate'),
      performanceEndDate: endIdx === -1 ? undefined : excelSerialToIso(r[endIdx]),
      raw,
    });
  }

  return { rows, skipped, headerRow };
}

/**
 * Deterministic id. Keyed on the CONTRACT NUMBER when present — that is DOE's
 * own stable identifier — and falls back to office+title, which is the only
 * thing available on a new requirement with no incumbent contract yet.
 */
export function doeExternalId(r: DoeForecastRow): string {
  const basis = r.incumbentContractNumber
    ? `C:${r.incumbentContractNumber}`
    : `T:${r.programOffice || ''}|${r.title}`;
  return `DOE-${basis.toUpperCase().replace(/[^A-Z0-9:]+/g, '-').replace(/^-|-$/g, '').slice(0, 120)}`;
}
