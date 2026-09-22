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
import { classifyExtraction, isPdfPortfolioStub, isMojibake, readableRatio } from './extraction-quality';

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
    expect(readableRatio(MOJIBAKE)).toBeLessThan(0.6);
    expect(isMojibake(MOJIBAKE)).toBe(true);
    expect(classifyExtraction(MOJIBAKE)).toBe('unreadable_encoding');
  });

  it('genuine solicitation prose is never flagged', () => {
    const prose =
      'Solicitation No. SPE60525R0222. The Contractor shall provide insurance in ' +
      'accordance with FAR 52.228-5. Evaluation will be conducted under FAR 52.212-2. '.repeat(10);
    expect(readableRatio(prose)).toBeGreaterThan(0.95);
    expect(classifyExtraction(prose)).toBe('ok');
  });

  it('short text is NOT judged — a label is not evidence of an encoding failure', () => {
    expect(isMojibake('\u0001\u0002\u0003')).toBe(false);
  });
});
