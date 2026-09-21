import { describe, it, expect } from 'vitest';
import { eligibleSetAsides, eligibleSetAsidesCombined } from './set-aside-eligibility';
import { eligibleSetAsides as vaultEligible } from '@/lib/vault/certifications';

/** Vault raw text -> normalized codes -> SAM codes, the full production path. */
const fromVault = (raw: string[]) => vaultEligible(raw).filter((c) => c !== 'Full & Open');

describe('crosswalk NEVER removes a lane (the cardinal rule)', () => {
  const TYPES = ['Small Business', 'small-business', 'WOSB', 'SDVOSB', 'VOSB', '8a', '8(a)', 'HUBZone', 'EDWOSB', 'women-owned', 'dot-certified', '', null];
  for (const t of TYPES) {
    it(`"${t}" keeps every code business_type alone would give`, () => {
      const before = eligibleSetAsides(t);
      const after = eligibleSetAsidesCombined(t, []);
      for (const c of before) expect(after).toContain(c);
    });
  }
});

describe('REAL under-served users gain their reserved lanes', () => {
  it('legacyprosolutions1@ — "Small Business" + vault [WOSB,EDWOSB,MBE,WBE]', () => {
    const v = fromVault(['WOSB', 'EDWOSB', 'MBE', 'WBE']);
    const after = eligibleSetAsidesCombined('Small Business', v);
    expect(after).toContain('WOSB');
    expect(after).toContain('EDWOSB');
    expect(after).toContain('SBA');          // base pool retained
    expect(eligibleSetAsides('Small Business')).not.toContain('WOSB'); // was missing
  });

  it('management@sanddmanagement — "Small Business" + vault [Small Business, VOSB]', () => {
    const after = eligibleSetAsidesCombined('Small Business', fromVault(['Small Business', 'VOSB']));
    expect(after).toContain('VSB');
  });

  it('rasheeda.smith24@ — vault "SDVOSB.WOSB" (crammed) still resolves both', () => {
    const after = eligibleSetAsidesCombined('Small Business', fromVault(['SDVOSB.WOSB']));
    expect(after).toContain('SDVOSBC');
    expect(after).toContain('WOSB');
  });

  it('cindy@ — "WOSB certified by U.S. SBA" resolves; NYC M/WBE does not', () => {
    const after = eligibleSetAsidesCombined('WOSB', fromVault(['WOSB certified by U.S. SBA', 'M/WBE certified by SBA of NYC']));
    expect(after).toContain('WOSB');
    expect(after).toContain('SBA');
  });

  it('smcneal@ — 8(a)+WOSB+EDWOSB all cross over', () => {
    const after = eligibleSetAsidesCombined('8(a)', fromVault(['8(a)', 'WOSB', 'EDWOSB']));
    expect(after).toEqual(expect.arrayContaining(['8A', 'WOSB', 'EDWOSB', 'SBA']));
  });
});

describe('safety contracts', () => {
  it('no business_type + no vault = [] (do NOT filter)', () => {
    expect(eligibleSetAsidesCombined(null, [])).toEqual([]);
    expect(eligibleSetAsidesCombined('', null)).toEqual([]);
  });

  it('vault alone works when business_type is unknown junk', () => {
    // 'dot-certified' is a real DB value and not a SAM set-aside.
    const after = eligibleSetAsidesCombined('dot-certified', fromVault(['8(a)']));
    expect(after).toContain('8A');
    expect(after).toContain('SBA');
  });

  it('ISO/FCL-only vault buys no set-aside lane', () => {
    expect(eligibleSetAsidesCombined(null, fromVault(['ISO 27001', 'FCL']))).toEqual([]);
  });

  it('state MBE/WBE alone buys no lane', () => {
    expect(eligibleSetAsidesCombined(null, fromVault(['MBE', 'WBE']))).toEqual([]);
  });
});
