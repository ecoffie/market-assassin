import { describe, it, expect } from 'vitest';
import {
  buildResolveUeisQuery,
  mapResolveRow,
  resolveUei,
  resolveUeis,
  RESOLVE_UEI_CTE,
} from './resolve-uei';

/**
 * These lock the TIE-BREAK ORDER and the dedupe contract. The ranking itself was
 * verified against live BigQuery on 2026-08-07 (9 UEIs in → 9 rows out, zero
 * duplicates, every known-hard case resolving to the recognizable company).
 * What follows guards the parts that can silently rot in code review.
 */

const row = (over: Partial<Record<string, unknown>> = {}) => ({
  uei: 'LVYXJGXKBQG3',
  rollup_uei: 'ROLLUPAAAAAA',
  rollup_name: 'WASTE MANAGEMENT, INC.',
  state: 'WV',
  city: 'Charleston',
  cage_code: '1ABC2',
  total_obligated: 137_500_000,
  award_count: 1558,
  distinct_agency_count: 21,
  distinct_naics_count: 44,
  child_count: 235,
  first_action_date: { value: '2008-03-04' },
  last_action_date: { value: '2026-04-22' },
  matched_as_child: true,
  candidate_count: 2,
  ...over,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}) as any;

describe('resolve-uei SQL', () => {
  it('orders self-match first, then obligated, then awards, then a deterministic backstop', () => {
    // The whole correctness of the resolver is this ORDER BY. If someone reorders
    // it, "USA WASTE OF CALIFORNIA INC" starts rendering as Zippy Shell again.
    expect(RESOLVE_UEI_CTE).toContain(
      'ORDER BY is_self DESC, total_obligated DESC, award_count DESC, rollup_uei ASC'
    );
  });

  it('partitions by uei so each input yields exactly one row', () => {
    expect(RESOLVE_UEI_CTE).toContain('PARTITION BY uei');
    expect(buildResolveUeisQuery()).toContain('WHERE rn = 1');
  });

  it('matches both as rollup parent and as absorbed child', () => {
    expect(RESOLVE_UEI_CTE).toContain('r.rollup_uei = i.uei');
    expect(RESOLVE_UEI_CTE).toContain('i.uei IN UNNEST(r.child_ueis)');
  });

  it('passes UEIs as a bound parameter, never string-interpolated', () => {
    const sql = buildResolveUeisQuery();
    expect(sql).toContain('UNNEST(@ueis)');
    expect(sql).not.toMatch(/UNNEST\(\s*\[/); // no inlined array literal
  });

  it('drops empty strings before querying — SAM ships ueiSAM:""', () => {
    expect(buildResolveUeisQuery()).toContain("uei != ''");
  });
});

describe('mapResolveRow', () => {
  it('unwraps BigQuery DATE objects into plain strings', () => {
    const m = mapResolveRow(row());
    expect(m.lastActionDate).toBe('2026-04-22');
    expect(m.firstActionDate).toBe('2008-03-04');
  });

  it('accepts a bare date string too', () => {
    const m = mapResolveRow(row({ last_action_date: '2026-04-22' }));
    expect(m.lastActionDate).toBe('2026-04-22');
  });

  it('coerces null numerics to 0 rather than NaN', () => {
    const m = mapResolveRow(
      row({ total_obligated: null, award_count: null, child_count: null })
    );
    expect(m.totalObligated).toBe(0);
    expect(m.awardCount).toBe(0);
    expect(m.childCount).toBe(0);
  });

  it('surfaces matchedAsChild so the UI can say "part of X"', () => {
    expect(mapResolveRow(row({ matched_as_child: true })).matchedAsChild).toBe(true);
    expect(mapResolveRow(row({ matched_as_child: false })).matchedAsChild).toBe(false);
  });
});

describe('resolveUeis', () => {
  it('dedupes, trims and drops blanks before hitting BigQuery', async () => {
    let seen: string[] = [];
    await resolveUeis(
      ['ABC123ABC123', ' ABC123ABC123 ', '', '   ', 'DEF456DEF456'],
      async (_sql, params) => {
        seen = params.ueis as string[];
        return [];
      }
    );
    expect(seen).toEqual(['ABC123ABC123', 'DEF456DEF456']);
  });

  it('never queries when there is nothing to resolve', async () => {
    let called = false;
    const out = await resolveUeis(['', '  '], async () => {
      called = true;
      return [];
    });
    expect(called).toBe(false);
    expect(out.size).toBe(0);
  });

  it('keys the map by the INPUT uei, not the rollup uei', async () => {
    // The caller holds sam_opportunities.awardee_uei and must be able to look up
    // by that value — keying on rollup_uei would make every child lookup miss.
    const out = await resolveUeis(['LVYXJGXKBQG3'], async () => [row()]);
    expect(out.has('LVYXJGXKBQG3')).toBe(true);
    expect(out.get('LVYXJGXKBQG3')?.rollupName).toBe('WASTE MANAGEMENT, INC.');
    expect(out.has('ROLLUPAAAAAA')).toBe(false);
  });

  it('returns a miss rather than inventing a company', async () => {
    // ~1 in 6 SAM awardees has no UEI, and some UEIs are too new for the rollup.
    // Callers fall back to awardee_name; they must never get a wrong name here.
    const out = await resolveUeis(['ZZZNOTREAL999'], async () => []);
    expect(out.get('ZZZNOTREAL999')).toBeUndefined();
  });
});

describe('resolveUei (single)', () => {
  it('returns null on a miss', async () => {
    expect(await resolveUei('ZZZNOTREAL999', async () => [])).toBeNull();
  });

  it('trims before lookup', async () => {
    const got = await resolveUei('  LVYXJGXKBQG3  ', async () => [row()]);
    expect(got?.rollupName).toBe('WASTE MANAGEMENT, INC.');
  });
});
