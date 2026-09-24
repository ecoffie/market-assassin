/**
 * Forecast watermark — adversarial set (Phase D) + high-volume keyset processing + partial-coverage gaps.
 * Drives the REAL evaluateForecastWatermark / planForecastRun against an in-memory corpus
 * (fake-forecast-db.ts honours created_at, floors, agency, the (created_at, id) keyset and limit).
 */
import { describe, it, expect } from 'vitest';
import {
  evaluateForecastWatermark, planForecastRun, floorOrExpr, isForecastCandidate, tsMicros, keysetAfterExpr,
  type ForecastWatermarkState, type PublisherFloor,
} from './forecast-watermark';
import { savedSearchForecastRequest } from './forecast-discovery';
import { fakeForecastDb, type FakeForecastRow } from './__fixtures__/fake-forecast-db';
import type { PlanContext } from '@/lib/discovery';

const CTX: PlanContext = { today: '2026-09-23', fiscalYear: 2026 };
const T = (d: string) => new Date(`2026-09-${d}Z`).toISOString(); // T('23T11:00:00')
const FLOORS: PublisherFloor[] = ['DOE', 'DHS', 'VA', 'HHS'].map((s) => ({ source_agency: s, state: 'active', alertable_after: T('01T00:00:00') }));
let seq = 0;
const hexId = () => (++seq).toString(16).padStart(12, '0');
const row = (src: string, created: string, extra: Partial<FakeForecastRow> = {}): FakeForecastRow => {
  const id = hexId();
  return { id, external_id: `${src}-${id}`, source_agency: src, created_at: created, last_synced_at: created, fiscal_year: 'FY2026', ...extra };
};
const ALL = { naics: '541512', horizons: { forecast: true } };
const W0: ForecastWatermarkState = { seenThrough: T('22T11:00:00'), gapSince: null, pending: null };

type RunOpts = { floors?: PublisherFloor[]; failOn?: (n: number) => boolean; pageSize?: number; maxPages?: number; seen?: Set<string>; dupes?: { n: number } };
/** One cron evaluation as the route applies it: state moves on measured / baseline / in_progress only. */
async function run(corpus: FakeForecastRow[] | (() => FakeForecastRow[]), filters: Record<string, unknown>, state: ForecastWatermarkState, snapshot: string, o: RunOpts = {}) {
  const f = fakeForecastDb(typeof corpus === 'function' ? corpus : () => corpus, { failOn: o.failOn });
  const res = await evaluateForecastWatermark(f.db, filters, state, {
    snapshot, floors: o.floors ?? FLOORS, ctx: CTX, pageSize: o.pageSize, maxPages: o.maxPages,
    onRows: (rows) => { for (const r of rows) { if (o.seen) { if (o.seen.has(r.id) && o.dupes) o.dupes.n++; o.seen.add(r.id); } } },
  });
  const next = res.kind === 'measured' || res.kind === 'baseline' || res.kind === 'in_progress' ? res.nextState : state;
  const count = res.kind === 'measured' ? res.count : 0;
  const ids = res.kind === 'measured' ? res.evidence.map((r) => String(r.external_id)) : [];
  return { res, next, count, ids, db: f };
}
/** Drive an interval to completion across runs (each run = one cron evaluation). */
async function drain(corpus: FakeForecastRow[], state: ForecastWatermarkState, snapshot: string, o: RunOpts & { maxRuns?: number } = {}) {
  const seen = new Set<string>(); const dupes = { n: 0 };
  let s = state; let runs = 0; let last;
  do {
    last = await run(corpus, ALL, s, snapshot, { ...o, seen, dupes });
    s = last.next; runs++;
    expect(JSON.stringify(s).length).toBeLessThan(2000); // state bounded at every step
  } while (last.res.kind === 'in_progress' && runs < (o.maxRuns ?? 1000));
  return { last, state: s, runs, seen, dupes: dupes.n };
}
const spread = (src: string, n: number, startIso: string, stepMicros = 1) => {
  const base = tsMicros(startIso);
  return Array.from({ length: n }, (_, i) => {
    const us = base + BigInt(i * stepMicros);
    const ms = Number(us / BigInt(1000));
    const frac = String(Number(us % BigInt(1000000))).padStart(6, '0');
    return row(src, `${new Date(ms).toISOString().slice(0, 19)}.${frac}+00:00`);
  });
};

describe('Phase D — adversarial', () => {
  it('1 · a historical row (created before the watermark) never alerts', async () => {
    const r = await run([row('DOE', T('01T12:00:00'))], ALL, W0, T('23T11:00:00'));
    expect(r.res.kind).toBe('measured'); expect(r.count).toBe(0);
  });

  it('2+3 · a new row alerts once; the same row re-synced never alerts again', async () => {
    const x = row('DHS', T('22T13:00:00'));
    const c = [row('DHS', T('01T12:00:00')), x];
    const a = await run(c, ALL, W0, T('23T11:00:00'));
    expect(a.count).toBe(1); expect(a.ids).toEqual([x.external_id]);
    const b = await run(c.map((r) => ({ ...r, last_synced_at: T('23T13:00:00') })), ALL, a.next, T('24T11:00:00'));
    expect(b.count).toBe(0);
  });

  it('4 · 2,519 rows sharing one last_synced_at have no effect on newness', async () => {
    const old = Array.from({ length: 2519 }, () => row('HHS', T('13T00:00:00'), { last_synced_at: T('23T13:00:00') }));
    const genuine = row('HHS', T('23T02:00:00'), { last_synced_at: T('23T13:00:00') });
    const r = await run([...old, genuine], ALL, W0, T('23T11:00:00'));
    expect(r.count).toBe(1); expect(r.ids).toEqual([genuine.external_id]);
  });

  it('5 · more than 500 matching Forecasts → no loss and no churn across runs', async () => {
    const hist = Array.from({ length: 600 }, () => row('DOE', T('01T12:00:00')));
    const fresh = spread('DOE', 650, T('22T12:00:00'), 1000);
    const a = await run([...hist, ...fresh], ALL, W0, T('23T11:00:00'));
    expect(a.count).toBe(650);
    expect((await run([...hist, ...fresh], ALL, a.next, T('24T11:00:00'))).count).toBe(0);
  });

  it('6 · 32,500 matching Forecasts → state stays bounded (timestamps, no list)', async () => {
    const r = await run(Array.from({ length: 32_500 }, () => row('HHS', T('13T00:00:00'))), ALL, W0, T('23T11:00:00'));
    expect(r.count).toBe(0);
    expect(r.next).toEqual({ seenThrough: T('23T11:00:00'), gapSince: null, pending: null });
  });

  it('7 · a row inserted DURING the run (after the snapshot) lands in the next run, never lost', async () => {
    const c: FakeForecastRow[] = [row('DHS', T('22T12:00:00'))];
    const late = row('DHS', T('23T11:02:00'));
    let inserted = false;
    const a = await run(() => { if (!inserted) { inserted = true; c.push(late); } return c; }, ALL, W0, T('23T11:00:00'));
    expect(a.count).toBe(1);
    expect(a.next.seenThrough).toBe(T('23T11:00:00'));
    const b = await run(c, ALL, a.next, T('24T11:00:00'));
    expect(b.ids).toEqual([late.external_id]);
  });

  it('8 · a failed run leaves the state unchanged', async () => {
    const r = await run([row('DHS', T('22T12:00:00'))], ALL, W0, T('23T11:00:00'), { failOn: () => true });
    expect(r.res.kind).toBe('failed'); expect(r.next).toBe(W0);
  });

  it('9 · a covered zero advances the watermark', async () => {
    const r = await run([], ALL, W0, T('23T11:00:00'));
    expect(r.res).toMatchObject({ kind: 'measured', coverage: 'ok', count: 0 });
    expect(r.next.seenThrough).toBe(T('23T11:00:00'));
  });

  it('10 · unavailable (no requested buyer covered) leaves the watermark unchanged and reads nothing', async () => {
    const r = await run([row('DHS', T('22T12:00:00'))], { agency: 'HUD', horizons: { forecast: true } }, W0, T('23T11:00:00'));
    expect(r.res.kind).toBe('unavailable'); expect(r.next).toBe(W0); expect(r.db.calls()).toBe(0);
  });

  it('11b · the global-watermark counterexample: WITHOUT a gap boundary the day-1 row is skipped forever', async () => {
    const hhsDay1 = row('HHS', T('23T02:00:00'));
    const r = await run([hhsDay1], { agency: 'VETERANS AFFAIRS|HHS', horizons: { forecast: true } }, { seenThrough: T('24T11:00:00'), gapSince: null }, T('25T11:00:00'));
    expect(r.count).toBe(0);
  });

  it('13 · historical onboarding → no burst (suspended, then floored at the load boundary); no floor → never', async () => {
    const onboard = spread('HHS', 1861, T('23T02:00:00'));
    const suspended: PublisherFloor[] = [...FLOORS.filter((f) => f.source_agency !== 'HHS'), { source_agency: 'HHS', state: 'suspended', alertable_after: null }];
    expect((await run(onboard, ALL, W0, T('23T11:00:00'), { floors: suspended })).count).toBe(0);
    const floorAtEnd = onboard[onboard.length - 1].created_at;
    const active: PublisherFloor[] = [...FLOORS.filter((f) => f.source_agency !== 'HHS'), { source_agency: 'HHS', state: 'active', alertable_after: floorAtEnd }];
    expect((await run(onboard, ALL, W0, T('23T11:00:00'), { floors: active })).count).toBe(0);
    const next = row('HHS', T('23T09:00:00'));
    expect((await run([...onboard, next], ALL, W0, T('23T11:00:00'), { floors: active })).ids).toEqual([next.external_id]);
    expect((await run([row('NASA', T('23T09:00:00'))], ALL, W0, T('23T11:00:00'))).count).toBe(0);
  });

  it('13b · a floor at microsecond precision: the row created AT the floor is not new, one microsecond after is', async () => {
    const at = row('HHS', '2026-09-23T13:00:38.208123+00:00');
    const after = row('HHS', '2026-09-23T13:00:38.208124+00:00');
    const floors: PublisherFloor[] = [{ source_agency: 'HHS', state: 'active', alertable_after: '2026-09-23T13:00:38.208123+00:00' }];
    const r = await run([at, after], ALL, W0, T('24T11:00:00'), { floors });
    expect(r.count).toBe(1); expect(r.ids).toEqual([after.external_id]);
  });

  it('14 · a daily sync re-stamping 870 old rows → 0', async () => {
    expect((await run(Array.from({ length: 870 }, () => row('DOE', T('01T12:00:00'), { last_synced_at: T('23T13:00:38') })), ALL, W0, T('24T11:00:00'))).count).toBe(0);
  });

  it('15 · an amendment to an old row (fields change, created_at does not) is not new', async () => {
    expect((await run([row('DHS', T('10T00:00:00'), { title: 'AMENDED', fiscal_year: 'FY2027', last_synced_at: T('23T13:00:00') })], ALL, W0, T('24T11:00:00'))).count).toBe(0);
  });

  it('16 · a newly created search (NULL watermark) baselines silently — nothing that exists is new', async () => {
    const r = await run([row('DHS', T('23T10:00:00'))], { agency: 'VETERANS AFFAIRS|COMMERCE', horizons: { forecast: true } }, { seenThrough: null, gapSince: null }, T('23T11:00:00'));
    expect(r.res.kind).toBe('baseline');
    expect(r.next).toEqual({ seenThrough: T('23T11:00:00'), gapSince: { COMMERCE: T('23T11:00:00') }, pending: null });
    expect(r.db.calls()).toBe(0);
  });

  it('17 · after the explicit baseline, the first run alerts only rows created after it', async () => {
    const c = [row('DOE', T('01T12:00:00')), row('DHS', T('23T19:00:00')), row('DHS', T('24T02:00:00'))];
    expect((await run(c, ALL, { seenThrough: T('23T20:00:00'), gapSince: null }, T('24T11:00:00'))).ids).toEqual([c[2].external_id]);
  });
});

describe('high volume — bounded, resumable keyset processing', () => {
  it('5,001 new rows → one complete interval, exact count, then 0', async () => {
    const rows = spread('DHS', 5001, T('22T12:00:00'));
    const d = await drain(rows, W0, T('23T11:00:00'));
    expect(d.runs).toBe(1);
    expect(d.last.res).toMatchObject({ kind: 'measured', count: 5001 });
    expect(d.seen.size).toBe(5001); expect(d.dupes).toBe(0);
    expect(d.last.ids).toHaveLength(3); // presentation: evidence only
    expect((await run(rows, ALL, d.state, T('24T11:00:00'))).count).toBe(0);
  });

  it('25,000 new rows → resumes across runs, never advances W early, never drops or repeats', async () => {
    const rows = spread('DHS', 25_000, T('22T12:00:00'));
    const first = await run(rows, ALL, W0, T('23T11:00:00'));
    expect(first.res.kind).toBe('in_progress');
    expect(first.next.seenThrough).toBe(W0.seenThrough);                  // watermark NOT advanced
    expect(first.next.pending?.processed).toBe(20_000);                   // 40 pages × 500
    expect(first.next.pending?.snapshot).toBe(T('23T11:00:00'));
    const d = await drain(rows, W0, T('23T11:00:00'));
    expect(d.runs).toBe(2);
    expect(d.last.res).toMatchObject({ kind: 'measured', count: 25_000 });
    expect(d.seen.size).toBe(25_000); expect(d.dupes).toBe(0);
    expect(d.state).toEqual({ seenThrough: T('23T11:00:00'), gapSince: null, pending: null });
  });

  it('100,000 new rows ALL with one identical created_at → the (created_at, id) keyset still visits each exactly once', async () => {
    const same = '2026-09-22T13:00:38.208123+00:00';
    const rows = Array.from({ length: 100_000 }, () => row('DHS', same));
    const d = await drain(rows, W0, T('23T11:00:00'), { pageSize: 500, maxPages: 50 });
    expect(d.runs).toBe(4); // 200 pages of 500 at 50/run → exactly 4 runs (look-ahead closes the last full page)
    expect(d.last.res).toMatchObject({ kind: 'measured', count: 100_000 });
    expect(d.seen.size).toBe(100_000); expect(d.dupes).toBe(0);
  });

  it('a failure mid-interval keeps the last DURABLE progress; the retry neither drops nor double-counts', async () => {
    const rows = spread('DHS', 3000, T('22T12:00:00'));
    const seen = new Set<string>(); const dupes = { n: 0 };
    const a = await run(rows, ALL, W0, T('23T11:00:00'), { pageSize: 500, maxPages: 2, seen, dupes });
    expect(a.res.kind).toBe('in_progress'); expect(a.next.pending?.processed).toBe(1000);
    // Run 2 fails on its 2nd page: nothing from run 2 is kept (the route writes nothing on failure).
    const b = await run(rows, ALL, a.next, T('24T11:00:00'), { pageSize: 500, maxPages: 2, failOn: (n) => n === 2 });
    expect(b.res.kind).toBe('failed'); expect(b.next).toBe(a.next);
    const seen2 = new Set(seen); const dupes2 = { n: 0 };
    let s = b.next; let last;
    do { last = await run(rows, ALL, s, T('25T11:00:00'), { pageSize: 500, maxPages: 2, seen: seen2, dupes: dupes2 }); s = last.next; } while (last.res.kind === 'in_progress');
    expect(last.res).toMatchObject({ kind: 'measured', count: 3000 });
    expect(seen2.size).toBe(3000);
    expect(s.seenThrough).toBe(T('23T11:00:00')); // the ORIGINAL snapshot, not the resume run's
  });

  it('a resumed interval keeps its own snapshot; rows created after it wait for the next interval', async () => {
    const rows = spread('DHS', 1500, T('22T12:00:00'));
    const a = await run(rows, ALL, W0, T('23T11:00:00'), { pageSize: 1000, maxPages: 1 });
    const late = row('DHS', T('23T15:00:00'));
    const b = await run([...rows, late], ALL, a.next, T('24T11:00:00'), { pageSize: 1000, maxPages: 1 });
    expect(b.res).toMatchObject({ kind: 'measured', count: 1500 });
    const c = await run([...rows, late], ALL, b.next, T('24T11:00:00'));
    expect(c.ids).toEqual([late.external_id]);
  });

  it('the PostgREST 1,000-row response cap never ends a segment early (measured bug: 1,018 of 2,018 rows dropped)', async () => {
    const rows = spread('HHS', 2018, T('22T12:00:00'));
    for (const pageSize of [1000, 999, 500]) {
      const d = await drain(rows, W0, T('23T11:00:00'), { pageSize });
      expect(d.last.res).toMatchObject({ kind: 'measured', count: 2018 });
      expect(d.seen.size).toBe(2018);
    }
  });

  it('keyset cursors are validated before they reach a query', () => {
    expect(() => keysetAfterExpr({ created_at: 'x', id: 'y' })).toThrow();
    expect(keysetAfterExpr({ created_at: '2026-09-22T13:00:38.208123+00:00', id: '00000000abcd' }))
      .toBe('created_at.gt.2026-09-22T13:00:38.208123+00:00,and(created_at.eq.2026-09-22T13:00:38.208123+00:00,id.gt.00000000abcd)');
  });
});

describe('partial coverage — per-buyer gap boundaries', () => {
  const partialPlan = savedSearchForecastRequest({ agency: 'VETERANS AFFAIRS|COMMERCE', horizons: { forecast: true } }, CTX).plan;
  const f3 = { agency: 'VETERANS AFFAIRS|HHS|COMMERCE', horizons: { forecast: true } };

  it('G1 · a newly uncovered buyer gets the PRE-gap boundary (W before this run)', () => {
    const p = planForecastRun(W0, partialPlan, T('23T11:00:00'));
    expect(p.mode === 'process' && p.pending.commit).toEqual({ seenThrough: T('23T11:00:00'), gapSince: { COMMERCE: W0.seenThrough } });
  });

  it('G2 · repeated partial runs never move that boundary forward', () => {
    let st: ForecastWatermarkState = W0;
    for (const d of ['23', '24', '25', '26']) {
      const p = planForecastRun(st, partialPlan, T(`${d}T11:00:00`));
      if (p.mode !== 'process') throw new Error('expected process');
      st = { seenThrough: p.pending.commit.seenThrough, gapSince: p.pending.commit.gapSince, pending: null };
      expect(st.gapSince).toEqual({ COMMERCE: W0.seenThrough });
    }
  });

  it('G3+G7 · a buyer that becomes covered catches up from its ORIGINAL boundary while the others advance normally', async () => {
    const st: ForecastWatermarkState = { seenThrough: T('25T11:00:00'), gapSince: { HHS: T('22T11:00:00'), COMMERCE: T('23T11:00:00') }, pending: null };
    const p = planForecastRun(st, savedSearchForecastRequest(f3, CTX).plan, T('26T11:00:00'));
    if (p.mode !== 'process') throw new Error('expected process');
    expect(p.pending.segments.map((s) => [s.key, s.from, s.to])).toEqual([
      ['main', T('25T11:00:00'), T('26T11:00:00')],
      ['gap:HHS', T('22T11:00:00'), T('25T11:00:00')],
    ]);
    const hhsMissed = row('HHS', T('23T02:00:00'));
    const vaToday = row('VA', T('26T02:00:00'));
    const r = await run([hhsMissed, vaToday], f3, st, T('26T11:00:00'));
    expect(r.count).toBe(2);
    expect(r.next.seenThrough).toBe(T('26T11:00:00'));                    // G7: W advances normally
    expect(r.res.kind === 'measured' && r.res.catchUpBuyers).toEqual(['HHS']);
  });

  it('G4 · the publisher floor still applies during catch-up', async () => {
    const st: ForecastWatermarkState = { seenThrough: T('25T11:00:00'), gapSince: { HHS: T('22T11:00:00') }, pending: null };
    const beforeFloor = row('HHS', T('23T02:00:00'));
    const afterFloor = row('HHS', T('24T02:00:00'));
    const floors: PublisherFloor[] = [...FLOORS.filter((f) => f.source_agency !== 'HHS'), { source_agency: 'HHS', state: 'active', alertable_after: T('23T12:00:00') }];
    const r = await run([beforeFloor, afterFloor], { agency: 'VETERANS AFFAIRS|HHS', horizons: { forecast: true } }, st, T('26T11:00:00'), { floors });
    expect(r.ids).toEqual([afterFloor.external_id]);
  });

  it('G5 · a successful catch-up clears ONLY that buyer\'s gap', async () => {
    const st: ForecastWatermarkState = { seenThrough: T('25T11:00:00'), gapSince: { HHS: T('22T11:00:00'), COMMERCE: T('23T11:00:00') }, pending: null };
    const r = await run([], f3, st, T('26T11:00:00'));
    expect(r.next.gapSince).toEqual({ COMMERCE: T('23T11:00:00') });
  });

  it('G6 · a failed catch-up preserves the gap (and the watermark)', async () => {
    const st: ForecastWatermarkState = { seenThrough: T('25T11:00:00'), gapSince: { HHS: T('22T11:00:00'), COMMERCE: T('23T11:00:00') }, pending: null };
    const r = await run([row('HHS', T('23T02:00:00'))], f3, st, T('26T11:00:00'), { failOn: (n) => n === 2 }); // main ok, catch-up fails
    expect(r.res.kind).toBe('failed'); expect(r.next).toBe(st);
  });

  it('G6b · an interrupted catch-up keeps the gap until the catch-up segment completes', async () => {
    const st: ForecastWatermarkState = { seenThrough: T('25T11:00:00'), gapSince: { HHS: T('22T11:00:00') }, pending: null };
    const missed = spread('HHS', 1500, T('23T02:00:00'));
    const a = await run(missed, { agency: 'VETERANS AFFAIRS|HHS', horizons: { forecast: true } }, st, T('26T11:00:00'), { pageSize: 1000, maxPages: 1 });
    expect(a.res.kind).toBe('in_progress');
    expect(a.next.gapSince).toEqual({ HHS: T('22T11:00:00') }); expect(a.next.seenThrough).toBe(T('25T11:00:00'));
  });
});

describe('floor predicate + timestamps', () => {
  it('only ACTIVE floors admit rows; none active → fail closed; floor text kept exactly', () => {
    expect(floorOrExpr([])).toBe('id.is.null');
    expect(floorOrExpr([{ source_agency: 'DHS', state: 'suspended', alertable_after: null }])).toBe('id.is.null');
    expect(floorOrExpr([{ source_agency: 'DHS', state: 'active', alertable_after: '2026-09-01T00:00:00.123456+00:00' }]))
      .toBe('and(source_agency.eq.DHS,created_at.gt.2026-09-01T00:00:00.123456+00:00)');
  });
  it('JS mirror agrees with the interval + floor rule (open lower, closed upper bound)', () => {
    const iv = { from: T('22T11:00:00'), to: T('23T11:00:00') };
    expect(isForecastCandidate({ source_agency: 'DHS', created_at: T('23T00:00:00') }, iv, FLOORS)).toBe(true);
    expect(isForecastCandidate({ source_agency: 'DHS', created_at: T('22T11:00:00') }, iv, FLOORS)).toBe(false);
    expect(isForecastCandidate({ source_agency: 'DHS', created_at: T('23T11:00:00') }, iv, FLOORS)).toBe(true);
    expect(isForecastCandidate({ source_agency: 'NASA', created_at: T('23T00:00:00') }, iv, FLOORS)).toBe(false);
  });
  it('tsMicros keeps microseconds and time zones', () => {
    expect(tsMicros('2026-09-23T13:00:38.208123+00:00') - tsMicros('2026-09-23T13:00:38.208Z')).toBe(BigInt(123));
    expect(tsMicros('2026-09-23T15:00:00+02:00')).toBe(tsMicros('2026-09-23T13:00:00Z'));
    expect(tsMicros('2026-09-23 13:00:00+00')).toBe(tsMicros('2026-09-23T13:00:00Z'));
  });
});
