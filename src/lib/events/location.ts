/**
 * Event location — extraction (write side) and the display guard (read side).
 *
 * The extractor used `/(?:at|location:|venue:)/i` with no word boundary, so it matched the "at"
 * INSIDE words and stored the tail as a place: "solicitATion" → "ion announcement", "ATtached" →
 * "tached", "locATed at…" → "ed at…". Measured 2026-11-09 on a live VA query: 45 of 47 SAM rows
 * carried a fragment like that, including "ION     VIRTUAL INDUSTRY DAY NOTICE" on a real industry
 * day. The optional ", ST" suffix had the same flaw under /i ("Westheimer Road, Ga" from "Galveston"),
 * so it now ends on a word boundary too. Existing rows are NOT backfilled — the display guard is what keeps them off the screen.
 */

export function extractLocation(text: string): string | null {
  // Look for common location patterns
  const patterns = [
    /(?:\bat\b|\blocation:|\bvenue:)\s*([^,.\n]+(?:,\s*[A-Z]{2}\b)?)/i,
    /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*,\s*[A-Z]{2}\s*\d{5})/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }

  return null;
}

// Leading tokens that are the tail of a word the old extractor split on "at" — in either case,
// because SAM titles are often all caps ("ION     VIRTUAL INDUSTRY DAY NOTICE"). No real place
// name starts with one of these.
const WORD_TAIL_FRAGMENTS = new Set([
  'ion', 'ions', 'ional', 'ed', 'ement', 'ements', 'tached', 'tachment', 'tachments',
  'ive', 'egory', 'er', 'or',
]);

/**
 * Display guard: a stored event_location that does not look like a place becomes null. Showing a
 * fragment is worse than showing nothing. "Virtual" and similar online locations are kept.
 */
export function cleanEventLocation(v: unknown): string | null {
  const s = String(v ?? '').trim();
  if (!s || s.length > 60) return null;
  if (/number\s*:/i.test(s)) return null;          // "…ion Number: N6134027R1002"
  if (/^[a-z]/.test(s)) return null;               // starts mid-word = a truncation
  const first = s.split(/[^A-Za-z]/)[0].toLowerCase();
  if (WORD_TAIL_FRAGMENTS.has(first)) return null; // "ION     VIRTUAL INDUSTRY DAY NOTICE"
  if (/\b(notice|solicitation|sources sought|request for)\b/i.test(s)) return null; // notice text, not a place
  return s;
}
