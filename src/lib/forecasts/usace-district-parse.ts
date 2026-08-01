/**
 * Parse a USACE district acquisition-forecast document into forecast rows.
 *
 * WHY THIS IS A MANUAL DROP, NOT A SCRAPER (verified 2026-08-01):
 * USACE publishes forecasts as per-district PDFs/spreadsheets, and every
 * usace.army.mil host sits behind an Akamai edge WAF that returns 403 to
 * unattended fetches — the district PDFs, the HQ MILCON page, and the DoD
 * forecast page on business.defense.gov all block. There is no official feed:
 * acquisition.gov/procurement-forecasts is a link directory with no Army or
 * USACE entry and no consolidated dataset, and DHS APFS (the one real
 * unauthenticated forecast API, 739 records) is DHS-only.
 *
 * Defeating a WAF is not on the table. So the human downloads the file in a
 * browser — where it is served normally — and drops it in. This parser turns
 * that file into rows.
 *
 * DESIGN: extract what is present, never invent what is not. District layouts
 * differ (Albuquerque, LA District and New Orleans all publish different
 * shapes), so every field is optional and a row that cannot yield a title is
 * dropped rather than stored as a stub. A half-parsed forecast in the map is
 * worse than a missing one.
 */

/** One parsed forecast line. Only `title` is guaranteed. */
export interface UsaceForecastRow {
  title: string;
  description?: string;
  naicsCode?: string;
  estimatedValueMin?: number;
  estimatedValueMax?: number;
  setAside?: string;
  fiscalYear?: string;
  anticipatedQuarter?: string;
  solicitationDate?: string;
  contractType?: string;
  popState?: string;
  /** Raw source line(s), so a wrong parse is auditable rather than opaque. */
  raw: string;
}

export interface UsaceParseResult {
  rows: UsaceForecastRow[];
  /** Lines that looked like data but yielded no title — surfaced, not hidden. */
  skipped: number;
  /** Which extraction shape matched, for the operator's confidence. */
  layout: 'tabular' | 'labelled' | 'unknown';
}

/** "$1,500,000" / "1.5M" / "$250K" / "5,000,000.00" → number. */
export function parseMoney(s: string | null | undefined): number | undefined {
  if (!s) return undefined;
  const t = String(s).trim().replace(/[$,\s]/g, '');
  if (!t) return undefined;
  const m = /^([0-9]*\.?[0-9]+)\s*([KMB])?$/i.exec(t);
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return undefined;
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] || '').toUpperCase() as 'K' | 'M' | 'B'];
  return mult ? n * mult : n;
}

/**
 * A value RANGE ("$1M - $5M", "Between $250,000 and $1,000,000").
 * USACE forecasts quote ranges far more often than point estimates, and
 * collapsing a range to one number would overstate precision.
 */
export function parseMoneyRange(s: string | null | undefined): { min?: number; max?: number } {
  if (!s) return {};
  const t = String(s).replace(/between/i, ' ');
  // Pull the MONEY TOKENS out first rather than splitting the whole line on
  // "-": a forecast line is full of other hyphens ("Set-Aside", "Ohio River
  // Mile 604-610"), and splitting on them shredded the amounts. Caught by test.
  // Require an EXPLICIT money marker — a "$" or a K/M/B suffix. Matching bare
  // digit runs pulled in the NAICS (237990) and the fiscal year (2026) as
  // dollar amounts, which produced min=$2,026. Caught by test.
  const tokens = t.match(/\$\s?[\d,]+(?:\.\d+)?\s*[KMB]?\b|\b[\d,]+(?:\.\d+)?\s*[KMB]\b/gi) || [];
  const amounts = tokens
    .map(tok => parseMoney(tok))
    .filter((n): n is number => n !== undefined && n > 0);
  if (amounts.length >= 2) {
    // A range is the two extremes present on the line.
    return { min: Math.min(...amounts), max: Math.max(...amounts) };
  }
  if (amounts.length === 1) return { min: amounts[0], max: amounts[0] };
  return {};
}

/** 6-digit NAICS anywhere in the text. */
export function parseNaics(s: string | null | undefined): string | undefined {
  const m = /\b(\d{6})\b/.exec(String(s || ''));
  return m ? m[1] : undefined;
}

/** "FY26" / "FY 2026" / "2026" → "FY2026". */
export function parseFiscalYear(s: string | null | undefined): string | undefined {
  const t = String(s || '');
  const m = /\bFY\s?(\d{2,4})\b/i.exec(t) || /\b(20\d{2})\b/.exec(t);
  if (!m) return undefined;
  const y = m[1].length === 2 ? `20${m[1]}` : m[1];
  const n = Number(y);
  // Guard against a random 4-digit number being read as a year.
  return n >= 2020 && n <= 2040 ? `FY${y}` : undefined;
}

/** "Q1" / "1st Quarter" / "Quarter 3" → "Q1"/"Q3". */
export function parseQuarter(s: string | null | undefined): string | undefined {
  const t = String(s || '');
  const m = /\bQ([1-4])\b/i.exec(t) || /\b([1-4])(?:st|nd|rd|th)?\s*(?:QTR|Quarter)\b/i.exec(t)
    || /\bQuarter\s*([1-4])\b/i.exec(t);
  return m ? `Q${m[1]}` : undefined;
}

/**
 * Set-aside, normalised to the vocabulary the rest of the app uses.
 * Order matters: check the most specific first, since "8(a)" and "SDVOSB" both
 * contain "small business" in their long forms.
 */
export function parseSetAside(s: string | null | undefined): string | undefined {
  const t = String(s || '').toLowerCase();
  if (!t) return undefined;
  if (/\b8\s*\(?a\)?\b/.test(t)) return '8(a)';
  if (/sdvosb|service[-\s]?disabled/.test(t)) return 'SDVOSB';
  if (/\bhubzone\b/.test(t)) return 'HUBZone';
  if (/\bwosb\b|woman[-\s]?owned|women[-\s]?owned/.test(t)) return 'WOSB';
  if (/\bvosb\b|veteran[-\s]?owned/.test(t)) return 'VOSB';
  if (/small\s*business|\bsb\b|set[-\s]?aside/.test(t)) return 'Small Business';
  if (/full\s*(and|&)\s*open|unrestricted/.test(t)) return 'Full and Open';
  return undefined;
}

/** A date in any of the shapes districts use → ISO yyyy-mm-dd. */
export function parseDate(s: string | null | undefined): string | undefined {
  const t = String(s || '').trim();
  if (!t) return undefined;
  let m = /\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/.exec(t);
  if (m) {
    const [, mo, d, y] = m;
    const yy = y.length === 2 ? `20${y}` : y;
    const dt = `${yy}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
    return Number.isNaN(Date.parse(dt)) ? undefined : dt;
  }
  m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(t);
  if (m) return m[0];
  return undefined;
}

const NOISE = /^(page\s+\d+|.*continued.*|revised.*|as of .*|for informational purposes.*|the following.*subject to change.*)$/i;
const HEADER_HINT = /(project|requirement|description|title)/i;

/**
 * The document's own title line, which carries a fiscal year and therefore
 * passes the signal test — "USACE Louisville District FY2026-2028 Acquisition
 * Forecast" would otherwise be stored as a forecast whose title is the name of
 * the document. Caught by test, and worth keeping tight: these phrases only
 * appear in headers, never in a project name.
 */
const DOC_TITLE = /\b(acquisition|procurement)\s+forecast\b|\bforecast\s+(for|as of)\b|\bprocurement\s+plan\b/i;

/**
 * Split extracted text into candidate data lines.
 * PDF text extraction collapses table rows into single lines, so a "row" here
 * is a line that carries at least one hard signal (a NAICS, a dollar figure or
 * a date) plus enough prose to be a title.
 */
function candidateLines(text: string): string[] {
  return String(text || '')
    .split(/\r?\n/)
    .map(l => l.replace(/\s{2,}/g, '  ').trim())
    .filter(l => l.length >= 12 && !NOISE.test(l));
}

/** Does this line carry a real forecast signal, or is it prose/boilerplate? */
function hasSignal(line: string): boolean {
  const signals = [
    /\b\d{6}\b/,                    // NAICS
    /\$\s?[\d,]+/,                  // money
    /\bFY\s?\d{2,4}\b/i,            // fiscal year
    /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/, // date
    /\bQ[1-4]\b/i,
  ];
  return signals.filter(r => r.test(line)).length >= 1;
}

/**
 * Strip the recognised structured bits out of a line, leaving the title.
 * Deliberately conservative — if what remains is too short to be a real
 * project name, the caller drops the row rather than storing a fragment.
 */
function titleFrom(line: string): string {
  let t = line
    .replace(/\b\d{6}\b/g, ' ')
    .replace(/\$\s?[\d,]+(?:\.\d{2})?\s*(?:[KMB]\b)?/gi, ' ')
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, ' ')
    .replace(/\bFY\s?\d{2,4}\b/gi, ' ')
    .replace(/\bQ[1-4]\b/gi, ' ')
    // Set-aside labels. "8(a)" needs its own alternative WITHOUT a \b prefix —
    // \b before "8" then an optional ")" left the closing paren stranded, so
    // titles came out as "Roof Replacement ... ) Set-Aside".
    .replace(/8\s?\(\s?a\s?\)|\b8\s?a\b/gi, ' ')
    .replace(/\b(?:SDVOSB|HUBZone|WOSB|VOSB|small business|full and open|unrestricted)\b/gi, ' ')
    .replace(/\bset[-\s]?aside\b/gi, ' ')
    .replace(/[|;]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/^[-–—:,.\s]+|[-–—:,.\s]+$/g, '');
  // Collapse a trailing lone separator or stray punctuation.
  if (t.length > 200) t = t.slice(0, 200).trim();
  return t;
}

/**
 * Parse extracted document text into forecast rows.
 *
 * Returns `skipped` so a low yield is VISIBLE. A parser that silently returns
 * 3 rows from a 200-row PDF looks like a thin district rather than a broken
 * parser, and that is exactly the failure mode worth surfacing.
 */
export function parseUsaceForecastText(text: string): UsaceParseResult {
  const lines = candidateLines(text);
  const rows: UsaceForecastRow[] = [];
  let skipped = 0;
  let sawHeader = false;

  for (const line of lines) {
    // The document's own title passes hasSignal() (it carries a fiscal year),
    // so it must be excluded BEFORE the signal check, not after.
    if (DOC_TITLE.test(line)) { sawHeader = true; continue; }
    if (HEADER_HINT.test(line) && !hasSignal(line)) { sawHeader = true; continue; }
    if (!hasSignal(line)) continue;

    const title = titleFrom(line);
    if (title.length < 8) { skipped++; continue; }

    const money = parseMoneyRange(line);
    rows.push({
      title,
      naicsCode: parseNaics(line),
      estimatedValueMin: money.min,
      estimatedValueMax: money.max,
      setAside: parseSetAside(line),
      fiscalYear: parseFiscalYear(line),
      anticipatedQuarter: parseQuarter(line),
      solicitationDate: parseDate(line),
      raw: line,
    });
  }

  return {
    rows,
    skipped,
    layout: rows.length === 0 ? 'unknown' : sawHeader ? 'tabular' : 'labelled',
  };
}

/**
 * Deterministic external_id so a re-drop of the same document UPDATES rather
 * than duplicating. Keyed on district + title, not on row order, because a
 * republished PDF reorders rows freely.
 */
export function usaceExternalId(district: string, title: string): string {
  const slug = `${district}|${title}`
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120);
  return `USACE-${slug}`;
}
