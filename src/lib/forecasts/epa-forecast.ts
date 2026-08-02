/**
 * EPA Acquisition Forecast Database (ordspub.epa.gov/ords/forecast, Oracle APEX).
 *
 * FINDING THE REPORT TOOK THREE WRONG TURNS, all the same mistake — guessing
 * instead of following the app:
 *   1. Guessed `epa.gov/osbp/procurement-forecast` → 404, recorded EPA as
 *      having no forecast. It has one; the URL was invented.
 *   2. Walked APEX page numbers (f?p=122:2..5) hoping to hit a report.
 *   3. Waited 60s for a grid on page 10 — which is a MENU, not a report. Its
 *      links ("By Record Number", "By NAICS Code", …) are the actual reports.
 *
 * The route that works: page 1 → "Current Opportunities" (page 10) → "By Record
 * Number" (page 2). Session ids are embedded in the hrefs, so the links must be
 * CLICKED in sequence — a hand-built f?p= URL with a stale session returns an
 * empty page (verified: guessed pagination params returned 0 rows).
 *
 * SIZE: 50 records. The other views ("By NAICS Code" etc.) are the same corpus
 * grouped differently, not extra data — their higher row counts are group
 * headers. Confirmed by unioning all seven views: still 50 unique.
 * Target award years FY2026-FY2030.
 */

export const EPA_FORECAST_URL = 'https://ordspub.epa.gov/ords/forecast/f?p=122:1';

export interface EpaForecastRow {
  recordNumber: string;
  naicsCode?: string;
  description: string;
  procurementMethod?: string;
  valueRange?: string;
  valueMin?: number;
  valueMax?: number;
  setAside?: string;
  awardYear?: string;
  awardQuarter?: string;
  placeOfPerformance?: string;
  /** 2-letter state parsed out of placeOfPerformance; undefined when it names no
   *  state ("Nation-wide", "Contractor's Facility"). Maps to `pop_state`. */
  popState?: string;
  raw: Record<string, string>;
}

const BLANK = /^(tbd|tba|to be decided.*|to be determined|n\/?a|na|none|unknown|-{1,}|\.)$/i;

export function epaCell(v: unknown): string | undefined {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (!s || BLANK.test(s)) return undefined;
  return s;
}

/** Header → canonical key, matched by name (APEX column order can change). */
export function epaFieldFor(header: string): string | null {
  const h = header.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!h) return null;
  if (h.includes('record number')) return 'record';
  if (h.startsWith('naics')) return 'naics';
  if (h === 'description') return 'description';
  if (h.includes('procurement method')) return 'method';
  if (h.includes('estimated dollars') || h.includes('dollar')) return 'value';
  if (h.includes('target award year')) return 'awardYear';
  if (h.includes('target award quarter')) return 'awardQuarter';
  if (h.includes('place of performance')) return 'pop';
  return null;
}

/** "$25,001 - 150,000" / ">$1M - $3M" / "<$25,000" → bounds. */
export function epaValueRange(v: string | undefined): { min?: number; max?: number } {
  if (!v) return {};
  // Money tokens may omit the $ on the upper bound ("$25,001 - 150,000").
  const toks = v.match(/\$?\s?[\d,.]+\s*[KMB]?/gi) || [];
  const nums = toks.map(t => {
    const m = /([\d,.]+)\s*([KMB])?/i.exec(t);
    if (!m) return NaN;
    const n = parseFloat(m[1].replace(/,/g, ''));
    const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] || '').toUpperCase() as 'K' | 'M' | 'B'] ?? 1;
    return n * mult;
  }).filter(n => Number.isFinite(n) && n >= 1000);
  if (!nums.length) return {};
  const min = Math.round(Math.min(...nums)), max = Math.round(Math.max(...nums));
  // ">$3M" style has no ceiling — a max would be invented.
  if (/^\s*>/.test(v) && nums.length === 1) return { min };
  if (/^\s*</.test(v) && nums.length === 1) return { max };
  return { min, max };
}

/**
 * EPA encodes the set-aside inside "Procurement Method" rather than its own
 * column — e.g. "Competition Restricted to Small Businesses or Small Business
 * Set-Aside".
 */
export function epaSetAside(method: string | undefined): string | undefined {
  const t = (method || '').toLowerCase();
  if (!t) return undefined;
  if (/8\s?\(?a\)?/.test(t)) return '8(a)';
  if (/sdvosb|service[-\s]?disabled/.test(t)) return 'SDVOSB';
  if (/hubzone/.test(t)) return 'HUBZone';
  if (/wosb|women[-\s]?owned|edwosb/.test(t)) return 'WOSB';
  if (/vosb|veteran[-\s]?owned/.test(t)) return 'VOSB';
  if (/small business/.test(t)) return 'Small Business';
  if (/full and open|unrestricted/.test(t)) return 'Full and Open';
  return undefined;
}

/** 2026 | "FY 2026" → "FY2026". */
export function epaFy(v: string | undefined): string | undefined {
  const m = /(\d{4})/.exec(String(v ?? ''));
  if (!m) return undefined;
  const n = Number(m[1]);
  return n >= 2020 && n <= 2040 ? `FY${m[1]}` : undefined;
}

/** USPS codes for the 50 states + DC + territories EPA actually operates in. */
const US_STATE_CODES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA',
  'ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK',
  'OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
  'DC','PR','VI','GU','AS','MP',
]);

/**
 * Pull a place-of-performance STATE out of EPA's free-text location column.
 *
 * The column mixes real state codes ("TX", "CO; NJ") with non-geographic answers
 * ("Contractor's Facility", "Region-wide", "Nation-wide"). Only the state codes
 * are placeable, so anything else returns undefined and the row goes honestly
 * unpinned rather than being guessed onto a centroid.
 *
 * Found 2026-08-01: the parser captured this column into `raw` but never mapped
 * it to a `popState`, so all 50 EPA rows reached the map with no location and
 * the source sat at 0% mapped. 27 of the 50 name a real state.
 *
 * Validated against the actual USPS code set, NOT a denylist of known non-states:
 * a denylist has to anticipate every two-letter word EPA might write ("US", "TB",
 * an initialism inside a facility name), and the first one it misses becomes a
 * bogus pin. A whitelist fails closed.
 *
 * Where several states are listed ("CO; NJ"), the FIRST is used — a pin has one
 * coordinate, and a midpoint between two states is a location neither party
 * would recognize.
 */
export function epaPopState(pop: string | undefined): string | undefined {
  if (!pop) return undefined;
  for (const tok of pop.toUpperCase().match(/\b[A-Z]{2}\b/g) || []) {
    if (US_STATE_CODES.has(tok)) return tok;
  }
  return undefined;
}

export interface EpaParseResult { rows: EpaForecastRow[]; skipped: number }

export function parseEpaForecast(header: string[], body: string[][]): EpaParseResult {
  const map = header.map(epaFieldFor);
  const rows: EpaForecastRow[] = [];
  let skipped = 0;

  for (const r of body) {
    const get = (f: string) => { const i = map.indexOf(f); return i === -1 ? undefined : epaCell(r[i]); };
    const description = get('description');
    const recordNumber = get('record');
    // A row with neither an id nor a description is grid furniture.
    if (!description || !recordNumber) { skipped++; continue; }

    const raw: Record<string, string> = {};
    header.forEach((h, i) => { const v = (r[i] || '').trim(); if (h && v) raw[h] = v; });

    const valueRange = get('value');
    const val = epaValueRange(valueRange);
    const method = get('method');

    rows.push({
      recordNumber,
      naicsCode: (get('naics') || '').match(/\b(\d{6})\b/)?.[1],
      description,
      procurementMethod: method,
      valueRange,
      valueMin: val.min,
      valueMax: val.max,
      setAside: epaSetAside(method),
      awardYear: epaFy(get('awardYear')),
      awardQuarter: (get('awardQuarter') || '').match(/(?:QTR|Q)\s?([1-4])/i)?.[1]
        ? `Q${(get('awardQuarter') || '').match(/(?:QTR|Q)\s?([1-4])/i)![1]}` : undefined,
      placeOfPerformance: get('pop'),
      popState: epaPopState(get('pop')),
      raw,
    });
  }

  return { rows, skipped };
}

/** EPA's own record number is unique and stable — no content hash needed. */
export function epaExternalId(r: EpaForecastRow): string {
  return `EPA-${r.recordNumber.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 110)}`;
}
