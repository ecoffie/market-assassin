import { describe, it, expect } from 'vitest';
import { termOfArtPscCodes, termOfArtNaicsCodes } from './sector-expansions';
import { buildMarketFilter } from './keyword-coverage';

describe('hospital construction term of art', () => {
  it('pins hospital construction/renovation phrasings', () => {
    for (const k of ['hospital construction renovation', 'VA hospital construction', 'renovation of medical center', 'VAMC renovation', 'clinic build-out']) {
      expect(termOfArtPscCodes(k)).toEqual(['Y1DA', 'Z1DA', 'Z2DA']);
      expect(termOfArtNaicsCodes(k)).toEqual(['236220']);
    }
  });
  it('never pins non-construction hospital work', () => {
    for (const k of ['hospital staffing', 'medical center IT support', 'clinic janitorial services', 'construction management software']) {
      expect(termOfArtPscCodes(k)).toBeNull();
    }
  });
  it('a pinned coverage ranks sections by PSC only — the literal phrase is not ANDed back in', () => {
    const f = buildMarketFilter({ coverage: { keyword: 'hospital construction renovation', pinnedPscCodes: ['Y1DA', 'Z1DA', 'Z2DA'] } as never })!;
    expect(f.psc_codes).toEqual(['Y1DA', 'Z1DA', 'Z2DA']);
    expect(f.keywords).toBeUndefined();
  });
});
