import { describe, it, expect } from 'vitest';
import { buildStarterPrompts, DEFAULT_STARTER_PROMPTS } from './starter-prompts';

describe('buildStarterPrompts — always 4, always spans the capabilities', () => {
  it('returns exactly 4 prompts', () => {
    expect(buildStarterPrompts({})).toHaveLength(4);
    expect(buildStarterPrompts({ naicsCodes: ['541512'], hasPipeline: true })).toHaveLength(4);
  });

  it('generic set (no context) showcases each new source, not just teaching', () => {
    const p = DEFAULT_STARTER_PROMPTS.join(' | ').toLowerCase();
    expect(p).toMatch(/pipeline|opportunit/); // pipeline / market
    expect(p).toMatch(/contract|open|industry/); // live market
    expect(p).toMatch(/contractors|space/); // competitive intel
    expect(p).toMatch(/capability statement|vault/); // vault
  });
});

describe('personalization — grounded in the user\'s real data only', () => {
  it('uses the user\'s real NAICS in the market + intel prompts', () => {
    const p = buildStarterPrompts({ naicsCodes: ['541512', '541519'] });
    expect(p.some((x) => x.includes('541512'))).toBe(true); // primary NAICS surfaced
    expect(p.some((x) => x.includes('541519'))).toBe(false); // only the primary, not every code
  });

  it('NEVER invents a NAICS when the user has none (no fabrication)', () => {
    const p = buildStarterPrompts({ naicsCodes: [] }).join(' ');
    expect(p).not.toMatch(/NAICS \d{6}/); // no fabricated 6-digit code
  });

  it('offers "my pursuits" ONLY when the user has a pipeline', () => {
    const withP = buildStarterPrompts({ hasPipeline: true });
    expect(withP[0]).toMatch(/my pursuits/i);

    const withoutP = buildStarterPrompts({ hasPipeline: false });
    expect(withoutP[0]).not.toMatch(/my pursuits/i);      // don't imply pursuits they lack
    expect(withoutP[0]).toMatch(/add to my pipeline|find me open/i); // steer to build one
  });

  it('uses a real set-aside in the vault prompt when present', () => {
    const p = buildStarterPrompts({ setAsides: ['HUBZone'] });
    expect(p.some((x) => /HUBZone/i.test(x))).toBe(true);
  });

  it('falls back to the generic vault prompt when no set-aside', () => {
    const p = buildStarterPrompts({ setAsides: [] });
    expect(p[3]).toMatch(/from my vault/i);
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
    expect(p.join(' ')).not.toMatch(/NAICS \s|NAICS $/); // no empty "NAICS " artifact
  });
});
