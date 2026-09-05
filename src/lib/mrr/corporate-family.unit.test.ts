/**
 * Corporate-family resolver — mutation / fail-closed tests.
 *
 * These guard the Rule-of-Two counting surface: naive UEI counting, name-only
 * parent merge, ambiguous parents treated as resolved, and lookup failure
 * treated as empty success must all FAIL CLOSED.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  resolveCorporateFamily,
  resolveCorporateFamilies,
  countEligibleFamilies,
  defaultParentEdgeLookup,
} from './corporate-family';
import type { ParentEdgeLookup, ParentEdgeLookupResult } from './types';

const PARENT = 'PARENT000001';
const CHILD_A = 'CHILD000000A';
const CHILD_B = 'CHILD000000B';
const SOLO_X = 'SOLOXXXX0001';
const SOLO_Y = 'SOLOYYYY0002';
const AS_OF = '2026-08-01';
const RETRIEVED = '2026-09-05T12:00:00.000Z';

function okLookup(partial: Partial<ParentEdgeLookupResult> & Pick<ParentEdgeLookupResult, 'parents'>): ParentEdgeLookupResult {
  return {
    ok: true,
    asOf: AS_OF,
    retrievedAt: RETRIEVED,
    members: partial.members,
    memberNames: partial.memberNames,
    error: undefined,
    ...partial,
  };
}

function fixtureLookup(
  byUei: Record<string, ParentEdgeLookupResult>,
): ParentEdgeLookup {
  return async (uei) => {
    const key = uei.trim().toUpperCase();
    const row = byUei[key];
    if (!row) {
      return okLookup({ parents: [], members: [key] });
    }
    return row;
  };
}

describe('resolveCorporateFamily — parent_uei edges only', () => {
  it('1. two UEIs with the same parent share one familyKey; RoT count is 1', async () => {
    const lookup = fixtureLookup({
      [CHILD_A]: okLookup({
        parents: [{ parentUei: PARENT, awardCount: 12, parentName: 'Acme Holdings' }],
        members: [CHILD_A, CHILD_B, PARENT],
        memberNames: { [PARENT]: 'Acme Holdings', [CHILD_A]: 'Acme Unit A', [CHILD_B]: 'Acme Unit B' },
      }),
      [CHILD_B]: okLookup({
        parents: [{ parentUei: PARENT, awardCount: 4, parentName: 'Acme Holdings' }],
        members: [CHILD_A, CHILD_B, PARENT],
      }),
    });

    const a = await resolveCorporateFamily(CHILD_A, lookup);
    const b = await resolveCorporateFamily(CHILD_B, lookup);

    expect(a.method).toBe('usaspending_parent_uei');
    expect(a.confidence).toBe('high');
    expect(a.ruleOfTwoEligible).toBe(true);
    expect(a.canonical?.familyKey).toBe(PARENT);
    expect(b.canonical?.familyKey).toBe(PARENT);
    expect(a.canonical?.familyKey).toBe(b.canonical?.familyKey);

    const { eligibleKeys, excluded } = countEligibleFamilies([a, b]);
    expect(eligibleKeys).toEqual([PARENT]);
    expect(eligibleKeys).toHaveLength(1);
    expect(excluded).toHaveLength(0);
  });

  it('2. conflicting parents → unresolved, NOT Rule-of-Two eligible', async () => {
    const lookup = fixtureLookup({
      [CHILD_A]: okLookup({
        parents: [
          { parentUei: 'PARENTAAAA01', awardCount: 3, parentName: 'Alpha' },
          { parentUei: 'PARENTBBBB02', awardCount: 1, parentName: 'Beta' },
        ],
      }),
    });

    const r = await resolveCorporateFamily(CHILD_A, lookup);
    expect(r.method).toBe('conflicting_parent_uei');
    expect(r.confidence).toBe('unresolved');
    expect(r.ruleOfTwoEligible).toBe(false);
    expect(r.canonical).toBeNull();
    expect(r.ineligibleReason).toMatch(/ambiguous parent_uei/);
    expect(r.evidence.parentUeiDistinct).toHaveLength(2);

    const { eligibleKeys, excluded } = countEligibleFamilies([r]);
    expect(eligibleKeys).toHaveLength(0);
    expect(excluded).toEqual([
      expect.objectContaining({ uei: CHILD_A }),
    ]);
  });

  it('3. name-only scenario: no parents → TWO separate self families (name merge refused)', async () => {
    // Both firms share a display name pattern ("LOCKHEED MARTIN …") but the
    // lookup returns ZERO parent_uei edges. Name similarity MUST NOT merge them.
    const lookup = fixtureLookup({
      [SOLO_X]: okLookup({
        parents: [],
        members: [SOLO_X],
        memberNames: { [SOLO_X]: 'LOCKHEED MARTIN CORP' },
      }),
      [SOLO_Y]: okLookup({
        parents: [],
        members: [SOLO_Y],
        memberNames: { [SOLO_Y]: 'LOCKHEED MARTIN CORPORATION' },
      }),
    });

    const x = await resolveCorporateFamily(SOLO_X, lookup);
    const y = await resolveCorporateFamily(SOLO_Y, lookup);

    expect(x.method).toBe('self_null_or_absent_parent');
    expect(y.method).toBe('self_null_or_absent_parent');
    expect(x.confidence).toBe('medium');
    expect(y.confidence).toBe('medium');
    expect(x.ruleOfTwoEligible).toBe(true);
    expect(y.ruleOfTwoEligible).toBe(true);

    // Separate self families — familyKey is each UEI, never a name key.
    expect(x.canonical?.familyKey).toBe(SOLO_X);
    expect(y.canonical?.familyKey).toBe(SOLO_Y);
    expect(x.canonical?.familyKey).not.toBe(y.canonical?.familyKey);

    const { eligibleKeys } = countEligibleFamilies([x, y]);
    expect(eligibleKeys.sort()).toEqual([SOLO_X, SOLO_Y].sort());
    expect(eligibleKeys).toHaveLength(2);
  });

  it('4. lookup failure → unresolved; NOT treated as empty-parent success', async () => {
    const lookup: ParentEdgeLookup = async () => ({
      ok: false,
      error: 'BigQuery quota exceeded',
      asOf: null,
      parents: [],
      retrievedAt: RETRIEVED,
    });

    const r = await resolveCorporateFamily(CHILD_A, lookup);
    expect(r.method).toBe('lookup_failed');
    expect(r.confidence).toBe('unresolved');
    expect(r.ruleOfTwoEligible).toBe(false);
    expect(r.canonical).toBeNull();
    // Critical: failure must not collapse into self_null_or_absent_parent
    expect(r.method).not.toBe('self_null_or_absent_parent');
    expect(r.ineligibleReason).toMatch(/quota/i);

    const thrown: ParentEdgeLookup = async () => {
      throw new Error('network reset');
    };
    const r2 = await resolveCorporateFamily(CHILD_A, thrown);
    expect(r2.method).toBe('lookup_failed');
    expect(r2.ruleOfTwoEligible).toBe(false);
    expect(r2.canonical).toBeNull();
  });

  it('5. malformed / empty UEI → malformed_uei, unresolved, not eligible', async () => {
    const spy = vi.fn(async (): Promise<ParentEdgeLookupResult> =>
      okLookup({ parents: [] }),
    );

    for (const bad of ['', '   ', 'TOOSHORT', 'WAYTOOLONGUEI123', 'bad uei!!!!']) {
      const r = await resolveCorporateFamily(bad, spy);
      expect(r.method).toBe('malformed_uei');
      expect(r.confidence).toBe('unresolved');
      expect(r.ruleOfTwoEligible).toBe(false);
      expect(r.canonical).toBeNull();
    }
    // Lookup must never run for malformed input
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('resolveCorporateFamilies — batch + shared lookup', () => {
  it('shares lookup calls across duplicate UEIs and preserves same-parent familyKey', async () => {
    let calls = 0;
    const lookup: ParentEdgeLookup = async (uei) => {
      calls += 1;
      const key = uei.trim().toUpperCase();
      if (key === CHILD_A || key === CHILD_B) {
        return okLookup({
          parents: [{ parentUei: PARENT, awardCount: 1, parentName: 'Parent Co' }],
          members: [CHILD_A, CHILD_B],
        });
      }
      return okLookup({ parents: [] });
    };

    const map = await resolveCorporateFamilies(
      [CHILD_A, CHILD_B, CHILD_A],
      lookup,
    );
    // Map keyed by input UEI — duplicate CHILD_A overwrites → size 2
    expect(map.size).toBe(2);
    expect(map.get(CHILD_A)?.canonical?.familyKey).toBe(PARENT);
    expect(map.get(CHILD_B)?.canonical?.familyKey).toBe(PARENT);
    // CHILD_A looked up once despite appearing twice in the input list
    expect(calls).toBe(2);
  });
});

describe('countEligibleFamilies', () => {
  it('excludes unresolved while counting distinct eligible familyKeys', async () => {
    const lookup = fixtureLookup({
      [CHILD_A]: okLookup({
        parents: [{ parentUei: PARENT, awardCount: 1, parentName: null }],
      }),
      [CHILD_B]: okLookup({
        parents: [
          { parentUei: 'P1XXXXXXXXX1', awardCount: 1, parentName: null },
          { parentUei: 'P2XXXXXXXXX2', awardCount: 1, parentName: null },
        ],
      }),
    });
    const a = await resolveCorporateFamily(CHILD_A, lookup);
    const b = await resolveCorporateFamily(CHILD_B, lookup);
    const { eligibleKeys, excluded } = countEligibleFamilies([a, b]);
    expect(eligibleKeys).toEqual([PARENT]);
    expect(excluded).toHaveLength(1);
    expect(excluded[0].uei).toBe(CHILD_B);
  });
});

describe('defaultParentEdgeLookup — awards only (no rollup)', () => {
  it('is a function that returns a ParentEdgeLookup', () => {
    const fn = defaultParentEdgeLookup();
    expect(typeof fn).toBe('function');
  });

  it('source module never queries the name-merge rollup (awards primary; recipients OK as fallback)', async () => {
    // Structural guard: implementation must never name/query the name-merge rollup.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.join(__dirname, 'corporate-family.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/recipients_rollup/);
    expect(src).not.toMatch(/recipients_rollup_merged/);
    expect(src).toMatch(/BQ_TABLES\.awards/);
    // Per-UEI recipients profile is an allowed quota-fallback — not a name merge.
    expect(src).toMatch(/BQ_TABLES\.recipients/);
  });
});
