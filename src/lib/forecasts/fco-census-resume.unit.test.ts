/**
 * FCO census must be able to RESUME TO COMPLETION across runs.
 *
 * Measured upstream (2026-11): 13,464 listings = ~540 pages at ~3.5 s each (~31 min), against a
 * 240 s run budget (~65 pages). Before this fix:
 *   (1) a resumed run started at the stored page with an EMPTY seen set and needed seen >= total
 *       on its own, so it could never complete;
 *   (2) a resumed run that reached the end incomplete returned resumePage=null, and the runner only
 *       rewrote the stored `{resumePage, partial:true}` when a NEW cursor existed — so every run
 *       restarted at the same late page forever.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { runFcoCensus, totalMovedMaterially, type FcoCensusProgress } from './fco-census';
import { runFcoWatch } from './fco-watch-run';

const TOTAL = 13_464;
const PER_PAGE = 25;
const PAGE_MS = 3_500;
const BUDGET_MS = 240_000;
const DEPTS = ['Department of the Interior', 'Department of Agriculture', 'Department of State'];

let clock = 0;
beforeEach(() => {
  clock = 1_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/**
 * Live-shaped source: page=2 repeats page=1 (measured 2026-11-19), so `total` rows occupy
 * ceil(total/25)+1 page indices — 540 for 13,464. Every fetch costs PAGE_MS of wall clock.
 */
function makeSource(opts: { total?: () => number; rows?: number } = {}) {
  const totalNow = opts.total ?? (() => TOTAL);
  const fetched: number[] = [];
  const impl = async (url: string) => {
    clock += PAGE_MS;
    const pageNo = Number(new URL(url).searchParams.get('page'));
    fetched.push(pageNo);
    const rowsCount = opts.rows ?? totalNow();
    const slice = pageNo <= 1 ? pageNo : pageNo === 2 ? 1 : pageNo - 1;
    const start = slice * PER_PAGE;
    const end = Math.min(start + PER_PAGE, rowsCount);
    const data = [] as Array<{ render: Record<string, unknown> }>;
    for (let i = start; i < end; i++) {
      data.push({ render: {
        nid: String(100_000 + i),
        title: `Row ${i}`,
        field_result_id: DEPTS[i % DEPTS.length],
        field_source_listing_id: `FY26_X_${i}`,
        changed: `<time datetime="2026-11-${String(1 + (i % 20)).padStart(2, '0')}T00:00:00Z">x</time>`,
      } });
    }
    return { ok: true, status: 200, json: async () => ({ listing: { total: String(totalNow()), data } }) };
  };
  return { impl, fetched };
}

const expectedDept = (d: string, total = TOTAL) =>
  Array.from({ length: total }, (_, i) => i).filter((i) => DEPTS[i % DEPTS.length] === d).length;

describe('runFcoCensus — cumulative progress across runs', () => {
  it('a 540-page source completes over ~9 budgeted runs with exact coverage', async () => {
    const src = makeSource();
    let progress: FcoCensusProgress | null = null;
    let runs = 0;
    let last;
    for (; runs < 20; ) {
      runs++;
      last = await runFcoCensus({ fetchImpl: src.impl, progress, budgetMs: BUDGET_MS, retryBaseMs: 0 });
      if (last.complete) break;
      expect(last.degraded).toBe(true);
      expect(last.progress, `run ${runs} must carry progress`).not.toBeNull();
      // The cursor ALWAYS advances — never the same late page again.
      if (progress) expect(last.progress!.next_page).toBeGreaterThan(progress.next_page);
      progress = last.progress!;
    }
    expect(last!.complete).toBe(true);
    expect(runs).toBeGreaterThanOrEqual(8);
    expect(runs).toBeLessThanOrEqual(10);
    expect(last!.runsSpanned).toBe(runs);
    expect(last!.uniqueRows).toBe(TOTAL);
    expect(last!.uniqueListingIds).toBe(TOTAL);
    expect(last!.progress).toBeNull();
    expect(last!.resumePage).toBeNull();
    expect(last!.restartReason).toBeUndefined();
    for (const d of DEPTS) {
      expect(last!.departments.find((x) => x.department === d)?.rows).toBe(expectedDept(d));
    }
    expect(last!.maxChanged).toBe('2026-11-20T00:00:00Z');
    expect(last!.fingerprint).toMatch(/^cum:[0-9a-f]{16}:13464$/);
    // Every page index 0..539 was read exactly once across the census: no gaps, no re-walks.
    const sorted = [...src.fetched].sort((a, b) => a - b);
    expect(sorted).toEqual(Array.from({ length: 540 }, (_, i) => i));
  });

  it('the cross-run digest is order-independent: same corpus, same fingerprint regardless of run split', async () => {
    const run = async (budget: number) => {
      const src = makeSource({ rows: 300, total: () => 300 });
      let progress: FcoCensusProgress | null = null;
      for (let i = 0; i < 50; i++) {
        const c = await runFcoCensus({ fetchImpl: src.impl, progress, budgetMs: budget, retryBaseMs: 0 });
        if (c.complete) return c.fingerprint;
        progress = c.progress!;
      }
      throw new Error('never completed');
    };
    expect(await run(10_000)).toBe(await run(20_000));
  });

  it('a repeated page index across the run boundary is skipped, not double-counted', async () => {
    // Budget allows exactly 2 pages (0 and 1); the next run starts at page 2, which repeats page 1.
    const src = makeSource({ rows: 100, total: () => 100 });
    const first = await runFcoCensus({ fetchImpl: src.impl, budgetMs: PAGE_MS, retryBaseMs: 0 });
    expect(first.progress!.next_page).toBe(2);
    expect(first.progress!.rows_seen_so_far).toBe(50);
    const second = await runFcoCensus({ fetchImpl: src.impl, progress: first.progress, budgetMs: 60_000, retryBaseMs: 0 });
    expect(second.complete).toBe(true);
    expect(second.uniqueRows).toBe(100);
  });

  it('a carried census that reaches the end short of the total starts a NEW census at page 0 in the same run', async () => {
    const src = makeSource({ rows: 100, total: () => 100 });
    // Stored progress claims page 30 with 10 rows — beyond the end of a 5-page source.
    const stale: FcoCensusProgress = {
      v: 1, census_started_at: '2026-10-01T00:00:00.000Z', start_total: 100, next_page: 30,
      rows_seen_so_far: 10, listing_ids_seen: 10, duplicate_listing_ids: 0,
      departments: { 'Department of the Interior': { rows: 10, listing_ids: 10 } },
      max_changed: null, digest_sum: 1, digest_xor: 1, last_page_key: '', runs: 3, pages_fetched: 4,
    };
    const c = await runFcoCensus({ fetchImpl: src.impl, progress: stale, budgetMs: 60_000, retryBaseMs: 0 });
    expect(src.fetched[0]).toBe(30);
    expect(src.fetched[1]).toBe(0);
    expect(c.complete).toBe(true);
    expect(c.uniqueRows).toBe(100);            // the stale 10 rows were discarded, not added
    expect(c.runsSpanned).toBe(1);
    expect(c.restartReason).toMatch(/reached end of source at page 30/);
    expect(c.fingerprint).not.toMatch(/^cum:/);
  });

  it('a material reported-total move mid-census abandons it and restarts at page 0', async () => {
    let total = TOTAL;
    const src = makeSource({ total: () => total });
    const first = await runFcoCensus({ fetchImpl: src.impl, budgetMs: BUDGET_MS, retryBaseMs: 0 });
    const next = first.progress!;
    expect(next.start_total).toBe(TOTAL);
    total = TOTAL + 600; // e.g. a new department onboarded
    src.fetched.length = 0;
    clock += 1;
    const second = await runFcoCensus({ fetchImpl: src.impl, progress: next, budgetMs: BUDGET_MS, retryBaseMs: 0 });
    expect(src.fetched[0]).toBe(next.next_page);
    expect(src.fetched[1]).toBe(0);
    expect(second.restartReason).toMatch(/13464 → 14064/);
    expect(second.progress!.start_total).toBe(TOTAL + 600);
    expect(second.progress!.runs).toBe(1);
    expect(second.progress!.census_started_at).not.toBe(next.census_started_at);
    expect(second.incompleteReason).toMatch(/new census/);
  });

  it('a small total move does not restart the census', async () => {
    let total = TOTAL;
    const src = makeSource({ total: () => total });
    const first = await runFcoCensus({ fetchImpl: src.impl, budgetMs: BUDGET_MS, retryBaseMs: 0 });
    total = TOTAL + 12;
    src.fetched.length = 0;
    const second = await runFcoCensus({ fetchImpl: src.impl, progress: first.progress, budgetMs: BUDGET_MS, retryBaseMs: 0 });
    expect(src.fetched[0]).toBe(first.progress!.next_page);
    expect(second.restartReason).toBeUndefined();
    expect(second.progress!.runs).toBe(2);
    expect(second.progress!.start_total).toBe(TOTAL);
  });

  it('materiality threshold is max(50, 0.5%)', () => {
    expect(totalMovedMaterially(13_464, 13_464 + 67)).toBe(false);
    expect(totalMovedMaterially(13_464, 13_464 + 68)).toBe(true);
    expect(totalMovedMaterially(1_000, 1_049)).toBe(false);
    expect(totalMovedMaterially(1_000, 1_050)).toBe(true);
    expect(totalMovedMaterially(0, 1_050)).toBe(false);
  });
});

// ── Runner: persistence through upstream_fingerprint ────────────────────────────────────────
type Inst = { upstream_fingerprint: string | null; last_source_advance: string | null; held_population: number | null } & Record<string, unknown>;

function stubSupabase(inst: Inst) {
  const updates: Array<Record<string, unknown>> = [];
  const sb = {
    from(table: string) {
      if (table === 'agency_forecasts') {
        return { select: () => ({ or: async () => ({ count: 13_000, error: null }) }) };
      }
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { ...inst }, error: null }) }) }),
        update: (clocks: Record<string, unknown>) => ({
          eq: async () => { updates.push(clocks); Object.assign(inst, clocks); return { error: null }; },
        }),
      };
    },
  };
  return { sb: sb as unknown as SupabaseClient, updates };
}

const ROSTER = {
  departments: ['Department of Agriculture', 'Department of the Interior'],
  perDepartment: { 'Department of the Interior': 4254, 'Department of Agriculture': 2519 },
  reportedTotal: 9225, maxChanged: '2026-09-14', fingerprint: 'abc:9225',
};

describe('runFcoWatch — the stored census resumes to completion', () => {
  it('reaches last_successful_check within ~9 runs of a 540-page source', async () => {
    const src = makeSource();
    vi.stubGlobal('fetch', src.impl);
    const inst: Inst = { upstream_fingerprint: JSON.stringify(ROSTER), last_source_advance: null, held_population: null };
    const { sb, updates } = stubSupabase(inst);
    let runs = 0;
    let run;
    for (; runs < 20; ) {
      runs++;
      run = await runFcoWatch(sb, { budgetMs: BUDGET_MS });
      if (run.census.complete) break;
      const stored = JSON.parse(inst.upstream_fingerprint!);
      // Roster survives every partial run; progress advances beside it.
      expect(stored.departments).toEqual(ROSTER.departments);
      expect(stored.census_progress.runs).toBe(runs);
      expect(stored.resumePage).toBeUndefined();
      expect(stored.partial).toBeUndefined();
      expect(inst.last_successful_check).toBeUndefined();
    }
    expect(run!.census.complete).toBe(true);
    expect(runs).toBeLessThanOrEqual(10);
    expect(run!.census.uniqueRows).toBe(TOTAL);
    expect(run!.census.runsSpanned).toBe(runs);
    expect(inst.last_successful_check).toBeTruthy();
    const stored = JSON.parse(inst.upstream_fingerprint!);
    expect(stored.census_progress).toBeUndefined();
    expect(stored.reportedTotal).toBe(TOTAL);
    expect(stored.departments.sort()).toEqual([...DEPTS].sort());
    // The completed census is compared against the prior roster: State appears.
    expect(run!.events.some((e) => e.type === 'department_appeared' && e.department === 'Department of State')).toBe(true);
    expect(updates).toHaveLength(runs);
  });

  it('a legacy stored {resumePage, partial} is ignored (fresh census at page 0) and dropped on write', async () => {
    const src = makeSource();
    vi.stubGlobal('fetch', src.impl);
    const inst: Inst = {
      upstream_fingerprint: JSON.stringify({ ...ROSTER, resumePage: 400, partial: true }),
      last_source_advance: null, held_population: null,
    };
    const { sb } = stubSupabase(inst);
    const run = await runFcoWatch(sb, { budgetMs: BUDGET_MS });
    expect(src.fetched[0]).toBe(0);
    expect(run.census.complete).toBe(false);
    const stored = JSON.parse(inst.upstream_fingerprint!);
    expect(stored.resumePage).toBeUndefined();
    expect(stored.partial).toBeUndefined();
    expect(stored.departments).toEqual(ROSTER.departments);
    expect(stored.perDepartment).toEqual(ROSTER.perDepartment);
    expect(stored.census_progress.next_page).toBe(run.census.nextPage);
    expect(stored.census_progress.next_page).toBeGreaterThan(0);
  });

  it('a stuck late cursor is cleared: the next run does not restart at the same page', async () => {
    // Source shrank: stored progress points past the end. The run restarts at 0 and the stored
    // cursor moves to wherever the NEW census got to — never left at the late page.
    const src = makeSource();
    vi.stubGlobal('fetch', src.impl);
    const late: FcoCensusProgress = {
      v: 1, census_started_at: '2026-10-01T00:00:00.000Z', start_total: TOTAL, next_page: 600,
      rows_seen_so_far: 12_000, listing_ids_seen: 12_000, duplicate_listing_ids: 0, departments: {},
      max_changed: null, digest_sum: 0, digest_xor: 0, last_page_key: '', runs: 8, pages_fetched: 500,
    };
    const inst: Inst = {
      upstream_fingerprint: JSON.stringify({ ...ROSTER, census_progress: late }),
      last_source_advance: null, held_population: null,
    };
    const { sb } = stubSupabase(inst);
    const run = await runFcoWatch(sb, { budgetMs: BUDGET_MS });
    expect(src.fetched[0]).toBe(600);
    expect(src.fetched[1]).toBe(0);
    expect(run.census.restartReason).toMatch(/reached end of source/);
    const stored = JSON.parse(inst.upstream_fingerprint!);
    expect(stored.census_progress.next_page).not.toBe(600);
    expect(stored.census_progress.runs).toBe(1);
    expect(stored.census_progress.rows_seen_so_far).toBeLessThan(12_000);
  });

  it('dry mode persists nothing, including progress', async () => {
    const src = makeSource();
    vi.stubGlobal('fetch', src.impl);
    const original = JSON.stringify(ROSTER);
    const inst: Inst = { upstream_fingerprint: original, last_source_advance: null, held_population: null };
    const { sb, updates } = stubSupabase(inst);
    const run = await runFcoWatch(sb, { budgetMs: BUDGET_MS, dry: true });
    expect(run.census.complete).toBe(false);
    expect(updates).toHaveLength(0);
    expect(inst.upstream_fingerprint).toBe(original);
  });
});
