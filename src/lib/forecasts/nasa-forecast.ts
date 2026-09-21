/**
 * NASA Agency-Wide Acquisition Forecast (hq.nasa.gov/office/procurement/forecast/NAF.html).
 *
 * Published quarterly, covering every anticipated procurement over $150K across
 * all NASA centers. The page renders a 14-column grid client-side with NO JSON
 * endpoint behind it — the data is only in the DOM — so this is a table scrape
 * driven by "Show All" plus pagination (50 rows/page, 3 pages, 146 rows).
 *
 * Verified 2026-08-01: HTTP 200, no auth, no WAF. The per-center counts in the
 * page's own filter sidebar (AFRC 13 · ARC 14 · GRC 10 · GSFC 7 · JSC 22 ·
 * KSC 40 · …) sum to the scraped total, which is the check that the pagination
 * walk captured everything rather than silently stopping early.
 */

export const NASA_FORECAST_URL = 'https://www.hq.nasa.gov/office/procurement/forecast/NAF.html';

export interface NasaForecastRow {
  buyingOffice?: string;
  status?: string;
  phase?: string;
  title: string;
  requirementType?: string;
  naicsCode?: string;
  pscCode?: string;
  valueRange?: string;
  valueMin?: number;
  valueMax?: number;
  newOrRecompete?: string;
  setAside?: string;
  quarter?: string;
  fiscalYear?: string;
  raw: Record<string, string>;
}

const BLANK = /^(tbd|tba|to be determined|n\/?a|na|none|unknown|-{1,}|\.)$/i;

export function nasaCell(v: unknown): string | undefined {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (!s || BLANK.test(s)) return undefined;
  return s;
}

/** Header text → canonical key. Matched by NAME; NASA reorders columns between
 *  quarterly editions, so position is never assumed. */
export function nasaFieldFor(header: string): string | null {
  const h = header.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!h) return null;
  if (h.includes('buying office') || h === 'center') return 'office';
  if (h.includes('acquisition status')) return 'status';
  if (h.includes('acquisition phase')) return 'phase';
  if (h.includes('title')) return 'title';
  if (h.includes('type of requirement')) return 'reqType';
  if (h === 'naics' || h.startsWith('naics')) return 'naics';
  if (h.includes('psc')) return 'psc';
  if (h.includes('estimated contract value') || h.includes('value')) return 'value';
  if (h.includes('new or recompete')) return 'newRecompete';
  if (h.includes('set aside') || h.includes('socio')) return 'setAside';
  if (h.includes('quarter')) return 'quarter';
  if (h.includes('fiscal year') || h === 'fy') return 'fy';
  return null;
}

/** "$250K - $1B" / "Over $1B" / "$5M" → bounds. */
export function nasaValueRange(v: string | undefined): { min?: number; max?: number } {
  if (!v) return {};
  const toks = v.match(/\$\s?[\d,.]+\s*[KMB]?/gi) || [];
  const nums = toks.map(t => {
    const m = /\$\s?([\d,.]+)\s*([KMB])?/i.exec(t);
    if (!m) return NaN;
    const n = parseFloat(m[1].replace(/,/g, ''));
    const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] || '').toUpperCase() as 'K' | 'M' | 'B'] ?? 1;
    return n * mult;
  }).filter(n => Number.isFinite(n) && n > 0);
  if (!nums.length) return {};
  const min = Math.round(Math.min(...nums)), max = Math.round(Math.max(...nums));
  // "Over $1B" has no ceiling — store the floor rather than invent one.
  if (/over|above|greater|\+/i.test(v) && nums.length === 1) return { min };
  if (min < 1000) return max >= 1000 ? { max } : {};
  return { min, max };
}

export function nasaSetAside(v: string | undefined): string | undefined {
  const t = (v || '').toLowerCase();
  if (!t) return undefined;
  if (/8\s?\(?a\)?/.test(t)) return '8(a)';
  if (/sdvosb|service[-\s]?disabled/.test(t)) return 'SDVOSB';
  if (/hubzone/.test(t)) return 'HUBZone';
  if (/wosb|women[-\s]?owned|edwosb/.test(t)) return 'WOSB';
  if (/vosb|veteran[-\s]?owned/.test(t)) return 'VOSB';
  if (/small business|\bsb\b/.test(t)) return 'Small Business';
  if (/full and open|unrestricted|full & open/.test(t)) return 'Full and Open';
  return undefined;
}

export function nasaFy(v: string | undefined): string | undefined {
  const m = /FY\s?(\d{4})|FY\s?(\d{2})\b|\b(20\d{2})\b/i.exec(String(v || ''));
  if (!m) return undefined;
  const y = m[1] || (m[2] ? `20${m[2]}` : m[3]);
  const n = Number(y);
  return n >= 2020 && n <= 2040 ? `FY${y}` : undefined;
}

export interface NasaParseResult { rows: NasaForecastRow[]; skipped: number }

/** Parse the scraped grid: `header` row + body rows, both as string arrays. */
export function parseNasaForecast(header: string[], body: string[][]): NasaParseResult {
  const map = header.map(nasaFieldFor);
  const rows: NasaForecastRow[] = [];
  let skipped = 0;

  for (const r of body) {
    const get = (f: string) => { const i = map.indexOf(f); return i === -1 ? undefined : nasaCell(r[i]); };
    const title = get('title');
    // A row with no requirement title is grid furniture, not an opportunity.
    if (!title || title.length < 5) { skipped++; continue; }

    const raw: Record<string, string> = {};
    header.forEach((h, i) => { const v = (r[i] || '').trim(); if (h && v) raw[h] = v; });

    const valueRange = get('value');
    const val = nasaValueRange(valueRange);
    const q = get('quarter');

    rows.push({
      buyingOffice: get('office'),
      status: get('status'),
      phase: get('phase'),
      title,
      requirementType: get('reqType'),
      naicsCode: (get('naics') || '').match(/\b(\d{6})\b/)?.[1],
      pscCode: get('psc'),
      valueRange,
      valueMin: val.min,
      valueMax: val.max,
      newOrRecompete: get('newRecompete'),
      setAside: nasaSetAside(get('setAside')),
      quarter: (q || '').match(/Q[1-4]/i)?.[0]?.toUpperCase(),
      fiscalYear: nasaFy(get('fy')) || nasaFy(q),
      raw,
    });
  }

  return { rows, skipped };
}

/**
 * Deterministic id. NASA supplies no record id, and titles repeat across
 * centers ("Institutional Services" at two centers is two requirements), so the
 * key is center + title + a content hash — the same lesson as USACE and NAVSUP.
 */
function shortHash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36).toUpperCase();
}

export function nasaExternalId(r: NasaForecastRow): string {
  const content = [r.title, r.naicsCode, r.valueRange, r.phase, r.newOrRecompete, r.quarter]
    .join('|').toUpperCase().replace(/\s+/g, ' ');
  const office = (r.buyingOffice || 'NASA').toUpperCase().replace(/[^A-Z0-9]+/g, '-').slice(0, 20);
  return `NASA-${office}-${shortHash(content)}`;
}
