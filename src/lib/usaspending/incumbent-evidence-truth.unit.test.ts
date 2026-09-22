/**
 * POTETO — Incumbent Evidence Truth (2026-09-22).
 *   CANDIDATES → EVIDENCE → SCORE → CONFIDENCE → SELECTION → EXPLANATION
 *
 * Production before (hosted MCP), 36C24226Q0857 VA demolition (NAICS 236220):
 *   every prior_awards row — AT&T "EAST ORANGE & LYONS NJ GUEST WIFI" (517110),
 *   a boiler inspection, temperature sensors, pharmacy inventory — carried
 *   matchConfidence "high" / matchScore ~105 with naicsMatch=false, pscMatch=false
 *   and a sector conflict; and find_predecessor_award returned AT&T as the
 *   "Likely incumbent … [match: high]" with grounded=true.
 *
 * Two root causes, both locked here:
 *   1. confidence came from the textual score alone — structured evidence only
 *      reached the (separate) selection guard;
 *   2. USASpending returns PSC as { code, description }; String(obj) made
 *      pscMatch false on EVERY live candidate.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reconcileMatchConfidence, groundIncumbent } from './incumbent-evidence';
import { awardPscCode, scoreAwardEvidence } from './solicitation-incumbent';

describe('confidence agrees with structured evidence', () => {
  it('AT&T (sector 23 vs 51, dual mismatch) cannot be high — sector conflict forces low', () => {
    const r = reconcileMatchConfidence('high', { naicsMatch: false, pscMatch: false, noticeSector: '23', awardSector: '51' });
    expect(r.matchConfidence).toBe('low');
    expect(r.constraint).toBe('sector_conflict');
  });

  it('Lockheed PAC-3 (sector 32 vs 33) cannot be high', () => {
    const r = reconcileMatchConfidence('high', { naicsMatch: false, pscMatch: false, noticeSector: '32', awardSector: '33' });
    expect(r.matchConfidence).toBe('low');
  });

  it('dual NAICS+PSC mismatch in the same sector caps at medium (title tokens alone)', () => {
    const r = reconcileMatchConfidence('high', { naicsMatch: false, pscMatch: false, noticeSector: '56', awardSector: '56' });
    expect(r.matchConfidence).toBe('medium');
    expect(r.constraint).toBe('no_taxonomy_agreement');
  });

  it('never raises confidence', () => {
    expect(reconcileMatchConfidence('low', { naicsMatch: false, pscMatch: false }).matchConfidence).toBe('low');
    expect(reconcileMatchConfidence('medium', { naicsMatch: true, pscMatch: true, noticeSector: '23', awardSector: '23' }).matchConfidence).toBe('medium');
  });

  it('positive control: agreeing evidence keeps high (Weeks Marine dredging)', () => {
    const r = reconcileMatchConfidence('high', { naicsMatch: true, pscMatch: true, noticeSector: '23', awardSector: '23' });
    expect(r).toEqual({ matchConfidence: 'high', constraint: null });
  });

  it('only verified identity lifts a sector conflict — mirroring the selection guard', () => {
    const r = reconcileMatchConfidence('high', { naicsMatch: false, pscMatch: true, noticeSector: '23', awardSector: '51', verifiedIdentity: true });
    expect(r.matchConfidence).toBe('high');
  });

  it('a missing sector is "cannot compare", not a conflict', () => {
    const r = reconcileMatchConfidence('high', { naicsMatch: true, pscMatch: false, noticeSector: null, awardSector: '51' });
    expect(r.matchConfidence).toBe('high');
  });

  it('selection stays stricter: a reconciled candidate is still never supported on geography alone', () => {
    const { matchConfidence } = reconcileMatchConfidence('high', { naicsMatch: false, pscMatch: false, noticeSector: '23', awardSector: '51' });
    const g = groundIncumbent({ distinctiveHits: 2, pscMatch: false, naicsMatch: false, matchConfidence, noticeSector: '23', awardSector: '51' });
    expect(g.grounded).toBe(false);
  });
});

describe('PSC evidence is read from the real USASpending shape', () => {
  it('reads { code } objects and plain strings', () => {
    expect(awardPscCode({ code: 'Z1KF', description: 'MAINTENANCE OF DREDGING FACILITIES' })).toBe('Z1KF');
    expect(awardPscCode('S201')).toBe('S201');
    expect(awardPscCode(null)).toBe('');
  });

  it('a same-PSC award (object-shaped, as USASpending returns it) earns pscMatch', () => {
    const ev = scoreAwardEvidence(
      { Description: 'PALM BEACH HARBOR MAINTENANCE DREDGING', PSC: { code: 'Z1KF' }, 'Award Amount': 1e7 },
      ['Palm', 'Beach', 'Harbor', 'Maintenance', 'Dredging'],
      null,
      'Z1KF',
    );
    expect(ev.pscMatch).toBe(true);
  });

  it('a different PSC does not match', () => {
    const ev = scoreAwardEvidence(
      { Description: 'EAST ORANGE & LYONS NJ GUEST WIFI', PSC: { code: 'DE10' }, 'Award Amount': 7e5 },
      ['VANJHCS', 'Demolition', 'Abatement', 'IDIQ', 'East', 'Orange', 'Lyons'],
      null,
      'Z1DA',
    );
    expect(ev.pscMatch).toBe(false);
  });
});

// ── SELECTION: the entry point that never ran the guard ─────────────────────
const hits = vi.hoisted(() => ({ value: [] as unknown[] }));
vi.mock('./solicitation-incumbent', async (orig) => ({
  ...(await orig<typeof import('./solicitation-incumbent')>()),
  findLikelyPriorAwards: vi.fn(async () => hits.value),
}));

describe('findPredecessorAward selection', () => {
  beforeEach(() => { hits.value = []; });

  it('does not present a sector-conflicted candidate as the likely incumbent', async () => {
    const { findPredecessorAward } = await import('./find-predecessor');
    hits.value = [{ recipientName: 'AT&T ENTERPRISES, LLC', matchConfidence: 'low', confidenceConstraint: 'sector_conflict', noticeSector: '23', awardSector: '51' }];
    expect(await findPredecessorAward({ naicsCode: '236220', keyword: 'Demolition and Abatement IDIQ East Orange and Lyons' })).toBeNull();
  });

  it('still returns a supported same-work predecessor (recall preserved)', async () => {
    const { findPredecessorAward } = await import('./find-predecessor');
    hits.value = [{ recipientName: 'WEEKS MARINE, INC.', matchConfidence: 'high', confidenceConstraint: null, noticeSector: '23', awardSector: '23' }];
    expect((await findPredecessorAward({ naicsCode: '237990', keyword: 'Palm Beach Harbor Maintenance Dredging' }))?.recipientName).toBe('WEEKS MARINE, INC.');
  });
});
