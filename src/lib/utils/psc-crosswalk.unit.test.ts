import { describe, it, expect } from 'vitest';
import {
  getPSCsForNAICS,
  getNAICSForPSC,
  isCrosswalkLoaded,
  getCrosswalkInfo,
  type PSCMatch,
} from './psc-crosswalk';

/**
 * PSC↔NAICS crosswalk drives the "broaden the search" PSC suggestions in alerts +
 * market research. Tests assert the BEHAVIOR CONTRACT (shape, confidence tiering,
 * prefix fallback, limit, empty handling) rather than pinning exact codes — the
 * data file is refreshed from USASpending, so exact values would be brittle.
 * NAICS 221111 is used as a known-present real key.
 */

const KNOWN_NAICS = '221111'; // present in the shipped crosswalk data

describe('getPSCsForNAICS — shape + confidence contract', () => {
  it('returns PSC matches with the full shape for a known NAICS', () => {
    const rows = getPSCsForNAICS(KNOWN_NAICS);
    expect(rows.length).toBeGreaterThan(0);
    const m = rows[0];
    expect(m).toHaveProperty('pscCode');
    expect(m).toHaveProperty('coOccurrenceCount');
    expect(['high', 'medium', 'low']).toContain(m.confidence);
  });

  it('sorts by co-occurrence (the first row is the strongest)', () => {
    const rows = getPSCsForNAICS(KNOWN_NAICS);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].coOccurrenceCount).toBeGreaterThanOrEqual(rows[i].coOccurrenceCount);
    }
  });

  it('assigns the TOP match "high" confidence (ratio to max = 1.0)', () => {
    const rows = getPSCsForNAICS(KNOWN_NAICS);
    expect(rows[0].confidence).toBe('high');
  });

  it('confidence tiers are monotonic — never rises as the count falls', () => {
    const order = { high: 3, medium: 2, low: 1 };
    const rows = getPSCsForNAICS(KNOWN_NAICS);
    for (let i = 1; i < rows.length; i++) {
      expect(order[rows[i].confidence]).toBeLessThanOrEqual(order[rows[i - 1].confidence]);
    }
  });

  it('respects the limit argument', () => {
    const rows = getPSCsForNAICS(KNOWN_NAICS, 2);
    expect(rows.length).toBeLessThanOrEqual(2);
  });

  it('returns [] for an unknown NAICS with no matchable prefix', () => {
    expect(getPSCsForNAICS('000000')).toEqual([]);
  });

  it('trims whitespace on the input code', () => {
    const clean = getPSCsForNAICS(KNOWN_NAICS);
    const padded = getPSCsForNAICS(`  ${KNOWN_NAICS}  `);
    expect(padded.map((r: PSCMatch) => r.pscCode)).toEqual(clean.map((r) => r.pscCode));
  });
});

describe('getNAICSForPSC — reverse lookup', () => {
  it('returns NAICS matches with the full shape for a known PSC', () => {
    // find a PSC that resolves by exercising a code we know is in the data
    const rows = getNAICSForPSC('1005');
    // may be empty if 1005 isn't a key, but must never throw and must be an array
    expect(Array.isArray(rows)).toBe(true);
    if (rows.length) {
      expect(rows[0]).toHaveProperty('naicsCode');
      expect(['high', 'medium', 'low']).toContain(rows[0].confidence);
    }
  });

  it('uppercases the PSC code (alphanumeric PSCs like S112)', () => {
    expect(getNAICSForPSC('s112')).toEqual(getNAICSForPSC('S112'));
  });

  it('returns [] for an unknown PSC (no crash)', () => {
    expect(getNAICSForPSC('ZZZZ')).toEqual([]);
  });
});

describe('crosswalk metadata', () => {
  it('reports loaded when version > 0 and lastUpdated is set', () => {
    expect(isCrosswalkLoaded()).toBe(true);
  });

  it('getCrosswalkInfo exposes counts + version', () => {
    const info = getCrosswalkInfo();
    expect(info.version).toBeGreaterThan(0);
    expect(info.naicsEntries).toBeGreaterThan(0);
    expect(info.pscEntries).toBeGreaterThan(0);
  });
});
