import { describe, it, expect } from 'vitest';
import {
  parseNAICSInput,
  expandNAICSCode,
  expandNAICSCodes,
  naicsSubsectorPrefixes,
  normalizeNAICSForPersist,
  MAX_PERSISTED_NAICS,
  isValidNAICSFormat,
} from './naics-expansion';

/**
 * Guards the "$674B" spend-inflation bug (memory: market_research_naics_overexpansion).
 * A single 6-digit code was silently expanding to its whole 3-digit subsector on
 * spend widgets, turning 541512's ~$95B into the entire 541 family's ~$674B.
 * The fix is the `expandFullCodes=false` flag — these tests lock that contract in.
 */
describe('expandNAICSCodes — the spend-inflation guard', () => {
  it('KEEPS a 6-digit code exact when expandFullCodes=false (the $674B fix)', () => {
    // This is THE assertion. If it ever returns the 541 family again, spend
    // widgets re-inflate and Eric gets a wrong number in front of a customer.
    expect(expandNAICSCodes(['541512'], false)).toEqual(['541512']);
  });

  it('BLOWS OUT a 6-digit code to its 3-digit family when expandFullCodes=true (alert matching)', () => {
    const expanded = expandNAICSCodes(['541512'], true);
    expect(expanded.length).toBeGreaterThan(40); // whole 541 subsector
    expect(expanded).toContain('541512');
    expect(expanded).toContain('541511');
    expect(expanded).toContain('541990');
    // sanity: it must NOT be just the one code
    expect(expanded).not.toEqual(['541512']);
  });

  it('the two modes differ for a 6-digit code — proves the flag actually does something', () => {
    const narrow = expandNAICSCodes(['541512'], false);
    const wide = expandNAICSCodes(['541512'], true);
    expect(wide.length).toBeGreaterThan(narrow.length);
  });

  it('still expands a short 3-digit prefix even in narrow mode (238 → the family)', () => {
    // expandFullCodes=false only pins FULLY-specified 6-digit codes; short
    // prefixes are meant to expand regardless (a coverage set may include "238").
    const out = expandNAICSCodes(['238'], false);
    expect(out.length).toBeGreaterThan(5);
    expect(out).toContain('238160'); // roofing
  });

  it('dedupes + sorts across multiple inputs', () => {
    const out = expandNAICSCodes(['541512', '541512', '541511'], false);
    expect(out).toEqual(['541511', '541512']); // sorted, no dupes
  });

  it('passes an unknown 6-digit code through unchanged (no fabricated family)', () => {
    expect(expandNAICSCodes(['999999'], true)).toEqual(['999999']);
  });
});

describe('expandNAICSCode — single-code behavior', () => {
  it('3-digit subsector returns the whole family', () => {
    const out = expandNAICSCode('236');
    expect(out).toContain('236220');
    expect(out.length).toBe(6);
  });

  it('2-digit sector aggregates every subsector under it', () => {
    const out = expandNAICSCode('23'); // construction
    expect(out).toContain('236220');
    expect(out).toContain('237310');
    expect(out).toContain('238160');
  });
});

describe('parseNAICSInput', () => {
  it('splits on commas/semicolons/whitespace and keeps only 2-6 digit codes', () => {
    expect(parseNAICSInput('541512, 541511; 236')).toEqual(['541512', '541511', '236']);
  });

  it('drops garbage and over-long tokens', () => {
    expect(parseNAICSInput('abc, 1, 1234567, 541512')).toEqual(['541512']);
  });

  it('returns [] for empty/whitespace input', () => {
    expect(parseNAICSInput('   ')).toEqual([]);
    expect(parseNAICSInput('')).toEqual([]);
  });
});

describe('naicsSubsectorPrefixes — the 3-digit "like" builder', () => {
  it('collapses 6-digit codes to distinct 3-char prefixes', () => {
    expect(naicsSubsectorPrefixes(['541512', '541611', '236220'])).toEqual(['541', '236']);
  });

  it('passes a <=3-digit code through as-is', () => {
    expect(naicsSubsectorPrefixes(['541'])).toEqual(['541']);
  });

  it('strips non-digits and skips too-short tokens', () => {
    expect(naicsSubsectorPrefixes(['54-1512', 'x', '5'])).toEqual(['541']);
  });
});

describe('isValidNAICSFormat', () => {
  it('accepts 2-6 digit numeric codes, rejects the rest', () => {
    expect(isValidNAICSFormat('54')).toBe(true);
    expect(isValidNAICSFormat('541512')).toBe(true);
    expect(isValidNAICSFormat('5')).toBe(false);
    expect(isValidNAICSFormat('1234567')).toBe(false);
    expect(isValidNAICSFormat('54a512')).toBe(false);
  });
});

/**
 * Guards the NAICS-bloat bug (audit 2026-07-27): the industry picker offers broad
 * SHORT PREFIXES ("Professional Services" = ['541']) and expandNAICSCodes(_, false)
 * only pinned 6-digit codes — so one click persisted all 51 codes of the 541
 * family. 1,089 profiles ended up >25 codes (710 holding the identical pure-541
 * array, max 241), driving 82% of alert volume from 12% of profiles.
 */
describe('normalizeNAICSForPersist — the profile-bloat guard', () => {
  it('does NOT persist the whole 541 family for a "541" preset click (THE fix)', () => {
    const out = normalizeNAICSForPersist(['541']);
    // The bug persisted 51 codes. The curated set must be far smaller.
    expect(out.length).toBeLessThan(15);
    expect(expandNAICSCodes(['541'], false).length).toBeGreaterThan(40); // old behavior
    expect(out).toContain('541512'); // still covers the core IT/cyber codes
  });

  it('keeps a fully-specified 6-digit code EXACT', () => {
    expect(normalizeNAICSForPersist(['541512'])).toEqual(['541512']);
  });

  it('reproduces the Hendricks case at a sane size (4 broad presets)', () => {
    // Professional Services + Healthcare + Logistics + Cyber = 93 codes before.
    const out = normalizeNAICSForPersist([
      '541', '621', '622', '623', '493', '484', '488', '541512', '541519', '518210',
    ]);
    expect(out.length).toBeLessThan(40);
    // and never leaves bare 3-digit stubs behind (484/488/493 used to survive raw)
    expect(out.filter((c) => c.length < 6)).toEqual([]);
  });

  it('hard-caps the persisted array so no save can bloat a profile', () => {
    const many = Array.from({ length: 200 }, (_, i) => `5415${String(i).padStart(2, '0')}`);
    expect(normalizeNAICSForPersist(many).length).toBeLessThanOrEqual(MAX_PERSISTED_NAICS);
  });

  it('passes an unmapped prefix through instead of fabricating codes', () => {
    expect(normalizeNAICSForPersist(['999'])).toEqual(['999']);
  });

  it('dedupes and sorts', () => {
    expect(normalizeNAICSForPersist(['541512', '541512', '541511'])).toEqual(['541511', '541512']);
  });
});

describe('NAICS_DATABASE — preset families that were missing (query-time)', () => {
  it('resolves every short prefix the industry picker offers', () => {
    // '484'/'488'/'493'/'611'/'423'/'424'/'333'/'335' had NO entry, so those
    // presets never expanded and leaked bare stubs into matching.
    for (const prefix of ['484', '488', '493', '611', '423', '424', '333', '335', '453', '339', '325']) {
      const out = expandNAICSCode(prefix);
      expect(out.length, `prefix ${prefix} should expand`).toBeGreaterThan(1);
      expect(out.every((c) => c.startsWith(prefix)), `prefix ${prefix} codes`).toBe(true);
    }
  });
});
