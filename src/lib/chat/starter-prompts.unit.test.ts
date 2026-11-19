import { describe, it, expect } from 'vitest';
import { buildStarterPrompts, DEFAULT_STARTER_PROMPTS } from './starter-prompts';

describe('buildStarterPrompts — always 4, plain-English for non-AI users', () => {
  it('returns exactly 4 prompts', () => {
    expect(buildStarterPrompts({})).toHaveLength(4);
    expect(buildStarterPrompts({ naicsCodes: ['541512'], hasPipeline: true })).toHaveLength(4);
  });

  it('generic set stays jargon-free and includes the downloadable-report loop', () => {
    const p = DEFAULT_STARTER_PROMPTS.join(' | ').toLowerCase();
    expect(p).toMatch(/open contracts|this week/);
    expect(p).toMatch(/who is buying/);
    expect(p).toMatch(/which companies win/);
    expect(p).toMatch(/downloadable report|agencies that buy/);
    // Generic chips must not dump expert jargon at a first-time user.
    expect(p).not.toMatch(/\bnaics\b/);
    expect(p).not.toMatch(/\bvault\b/);
    expect(p).not.toMatch(/\bpipeline\b/);
  });
});

describe('personalization — grounded in the user\'s real data only', () => {
  it('uses the user\'s real NAICS in the market + intel prompts', () => {
    const p = buildStarterPrompts({ naicsCodes: ['541512', '541519'] });
    expect(p.some((x) => x.includes('541512'))).toBe(true);
    expect(p.some((x) => x.includes('541519'))).toBe(false);
  });

  it('NEVER invents a NAICS when the user has none (no fabrication)', () => {
    const p = buildStarterPrompts({ naicsCodes: [] }).join(' ');
    expect(p).not.toMatch(/NAICS \d{6}/);
  });

  it('offers "my pursuits" ONLY when the user has a pipeline', () => {
    const withP = buildStarterPrompts({ hasPipeline: true });
    expect(withP[0]).toMatch(/my pursuits/i);

    const withoutP = buildStarterPrompts({ hasPipeline: false });
    expect(withoutP[0]).not.toMatch(/my pursuits/i);
    expect(withoutP[0]).toMatch(/open contracts|this week/i);
  });

  it('uses a real set-aside in the report prompt when present', () => {
    const p = buildStarterPrompts({ setAsides: ['HUBZone'] });
    expect(p.some((x) => /HUBZone/i.test(x))).toBe(true);
    expect(p[3]).toMatch(/downloadable report/i);
  });

  it('falls back to the generic downloadable-report prompt when no set-aside', () => {
    const p = buildStarterPrompts({ setAsides: [] });
    expect(p[3]).toMatch(/agencies that buy.*downloadable report/i);
  });

  it('fully-personalized profile hits all four personalized slots', () => {
    const p = buildStarterPrompts({ naicsCodes: ['236220'], hasPipeline: true, setAsides: ['WOSB'] });
    expect(p[0]).toMatch(/my pursuits/i);
    expect(p[1]).toMatch(/236220/);
    expect(p[2]).toMatch(/236220/);
    expect(p[3]).toMatch(/WOSB/i);
  });

  it('handles junk/empty NAICS entries without emitting a blank code', () => {
    const p = buildStarterPrompts({ naicsCodes: ['', '  ', '541512'] });
    expect(p.some((x) => x.includes('541512'))).toBe(true);
    expect(p.join(' ')).not.toMatch(/NAICS \s|NAICS $/);
  });
});
