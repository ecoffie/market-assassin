import { describe, expect, it } from 'vitest';
import { cleanRecompetePiid, PIID_ROLLUP_SUFFIX_SOURCE, recompetePursuitTitle } from './pursuit-key';

describe('recompete pursuit key', () => {
  it('strips the rollup suffix, any spacing', () => {
    expect(cleanRecompetePiid('N0018926F0012 (+3 more)')).toBe('N0018926F0012');
    expect(cleanRecompetePiid('N0018926F0012  (+12  more) ')).toBe('N0018926F0012');
    expect(cleanRecompetePiid('W912PL25C0001')).toBe('W912PL25C0001');
    expect(cleanRecompetePiid(null)).toBe('');
  });
  it('the emitted-script form matches the TS form', () => {
    // What the map scripts do: new RegExp(<source>, 'i').
    const re = new RegExp(PIID_ROLLUP_SUFFIX_SOURCE, 'i');
    for (const s of ['A (+1 more)', 'B(+2 more)', 'C  (+3  more)  ', 'D']) {
      expect(s.replace(re, '').trim()).toBe(cleanRecompetePiid(s));
    }
  });
  it('titles the pursuit the same way everywhere', () => {
    expect(recompetePursuitTitle('Acme Corp', 'P1')).toBe('Recompete: Acme Corp · P1');
    expect(recompetePursuitTitle('', 'P1')).toBe('Recompete: Awarded contract · P1');
  });
});
