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
 * Share of characters that are ordinary readable Latin text. A font-subset PDF
 * whose glyphs carry no usable ToUnicode map extracts as control characters and
 * private-use codepoints, driving this near zero.
 */
export function readableRatio(text: string): number {
  if (!text) return 0;
  const readable = text.match(/[A-Za-z0-9 .,;:()/\-\n\r\t'"$%&#]/g);
  return (readable ? readable.length : 0) / text.length;
}

/** Below this, the text is not usable prose. Real documents measure 0.98–1.00. */
export const MIN_READABLE_RATIO = 0.6;

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
