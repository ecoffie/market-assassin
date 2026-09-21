/**
 * Parse the USACE ENTERPRISE forecast — the "DA Format" workbook.
 *
 * This is the single best USACE artifact we have found: ONE file, 2,126 rows,
 * 43 buying activities covering essentially every district (plus Huntsville
 * ESC, HECSA, ERDC and the Army Geospatial Center). It supersedes the
 * per-district scavenging — a division workbook covers 7 districts and a
 * district page covers 1, but this covers the enterprise.
 *
 * Crucially it carries a real "Buying / Requiring Activity" COLUMN, so the
 * office comes from published data rather than from the filename or the page
 * it was downloaded from. That is what makes one file safe to split across 43
 * offices.
 *
 * TWO TRAPS, both of which would put fabricated data on a user's screen:
 *
 *  1. "FYXXXX, Q4" is a LITERAL placeholder — the most common value in the
 *     solicitation-date column. It means "quarter known, year not". The year
 *     must be NULL; only the quarter survives. Reading FYXXXX as a year, or
 *     letting the X's fall through a loose \d{4} match, invents timing.
 *  2. Activity names are ABBREVIATED in the DoDAAC directory in ways no
 *     normaliser guesses: "Jacksonville District" is ENDIST JACKSNVLLE,
 *     "Ft Worth District" is ENDIST FT WORTH, "San Francisco" is ENDIST SAN
 *     FRAN. Matching on a cleaned name silently drops those districts, so the
 *     crosswalk below is explicit and anything unmapped is REPORTED, never
 *     quietly assigned to a plausible-looking office.
 */

/** "Buying / Requiring Activity" → dodaac_directory office_name. */
export const ACTIVITY_TO_OFFICE: Record<string, string> = {
  'alaska district': 'ENDIST ALASKA',
  'albuquerque district': 'ENDIST ALBUQUERQUE',
  'baltimore district': 'ENDIST BALTIMORE',
  'buffalo district': 'ENDIST BUFFALO',
  'caribbean district': 'ENDIST CARIBBEAN(PROVIS)',
  'charleston district': 'ENDIST CHARLESTON',
  'chicago district': 'ENDIST CHICAGO',
  'detroit district': 'ENDIST DETROIT',
  'ft worth district': 'ENDIST FT WORTH',
  'galveston district': 'ENDIST GALVESTON',
  'honolulu district': 'ENDIST HONOLULU',
  'huntington district': 'ENDIST HUNTINGTON',
  'jacksonville district': 'ENDIST JACKSNVLLE',   // NOT "JACKSONVILLE"
  'kansas cit district': 'ENDIST KANSAS CITY',    // published with the typo
  'kansas city district': 'ENDIST KANSAS CITY',
  'little rock district': 'ENDIST LITTLE ROCK',
  'los angeles district': 'ENDIST LOS ANGELES',
  'louisville district': 'ENDIST LOUISVILLE',
  'memphis district': 'ENDIST MEMPHIS',
  'mobile district': 'ENDIST MOBILE',
  'nashville district': 'ENDIST NASHVILLE',
  'new england district': 'ENDIST NEW ENGLAND',
  'new orleans district': 'ENDIST NEW ORLEANS',
  'new york district': 'ENDIST NEW YORK',
  'norfolk district': 'ENDIST NORFOLK',
  'omaha district': 'ENDIST OMAHA',
  'philadelphia district': 'ENDIST PHILADELPHIA',
  'pittsburgh district': 'ENDIST PITTSBURGH',
  'portland district': 'ENDIST PORTLAND',
  'rock island district': 'ENDIST ROCK ISLAND',
  'sacramento district': 'ENDIST SACRAMENTO',
  'san francisco district': 'ENDIST SAN FRAN',    // NOT "SAN FRANCISCO"
  'savannah district': 'ENDIST SAVANNAH',
  'seattle district': 'ENDIST SEATTLE',
  'st louis district': 'ENDIST ST LOUIS',
  'st paul district': 'ENDIST ST PAUL',
  'tulsa district': 'ENDIST TULSA',
  'vicksburg district': 'ENDIST VICKSBURG',
  // NOT "ENDIST WALLA WALLA" — this one is spelled out and TRUNCATED.
  'walla walla district': 'US ARMY ENGINEER DISTRICT WALLA WAL',
  'wilmington district': 'ENDIST WILMINGTON',
  // Non-district USACE commands that also publish into this file. Every one of
  // these was verified against dodaac_directory by hand: the obvious guesses
  // ("ENDIST HUNTSVILLE", "ARMY GEOSPATIAL CENTER") all MISS, and Huntsville is
  // the single largest office in the file at 327 rows — so a guess here would
  // have silently disconnected the biggest block of rows in the ingest.
  'engineering research & development ctr': 'USA ENGR R & D CTR',       // W912HZ
  'huntsville engineer & support ctr': 'USA ENG SPT CTR HUNTSVIL',      // W912DY, 44,284 awards
  'humphreys engineer ctr support activity': 'USA HECSA',               // W912HQ
  'army geospatial ctr': 'USA GEOSPATIAL CTR',                          // W5J9CQ
};

export function officeForActivity(activity: string | undefined): string | undefined {
  if (!activity) return undefined;
  const k = activity.toLowerCase().replace(/\s+/g, ' ').trim();
  return ACTIVITY_TO_OFFICE[k];
}

export interface UsaceDaRow {
  activity: string;
  office?: string;
  title: string;
  priorContractNumber?: string;
  valueRange?: string;
  valueMin?: number;
  valueMax?: number;
  popMonths?: number;
  naicsCode?: string;
  pscCode?: string;
  setAside?: string;
  awardType?: string;
  fiscalYear?: string;
  anticipatedQuarter?: string;
  solicitationDateRaw?: string;
  awardDateRaw?: string;
  contactEmail?: string;
  raw: Record<string, string>;
}

const BLANK = /^(tbd|tba|n\/?a|na|none|unknown|-+|\.)$/i;

export function daCell(v: unknown): string | undefined {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (!s || BLANK.test(s)) return undefined;
  return s;
}

export function daFieldFor(header: string): string | null {
  const h = header.toLowerCase().replace(/[^a-z0-9/ ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!h) return null;
  if (h.includes('project title')) return 'title';
  if (h.includes('prior contract number')) return 'priorcontract';
  if (h.includes('dollar value') || h.includes('idc capacity')) return 'value';
  if (h.includes('period of perform')) return 'pop';
  if (h.includes('naics')) return 'naicspsc';
  if (h.includes('set aside') || h.includes('set-aside')) return 'setaside';
  if (h.includes('action / award type') || h.includes('award type')) return 'awardtype';
  if (h.includes('solicitation date')) return 'solicitationdate';
  if (h.includes('award date')) return 'awarddate';
  if (h.includes('buying') || h.includes('requiring activity')) return 'activity';
  if (h.includes('contact information')) return 'contact';
  return null;
}

/** "$75,000,000 to $100,000,000" / "150000000" → bounds. */
export function daValueRange(v: string | undefined): { min?: number; max?: number } {
  if (!v) return {};
  const nums = (v.match(/[\d,]+(?:\.\d+)?/g) || [])
    .map(t => parseFloat(t.replace(/,/g, '')))
    .filter(n => Number.isFinite(n) && n > 0);
  if (!nums.length) return {};
  // A single bare number is a point estimate, not a range — record it as the
  // ceiling, which is how every other forecast source in this table reads.
  if (nums.length === 1) return { max: Math.round(nums[0]) };
  return { min: Math.round(Math.min(...nums)), max: Math.round(Math.max(...nums)) };
}

/**
 * "FY2026, Q4" → { fy: 'FY2026', q: 'Q4' }.
 * "FYXXXX, Q4" → { q: 'Q4' } — the year is a PLACEHOLDER, not a year.
 */
export function daTiming(v: string | undefined): { fy?: string; q?: string } {
  if (!v) return {};
  const out: { fy?: string; q?: string } = {};
  const qm = /Q\s?([1-4])/i.exec(v);
  if (qm) out.q = `Q${qm[1]}`;
  // Require four DIGITS. "FYXXXX" must not match, and must not fall through to
  // a looser pattern that finds a year elsewhere in the string.
  const ym = /FY\s?(\d{4})/i.exec(v);
  if (ym) {
    const n = Number(ym[1]);
    if (n >= 2020 && n <= 2040) out.fy = `FY${ym[1]}`;
  }
  return out;
}

/** "236220 / Y1JZ" → { naics: '236220', psc: 'Y1JZ' }. */
export function daNaicsPsc(v: string | undefined): { naics?: string; psc?: string } {
  if (!v) return {};
  const out: { naics?: string; psc?: string } = {};
  const n = /\b(\d{6})\b/.exec(v);
  if (n) out.naics = n[1];
  const p = /\/\s*([A-Z0-9]{2,4})\b/i.exec(v);
  if (p) out.psc = p[1].toUpperCase();
  return out;
}

export function daSetAside(v: string | undefined): string | undefined {
  const t = (v || '').toLowerCase();
  if (!t) return undefined;
  if (/8\s?\(?a\)?/.test(t)) return '8(a)';
  if (/sdvosb|service[- ]?disabled/.test(t)) return 'SDVOSB';
  if (/hubzone/.test(t)) return 'HUBZone';
  if (/wosb|women[- ]?owned|edwosb/.test(t)) return 'WOSB';
  if (/vosb|veteran[- ]?owned/.test(t)) return 'VOSB';
  if (/sb set[- ]?aside|small business set[- ]?aside|\bsb\b/.test(t)) return 'Small Business';
  if (/full & open|full and open|unrestricted/.test(t)) return 'Full and Open';
  return undefined;
}

export interface UsaceDaResult {
  rows: UsaceDaRow[];
  skipped: number;
  /** Activities with no office mapping — surfaced so a new one is never silently dropped. */
  unmappedActivities: Record<string, number>;
}

export function parseUsaceDaSheet(aoa: unknown[][]): UsaceDaResult {
  let headerIdx = -1;
  for (let i = 0; i < Math.min(aoa.length, 8); i++) {
    const mapped = (aoa[i] || []).map(c => daFieldFor(String(c ?? '')));
    if (mapped.includes('title') && mapped.includes('activity')) { headerIdx = i; break; }
  }
  if (headerIdx === -1) return { rows: [], skipped: 0, unmappedActivities: {} };

  const headers = (aoa[headerIdx] || []).map(h => String(h ?? ''));
  const map = headers.map(daFieldFor);
  const rows: UsaceDaRow[] = [];
  const unmappedActivities: Record<string, number> = {};
  let skipped = 0;

  for (let i = headerIdx + 1; i < aoa.length; i++) {
    const r = aoa[i] || [];
    if (!r.some(c => String(c ?? '').trim())) continue;
    const get = (f: string) => { const j = map.indexOf(f); return j === -1 ? undefined : daCell(r[j]); };

    const title = get('title');
    const activity = get('activity');
    // No title = not a forecast. No activity = we cannot attribute it to an
    // office, and an unattributed USACE row is not worth storing.
    if (!title || title.length < 5 || !activity) { skipped++; continue; }

    const office = officeForActivity(activity);
    if (!office) unmappedActivities[activity] = (unmappedActivities[activity] || 0) + 1;

    const raw: Record<string, string> = {};
    headers.forEach((h, j) => { const v = String(r[j] ?? '').trim(); if (h && v) raw[h] = v; });

    const valueRange = get('value');
    const val = daValueRange(valueRange);
    const solDate = get('solicitationdate');
    const timing = daTiming(solDate);
    const np = daNaicsPsc(get('naicspsc'));
    const months = Number(String(get('pop') ?? '').replace(/[^\d]/g, ''));

    rows.push({
      activity,
      office,
      title,
      priorContractNumber: get('priorcontract'),
      valueRange,
      valueMin: val.min,
      valueMax: val.max,
      popMonths: Number.isFinite(months) && months > 0 ? months : undefined,
      naicsCode: np.naics,
      pscCode: np.psc,
      setAside: daSetAside(get('setaside')),
      awardType: get('awardtype'),
      fiscalYear: timing.fy,
      anticipatedQuarter: timing.q,
      solicitationDateRaw: solDate,
      awardDateRaw: get('awarddate'),
      contactEmail: /@/.test(get('contact') || '') ? get('contact') : undefined,
      raw,
    });
  }

  return { rows, skipped, unmappedActivities };
}

/**
 * Deterministic id. The enterprise file has no record number, and the same
 * title recurs across activities ("Market Research" at two districts is two
 * requirements), so the key is office + a content hash — the same lesson as
 * USACE districts, NAVSUP and NASA.
 */
function shortHash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36).toUpperCase();
}

export function usaceDaExternalId(r: UsaceDaRow): string {
  const content = [r.title, r.naicsCode, r.valueRange, r.solicitationDateRaw, r.awardType, r.priorContractNumber]
    .join('|').toUpperCase().replace(/\s+/g, ' ');
  const office = (r.office || r.activity).toUpperCase().replace(/[^A-Z0-9]+/g, '-').slice(0, 28);
  return `USACE-DA-${office}-${shortHash(content)}`;
}
