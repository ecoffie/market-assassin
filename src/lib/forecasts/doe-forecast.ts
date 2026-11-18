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

/**
 * Legacy July 2026 workbook. It still returns HTTP 200, so a collector that
 * fetches only this URL keeps succeeding on a frozen edition.
 * The living file is the dated CSV linked from DOE_FORECAST_PAGE
 * (measured 2026-11-18: /documents/osbp-acquisition-forecast-public-2026-11-16csv).
 */
export const DOE_FORECAST_URL =
  'https://www.energy.gov/sites/default/files/2026-07/OSBP%20Acquisition%20Forecast%20Public%20Version%20for%20Web.xlsx';

/** Page that links the current public forecast. The href carries the edition date. */
export const DOE_FORECAST_PAGE = 'https://www.energy.gov/osbp/acquisition-forecast';

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
  /** Report-run date from the CSV's CURRENT_DATE column, when present. */
  editionDate?: string;
  raw: Record<string, string>;
}

const BLANK = /^(tbd|tbd\.|n\/?a|na|none|unknown|unavailable|-{1,}|\.)$/i;

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
  // The Nov 2026 CSV has BOTH a precise "Estimated Dollar Value" and a band
  // "Estimated Value Range". The precise column must not be stored as the band.
  if (h.includes('dollar value')) return 'amount';
  if (h.includes('estimated') && (h.includes('value') || h.includes('dollar'))) return 'value';
  // "IDV Type of Set Aside" sits before the real "Type of Set Aside" and is
  // often "Unavailable". It must not win the set-aside field.
  if (h.includes('idv') && h.includes('set aside')) return null;
  if (h === 'current date' || h === 'current_date') return 'edition';
  if (h.includes('set aside')) return 'setaside';
  if (h.includes('contract type')) return 'contracttype';
  if (h.includes('place of performance')) return 'popstate';
  if (h.includes('performance end date')) return 'endsdate';
  return null;
}

/**
 * Excel serial OR M/D/YYYY OR YYYY-MM-DD.
 * The July workbook stores serials (45597 = 2024-11-01). The Nov 2026 CSV uses M/D/YYYY.
 */
export function doeDate(v: unknown): string | undefined {
  const serial = excelSerialToIso(v);
  if (serial && typeof v !== 'string') return serial;
  const s = doeCell(v);
  if (!s) return undefined;
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) {
    const month = Number(mdy[1]);
    const day = Number(mdy[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
    return `${mdy[3]}-${mdy[1].padStart(2, '0')}-${mdy[2].padStart(2, '0')}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return excelSerialToIso(v);
}

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
    const amountRaw = get('amount');
    const amount = amountRaw != null && Number.isFinite(Number(amountRaw.replace(/,/g, '')))
      ? Number(amountRaw.replace(/,/g, ''))
      : undefined;
    const money = amount != null && amount > 0
      ? { min: amount, max: amount }
      : helpers.parseMoneyRange(valueRaw);
    const endIdx = map.indexOf('endsdate');

    rows.push({
      title,
      naicsCode: helpers.parseNaics(get('naics')),
      naicsDescription: get('naicsdesc'),
      programOffice: get('office'),
      incumbentName: get('incumbent'),
      incumbentContractNumber: get('contractnum'),
      estimatedValueRange: valueRaw || (amount != null ? amountRaw : undefined),
      estimatedValueMin: money.min,
      estimatedValueMax: money.max,
      setAside: helpers.parseSetAside(get('setaside')),
      contractType: get('contracttype'),
      popState: get('popstate'),
      performanceEndDate: endIdx === -1 ? undefined : doeDate(r[endIdx]),
      editionDate: doeDate(get('edition')),
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

export interface DoeForecastDocument {
  /** YYYY-MM-DD edition from the href. */
  edition: string;
  href: string;
}

/**
 * Dated public files linked from the OSDBU forecast page.
 * Newest edition first. The July XLSX is not on this page and is not returned.
 */
export function extractDoeForecastDocuments(html: string): DoeForecastDocument[] {
  const found = new Map<string, string>();
  const dated = /href="([^"]*osbp-acquisition-forecast-public-(\d{4}-\d{2}-\d{2})csv[^"]*)"/gi;
  let m: RegExpExecArray | null;
  while ((m = dated.exec(html))) found.set(m[2], m[1].replace(/&amp;/g, '&'));
  const compact = /href="([^"]*acquisition-forecast[^"]*?(\d{4})(\d{2})(\d{2})\.csv[^"]*)"/gi;
  while ((m = compact.exec(html))) found.set(`${m[2]}-${m[3]}-${m[4]}`, m[1].replace(/&amp;/g, '&'));
  return [...found.entries()]
    .map(([edition, href]) => ({ edition, href }))
    .sort((a, b) => (a.edition < b.edition ? 1 : a.edition > b.edition ? -1 : 0));
}

export function absoluteDoeUrl(href: string): string {
  if (href.startsWith('http://') || href.startsWith('https://')) return href;
  return `https://www.energy.gov${href.startsWith('/') ? '' : '/'}${href}`;
}

/** RFC-style CSV. DOE quotes descriptions that contain commas. */
export function parseCsvRows(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { cur += '"'; i++; }
        else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c !== '\r') cur += c;
  }
  if (cur.length > 0 || row.length > 0) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

export function parseDoeCsv(
  text: string,
  helpers: Parameters<typeof parseDoeForecast>[1],
): DoeParseResult {
  return parseDoeForecast(parseCsvRows(text), helpers);
}
