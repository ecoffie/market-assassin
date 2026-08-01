/**
 * Navy LRAE (Long Range Acquisition Estimate) — the combined DON-wide forecast.
 *
 * THE TERM WAS THE KEY. Every navy.mil and af.mil host WAFs an unattended fetch,
 * so searching for "Navy procurement forecast" dead-ends. The Navy does not call
 * it a forecast — it is a Long Range Acquisition Estimate, and secnav.navy.mil
 * publishes one COMBINED workbook covering every command:
 *
 *   secnav.navy.mil/smallbusiness/Documents/Combined LRAE_<MM.YYYY>.xlsx
 *
 * 9,922 rows in the Feb 2026 edition — NAVSUP WSS 2,649, NAVFAC regions ~2,180
 * (Mid-Atlantic 852, Far East 485, Washington 265, Southwest 206, Southeast 160,
 * Hawaii 144, Northwest 119), plus NAVSEA, NAVAIR, NAVWAR and USMC.
 *
 * Richest source we hold: incumbent + existing contract number, solicitation AND
 * award fiscal year + quarter, NAICS, PSC, value band, place of performance, and
 * TWO named POCs with emails (FAR 5.404-1(b)(4) requires them).
 */

/** Header text → canonical key. Matched by NAME because the Navy renumbers
 *  columns between editions and appends FAR citations to header labels. */
export function lraeFieldFor(header: string): string | null {
  const h = header.toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!h) return null;
  if (h.startsWith('requirement title')) return 'title';
  if (h.startsWith('requirement description')) return 'description';
  if (h.includes('program or requirement office')) return 'office';
  if (h.includes('total value')) return 'value';
  if (h.includes('procurement method')) return 'method';
  if (h.includes('contract type')) return 'contracttype';
  if (h.includes('contracting office uic')) return 'uic';
  if (h.includes('solicitation') && h.includes('fiscal year')) return 'solfy';
  if (h.includes('solicitation') && h.includes('quarter')) return 'solq';
  if (h.includes('award') && h.includes('fiscal year')) return 'awardfy';
  if (h.includes('award') && h.includes('quarter')) return 'awardq';
  if (h.includes('existing contract number')) return 'contractnum';
  if (h.includes('incumbent')) return 'incumbent';
  if (h.includes('place of performance')) return 'pop';
  if (h.includes('naics')) return 'naics';
  if (h.includes('psc')) return 'psc';
  if (h.startsWith('contracting poc name')) return 'pocname';
  if (h.startsWith('contracting poc e mail') || h.startsWith('contracting poc email')) return 'poccontact';
  if (h.includes('follow on or new')) return 'followon';
  return null;
}

export interface LraeRow {
  title: string;
  description?: string;
  programOffice?: string;
  dodaac?: string;
  officeLabel?: string;
  naicsCode?: string;
  naicsDescription?: string;
  pscCode?: string;
  valueRange?: string;
  valueMin?: number;
  valueMax?: number;
  setAside?: string;
  contractType?: string;
  solicitationFy?: string;
  solicitationQuarter?: string;
  awardFy?: string;
  awardQuarter?: string;
  incumbentName?: string;
  incumbentContractNumber?: string;
  popState?: string;
  popRaw?: string;
  pocName?: string;
  pocEmail?: string;
  pocPhone?: string;
  isFollowOn?: boolean;
  raw: Record<string, string>;
}

const BLANK = /^(tbd|tbd\.|n\/?a|na|none|unknown|-{1,}|\.)$/i;

export function lraeCell(v: unknown): string | undefined {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (!s || BLANK.test(s)) return undefined;
  return s;
}

/**
 * Pull the DoDAAC out of a UIC cell.
 *
 * Only 38% of rows carry a bare 6-char code; the rest embed it with a label —
 * "N00024: NAVSEA HQ", "M00318 - MCIPAC", "M00263 RCO Parris Island". Taking
 * the field verbatim would drop the join for the majority of rows.
 *
 * A cell listing SEVERAL UICs ("M33000, M93737, M34000") is deliberately left
 * unresolved: picking the first would silently attribute the requirement to one
 * arbitrary office.
 */
export function dodaacFromUic(v: string | undefined): { dodaac?: string; label?: string } {
  const s = (v || '').trim();
  if (!s) return {};
  // Multiple codes → ambiguous, don't guess.
  if (/[A-Z0-9]{6}\s*[,&]\s*[A-Z0-9]{6}/i.test(s)) return { label: s };
  const m = /^([A-Z][A-Z0-9]{5})\b/i.exec(s);
  if (!m) return { label: s };
  const rest = s.slice(m[1].length).replace(/^[\s:,\-–]+/, '').trim();
  return { dodaac: m[1].toUpperCase(), label: rest || undefined };
}

/** "541611 - ADMINISTRATIVE MANAGEMENT..." → code + description. */
export function splitCodeLabel(v: string | undefined): { code?: string; label?: string } {
  const s = (v || '').trim();
  if (!s) return {};
  const m = /^([A-Z0-9]{3,6})\s*[-–:]\s*(.+)$/i.exec(s);
  if (m) return { code: m[1].toUpperCase(), label: m[2].trim() };
  return /^[A-Z0-9]{3,6}$/i.test(s) ? { code: s.toUpperCase() } : { label: s };
}

/** "Arlington, VA" / "Norfolk, Virginia" → 2-letter state. */
const STATES: Record<string, string> = {
  alabama:'AL',alaska:'AK',arizona:'AZ',arkansas:'AR',california:'CA',colorado:'CO',
  connecticut:'CT',delaware:'DE',florida:'FL',georgia:'GA',hawaii:'HI',idaho:'ID',
  illinois:'IL',indiana:'IN',iowa:'IA',kansas:'KS',kentucky:'KY',louisiana:'LA',
  maine:'ME',maryland:'MD',massachusetts:'MA',michigan:'MI',minnesota:'MN',
  mississippi:'MS',missouri:'MO',montana:'MT',nebraska:'NE',nevada:'NV',
  'new hampshire':'NH','new jersey':'NJ','new mexico':'NM','new york':'NY',
  'north carolina':'NC','north dakota':'ND',ohio:'OH',oklahoma:'OK',oregon:'OR',
  pennsylvania:'PA','rhode island':'RI','south carolina':'SC','south dakota':'SD',
  tennessee:'TN',texas:'TX',utah:'UT',vermont:'VT',virginia:'VA',washington:'WA',
  'west virginia':'WV',wisconsin:'WI',wyoming:'WY','district of columbia':'DC',
};
const CODES = new Set(Object.values(STATES));

export function lraeState(pop: string | undefined): string | undefined {
  if (!pop) return undefined;
  const m = /,\s*([A-Za-z]{2})\b\s*$/.exec(pop.trim());
  if (m && CODES.has(m[1].toUpperCase())) return m[1].toUpperCase();
  const l = pop.toLowerCase();
  for (const [name, code] of Object.entries(STATES)) {
    if (new RegExp(`\\b${name}\\b`).test(l)) return code;
  }
  return undefined;
}

/** "> $7.5M - < $50M" / "$100M - $250M" → bounds. */
export function lraeValueRange(v: string | undefined): { min?: number; max?: number } {
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
  let min = Math.min(...nums), max = Math.max(...nums);
  // Source typos exist: "> $250- < $1B" and ">$7.5 - < $50M" are missing the
  // magnitude suffix on the lower bound, so it parses to 250 and 7.5 — which
  // Postgres then rejects for a bigint column ("invalid input syntax ... 7.5").
  // A federal forecast is never bounded below $1,000. Drop the bad bound rather
  // than guess the intended magnitude: a missing min is honest, an invented one
  // is a fabricated fact on a card.
  const MIN_PLAUSIBLE = 1000;
  if (min < MIN_PLAUSIBLE) {
    if (max >= MIN_PLAUSIBLE) return { max: Math.round(max) };
    return {};
  }
  // Round: bigint columns reject a fractional value ("$1.5M" is fine, but a
  // stray decimal from a malformed cell is not).
  return { min: Math.round(min), max: Math.round(max) };
}

/** Procurement method → the app's set-aside vocabulary. */
export function lraeSetAside(method: string | undefined): string | undefined {
  const t = (method || '').toLowerCase();
  if (!t) return undefined;
  if (/8\s?\(?a\)?/.test(t)) return '8(a)';
  if (/sdvosb|service[-\s]?disabled/.test(t)) return 'SDVOSB';
  if (/hubzone/.test(t)) return 'HUBZone';
  if (/wosb|women[-\s]?owned|woman[-\s]?owned/.test(t)) return 'WOSB';
  if (/vosb|veteran[-\s]?owned/.test(t)) return 'VOSB';
  if (/small business/.test(t)) return 'Small Business';
  if (/full and open|unrestricted|competitive/.test(t)) return 'Full and Open';
  if (/sole source/.test(t)) return 'Sole Source';
  return undefined;
}

/** "2026" / "FY26" → "FY2026". */
export function lraeFy(v: string | undefined): string | undefined {
  const m = /(\d{4})|FY\s?(\d{2})/i.exec(String(v || ''));
  if (!m) return undefined;
  const y = m[1] || `20${m[2]}`;
  const n = Number(y);
  return n >= 2020 && n <= 2040 ? `FY${y}` : undefined;
}

export interface LraeParseResult {
  rows: LraeRow[];
  skipped: number;
  headerRow: number;
}

export function parseNavyLrae(aoa: unknown[][]): LraeParseResult {
  let headerRow = -1;
  for (let i = 0; i < Math.min(aoa.length, 12); i++) {
    const r = (aoa[i] || []).map(c => String(c ?? '').toLowerCase());
    if (r.some(c => c.includes('requirement title')) && r.filter(Boolean).length >= 5) { headerRow = i; break; }
  }
  if (headerRow === -1) return { rows: [], skipped: 0, headerRow: -1 };

  const headers = (aoa[headerRow] || []).map(h => String(h ?? '').replace(/\s+/g, ' ').trim());
  const map = headers.map(lraeFieldFor);
  const rows: LraeRow[] = [];
  let skipped = 0;

  for (let i = headerRow + 1; i < aoa.length; i++) {
    const r = aoa[i] || [];
    if (!r.some(c => String(c ?? '').trim())) continue;
    const get = (f: string) => { const j = map.indexOf(f); return j === -1 ? undefined : lraeCell(r[j]); };

    const title = get('title');
    if (!title || title.length < 5) { skipped++; continue; }

    const raw: Record<string, string> = {};
    headers.forEach((h, j) => { const v = String(r[j] ?? '').trim(); if (h && v) raw[h] = v; });

    const uic = dodaacFromUic(get('uic'));
    const naics = splitCodeLabel(get('naics'));
    const psc = splitCodeLabel(get('psc'));
    const val = lraeValueRange(get('value'));
    const pop = get('pop');
    const contact = get('poccontact');

    rows.push({
      title,
      description: get('description'),
      programOffice: get('office'),
      dodaac: uic.dodaac,
      officeLabel: uic.label,
      naicsCode: naics.code,
      naicsDescription: naics.label,
      pscCode: psc.code,
      valueRange: get('value'),
      valueMin: val.min,
      valueMax: val.max,
      setAside: lraeSetAside(get('method')),
      contractType: get('contracttype'),
      solicitationFy: lraeFy(get('solfy')),
      solicitationQuarter: (get('solq') || '').match(/Q[1-4]/i)?.[0]?.toUpperCase(),
      awardFy: lraeFy(get('awardfy')),
      awardQuarter: (get('awardq') || '').match(/Q[1-4]/i)?.[0]?.toUpperCase(),
      incumbentName: get('incumbent'),
      incumbentContractNumber: get('contractnum'),
      popRaw: pop,
      popState: lraeState(pop),
      pocName: get('pocname'),
      // One column holds EITHER an email or a phone — split on the '@'.
      pocEmail: contact && contact.includes('@') ? contact : undefined,
      pocPhone: contact && !contact.includes('@') ? contact : undefined,
      isFollowOn: /follow[-\s]?on/i.test(get('followon') || '') || undefined,
      raw,
    });
  }

  return { rows, skipped, headerRow };
}

/**
 * Deterministic id. Prefers the Navy's own contract number; falls back to
 * office+title for a new requirement that has no predecessor contract.
 */
/** Short, stable hash of a string — for fingerprinting row content. */
function shortHash(s: string): string {
  let h = 2166136261; // FNV-1a
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36).toUpperCase();
}

/**
 * Deterministic id for an LRAE row.
 *
 * NEITHER the contract number NOR the title is unique on its own:
 *   - NAVSUP WSS files hundreds of distinct requirements under one generic
 *     title (501 rows named "LI/SOC/FBW Procurement Requirement", each a
 *     different incumbent, 245 distinct descriptions);
 *   - and the same contract number recurs across different requirements
 *     (M0026421C0008 appears twice with different content).
 *
 * So the id is always ANCHOR + a hash of the row's identifying content. That
 * keeps it stable across monthly editions — the same requirement re-published
 * unchanged hashes the same and UPDATES — while separating rows that merely
 * share an anchor. Keying on either field alone silently dropped ~30% of the
 * file.
 */
export function lraeExternalId(r: LraeRow): string {
  const anchor = r.incumbentContractNumber
    ? `C:${r.incumbentContractNumber}`
    : `T:${r.dodaac || r.programOffice || ''}`;
  const content = [
    r.title,
    r.description || '',
    r.incumbentName || '',
    r.valueRange || '',
    r.popRaw || '',
    // TIMING is part of identity, not decoration. "Surface Ship Maintenance"
    // appears for FY2026 AND FY2027 at the same office — two distinct
    // procurement cycles. Without these, 100 real rows collapsed into each
    // other. Caught by auditing what the dedupe was actually merging.
    r.solicitationFy || '', r.solicitationQuarter || '',
    r.awardFy || '', r.awardQuarter || '',
    r.naicsCode || '', r.pscCode || '',
    r.contractType || '',
  ].join('|').toUpperCase().replace(/\s+/g, ' ').trim();
  // NOTE: POC name/email are deliberately NOT in the fingerprint. They differ
  // on ~61 otherwise-identical rows — the same requirement listed twice with a
  // different point of contact — and including them would store the same
  // opportunity twice. Incumbent IS included (above), because a different
  // incumbent means a different requirement.
  const clean = anchor.toUpperCase().replace(/[^A-Z0-9:]+/g, '-').replace(/^-|-$/g, '');
  return `NAVY-${clean.slice(0, 90)}-${shortHash(content)}`;
}
