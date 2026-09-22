/**
 * RC-3 — incumbent false-positive guardrail. Two REAL customer-facing incidents,
 * both reported `supported` / high confidence on title-token overlap alone.
 *
 * Reproduced against live data 2026-09-22 before any code changed:
 *
 *   36C24226Q0857 "Z1DA--VANJHCS Demolition and Abatement IDIQ East Orange and
 *     Lyons" (NAICS 236220 construction, PSC Z1DA)
 *     → AT&T "EAST ORANGE & LYONS NJ GUEST WIFI" (NAICS 517110 telecom)
 *     distinctiveHits=3, pscMatch=false, naicsMatch=false, certainty=supported.
 *     The three matching tokens were East, Orange, Lyons — PURE GEOGRAPHY.
 *
 *   SPE60525R0222 "3.22 COG 2 Northeastern United States" (NAICS 324110
 *     petroleum, PSC 9130)
 *     → Lockheed PAC-3 "...(PATRIOT) ADVANCED CAPABILITY-3 (PAC-3) PRODUCTION
 *     REQUIREMENTS FOR THE UNITED STATES (US) AND FOREIGN MILITARY SALES"
 *     (NAICS 336414 aerospace) distinctiveHits=2, pscMatch=false,
 *     naicsMatch=false, certainty=supported.
 *     The two matching tokens were United, States — GOVERNMENT GEOGRAPHY.
 *
 * Telling a contractor that AT&T holds their asbestos-abatement work, or that
 * Lockheed holds their fuel contract, is a confidently wrong deliverable.
 */
import { describe, it, expect } from 'vitest';
import { groundIncumbent } from './incumbent-evidence';

describe('RC-3: no taxonomy agreement can never be supported', () => {
  it('AT&T guest WiFi is NOT a supported incumbent for VA demolition/abatement', () => {
    const g = groundIncumbent({
      distinctiveHits: 3, // East, Orange, Lyons — geography only
      pscMatch: false,
      naicsMatch: false,
      matchConfidence: 'high',
      noticeSector: '23', // construction
      awardSector: '51', // telecom
    });
    expect(g.grounded).toBe(false);
    expect(g.certainty).not.toBe('supported');
  });

  it('Lockheed PAC-3 is NOT a supported incumbent for DLA fuel', () => {
    const g = groundIncumbent({
      distinctiveHits: 2, // United, States
      pscMatch: false,
      naicsMatch: false,
      matchConfidence: 'high',
      noticeSector: '32', // petroleum
      awardSector: '33', // aerospace
    });
    expect(g.grounded).toBe(false);
    expect(g.certainty).not.toBe('supported');
  });

  it('naicsMatch=false AND pscMatch=false is never supported, at any hit count', () => {
    for (const hits of [2, 3, 5, 20]) {
      const g = groundIncumbent({
        distinctiveHits: hits,
        pscMatch: false,
        naicsMatch: false,
        matchConfidence: 'high',
      });
      expect(g.grounded).toBe(false);
    }
  });
});

describe('RC-3: a 2-digit sector conflict hard-rejects', () => {
  it('rejects outright even when PSC matches — different sector is different work', () => {
    const g = groundIncumbent({
      distinctiveHits: 4,
      pscMatch: true, // taxonomy agreement exists…
      naicsMatch: false,
      matchConfidence: 'high',
      noticeSector: '23',
      awardSector: '51', // …but the sectors conflict
    });
    expect(g.certainty).toBe('none');
    expect(g.reason).toMatch(/different kind of work/i);
  });

  it('ONLY independently verified identity makes the sector comparison inapplicable', () => {
    const base = {
      distinctiveHits: 4,
      pscMatch: true,
      naicsMatch: false,
      matchConfidence: 'high' as const,
      noticeSector: '23',
      awardSector: '51',
    };
    expect(groundIncumbent(base).grounded).toBe(false);
    expect(groundIncumbent({ ...base, verifiedIdentity: true }).grounded).toBe(true);
  });

  it('an unknown sector on either side is "cannot compare", never a silent pass', () => {
    // A missing code must not be read as agreement.
    const g = groundIncumbent({
      distinctiveHits: 4, pscMatch: true, naicsMatch: false,
      matchConfidence: 'high', noticeSector: '23', awardSector: null,
    });
    expect(g.grounded).toBe(true); // no conflict PROVEN; PSC carries it
    expect(g.certainty).toBe('supported');
  });
});

describe('RC-3: legitimate incumbents still resolve', () => {
  it('same sector + PSC match + high confidence stays supported', () => {
    const g = groundIncumbent({
      distinctiveHits: 3,
      pscMatch: true,
      naicsMatch: true,
      matchConfidence: 'high',
      noticeSector: '23',
      awardSector: '23',
    });
    expect(g.grounded).toBe(true);
    expect(g.certainty).toBe('supported');
  });

  it('a same-sector NAICS match with distinctive work tokens stays supported', () => {
    const g = groundIncumbent({
      distinctiveHits: 2, pscMatch: false, naicsMatch: true,
      matchConfidence: 'high', noticeSector: '23', awardSector: '23',
    });
    expect(g.grounded).toBe(true);
  });
});
