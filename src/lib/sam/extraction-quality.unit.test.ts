/**
 * Extractions that succeed mechanically but return unusable text.
 *
 * THE DEFECT: both shapes below return a non-empty string and throw nothing, so
 * they were reported as clean COMPLETE reads. A downstream extractor handed
 * them has no signal the real content is missing — which is how a compliance
 * matrix comes back citing a "Section L.3.2" that the solicitation never had.
 *
 * Fixtures are the REAL measured values from DLA SPE60525R0222
 * (notice d441cf3c3ee048548057c9fd52499db9), 2026-09-22.
 */
import { describe, it, expect } from 'vitest';
import { classifyExtraction, isPdfPortfolioStub, isMojibake, readableRatio, hasSymbolEncodedBody, MIN_READABLE_RATIO } from './extraction-quality';

// Attachment C - DLA Energy CQAP.pdf: 1,796,570 bytes on disk → 128 chars.
const PORTFOLIO_STUB =
  'For the best experience, open this PDF portfolio in\nAcrobat X or Adobe Reader X, or later.';

// Updated Amendment 0003.pdf: 118,488 bytes, 2 pages → 3,884 chars at ratio 0.35.
const MOJIBAKE = '\u0000\t\u0000\t\u0002\u0003\u0004\u0005\u0006\u0007\u000e\u0010\u0011\u0012\u0013'.repeat(40);

describe('container stubs', () => {
  it('a PDF Portfolio cover sheet is not the document', () => {
    expect(isPdfPortfolioStub(PORTFOLIO_STUB)).toBe(true);
    expect(classifyExtraction(PORTFOLIO_STUB)).toBe('container_stub');
  });

  it('a real document that merely MENTIONS Acrobat is not a stub', () => {
    const real = `Submit the completed form. ${'Requirements follow. '.repeat(60)} Open in Adobe Reader if needed.`;
    expect(isPdfPortfolioStub(real)).toBe(false);
    expect(classifyExtraction(real)).toBe('ok');
  });
});

describe('unreadable encoding', () => {
  it('font-subset mojibake is detected', () => {
    expect(readableRatio(MOJIBAKE)).toBeLessThan(MIN_READABLE_RATIO);
    expect(isMojibake(MOJIBAKE)).toBe(true);
    expect(classifyExtraction(MOJIBAKE)).toBe('unreadable_encoding');
  });

  it('a box-drawing CLIN table is NOT mojibake (the false-positive guard)', () => {
    // An allow-list metric scored this 0.583 against a 0.6 threshold, which would
    // have reported a real extracted priced schedule as "no usable text".
    const table = '│ CLIN │ Qty │ Unit Price │\n├──────┼─────┼────────────┤\n│ 0001 │ 100 │ $1,234.00  │\n'.repeat(20);
    expect(readableRatio(table)).toBeGreaterThan(MIN_READABLE_RATIO);
    expect(classifyExtraction(table)).toBe('ok');
  });

  it('typographic and accented text is never flagged', () => {
    const fancy = '• Deliverable A — due 30 days “per spec”; climatización requerida.\n'.repeat(20);
    expect(classifyExtraction(fancy)).toBe('ok');
  });

  it('a Wingdings checkbox page (Section K reps-and-certs) is NOT mojibake', () => {
    // Word maps checkbox glyphs into the Symbol/Wingdings PUA sub-range, so a
    // near-pure certifications page scored 0.82 before that range was excluded.
    const checkboxes = '\uF0A8 Yes \uF0A8 No \uF0A8 N/A\n'.repeat(200);
    expect(readableRatio(checkboxes)).toBeGreaterThan(MIN_READABLE_RATIO);
    expect(classifyExtraction(checkboxes)).toBe('ok');
  });

  it('a font subset outside the symbol range is STILL flagged', () => {
    // The exclusion must not blind the detector to real PUA font failures.
    expect(classifyExtraction('\uE001\uE002\uE003\uE004\uE005'.repeat(80))).toBe('unreadable_encoding');
  });

  it('a symbol-encoded BODY font is flagged (the exclusion\'s blind spot)', () => {
    // 0xF000+ascii is the standard symbol-encoded TrueType mapping — the same
    // mechanism behind the checkbox glyphs. readableRatio scores this 1.00 by
    // construction, so the ratio ALONE cannot see it.
    const body = [...'The Contractor shall provide all labor and materials.']
      .map((c) => String.fromCharCode(0xf000 + c.charCodeAt(0)))
      .join('')
      .repeat(50);
    expect(readableRatio(body)).toBe(1); // ratio is blind, by design
    expect(classifyExtraction(body)).toBe('unreadable_encoding'); // caught anyway
  });

  it('a checkbox PAGE is still ok — the body-font check must not undo the fix', () => {
    // Dense checkboxes but with real readable words: not a symbol body font.
    const page = '\uF0A8 Yes \uF0A8 No \uF0A8 N/A\n'.repeat(200);
    expect(classifyExtraction(page)).toBe('ok');
  });

  it('pins the ACCEPTED blind-spot boundary (change only with a measurement)', () => {
    // Build text at a given symbol/ASCII mix. Documents the exact band where
    // neither gate fires, so a future threshold change has to confront it
    // rather than silently widening or narrowing the trade.
    const mk = (symPct: number, asciiPct: number, n = 4000) =>
      Array.from({ length: n }, (_, i) => {
        const r = i / n;
        if (r < symPct) return String.fromCharCode(0xf041 + (i % 26));
        if (r < symPct + asciiPct) return String.fromCharCode(65 + (i % 26));
        return ' ';
      }).join('');

    // Inside the blind spot — NOT flagged, knowingly.
    expect(hasSymbolEncodedBody(mk(0.5, 0.1))).toBe(false);
    expect(hasSymbolEncodedBody(mk(0.6, 0.05))).toBe(false);
    // Past the boundary — flagged.
    expect(hasSymbolEncodedBody(mk(0.7, 0.04))).toBe(true);
    expect(hasSymbolEncodedBody(mk(0.8, 0.03))).toBe(true);
  });

  it('genuine solicitation prose is never flagged', () => {
    const prose =
      'Solicitation No. SPE60525R0222. The Contractor shall provide insurance in ' +
      'accordance with FAR 52.228-5. Evaluation will be conducted under FAR 52.212-2. '.repeat(10);
    expect(readableRatio(prose)).toBeGreaterThan(MIN_READABLE_RATIO);
    expect(classifyExtraction(prose)).toBe('ok');
  });

  it('short text is NOT judged — a label is not evidence of an encoding failure', () => {
    expect(isMojibake('\u0001\u0002\u0003')).toBe(false);
  });
});
