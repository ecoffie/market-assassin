/**
 * CHAIN-3 — the decision layer consumes evidence; it never re-derives.
 *
 * Fixtures from the two blind chain runs of 2026-08-25:
 *   FLUIDYNE   evidence retrieved then IGNORED — six tables, no recommendation, market
 *              re-derived from free-text keywords (ammunition NAICS, Boeing as competitor)
 *   NORTH STAR evidence never retrieved, and where retrieved, mis-attributed (FA4610 read
 *              as "Air Force" when it is Space Launch Delta 30)
 */
import { describe, it, expect } from 'vitest';
import { recommendPursuits, type PursuitEvidence } from './pursuit-recommendation';

const NORTH_STAR: PursuitEvidence = {
  company: { name: 'NORTH STAR GOVERNMENT SERVICES', uei: 'FCJCDUZV7RM3' },
  identity: { registrationStatus: 'Active', naicsCodes: ['236220'], has8a: true, hasHUBZone: true, hasWOSB: true },
  demonstrated: [
    { piid: 'FA461025F0190', naicsCode: '236220', value: 565887, endsOn: '2026-09-08',
      customer: { component: 'U.S. Space Force', unit: 'Space Launch Delta 30', installation: 'VANDENBERG SFB', divergesFromAdministrative: true } },
    { piid: 'FA461025F0118', naicsCode: '236220', value: 1366238, endsOn: '2027-04-07',
      customer: { component: 'U.S. Space Force', unit: 'Space Launch Delta 30', installation: 'VANDENBERG SFB', divergesFromAdministrative: true } },
  ],
  reachable: [
    { piid: 'FA461025F0190', incumbentName: 'NORTH STAR GOVERNMENT SERVICES', incumbentUei: 'FCJCDUZV7RM3', naicsCode: '236220', value: 565887, endsOn: '2026-09-08', isOwnIncumbency: true },
    { piid: 'FA461025F0189', incumbentName: 'RDZ CONTRACTORS, INC.', incumbentUei: 'OTHER', naicsCode: '236220', value: 180071, endsOn: '2028-02-21', isOwnIncumbency: false },
  ],
  evidenceGaps: [],
};

describe('CHAIN-3 — North Star reaches the SABER insight from evidence', () => {
  it('⚠️ THE REGRESSION: names Space Launch Delta 30, not "Air Force"', () => {
    const r = recommendPursuits(NORTH_STAR);
    expect(JSON.stringify(r)).toContain('Space Launch Delta 30');
    expect(r.demonstratedProfile.customers[0].label).toBe('Space Launch Delta 30');
  });

  it('prioritises DEFENDING its own expiring work first', () => {
    const r = recommendPursuits(NORTH_STAR);
    expect(r.pursuits[0].what).toMatch(/Defend FA461025F0190/);
    expect(r.pursuits[0].basis).toBe('demonstrated');
  });

  it('every pursuit cites specific evidence rows, never a summary', () => {
    const r = recommendPursuits(NORTH_STAR);
    expect(r.pursuits.every((p) => p.evidence.length > 0)).toBe(true);
    expect(r.pursuits.every((p) => p.why.length > 40)).toBe(true);
  });

  it('surfaces the administrative-vs-operational divergence as a caveat', () => {
    const r = recommendPursuits(NORTH_STAR);
    expect(r.caveats.join(' ')).toMatch(/different administrative hierarchy/i);
  });

  it('claims a certification only where the evidence AFFIRMS it', () => {
    const r = recommendPursuits(NORTH_STAR);
    const setAside = r.pursuits.find((p) => p.what.includes('standing'))!;
    expect(setAside.what).toContain('8(a)');
    expect(setAside.what).toContain('HUBZone');
    expect(setAside.what).not.toContain('SDVOSB');   // undefined = unknown, never claimed
    expect(r.caveats.join(' ')).toMatch(/Certification status unknown/i);
  });
});

describe('refuses rather than inventing — the Fluidyne failure mode', () => {
  it('NO award history yields an honest refusal, not a keyword-derived market', () => {
    const r = recommendPursuits({ ...NORTH_STAR, demonstrated: [], reachable: [] });
    expect(r.pursuits).toEqual([]);
    expect(r.cannotAnswer).toMatch(/no demonstrated basis/i);
    expect(r.cannotAnswer).toMatch(/would be a guess presented as analysis/i);
  });

  it('never labels anything "adjacent" without demonstrated evidence behind it', () => {
    const r = recommendPursuits(NORTH_STAR);
    expect(r.pursuits.every((p) => p.basis === 'demonstrated')).toBe(true);
  });

  it('separates DEMONSTRATED from potential in the profile', () => {
    const r = recommendPursuits(NORTH_STAR);
    expect(r.demonstratedProfile.totalValue).toBe(565887 + 1366238);
    expect(r.demonstratedProfile.naicsCodes).toEqual(['236220']);
  });

  it('carries upstream evidence gaps into the caveats', () => {
    const r = recommendPursuits({ ...NORTH_STAR, evidenceGaps: ['recompete retrieval degraded'] });
    expect(r.caveats).toContain('recompete retrieval degraded');
  });

  it('says so when no recompete was reachable', () => {
    const r = recommendPursuits({ ...NORTH_STAR, reachable: [] });
    expect(r.caveats.join(' ')).toMatch(/No recompetes were reachable/i);
  });
});
