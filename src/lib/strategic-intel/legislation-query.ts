/**
 * Deterministic query resolution for get_legislation_status.
 *
 * Resolves a free-text question to ONE legislative identity, in a fixed order:
 *   public law → committee report → bill number → fiscal-year NDAA → "the NDAA" → unresolved.
 * Exact patterns only. There is NO title-similarity matching: two different bills must
 * never merge because their titles look alike.
 *
 * It also detects a CONTENT request ("what does it say about X", "which provisions",
 * "what changed between…"). Mindy holds no bill text, so a content request is returned
 * to the caller to be answered with `content_status: NOT_HELD` — never with a title search.
 */

export type LegislationQuery =
  | { kind: 'public_law'; congress: number; number: number }
  | { kind: 'committee_report'; chamber: 'House' | 'Senate'; congress: number; number: number; errata: boolean }
  | { kind: 'bill'; billType: 'HR' | 'S'; number: number; congress: number | null; reportsOnly: boolean }
  | { kind: 'fy_vehicle'; fiscalYear: number; congress: number | null }
  | { kind: 'all_vehicles'; congress: number | null }
  | { kind: 'unresolved' };

export interface ContentRequest {
  terms: string[];
  kind: 'topic' | 'section' | 'comparison';
}

export interface ParsedLegislationQuery {
  query: LegislationQuery;
  content_request: ContentRequest | null;
}

const PUBLIC_LAW_RE = /\b(?:P\.?\s?L\.?|Pub(?:lic)?\.?\s*L(?:aw)?\.?)\s*(?:No\.?\s*)?(\d{2,3})\s*[-–]\s*(\d{1,4})\b/i;
const REPORT_RE = /\b([HS])\.?\s*R(?:e?pt|ept)\.?\s*(?:No\.?\s*)?(\d{2,3})\s*[-–]\s*(\d{1,5})\b/i;
// "H.R. 8800", "HR8800", "H. R. 8800", "S. 4784", "S 4784". The lookbehind stops "U.S. 1"
// or a word ending in s/h from matching.
const BILL_RE = /(?<![A-Za-z.])(H\.?\s?R\.?|S\.?)\s?(\d{1,5})\b/i;
const CONGRESS_RE = /\b(1\d{2})(?:st|nd|rd|th)\s+Congress\b/i;
const NDAA_RE = /\bNDAA\b|national\s+defen[cs]e\s+authori[sz]ation/i;
const FY4_RE = /\b(?:FY\s?'?|fiscal\s+year\s+)?(20\d{2})\b/i;
const FY2_RE = /\bFY\s?'?(\d{2})\b/i;

/** Words that carry no topic: question / status / identity vocabulary. */
const STOP = new Set(`a an and or the of for to in on at by with from into is are was were be been being has have had
do does did what which who whom when where how why status state current currently latest now today yet still so far
law laws become became enacted enact passed pass signed sign show me give tell find get list look lookup up see
version versions mindy bill bills act acts ndaa national defense defence authorization authorisation fiscal year fy
house senate congress congressional committee report reports public pl pub errata erratum it its this that these those
there any all my our i we you your please can could would will should h r s hr rept no number th st nd rd legislation
legislative document documents record records stored hold held about the vs versus is there has been`.split(/\s+/));

const COMPARISON_RE = /\b(?:changed?|changes|differ(?:s|ent|ence|ences)?|compare[sd]?|comparison)\b/i;
const SECTION_RE = /\b(?:section|sec\.|§)\s*\d*/i;
const CONTENT_RE = /\b(?:say|says|said)\s+(?:about|on|regarding)\b|\b(?:require|requires|required|requirement|requirements|provision|provisions|direct|directs|mandate|mandates|contain|contains|include|includes|text|language|fund|funds|authorize|authorizes)\b/i;

function stripSpans(text: string, ...res: RegExp[]): string {
  let out = text;
  for (const re of res) out = out.replace(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'), ' ');
  return out;
}

export function detectContentRequest(remainder: string): ContentRequest | null {
  const comparison = COMPARISON_RE.test(remainder);
  const section = SECTION_RE.test(remainder);
  const verb = CONTENT_RE.test(remainder);
  const terms = remainder
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !/^\d+$/.test(w) && !STOP.has(w)
      && !/^(?:say|says|said|regarding|require|requires|required|requirement|requirements|provision|provisions|direct|directs|mandate|mandates|contain|contains|include|includes|text|language|section|changed|change|changes|between|differ|differs|different|difference|differences|compare|compared|comparison)$/.test(w));
  if (!comparison && !section && !verb && terms.length === 0) return null;
  return { terms, kind: comparison ? 'comparison' : section ? 'section' : 'topic' };
}

export function parseLegislationQuery(input: string): ParsedLegislationQuery {
  const text = String(input ?? '').trim();
  const congressHit = text.match(CONGRESS_RE);
  const congress = congressHit ? Number(congressHit[1]) : null;

  let query: LegislationQuery = { kind: 'unresolved' };
  let remainder = text;

  const pl = text.match(PUBLIC_LAW_RE);
  const rpt = !pl ? text.match(REPORT_RE) : null;
  const bill = !pl && !rpt ? text.match(BILL_RE) : null;

  if (pl) {
    query = { kind: 'public_law', congress: Number(pl[1]), number: Number(pl[2]) };
    remainder = stripSpans(text, PUBLIC_LAW_RE);
  } else if (rpt) {
    query = {
      kind: 'committee_report',
      chamber: rpt[1].toUpperCase() === 'H' ? 'House' : 'Senate',
      congress: Number(rpt[2]),
      number: Number(rpt[3]),
      errata: /\berrat/i.test(text),
    };
    remainder = stripSpans(text, REPORT_RE);
  } else if (bill) {
    const type = bill[1].replace(/[.\s]/g, '').toUpperCase() === 'HR' ? 'HR' : 'S';
    query = {
      kind: 'bill', billType: type, number: Number(bill[2]), congress,
      reportsOnly: /\bcommittee\s+reports?\b|\breports?\b/i.test(text),
    };
    remainder = stripSpans(text, BILL_RE);
  } else if (NDAA_RE.test(text)) {
    const fy4 = text.match(FY4_RE);
    const fy2 = !fy4 ? text.match(FY2_RE) : null;
    const fiscalYear = fy4 ? Number(fy4[1]) : fy2 ? 2000 + Number(fy2[1]) : null;
    query = fiscalYear ? { kind: 'fy_vehicle', fiscalYear, congress } : { kind: 'all_vehicles', congress };
    remainder = stripSpans(text, NDAA_RE, FY4_RE, FY2_RE);
  }

  remainder = stripSpans(remainder, CONGRESS_RE);
  return { query, content_request: query.kind === 'unresolved' ? null : detectContentRequest(remainder) };
}

/** First calendar year of a Congress (the 119th convened in 2025). */
export function congressStartYear(congress: number): number {
  return 1789 + 2 * (congress - 1);
}

/**
 * The NDAA fiscal years a Congress's measures authorize: a Congress seated in year Y
 * writes the FY(Y+1) and FY(Y+2) bills — the 119th (2025) holds FY2026 and FY2027.
 */
export function fiscalYearsForCongress(congress: number): number[] {
  const y = congressStartYear(congress);
  return [y + 1, y + 2];
}
