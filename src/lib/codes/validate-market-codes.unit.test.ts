import { describe, expect, it } from 'vitest';
import {
  commitNaicsFromTypedInput,
  isAcceptablePscCode,
  isKnownNaicsCode,
  knownNaicsForMatch,
  persistNaicsWrite,
  unknownNaicsBeingAdded,
  validateMarketCodesInput,
} from './validate-market-codes';

describe('Census NAICS vs PSC/FSC authorities', () => {
  it('rejects 618210 and accepts 518210', () => {
    expect(isKnownNaicsCode('618210')).toBe(false);
    expect(isKnownNaicsCode('518210')).toBe(true);
    expect(validateMarketCodesInput(['618210'], undefined).ok).toBe(false);
    expect(validateMarketCodesInput(['518210'], undefined).ok).toBe(true);
  });

  it('keeps a stored invalid on re-save and blocks a new invalid add', () => {
    expect(unknownNaicsBeingAdded(['541512', '618210'], ['541512', '618210'])).toEqual([]);
    expect(unknownNaicsBeingAdded(['541512', '618210', '999999'], ['541512', '618210'])).toEqual(['999999']);
    expect(unknownNaicsBeingAdded(['618210'], [])).toEqual(['618210']);
  });

  it('matching drops unknown codes and keeps 611xxx', () => {
    expect(knownNaicsForMatch(['518210', '618210', '611420', '611430', '611710'])).toEqual([
      '518210',
      '611420',
      '611430',
      '611710',
    ]);
  });

  it('accepts official FSC product codes missing from the spend table', () => {
    expect(isAcceptablePscCode('6520')).toBe(true);
    expect(isAcceptablePscCode('8405')).toBe(true);
    expect(isAcceptablePscCode('8905')).toBe(true);
    expect(validateMarketCodesInput(undefined, ['6520', '8405', '8905'])).toEqual({ ok: true });
  });

  it('accepts AQ93 as a 4-character PSC shape', () => {
    expect(isAcceptablePscCode('AQ93')).toBe(true);
    expect(validateMarketCodesInput(undefined, ['AQ93'])).toEqual({ ok: true });
  });

  it('rejects a non-code PSC string', () => {
    expect(isAcceptablePscCode('TOOLS')).toBe(false);
    expect(validateMarketCodesInput(undefined, ['TOOLS']).ok).toBe(false);
  });

  it('client commit keeps stored 618210 and strips a new unknown', () => {
    expect(commitNaicsFromTypedInput(
      ['518210', '618210', '999999', '611420'],
      ['518210', '618210', '611420'],
    )).toEqual({
      persist: ['518210', '618210', '611420'],
      blockedAdds: ['999999'],
    });
  });

  it('direct write cannot add 618210 to a clean row', () => {
    expect(persistNaicsWrite(['541512', '618210'], ['541512'])).toEqual({
      ok: false,
      blocked: ['618210'],
      error: 'Invalid NAICS code "618210". Use a Census 2022 code.',
    });
    expect(persistNaicsWrite(['541512', '618210'], ['541512', '618210'])).toEqual({
      ok: true,
      codes: ['541512', '618210'],
    });
  });
});
