import { describe, it, expect } from 'vitest';
import { computeGenome, topStrands, type GenomeInput } from './genome';

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

  it('does NOT emit Repeat Buyer / Posts-early — deferred until grounded (Phase 1.5)', () => {
    // Even a maximal row must not fabricate the not-yet-grounded strands.
    const k = keys({ src: 'RECOMPETE', noticeType: 'Sources Sought', set: 'SDVOSB', close: inDays(2), sbf: 1 });
    expect(k).not.toContain('repeat_buyer');
    expect(k).not.toContain('posts_early');
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
