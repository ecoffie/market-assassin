/**
 * Reconstruct records from a USACE district forecast published as a PDF of the
 * DA-format table (New Orleans "CEMVN Acq. Forecast", Sacramento "Procurement
 * Forecast FY26 Q3", and others in the same shape).
 *
 * WHY THIS EXISTS — the generic line-scanner corrupts these files.
 * PDF text extraction flattens the table, and two things break a line-at-a-time
 * parser:
 *   - the column HEADERS wrap across ~15 separate lines
 *   - every record SPILLS across 2-5 lines, with the title on the leading
 *     line(s) and the data tail on the last
 *
 * Run through the old parser, New Orleans produced 53 "rows" from 26 real
 * records, and the damage was not cosmetic:
 *   - naics=384351 — a PROJECT CODE lifted out of the title text; the real
 *     NAICS on that row is 237990
 *   - "$25-100M" read as $100.0M — the range collapsed to its ceiling, which
 *     overstates the floor by 4x
 *   - "Contract" became a standalone title, from a continuation fragment
 *
 * THE ANCHOR: a record's data tail always carries a 6-digit NAICS AND a dollar
 * amount. Measured on the live files — New Orleans 26/26 lines match, Sacramento
 * 100/100 — so the tail is found reliably, and everything between the previous
 * tail and this one is the title. That is a structural rule, not a heuristic
 * tuned to one file.
 *
 * The NAICS is taken ONLY from the data tail, never from the title text, which
 * is what stops project codes being read as industry codes.
 */
import { parseMoneyRange, parseFiscalYear, parseQuarter, parseSetAside } from './usace-district-parse';

export interface UsaceDaPdfRow {
  title: string;
  naicsCode?: string;
  estimatedValueMin?: number;
  estimatedValueMax?: number;
  estimatedValueRange?: string;
  setAside?: string;
  contractVehicle?: string;
  fiscalYear?: string;
  anticipatedQuarter?: string;
  popMonths?: number;
  raw: string;
}

/**
 * Program/portfolio labels that group rows in these PDFs. They are never a
 * requirement title on their own — "Civil Works" alone identifies nothing.
 * Anchored, so a real title that BEGINS with one ("Civil Works LSJ- Phase C-2
 * Levee Construction") is kept.
 */
const PROGRAM_LABEL = /^(civil works|operations|military|environmental|programs?|regulatory|planning|real estate|emergency management|construction|design)$/i;

export interface UsaceDaPdfResult {
  rows: UsaceDaPdfRow[];
  /** Data tails we found but could not give a title — surfaced, never hidden. */
  skipped: number;
}

/** A record's data tail: carries BOTH a 6-digit NAICS and a dollar amount. */
export function isDataTail(line: string): boolean {
  return /\b\d{6}\b/.test(line) && /\$/.test(line);
}

/**
 * Header/furniture lines that must never become part of a title.
 * These are the wrapped column headers, which arrive as short fragments.
 */
const FURNITURE = new RegExp(
  '^(anticipated|dollar value|contract period|of performance|naics|set-aside|decision|'
  + 'contract vehicle|\\(task/delivery|orders\\)|action/award|type|solicitation|date|'
  + 'award date|program|requirement|if follow-on|action,|current|contract|number|'
  + 'project title and description|item description|fiscal year.*|page \\d+.*|'
  + 'us army corps.*|usace .*district.*|.*procurement forecast.*|.*acquisition forecast.*)$',
  'i',
);

/**
 * Header fragments that appear INSIDE a line rather than as the whole line.
 *
 * The wrapped column headers run together with the first record's title, so the
 * top row of every file used to read "Project Title and Description Anticipated
 * of Performance NAICS CG BBA18 West Shore…". These are stripped from a title
 * before it is stored — the header block is never part of a project name.
 */
const HEADER_PHRASES = [
  'project title and description', 'item description', 'anticipated dollar value',
  'dollar value', 'contract period of performance', 'period of performance',
  'anticipated set-aside decision', 'set-aside decision', 'contract vehicle',
  '(task/delivery orders)', 'task/delivery', 'action/award type', 'action/ award type',
  'anticipated solicitation date', 'anticipated award date', 'solicitation date',
  'award date', 'if follow-on action', 'current contract number', 'anticipated',
  'of performance', 'requirement', 'program', 'naics', 'vehicle', 'type', 'action/',
];

export function stripHeaderPhrases(title: string): string {
  let t = ` ${title} `;
  for (const p of HEADER_PHRASES) {
    t = t.replace(new RegExp(`\\s${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s`, 'gi'), ' ');
  }
  return t.replace(/\s+/g, ' ').trim();
}

export function isFurniture(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (FURNITURE.test(t)) return true;
  // A bare fragment with no letters is not a title.
  if (!/[a-z]/i.test(t)) return true;
  return false;
}

/**
 * Extract the NAICS from the DATA TAIL only.
 *
 * Titles contain 6-digit project codes ("Construction WP 384351"), so reading a
 * 6-digit number from anywhere in the record invents an industry. The tail is
 * tab-delimited, so prefer a cell that is EXACTLY a 6-digit code; fall back to
 * the last 6-digit token before the set-aside text, never the first in the line.
 */
export function naicsFromTail(tail: string): string | undefined {
  const cells = tail.split('\t').map(c => c.trim());
  const exact = cells.find(c => /^\d{6}$/.test(c));
  if (exact) return exact;
  // No clean cell — take the 6-digit run that is its own token.
  const toks = tail.match(/(?<![\d.])\d{6}(?![\d.])/g);
  return toks?.length ? toks[toks.length - 1] : undefined;
}

/** "$25-100M" / "$1M - $5M" / "$250K - $500K" / "$100-250M" → bounds + label. */
export function valueFromTail(rawTail: string): { min?: number; max?: number; range?: string } {
  // PDFs carry Unicode dashes. "$5‐10M" uses U+2010 NON-BREAKING HYPHEN, not
  // ASCII "-", so a [-–] class missed it, the range regex fell through to the
  // single-amount branch, and the row stored $5 as BOTH floor and ceiling on a
  // $5-10M contract. Normalise every dash variant before matching.
  const tail = rawTail.replace(/[‐‑‒–—−]/g, '-');

  // Grab the money span as published so the card can show the real range.
  const m = /\$\s?[\d,.]+\s*[KMB]?\s*(?:-|to)\s*\$?\s?[\d,.]+\s*[KMB]?/i.exec(tail)
    || /\$\s?[\d,.]+\s*[KMB]?/i.exec(tail);
  if (!m) return {};
  const range = m[0].replace(/\s+/g, ' ').trim();

  // SHARED-SUFFIX shorthand: "$25-100M" means $25M to $100M, NOT $25 to $100M.
  // New Orleans writes ranges this way ("$100-250M", "$5-10M") while Sacramento
  // repeats the unit ("$1M - $5M"). parseMoneyRange only sees the suffix on the
  // SECOND number, so the floor came out as 25 dollars — a range spanning eight
  // orders of magnitude, and a $25 minimum on a $100M levee contract.
  // Whether the suffix is shared is decided by the NUMBERS, not by punctuation.
  // Both of these appear, and the "$" on the upper bound does not distinguish
  // them:
  //   "$100-$200M"  → $100M to $200M   (shared: 100 < 200, a sane 2x range)
  //   "$250-$1M"    → $250K to $1M     (NOT shared: 250 > 1, so sharing would
  //                                     invert the range)
  // Rule: apply the suffix to the lower bound only if the result still orders
  // correctly. My first attempt keyed on `(?!\$)` and got "$100-$200M" wrong —
  // storing a $100 floor on a levee project. The invariant check caught it.
  const shared = /^\$?\s?([\d,.]+)\s*(?:-|to)\s*\$?\s?([\d,.]+)\s*([KMB])$/i.exec(range);
  if (shared) {
    const mult = { K: 1e3, M: 1e6, B: 1e9 }[shared[3].toUpperCase() as 'K' | 'M' | 'B'];
    const loRaw = parseFloat(shared[1].replace(/,/g, ''));
    const hi = parseFloat(shared[2].replace(/,/g, '')) * mult;
    if (Number.isFinite(loRaw) && Number.isFinite(hi)) {
      const lo = loRaw <= parseFloat(shared[2].replace(/,/g, '')) ? loRaw * mult : loRaw;
      return order(Math.round(lo), Math.round(hi), range);
    }
  }

  const b = parseMoneyRange(range);
  return order(b.min, b.max, range);
}

/**
 * A range whose floor exceeds its ceiling is a PARSE failure, not a real bound.
 * Rather than store it inverted — which no downstream filter would catch — put
 * the smaller number first and keep the published text so the row stays
 * auditable. This is the guard that would have caught "$250-$1M" on its own.
 */
function order(min: number | undefined, max: number | undefined, range: string) {
  if (min != null && max != null && min > max) return { min: max, max: min, range };
  // An implausible FLOOR is dropped, and the ceiling kept. "$250-$1M" omits the
  // unit on the lower bound entirely — it means $250K, but the text does not
  // say so, and inferring "K" here would be inventing a figure the government
  // did not publish. A federal forecast is never floored at $250, so storing
  // that is worse than storing nothing: the published range string survives on
  // the card either way.
  if (min != null && min < 1000) return { min: undefined, max, range };
  return { min, max, range };
}

/**
 * Is this line the WRAPPED REMAINDER of the record above, rather than the start
 * of the next title?
 *
 * Shape-based, not a vocabulary list. The trailing columns of a DA row are
 * set-aside / vehicle / award-type / FY-quarter, so a continuation is
 * characterised by what it LACKS — it carries no descriptive prose. A record
 * title always names a thing ("Englebright HQ Building"); a continuation is
 * procurement boilerplate and timing tokens.
 *
 * Sacramento wraps differently from New Orleans ("alone) IFB \tFY26 Q1 \tFY26
 * Q3" vs "Woman / Owned Set / Aside"), so matching on a fixed word list fixed
 * one file and left the other leaking the previous record's tail into the next
 * title. The test is: strip every known boilerplate/timing token — if nothing
 * meaningful is left, it is a continuation.
 */
const BOILERPLATE = new RegExp(
  '\\b(n/?a|tbd|contract|stand|alone\\)?|\\(to\\)|to|task|order|delivery|orders|'
  + 'woman|owned|aside|set|small|business|unrestricted|8\\(a\\)|hubzone|sdvosb|vosb|'
  + 'wosb|edwosb|sba|ifb|rfp|rfq|matoc|satoc|idiq|bpa|c-type|type|competitive|'
  + 'sole|source|full|open|competition|multiple|award|awards|iaw|far)\\b',
  'gi',
);

export function isContinuationFragment(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  const stripped = t
    .replace(/FY\s?\d{2,4}/gi, ' ')      // FY26 / FY2026
    .replace(/\bQ[1-4]\b/gi, ' ')        // Q1..Q4
    .replace(BOILERPLATE, ' ')
    .replace(/[^A-Za-z]+/g, ' ')         // punctuation, digits, tabs
    .replace(/\s+/g, ' ')
    .trim();
  // Nothing descriptive survived → it belonged to the row above.
  // A short leftover ("IFB", "TO") is still boilerplate; real titles are longer.
  return stripped.length <= 3;
}

/**
 * Join wrapped lines back into records.
 *
 * Walks the lines; when a DATA TAIL is found, everything since the previous
 * record (minus furniture) is that record's title.
 */
export function parseUsaceDaPdf(text: string): UsaceDaPdfResult {
  const lines = text.split('\n').map(l => l.replace(/\s+$/, ''));
  const rows: UsaceDaPdfRow[] = [];
  let skipped = 0;
  let titleBuf: string[] = [];
  // The record currently being built. Its data tail can CONTINUE across the
  // following lines — "Woman / Owned Set / Aside / N/A Stand Alone / Contract
  // FY26 Q2" all belong to the record ABOVE, not the one below. Attributing
  // them forward is what put "Contract FY26 Q2" at the head of the next title
  // and dropped the fiscal year to 4%.
  let pending: { tail: string[] } | null = null;

  const flush = () => {
    if (!pending) return;
    const tail = pending.tail.join(' ');
    const title = stripHeaderPhrases(
      titleBuf.join(' ').replace(/\s*\|\s*/g, ' — ').replace(/\s+/g, ' ').trim(),
    ).replace(/\s+N\/A$/i, '').trim();   // trailing "N/A" is an empty column, not a name
    titleBuf = [];
    pending = null;
    // A title that is only a PROGRAM LABEL names no requirement. Sacramento's
    // sheet is grouped by program, so "Civil Works" / "Operations" / "Military"
    // appear as bare cells on many rows — storing them produced three different
    // requirements all titled "Civil Works", which then collided on external_id
    // and merged into one row with another row's dollar values. Caught by the
    // oracle, not by inspection.
    if (!title || title.length < 8 || PROGRAM_LABEL.test(title)) { skipped++; return; }

    const val = valueFromTail(tail);
    const months = /\b(\d{1,3})\s*(?:months?|mos?)\b/i.exec(tail);
    rows.push({
      title,
      naicsCode: naicsFromTail(tail),
      estimatedValueMin: val.min,
      estimatedValueMax: val.max,
      estimatedValueRange: val.range,
      setAside: parseSetAside(tail),
      fiscalYear: parseFiscalYear(tail),
      anticipatedQuarter: parseQuarter(tail),
      popMonths: months ? Number(months[1]) : undefined,
      raw: tail.trim(),
    });
  };

  for (const line of lines) {
    if (isDataTail(line)) {
      // A new record starts here: close the previous one first, using the title
      // collected BEFORE this line.
      // Everything BEFORE the money column on this line belongs to the title.
      //
      // Cutting at the FIRST tab loses it when the record is fully inline:
      // Sacramento writes "Operations \t Englebright HQ Building \t N/A \t $10M
      // - $25M \t…", so a first-tab cut kept only the program label "Operations"
      // and threw the actual project name away. Split on tabs and keep every
      // cell up to the one holding the dollar amount.
      const cells = line.split('\t');
      const moneyAt = cells.findIndex(c => /\$/.test(c));
      const lead = (moneyAt > 0 ? cells.slice(0, moneyAt) : cells.slice(0, 1))
        .map(c => c.trim())
        .filter(c => c && !/^n\/?a$/i.test(c) && !isFurniture(c))
        .join(' ')
        .trim();
      const prevTitle = titleBuf.slice();
      titleBuf = [];
      if (pending) { titleBuf = prevTitle; flush(); }
      else titleBuf = prevTitle;
      // Whatever preceded the money on THIS line is the tail of this record's
      // own title.
      if (lead && !isFurniture(lead)) titleBuf.push(lead);
      pending = { tail: [line] };
      continue;
    }

    if (pending) {
      // Still inside the open record's wrapped tail? A continuation carries no
      // real prose — it is a set-aside fragment, a vehicle, or an FY/quarter.
      const t = line.trim();
      if (isContinuationFragment(t)) { pending.tail.push(t); continue; }
      // Real prose → the open record is finished and this begins the next title.
      flush();
    }

    if (!isFurniture(line)) titleBuf.push(line.trim());
  }
  flush();

  return { rows, skipped };
}
