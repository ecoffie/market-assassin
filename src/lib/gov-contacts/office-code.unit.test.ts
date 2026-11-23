import { describe, it, expect } from 'vitest';
import { isValidOfficeCode, officePrefixOrExpr } from './dodaac-prefix';
import { isValidDodaac } from './agency-key';

describe('isValidOfficeCode — civilian office codes are targetable', () => {
  it('accepts VA NCO 8 (36C248) and DoD DoDAACs; rejects words and numbers', () => {
    expect(isValidDodaac('36C248')).toBe(false); // the old validator — why VA offices were unreachable
    expect(isValidOfficeCode('36C248')).toBe(true);
    expect(isValidOfficeCode('W912PL')).toBe(true);
    for (const bad of ['REPOST', '123456', 'ABC', '36C2481', '', null]) expect(isValidOfficeCode(bad)).toBe(false);
  });
  it('builds a deduped solicitation-number prefix OR', () => {
    expect(officePrefixOrExpr(['36c248', '36C248', 'REPOST', 'W912PL'])).toBe('solicitation_number.ilike.36C248%,solicitation_number.ilike.W912PL%');
    expect(officePrefixOrExpr(['REPOST'])).toBe('');
  });
});
