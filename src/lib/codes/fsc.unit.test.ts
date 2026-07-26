import { describe, it, expect } from 'vitest';
import { decodeFSC, getFSGTitle, extractNSNs, isFscTableLoaded, getFscTableInfo } from './fsc';

describe('decodeFSC', () => {
  it('decodes a bare 4-digit FSC (2915 -> Engine Fuel System Components Aircraft)', () => {
    const d = decodeFSC('2915');
    expect(d).not.toBeNull();
    expect(d?.fsc).toBe('2915');
    expect(d?.fscTitle.toLowerCase()).toContain('engine fuel system components');
    expect(d?.fsg).toBe('29');
    expect(d?.fsgTitle.toLowerCase()).toContain('engine accessories');
  });

  it('decodes a full formatted NSN (Eric\'s example) by extracting the leading FSC', () => {
    const d = decodeFSC('2915-01-218-7655');
    expect(d).not.toBeNull();
    expect(d?.fsc).toBe('2915');
    expect(d?.fscTitle.toLowerCase()).toContain('engine fuel system components');
  });

  it('decodes an unformatted 13-digit NSN', () => {
    const d = decodeFSC('2915012187655');
    expect(d?.fsc).toBe('2915');
  });

  it('decodes an NSN with an "NSN:" label prefix', () => {
    const d = decodeFSC('NSN: 2915-01-218-7655');
    expect(d?.fsc).toBe('2915');
  });

  it('decodes a second known code (1005 -> Guns)', () => {
    const d = decodeFSC('1005');
    expect(d?.fscTitle.toLowerCase()).toContain('guns');
    expect(d?.fsg).toBe('10');
  });

  it('returns null for a non-code / unrecognized input', () => {
    expect(decodeFSC('not a code')).toBeNull();
    expect(decodeFSC('')).toBeNull();
    expect(decodeFSC(null)).toBeNull();
    expect(decodeFSC(undefined)).toBeNull();
  });

  it('returns null for a well-formed but unknown FSC prefix', () => {
    // 0000 is not an assigned FSC
    expect(decodeFSC('0000')).toBeNull();
  });
});

describe('getFSGTitle', () => {
  it('returns the FSG title for a known 2-digit group', () => {
    expect(getFSGTitle('29')).toMatch(/engine accessories/i);
  });

  it('returns null for an unknown group', () => {
    expect(getFSGTitle('00')).toBeNull();
    expect(getFSGTitle(null)).toBeNull();
  });
});

describe('extractNSNs', () => {
  it('finds a labeled formatted NSN in free text (Eric\'s real example)', () => {
    const text = 'NSN: 2915-012187655, Rod & Piston, ACTU; Part Number 2665806; Qty 266; WSDC 06F';
    const found = extractNSNs(text);
    expect(found.length).toBeGreaterThan(0);
    expect(found.some((n) => n.replace(/\D/g, '').startsWith('2915'))).toBe(true);
  });

  it('finds an unlabeled fully-formatted NSN', () => {
    const found = extractNSNs('Replacement part, NSN 2915-01-218-7655, required for engine repair.');
    expect(found).toContain('2915-01-218-7655');
  });

  it('finds multiple distinct NSNs in one text', () => {
    const text = 'Items needed: NSN 2915-01-218-7655 and NSN 1005-00-123-4567.';
    const found = extractNSNs(text);
    expect(found.length).toBe(2);
  });

  it('returns empty array for text with no NSN pattern', () => {
    expect(extractNSNs('This is a janitorial services contract with no part numbers.')).toEqual([]);
  });

  it('finds an NSN glued to "NSN" by underscore on both sides, with a letter suffix and no boundary (real SAM title)', () => {
    const found = extractNSNs('GENERATOR,ALTERNATI_End_Item_F15_NSN_6115012345860HY_PN_31169-010');
    expect(found).toContain('6115012345860');
    const d = decodeFSC(found[0]);
    expect(d?.fsc).toBe('6115');
  });

  it('finds an NSN with a colon label and trailing letter suffix, no space (real SAM title)', () => {
    const found = extractNSNs('New Manufacture of SEAT,AIRCRAFT / NSN: 1680994354135KT / PN: 3A254-0042-21-1');
    expect(found).toContain('1680994354135');
  });

  it('returns empty array for null/undefined', () => {
    expect(extractNSNs(null)).toEqual([]);
    expect(extractNSNs(undefined)).toEqual([]);
  });
});

describe('table metadata', () => {
  it('the bundled FSC table is loaded and roughly complete (~650 codes)', () => {
    expect(isFscTableLoaded()).toBe(true);
    const info = getFscTableInfo();
    expect(info.totalCodes).toBeGreaterThan(600);
    expect(info.totalGroups).toBeGreaterThan(70);
  });
});
