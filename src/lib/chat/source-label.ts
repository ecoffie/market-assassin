/**
 * A stored source label shown to a customer or an MCP host without its research date (Eric, 2026-11-27: no dates in
 * customer-facing text). Strips a LEADING or TRAILING month-year ("Jun 2026 research", "SAM.gov, June 2026",
 * "2026-06 roster"); the stored label is untouched. A label that is nothing but the date and the word "research"
 * reads as "Mindy research". Null/empty stays null: unknown stays unknown.
 */
const MONTH = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const MONTH_YEAR = `(?:${MONTH}\\.?[\\s-]+20\\d\\d|20\\d\\d-(?:0[1-9]|1[0-2]))`;
const LEADING = new RegExp(`^\\s*${MONTH_YEAR}\\s*[,;:·-]?\\s*`, 'i');
const TRAILING = new RegExp(`\\s*[,;:·(-]?\\s*${MONTH_YEAR}\\s*\\)?\\s*$`, 'i');

export function displaySourceLabel(label: string | null | undefined): string | null {
  if (typeof label !== 'string' || !label.trim()) return null;
  const out = label.replace(LEADING, '').replace(TRAILING, '').trim();
  if (!out) return 'Mindy research';
  return /^research$/i.test(out) ? 'Mindy research' : out;
}
