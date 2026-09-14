/**
 * FCO roster watch + census contract.
 *
 * The scenario every test here exists for: **State joined FCO on 2026-08-19/20 and nothing
 * noticed for three and a half weeks**, because the only enumerator stopped at 8,000 rows of a
 * 9,225-row source. These assert the watcher cannot repeat that.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  evaluateFcoWatch, dedupeFcoEvents, POPULATION_ABS_THRESHOLD,
  type FcoWatchState,
} from './fco-roster-watch';
import { fingerprintRows, normalizeListingId, parseChanged, mapFcoRow, type FcoCensus } from './fco-census';

const census = (over: Partial<FcoCensus> = {}): FcoCensus => ({
  reportedTotal: 9225, uniqueRows: 9225, uniqueListingIds: 9216, duplicateListingIds: 9,
  departments: [
    { department: 'Department of the Interior', rows: 4254, listingIds: 4249 },
    { department: 'Department of Agriculture', rows: 2519, listingIds: 2519 },
  ],
  maxChanged: '2026-09-14', fingerprint: 'abc:9225', pagesFetched: 370, pagesFailed: 0,
  complete: true, ...over,
});
const prior = (over: Partial<FcoWatchState> = {}): FcoWatchState => ({
  departments: ['Department of Agriculture', 'Department of the Interior'],
  perDepartment: { 'Department of the Interior': 4254, 'Department of Agriculture': 2519 },
  reportedTotal: 9225, maxChanged: '2026-09-14', fingerprint: 'abc:9225', ...over,
});

describe('the State scenario cannot recur', () => {
  it('a NEW department raises a critical alert naming it', () => {
    const c = census({ departments: [...census().departments, { department: 'Department of State', rows: 396, listingIds: 396 }] });
    const r = evaluateFcoWatch({ census: c, previous: prior(), heldCanonical: 6724 });
    const e = r.events.find((x) => x.type === 'department_appeared');
    expect(e).toBeTruthy();
    expect(e!.severity).toBe('critical');
    expect(e!.message).toContain('Department of State');
    expect(e!.message).toMatch(/same source|do not create a source instance/i);
  });

  it('an AIR FORCE / SPACE FORCE / DoD department raises the dedicated P0 event', () => {
    for (const dep of ['Department of the Air Force', 'United States Space Force', 'Department of Defense']) {
      const c = census({ departments: [...census().departments, { department: dep, rows: 10, listingIds: 10 }] });
      const r = evaluateFcoWatch({ census: c, previous: prior(), heldCanonical: 6724 });
      const e = r.events.find((x) => x.type === 'dod_component_appeared');
      expect(e, `${dep} did not raise the DoD event`).toBeTruthy();
      expect(e!.severity).toBe('critical');
    }
  });

  it('JOB SUCCESS != DATA CURRENTNESS — a clean run still reports held-behind-upstream', () => {
    const r = evaluateFcoWatch({ census: census(), previous: prior(), heldCanonical: 6724 });
    const e = r.events.find((x) => x.type === 'held_behind_upstream');
    expect(e).toBeTruthy();
    expect(e!.message).toMatch(/does NOT mean the source is ingested/i);
  });

  it('when held has caught up, no held-behind event fires', () => {
    const r = evaluateFcoWatch({ census: census(), previous: prior(), heldCanonical: 9216 });
    expect(r.events.find((x) => x.type === 'held_behind_upstream')).toBeUndefined();
  });
});

describe('an incomplete census is NOT a successful check', () => {
  it('does not advance last_successful_check and does not overwrite prior state', () => {
    const c = census({ complete: false, incompleteReason: 'enumerated 8000 of reported 9225', uniqueRows: 8000 });
    const r = evaluateFcoWatch({ census: c, previous: prior(), heldCanonical: 6724 });
    expect(r.clocks.lastPoll).toBeTruthy();
    expect(r.clocks.lastSuccessfulCheck).toBeNull();
    expect(r.clocks.lastSourceAdvance).toBeNull();
    expect(r.next).toBeNull();
    expect(r.events[0].type).toBe('enumeration_incomplete');
  });

  it('a partial census NEVER claims a department disappeared', () => {
    // The 8,000-row ceiling truncates the tail — exactly where a new department would sit.
    const c = census({ complete: false, incompleteReason: 'partial', departments: [] });
    const r = evaluateFcoWatch({ census: c, previous: prior(), heldCanonical: 6724 });
    expect(r.events.some((e) => e.type === 'department_disappeared')).toBe(false);
  });

  it('unreachable source is distinguished from an incomplete enumeration', () => {
    const c = census({ complete: false, pagesFetched: 0, incompleteReason: 'page 0 unreadable' });
    const r = evaluateFcoWatch({ census: c, previous: prior(), heldCanonical: 6724 });
    expect(r.events[0].type).toBe('source_unreachable');
  });
});

describe('clock semantics', () => {
  it('last_source_advance is the SOURCE MAX(changed), never a Mindy timestamp', () => {
    const r = evaluateFcoWatch({ census: census({ maxChanged: '2026-09-11' }), previous: prior(), heldCanonical: 9216 });
    expect(r.clocks.lastSourceAdvance).toBe('2026-09-11');
  });
  it('a watch NEVER advances ingest clocks', () => {
    const r = evaluateFcoWatch({ census: census(), previous: prior(), heldCanonical: 9216 });
    expect(r.clocks).not.toHaveProperty('lastVerifiedIngest');
    expect(r.clocks).not.toHaveProperty('lastDataAdvance');
  });
  it('held_population is not touched by a watch', () => {
    const r = evaluateFcoWatch({ census: census(), previous: prior(), heldCanonical: 9216 });
    expect(r.clocks).not.toHaveProperty('heldPopulation');
  });
});

describe('population movement + dedup', () => {
  it('a material move alerts; a small one does not', () => {
    const big = evaluateFcoWatch({
      census: census({ departments: [{ department: 'Department of the Interior', rows: Math.round(4254 * 1.2), listingIds: 1 }, census().departments[1]] }),
      previous: prior(), heldCanonical: 9216,
    });
    expect(big.events.some((e) => e.type === 'population_moved')).toBe(true);
    const small = evaluateFcoWatch({
      census: census({ departments: [{ department: 'Department of the Interior', rows: 4264, listingIds: 1 }, census().departments[1]] }),
      previous: prior(), heldCanonical: 9216,
    });
    expect(small.events.some((e) => e.type === 'population_moved')).toBe(false);
  });

  it('an unchanged condition does not re-alert', () => {
    const c = census({ departments: [...census().departments, { department: 'Department of State', rows: 396, listingIds: 396 }] });
    const first = evaluateFcoWatch({ census: c, previous: prior(), heldCanonical: 6724 });
    const seen = new Set(first.events.map((e) => e.dedupeKey));
    expect(dedupeFcoEvents(first.events, seen)).toHaveLength(0);
  });

  it('first ever run emits no roster churn (nothing to compare)', () => {
    const r = evaluateFcoWatch({ census: census(), previous: null, heldCanonical: 9216 });
    expect(r.events.some((e) => ['department_appeared', 'department_disappeared'].includes(e.type))).toBe(false);
    expect(r.next).not.toBeNull();
  });
});

describe('census primitives — the traps that were measured', () => {
  it('the CSV/API separator trap: ids normalise to the same value', () => {
    expect(normalizeListingId('FY26-WBSCM-000835')).toBe(normalizeListingId('FY26_WBSCM_000835'));
  });
  it('changed parses from the ISO datetime attribute, not the display text', () => {
    expect(parseChanged('<time datetime="2026-09-11T09:21:52-04:00">09/11/2026</time>')).toBe('2026-09-11T09:21:52-04:00');
  });
  it('fingerprint is order-independent and movement-sensitive', () => {
    const a = [{ listingId: 'A', changed: '1' }, { listingId: 'B', changed: '2' }] as never[];
    const b = [{ listingId: 'B', changed: '2' }, { listingId: 'A', changed: '1' }] as never[];
    const c = [{ listingId: 'A', changed: '9' }, { listingId: 'B', changed: '2' }] as never[];
    expect(fingerprintRows(a)).toBe(fingerprintRows(b));
    expect(fingerprintRows(a)).not.toBe(fingerprintRows(c));
  });
  it('mapFcoRow reads the department from field_result_id', () => {
    // 79% of rows have a NULL funding_organization; the department lives in field_result_id.
    const r = mapFcoRow({ nid: '1', field_result_id: 'Department of State', field_funding_organization: '' });
    expect(r.department).toBe('Department of State');
  });
});

describe('the census module can never write forecasts', () => {
  /**
   * ⚠️ STRIP COMMENTS FIRST. Both modules' docblocks deliberately QUOTE the things they forbid
   * ("must never write agency_forecasts", "start < 320"), so a naive grep matches the explanation
   * and reports the bug as present. That false positive is what trains people to delete the guard.
   * Same rule as scripts/audit-supabase-errors.mjs.
   */
  const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  const SRC = strip(readFileSync(join(process.cwd(), 'src/lib/forecasts/fco-census.ts'), 'utf8'));
  const WATCH = strip(readFileSync(join(process.cwd(), 'src/lib/forecasts/fco-roster-watch.ts'), 'utf8'));
  it('neither module references agency_forecasts or a supabase client', () => {
    for (const [n, s] of Object.entries({ SRC, WATCH })) {
      expect(s, `${n} touches agency_forecasts`).not.toContain('agency_forecasts');
      expect(s, `${n} imports supabase`).not.toMatch(/createClient|@supabase/);
      expect(s, `${n} can mutate`).not.toMatch(/\.(upsert|insert|update|delete)\(/);
    }
  });
  it('enumeration is not bounded by a page-number ceiling of 320', () => {
    expect(SRC).not.toMatch(/start\s*<\s*320/);
    expect(SRC).toContain('MAX_PAGES');
    expect(SRC).toMatch(/reportedTotal/); // termination is by the source's own total
  });
});
