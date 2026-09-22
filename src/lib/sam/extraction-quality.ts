/**
 * Detect extractions that SUCCEEDED mechanically but produced unusable text.
 *
 * Both cases below return a non-empty string and throw nothing, so every caller
 * reported them as a clean, COMPLETE read. That is the dangerous shape: a
 * downstream extractor handed 128 chars of boilerplate (or 3,884 chars of
 * mojibake) has no signal that the real content is missing, and an LLM asked to
 * find requirements in it will supply plausible federal boilerplate instead.
 *
 * Measured 2026-09-22 on DLA SPE60525R0222 (notice d441cf3c3ee048548057c9fd52499db9):
 *   Attachment C - DLA Energy CQAP.pdf → 1,796,570 bytes on disk, 1 page, 128 chars
 *     extracted: "For the best experience, open this PDF portfolio in Acrobat…".
 *     It is a PDF Portfolio; the real QAP files are nested inside the container.
 *   Updated Amendment 0003.pdf → 118,488 bytes, 2 pages, 3,884 chars extracted,
 *     only 26% of characters in the plain ASCII range — a font-subset encoding
 *     failure. This is the package's MOST RECENT amendment.
 */

/** A PDF Portfolio/Package cover sheet — the payload is nested, not extracted. */
export function isPdfPortfolioStub(text: string): boolean {
  if (text.length > 400) return false;
  return /pdf\s*(portfolio|package)/i.test(text) && /acrobat|adobe reader/i.test(text);
}

/**
 * Share of characters that are ordinary readable text.
 *
 * Measured by what is UNREADABLE rather than by an allow-list of "normal"
 * characters. An allow-list is the wrong shape here: a legitimate extracted
 * CLIN table drawn with box characters (│ ├ ─ ┼) scored 0.583 against one and
 * would have been suppressed as mojibake — reporting a real priced schedule as
 * "no usable text" and permanently blocking coverage.complete.
 *
 * What actually signals a font-subset failure is the presence of C0 control
 * codes, private-use-area codepoints and U+FFFD — characters that do not occur
 * in correctly extracted text at any meaningful rate. Everything else (accents,
 * CJK, box drawing, typographic punctuation, currency) counts as readable.
 */
export function readableRatio(text: string): number {
  if (!text) return 0;
  // C0 controls except tab/newline/CR, DEL, private use areas, replacement char.
  const unreadable = text.match(
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uE000-\uF8FF\uFFFD]/g,
  );
  return 1 - (unreadable ? unreadable.length : 0) / text.length;
}

/**
 * Below this, the text is not usable prose. Correctly extracted documents have
 * essentially NO control/private-use characters, so they measure ~1.00; the DLA
 * font-subset amendments measured 0.35–0.37 on the old metric and score far
 * below this on the new one. 0.9 keeps a wide margin from real text while still
 * catching a document that is mostly unmapped glyphs.
 */
export const MIN_READABLE_RATIO = 0.9;

export function isMojibake(text: string): boolean {
  // Needs enough characters to judge; a 20-char label proves nothing.
  if (text.length < 200) return false;
  return readableRatio(text) < MIN_READABLE_RATIO;
}

export type ExtractionQuality = 'ok' | 'container_stub' | 'unreadable_encoding';

export function classifyExtraction(text: string): ExtractionQuality {
  if (isPdfPortfolioStub(text)) return 'container_stub';
  if (isMojibake(text)) return 'unreadable_encoding';
  return 'ok';
}
