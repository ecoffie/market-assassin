/**
 * GSA Acquisition Gateway forecast export (acquisitiongateway.gov/forecast).
 *
 * THE GOV-WIDE TOOL. VA and DOT migrated their agency forecasts here as of
 * Oct 2025, which is why their own OSDBU pages went dark — the data did not
 * disappear, it moved. The tool is public (no login) and has an Export CSV
 * button; 44 columns, the richest schema of any source we ingest.
 *
 * A CORRECTION WORTH RECORDING: this source was written off twice as
 * login-gated. That conclusion came from probing `ag-dashboard.acquisitiongateway.gov`,
 * a DIFFERENT app that bounces to Login.gov (and to an identitysandbox.gov TEST
 * IdP at that). The public tool at www.acquisitiongateway.gov/forecast needs no
 * auth at all. Guessing at URLs and reading a 403/redirect as "closed" is the
 * mistake; find the real page, then watch what it actually calls.
 *
 * Every row carries a POC email — the existing scraped rows for these agencies
 * have ZERO — so this enriches as well as refreshes.
 */

export interface GatewayForecastRow {
  listingId?: string;
  title: string;
  description?: string;
  agency?: string;
  organization?: string;
  naicsCode?: string;
  popCity?: string;
  popState?: string;
  estimatedValueRange?: string;
  estimatedValueMin?: number;
  estimatedValueMax?: number;
  awardFy?: string;
  awardQuarter?: string;
  solicitationDate?: string;
  setAside?: string;
  contractType?: string;
  procurementMethod?: string;
  incumbentName?: string;
  pocName?: string;
  pocEmail?: string;
  sbSpecialistName?: string;
  sbSpecialistEmail?: string;
  requirementStatus?: string;
  acquisitionPhase?: string;
  raw: Record<string, string>;
}

const BLANK = /^(tbd|tba|n\/?a|na|none|unknown|null|-{1,}|\.)$/i;

export function gwCell(v: unknown): string | undefined {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (!s || BLANK.test(s)) return undefined;
  return s;
}

/** "$1,000,000 - $5,000,000" / "> $250K to < or = $750K" / "$25M" → bounds. */
export function gwValueRange(v: string | undefined): { min?: number; max?: number } {
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
  // Round + floor-check: a bigint column rejects fractions, and a federal
  // forecast bounded below $1,000 is a malformed cell, not a real figure.
  const min = Math.round(Math.min(...nums)), max = Math.round(Math.max(...nums));
  if (min < 1000) return max >= 1000 ? { max } : {};
  return { min, max };
}

/** "FY 2026 Q2" / "2026-Q3" / "FY26 Q1" → { fy, quarter }. */
export function gwAwardTiming(fyQtr: string | undefined, fyOnly: string | undefined): { fy?: string; quarter?: string } {
  const src = `${fyQtr || ''} ${fyOnly || ''}`;
  const fm = /FY\s?(\d{4})|FY\s?(\d{2})\b|\b(20\d{2})\b/i.exec(src);
  let fy: string | undefined;
  if (fm) {
    const y = fm[1] || (fm[2] ? `20${fm[2]}` : fm[3]);
    const n = Number(y);
    if (n >= 2020 && n <= 2040) fy = `FY${y}`;
  }
  const qm = /\bQ([1-4])\b/i.exec(src);
  return { fy, quarter: qm ? `Q${qm[1]}` : undefined };
}

/** Gateway set-aside text → the app's vocabulary. */
export function gwSetAside(v: string | undefined): string | undefined {
  const t = (v || '').toLowerCase();
  if (!t) return undefined;
  if (/8\s?\(?a\)?/.test(t)) return '8(a)';
  if (/sdvosb|service[-\s]?disabled/.test(t)) return 'SDVOSB';
  if (/hubzone/.test(t)) return 'HUBZone';
  if (/wosb|edwosb|women[-\s]?owned|woman[-\s]?owned/.test(t)) return 'WOSB';
  if (/vosb|veteran[-\s]?owned/.test(t)) return 'VOSB';
  if (/small business|\bsb\b|\bsbsa\b|total small/.test(t)) return 'Small Business';
  if (/full and open|unrestricted|full & open/.test(t)) return 'Full and Open';
  if (/sole source/.test(t)) return 'Sole Source';
  return undefined;
}

/** ISO date from the shapes the export uses. */
export function gwDate(v: string | undefined): string | undefined {
  const s = (v || '').trim();
  if (!s) return undefined;
  let m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(s);
  if (m) return m[0];
  m = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/.exec(s);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return undefined;
}

/** Header → canonical key. Matched by NAME; the export renames columns between
 *  releases and appends "Content: " prefixes to some. */
export function gwFieldFor(header: string): string | null {
  const h = header.toLowerCase().replace(/^content:\s*/, '').replace(/[^a-z0-9 ()]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!h) return null;
  if (h === 'listing id') return 'listingId';
  if (h === 'title') return 'title';
  if (h === 'description') return 'description';
  if (h === 'agency') return 'agency';
  if (h === 'organization') return 'organization';
  if (h.startsWith('naics')) return 'naics';
  if (h.includes('place of performance city')) return 'popCity';
  if (h.includes('place of performance state')) return 'popState';

  if (h === 'estimated contract value') return 'value';
  if (h.includes('estimated award fy qtr')) return 'awardFyQtr';
  if (h === 'estimated award fy') return 'awardFy';
  if (h.includes('estimated solicitation date')) return 'solDate';
  if (h.includes('set aside type')) return 'setAside';
  if (h === 'contract type') return 'contractType';
  if (h.includes('procurement method')) return 'method';
  if (h.includes('contractor name')) return 'incumbent';
  if (h.includes('point of contact (name)')) return 'pocName';
  if (h.includes('point of contact (email)')) return 'pocEmail';
  if (h.includes('small business specialist info (name')) return 'sbsName';
  if (h.includes('small business specialist info (email')) return 'sbsEmail';
  if (h.includes('requirement status')) return 'status';
  if (h.includes('acquisition phase')) return 'phase';
  return null;
}

export function parseGatewayRow(rec: Record<string, string>): GatewayForecastRow | null {
  const get = (field: string): string | undefined => {
    for (const [h, v] of Object.entries(rec)) {
      if (gwFieldFor(h) === field) return gwCell(v);
    }
    return undefined;
  };
  const title = get('title');
  if (!title || title.length < 4) return null;

  const val = gwValueRange(get('value'));
  const timing = gwAwardTiming(get('awardFyQtr'), get('awardFy'));

  return {
    listingId: get('listingId'),
    title,
    description: get('description'),
    agency: get('agency'),
    organization: get('organization'),
    naicsCode: (get('naics') || '').match(/\b(\d{6})\b/)?.[1],
    popCity: get('popCity'),
    popState: normalizeGatewayState(get('popState')),
    estimatedValueRange: get('value'),
    estimatedValueMin: val.min,
    estimatedValueMax: val.max,
    awardFy: timing.fy,
    awardQuarter: timing.quarter,
    solicitationDate: gwDate(get('solDate')),
    setAside: gwSetAside(get('setAside')),
    contractType: get('contractType'),
    procurementMethod: get('method'),
    incumbentName: get('incumbent'),
    pocName: get('pocName'),
    pocEmail: get('pocEmail'),
    sbSpecialistName: get('sbsName'),
    sbSpecialistEmail: get('sbsEmail'),
    requirementStatus: get('status'),
    acquisitionPhase: get('phase'),
    raw: rec,
  };
}

/**
 * Deterministic id. Gateway's own Listing ID is the stable key when present;
 * otherwise agency + title + a content hash, because titles repeat across
 * organizations (the same lesson as USACE and NAVSUP).
 */
function shortHash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36).toUpperCase();
}

export function gatewayExternalId(r: GatewayForecastRow): string {
  if (r.listingId) return `GW-L:${r.listingId.toUpperCase().replace(/[^A-Z0-9]+/g, '-')}`.slice(0, 120);
  const content = [r.agency, r.organization, r.title, r.description, r.naicsCode, r.awardFy, r.popState]
    .join('|').toUpperCase().replace(/\s+/g, ' ');
  return `GW-T:${(r.agency || '').toUpperCase().replace(/[^A-Z0-9]+/g, '-').slice(0, 40)}-${shortHash(content)}`;
}

/** Gateway agency label → the source_agency code the table already uses. */
export function gatewayAgencyCode(agency: string | undefined): string {
  const a = (agency || '').toLowerCase();
  if (a.includes('agriculture')) return 'USDA';
  if (a.includes('veterans')) return 'VA';
  if (a.includes('general services')) return 'GSA';
  if (a.includes('interior')) return 'DOI';
  if (a.includes('transportation')) return 'DOT';
  if (a.includes('labor')) return 'DOL';
  if (a.includes('energy')) return 'DOE';
  if (a.includes('homeland')) return 'DHS';
  if (a.includes('health')) return 'HHS';
  if (a.includes('treasury')) return 'Treasury';
  if (a.includes('justice')) return 'DOJ';
  if (a.includes('commerce')) return 'Commerce';
  if (a.includes('state')) return 'State';
  return (agency || 'GATEWAY').slice(0, 24);
}

/** Full state NAME → USPS code. The Gateway export mixes both forms. */
const STATE_NAMES: Record<string, string> = {
  ALABAMA: 'AL', ALASKA: 'AK', ARIZONA: 'AZ', ARKANSAS: 'AR', CALIFORNIA: 'CA',
  COLORADO: 'CO', CONNECTICUT: 'CT', DELAWARE: 'DE', FLORIDA: 'FL', GEORGIA: 'GA',
  HAWAII: 'HI', IDAHO: 'ID', ILLINOIS: 'IL', INDIANA: 'IN', IOWA: 'IA',
  KANSAS: 'KS', KENTUCKY: 'KY', LOUISIANA: 'LA', MAINE: 'ME', MARYLAND: 'MD',
  MASSACHUSETTS: 'MA', MICHIGAN: 'MI', MINNESOTA: 'MN', MISSISSIPPI: 'MS',
  MISSOURI: 'MO', MONTANA: 'MT', NEBRASKA: 'NE', NEVADA: 'NV',
  'NEW HAMPSHIRE': 'NH', 'NEW JERSEY': 'NJ', 'NEW MEXICO': 'NM', 'NEW YORK': 'NY',
  'NORTH CAROLINA': 'NC', 'NORTH DAKOTA': 'ND', OHIO: 'OH', OKLAHOMA: 'OK',
  OREGON: 'OR', PENNSYLVANIA: 'PA', 'RHODE ISLAND': 'RI', 'SOUTH CAROLINA': 'SC',
  'SOUTH DAKOTA': 'SD', TENNESSEE: 'TN', TEXAS: 'TX', UTAH: 'UT', VERMONT: 'VT',
  VIRGINIA: 'VA', WASHINGTON: 'WA', 'WEST VIRGINIA': 'WV', WISCONSIN: 'WI',
  WYOMING: 'WY', 'DISTRICT OF COLUMBIA': 'DC', 'PUERTO RICO': 'PR',
  'VIRGIN ISLANDS': 'VI', 'U.S. VIRGIN ISLANDS': 'VI', GUAM: 'GU',
  'AMERICAN SAMOA': 'AS', 'NORTHERN MARIANA ISLANDS': 'MP',
};

const USPS = new Set(Object.values(STATE_NAMES));

/**
 * Normalise the Gateway's place-of-performance state.
 *
 * THE BUG (found 2026-08-02 by the map-coverage audit): this was a blind
 * `.trim().toUpperCase().slice(0, 2)`, which assumes the column holds USPS
 * codes. It often holds the full NAME, so slicing produced the first two
 * letters of a word and wrote ~670 rows of nonsense across DOI, GSA, DOT and
 * USDA:
 *
 *   "District of Columbia" → "DI"      "Tennessee"      → "TE"
 *   "Pennsylvania"         → "PE"      "Kansas"         → "KA"
 *   "Georgia"              → "GE"      "Louisiana"      → "LO"
 *   "North Carolina"       → "NO"      "South Carolina" → "SO"
 *
 * None of those geocode, so the rows silently lost their location. Worse, the
 * truncation is LOSSY and ambiguous — "NO" could be North Carolina or North
 * Dakota — so the damage cannot be repaired in place; the fix is here, then a
 * re-ingest.
 *
 * A real 2-letter USPS code still passes through untouched. Anything that is
 * neither a known name nor a valid code returns undefined rather than a
 * truncated guess.
 */
export function normalizeGatewayState(raw: string | undefined): string | undefined {
  const s = String(raw ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
  if (!s) return undefined;
  if (STATE_NAMES[s]) return STATE_NAMES[s];
  if (/^[A-Z]{2}$/.test(s) && USPS.has(s)) return s;
  // "VIRGINIA (VA)" / "TEXAS - TX" — take a parenthesised or trailing code.
  const code = /\b([A-Z]{2})\b\s*\)?$/.exec(s);
  if (code && USPS.has(code[1])) return code[1];
  return undefined;
}
