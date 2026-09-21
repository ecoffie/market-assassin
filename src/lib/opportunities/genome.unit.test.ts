import { describe, it, expect } from 'vitest';
import { computeGenome, topStrands, setAsideLabel, type GenomeInput } from './genome';

// A fixed "now" so deadline math is deterministic. 2026-08-04T12:00:00Z.
const NOW = Date.parse('2026-08-04T12:00:00Z');
const inDays = (n: number) => new Date(NOW + n * 86400000).toISOString();
const keys = (row: GenomeInput) => computeGenome(row, NOW).map((s) => s.key).sort();

describe('computeGenome — grounded strands only', () => {
  it('emits NO strands for a bare row (no fabrication)', () => {
    // src SAM (not a horizon strand), unknown notice type, no set, no deadline, not sb-friendly.
    expect(computeGenome({ src: 'SAM' }, NOW)).toEqual([]);
  });

  it('a recompete pin gets the Recompete strand', () => {
    expect(keys({ src: 'RECOMPETE' })).toContain('recompete');
    expect(keys({ src: 'FORECAST' })).toContain('forecast');
  });

  it('Sources Sought → sources_sought + early_cycle (a response, still forming)', () => {
    const k = keys({ src: 'SAM', noticeType: 'Sources Sought' });
    expect(k).toContain('sources_sought');
    expect(k).toContain('early_cycle');
  });

  it('a plain Solicitation (biddable) is NOT early-cycle and NOT sources-sought', () => {
    const k = keys({ src: 'SAM', noticeType: 'Combined Synopsis/Solicitation' });
    expect(k).not.toContain('early_cycle');
    expect(k).not.toContain('sources_sought');
  });

  it('an UNKNOWN notice type never fabricates early-cycle (defaults to biddable)', () => {
    // classifyNoticeType returns label:null, respondability:'bid' for blank/unknown → no strand.
    expect(keys({ src: 'SAM', noticeType: null })).not.toContain('early_cycle');
    expect(keys({ src: 'SAM', noticeType: 'Zorp Notice' })).not.toContain('early_cycle');
  });

  it('deadline drives Closes Soon (≤7d) vs Last Chance (≤3d), and nothing when far out', () => {
    expect(keys({ src: 'SAM', close: inDays(2) })).toContain('last_chance');
    expect(keys({ src: 'SAM', close: inDays(5) })).toContain('closes_soon');
    expect(keys({ src: 'SAM', close: inDays(30) })).not.toContain('closes_soon');
    // a past deadline emits neither (d < 0)
    expect(keys({ src: 'SAM', close: inDays(-2) })).toEqual([]);
    // an unparseable/absent deadline emits nothing (no fabrication)
    expect(keys({ src: 'SAM', close: 'not-a-date' })).toEqual([]);
    expect(keys({ src: 'SAM', close: null })).toEqual([]);
  });

  it('set-aside vs full & open are mutually exclusive and grounded in the real set key', () => {
    expect(keys({ src: 'SAM', set: 'SDVOSB' })).toContain('set_aside');
    expect(keys({ src: 'SAM', set: '8A' })).toContain('set_aside');
    expect(keys({ src: 'SAM', set: 'NONE' })).toContain('full_open');
    // NONE never also emits set_aside
    expect(keys({ src: 'SAM', set: 'NONE' })).not.toContain('set_aside');
    // a missing set emits neither
    expect(keys({ src: 'SAM', set: null })).toEqual([]);
  });

  it('sb-friendly strand only when the upstream sbf flag is truthy', () => {
    expect(keys({ src: 'SAM', sbf: 1 })).toContain('sb_friendly');
    expect(keys({ src: 'SAM', sbf: true })).toContain('sb_friendly');
    expect(keys({ src: 'SAM', sbf: 0 })).not.toContain('sb_friendly');
    expect(keys({ src: 'SAM', sbf: null })).not.toContain('sb_friendly');
  });

  it('Repeat Buyer fires ONLY when the grounded repeatBuyer flag is set (Phase 1.5)', () => {
    expect(keys({ src: 'SAM', repeatBuyer: 1 })).toContain('repeat_buyer');
    expect(keys({ src: 'SAM', repeatBuyer: true })).toContain('repeat_buyer');
    // no fabrication: absent/false flag → no strand (the map lib returns false for an unknown pair)
    expect(keys({ src: 'SAM', repeatBuyer: 0 })).not.toContain('repeat_buyer');
    expect(keys({ src: 'SAM' })).not.toContain('repeat_buyer');
  });

  it('Posts Early fires ONLY when the grounded postsEarly flag is set (Phase 1.5)', () => {
    expect(keys({ src: 'SAM', postsEarly: 1 })).toContain('posts_early');
    expect(keys({ src: 'SAM', postsEarly: true })).toContain('posts_early');
    // no fabrication: absent/false (band !== 'high', or office unscored) → no strand
    expect(keys({ src: 'SAM', postsEarly: 0 })).not.toContain('posts_early');
    expect(keys({ src: 'SAM' })).not.toContain('posts_early');
  });
});

describe('topStrands — progressive reveal', () => {
  const rich: GenomeInput = { src: 'RECOMPETE', noticeType: 'Sources Sought', set: 'SDVOSB', close: inDays(2), sbf: 1 };

  it('card=1 → one strand, popup=3 → three, listing=all', () => {
    const g = computeGenome(rich, NOW);
    expect(g.length).toBeGreaterThanOrEqual(5);
    expect(topStrands(g, 1)).toHaveLength(1);
    expect(topStrands(g, 3)).toHaveLength(3);
    expect(topStrands(g, 99)).toHaveLength(g.length);
  });

  it('leads with a Tier-1 good strand (a positive), not a watch/neutral', () => {
    const g = computeGenome(rich, NOW);
    const first = topStrands(g, 1)[0];
    expect(first.tier).toBe(1);
    expect(first.tone).toBe('good');
  });

  it('never returns more than exist', () => {
    const g = computeGenome({ src: 'SAM', sbf: 1 }, NOW); // exactly 1 strand
    expect(topStrands(g, 3)).toHaveLength(1);
  });
});

describe('card labels read like the deal, not the database (Eric 2026-08-04)', () => {
  it('the sb_friendly strand reads "SB-Friendly Buyer" (a buyer trait, not a bare adjective)', () => {
    const g = computeGenome({ src: 'SAM', sbf: 1 }, NOW);
    const s = g.find((x) => x.key === 'sb_friendly');
    expect(s?.label).toBe('SB-Friendly Buyer');
  });

  it('the set_aside strand NAMES the program — never a bare "Small Business"/"Set-Aside"', () => {
    const label = (set: string) =>
      computeGenome({ src: 'SAM', set }, NOW).find((x) => x.key === 'set_aside')?.label;
    expect(label('WOSB')).toBe('WOSB Set-Aside');
    expect(label('SB')).toBe('Small Business Set-Aside'); // the screenshot's bare "Small Business"
    expect(label('SDVOSB')).toBe('SDVOSB Set-Aside');
  });

  it('setAsideLabel maps every program key + falls back without inventing a program', () => {
    expect(setAsideLabel('8A')).toBe('8(a) Set-Aside');
    expect(setAsideLabel('HZ')).toBe('HUBZone Set-Aside');
    expect(setAsideLabel('EDWOSB')).toBe('EDWOSB Set-Aside');
    // an unrecognized non-empty key is echoed as "<KEY> Set-Aside" — grounded, never fabricated
    expect(setAsideLabel('XYZ')).toBe('XYZ Set-Aside');
    expect(setAsideLabel('')).toBe('Set-Aside');
  });
});
