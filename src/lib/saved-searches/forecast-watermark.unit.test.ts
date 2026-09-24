/**
 * Forecast watermark — the adversarial set (Phase D). Drives the REAL evaluateForecastWatermark /
 * planForecastRun against an in-memory corpus (fake-forecast-db.ts honours created_at, floors, agency).
 */
import { describe, it, expect } from 'vitest';
import {
  evaluateForecastWatermark, planForecastRun, floorOrExpr, isForecastCandidate,
  type ForecastWatermarkState, type PublisherFloor, FORECAST_CANDIDATE_CEILING,
} from './forecast-watermark';
import { savedSearchForecastRequest } from './forecast-discovery';
import { fakeForecastDb, type FakeForecastRow } from './__fixtures__/fake-forecast-db';
import type { PlanContext } from '@/lib/discovery';

const CTX: PlanContext = { today: '2026-09-23', fiscalYear: 2026 };
const T = (d: string) => new Date(`2026-09-${d}Z`).toISOString(); // T('23T11:00:00') …
const FLOORS: PublisherFloor[] = ['DOE', 'DHS', 'VA', 'HHS'].map((s) => ({ source_agency: s, state: 'active', alertable_after: T('01T00:00:00') }));
let seq = 0;
const row = (src: string, created: string, extra: Partial<FakeForecastRow> = {}): FakeForecastRow =>
  ({ id: `r${String(++seq).padStart(6, '0')}`, external_id: `${src}-${seq}`, source_agency: src, created_at: created, last_synced_at: created, fiscal_year: 'FY2026', ...extra });

const ALL = { naics: '541512', horizons: { forecast: true } };

/** One cron evaluation as the route applies it: state moves only on measured / baseline. */
async function run(corpus: FakeForecastRow[] | (() => FakeForecastRow[]), filters: Record<string, unknown>, state: ForecastWatermarkState, snapshot: string, floors = FLOORS, failOn?: (n: number) => boolean) {
  const f = fakeForecastDb(typeof corpus === 'function' ? corpus : () => corpus, { failOn });
  const o = await evaluateForecastWatermark(f.db, filters, state, { snapshot, floors, ctx: CTX });
  const next = o.kind === 'measured' || o.kind === 'baseline' ? o.nextState : state;
  const ids = o.kind === 'measured' ? o.rows.map((r) => r.external_id) : [];
  return { o, next, ids, db: f };
}
const W0: ForecastWatermarkState = { seenThrough: T('22T11:00:00'), gapSince: null };

describe('Phase D — adversarial', () => {
  it('1 · a historical row (created before the watermark) never alerts', async () => {
    const r = await run([row('DOE', T('01T12:00:00'))], ALL, W0, T('23T11:00:00'));
    expect(r.o.kind).toBe('measured'); expect(r.ids).toEqual([]);
  });

  it('2+3 · a new row alerts once; the same row re-synced never alerts again', async () => {
    const x = row('DHS', T('22T13:00:00'));
    const c: FakeForecastRow[] = [row('DHS', T('01T12:00:00')), x];
    const a = await run(c, ALL, W0, T('23T11:00:00'));
    expect(a.ids).toEqual([x.external_id]);
    // daily sync re-stamps it (last_synced_at moves; created_at never does)
    const resynced = c.map((r) => ({ ...r, last_synced_at: T('23T13:00:00') }));
    const b = await run(resynced, ALL, a.next, T('24T11:00:00'));
    expect(b.ids).toEqual([]);
  });

  it('4 · 2,519 rows sharing one last_synced_at have no effect on newness', async () => {
    const old = Array.from({ length: 2519 }, () => row('HHS', T('13T00:00:00'), { last_synced_at: T('23T13:00:00') }));
    const genuine = row('HHS', T('23T02:00:00'), { last_synced_at: T('23T13:00:00') });
    const r = await run([...old, genuine], ALL, W0, T('23T11:00:00'));
    expect(r.ids).toEqual([genuine.external_id]);
  });

  it('5 · more than 500 matching Forecasts → no loss and no churn across runs', async () => {
    const hist = Array.from({ length: 600 }, () => row('DOE', T('01T12:00:00')));
    const fresh = Array.from({ length: 650 }, (_, i) => row('DOE', new Date(Date.parse(T('22T12:00:00')) + i * 1000).toISOString()));
    const a = await run([...hist, ...fresh], ALL, W0, T('23T11:00:00'));
    expect(a.ids).toHaveLength(650); // every genuinely new row, beyond any 200/500 cap, paged in full
    const b = await run([...hist, ...fresh], ALL, a.next, T('24T11:00:00'));
    expect(b.ids).toHaveLength(0);
    const c = await run([...hist, ...fresh], ALL, b.next, T('25T11:00:00'));
    expect(c.ids).toHaveLength(0);
  });

  it('6 · 32,000+ matching Forecasts → state stays bounded (a timestamp, not a list)', async () => {
    const big = Array.from({ length: 32_500 }, () => row('HHS', T('13T00:00:00')));
    const r = await run(big, ALL, W0, T('23T11:00:00'));
    expect(r.ids).toHaveLength(0);
    expect(JSON.stringify(r.next).length).toBeLessThan(120);
    expect(r.next).toEqual({ seenThrough: T('23T11:00:00'), gapSince: null });
  });

  it('7 · a row inserted DURING the run (after the snapshot) is not lost — it lands in the next run', async () => {
    const c: FakeForecastRow[] = [row('DHS', T('22T12:00:00'))];
    const snapshot = T('23T11:00:00');
    let inserted = false;
    const late = row('DHS', T('23T11:02:00')); // committed while the run executes, after the snapshot
    const a = await run(() => { if (!inserted) { inserted = true; c.push(late); } return c; }, ALL, W0, snapshot);
    expect(a.ids).toEqual([c[0].external_id]);
    expect(a.next.seenThrough).toBe(snapshot); // advanced to the SNAPSHOT, not the wall clock
    const b = await run(c, ALL, a.next, T('24T11:00:00'));
    expect(b.ids).toEqual([late.external_id]);
  });

  it('8 · a failed run leaves the watermark unchanged', async () => {
    const r = await run([row('DHS', T('22T12:00:00'))], ALL, W0, T('23T11:00:00'), FLOORS, () => true);
    expect(r.o.kind).toBe('failed'); expect(r.next).toBe(W0);
  });

  it('9 · a covered zero advances the watermark', async () => {
    const r = await run([], ALL, W0, T('23T11:00:00'));
    expect(r.o).toMatchObject({ kind: 'measured', coverage: 'ok', rows: [] });
    expect(r.next.seenThrough).toBe(T('23T11:00:00'));
  });

  it('10 · unavailable (no requested buyer covered) leaves the watermark unchanged and reads nothing', async () => {
    const r = await run([row('DHS', T('22T12:00:00'))], { agency: 'HUD', horizons: { forecast: true } }, W0, T('23T11:00:00'));
    expect(r.o.kind).toBe('unavailable'); expect(r.next).toBe(W0);
    expect(r.db.calls()).toBe(0);
  });

  it('11+12 · partial coverage leaves NO permanent blind spot: a buyer that becomes covered later gets its missed interval', async () => {
    // Day 1: VA covered, "ACME PUBLISHER" not resolvable → partial. The watermark moves; ACME keeps W as its boundary.
    const f = { agency: 'VETERANS AFFAIRS|ACME PUBLISHER', horizons: { forecast: true } };
    const plan = savedSearchForecastRequest(f, CTX).plan;
    expect(plan.horizons.forecast.coverage).toBe('partial');
    const d1 = planForecastRun(W0, plan, T('23T11:00:00'));
    expect(d1.mode).toBe('measure');
    if (d1.mode !== 'measure') return;
    expect(d1.nextState).toEqual({ seenThrough: T('23T11:00:00'), gapSince: { 'ACME PUBLISHER': W0.seenThrough } });
    // Day 2 (still uncovered): the boundary does NOT move with the watermark.
    const d2 = planForecastRun(d1.nextState, plan, T('24T11:00:00'));
    if (d2.mode !== 'measure') throw new Error('expected measure');
    expect(d2.nextState.gapSince).toEqual({ 'ACME PUBLISHER': W0.seenThrough });
    // Day 3: ACME resolves (modelled as a covered buyer in the plan). Its rows created on day 1-2 are read
    // over (gap boundary, W] as well as (W, snapshot].
    const coveredPlan = savedSearchForecastRequest({ agency: 'VETERANS AFFAIRS|HHS', horizons: { forecast: true } }, CTX).plan;
    const state3: ForecastWatermarkState = { seenThrough: d2.nextState.seenThrough, gapSince: { HHS: W0.seenThrough! } };
    const d3 = planForecastRun(state3, coveredPlan, T('25T11:00:00'));
    if (d3.mode !== 'measure') throw new Error('expected measure');
    expect(d3.catchUp).toEqual([{ buyer: 'HHS', from: W0.seenThrough, to: T('24T11:00:00') }]);
    expect(d3.nextState).toEqual({ seenThrough: T('25T11:00:00'), gapSince: null });
    // End to end on the corpus: the day-1 HHS row is found on day 3; the historical one is not.
    const hhsDay1 = row('HHS', T('23T02:00:00'));
    const hist = row('HHS', T('13T00:00:00'));
    const r = await run([hist, hhsDay1], { agency: 'VETERANS AFFAIRS|HHS', horizons: { forecast: true } }, state3, T('25T11:00:00'));
    expect(r.ids).toEqual([hhsDay1.external_id]);
    expect(r.o.kind === 'measured' && r.o.catchUpBuyers).toEqual(['HHS']);
  });

  it('11b · the global-watermark counterexample: WITHOUT the gap boundary the day-1 row would be skipped forever', async () => {
    const hhsDay1 = row('HHS', T('23T02:00:00'));
    const globalOnly: ForecastWatermarkState = { seenThrough: T('24T11:00:00'), gapSince: null };
    const r = await run([hhsDay1], { agency: 'VETERANS AFFAIRS|HHS', horizons: { forecast: true } }, globalOnly, T('25T11:00:00'));
    expect(r.ids).toEqual([]); // the blind spot the gap boundary exists to prevent
  });

  it('13 · historical publisher onboarding → no alert burst (suspended during load, floor at its last created_at)', async () => {
    const onboard = Array.from({ length: 1861 }, (_, i) => row('HHS', new Date(Date.parse(T('23T02:00:00')) + i).toISOString()));
    const suspended: PublisherFloor[] = [...FLOORS.filter((f) => f.source_agency !== 'HHS'), { source_agency: 'HHS', state: 'suspended', alertable_after: null }];
    expect((await run(onboard, ALL, W0, T('23T11:00:00'), suspended)).ids).toHaveLength(0);
    const floorAtEnd = onboard[onboard.length - 1].created_at;
    const active: PublisherFloor[] = [...FLOORS.filter((f) => f.source_agency !== 'HHS'), { source_agency: 'HHS', state: 'active', alertable_after: floorAtEnd }];
    expect((await run(onboard, ALL, W0, T('23T11:00:00'), active)).ids).toHaveLength(0);
    // …and a genuinely new HHS row after the floor still alerts
    const next = row('HHS', T('23T09:00:00'));
    expect((await run([...onboard, next], ALL, W0, T('23T11:00:00'), active)).ids).toEqual([next.external_id]);
    // A publisher with NO floor row is not alertable at all (fail closed).
    expect((await run([row('NASA', T('23T09:00:00'))], ALL, W0, T('23T11:00:00'), FLOORS)).ids).toEqual([]);
  });

  it('14 · a daily sync (every old row re-stamped) → no old-row burst', async () => {
    const c = Array.from({ length: 870 }, () => row('DOE', T('01T12:00:00'), { last_synced_at: T('23T13:00:38') }));
    expect((await run(c, ALL, W0, T('24T11:00:00'))).ids).toEqual([]);
  });

  it('15 · an amendment to an old row (fields change, created_at does not) is not new', async () => {
    const r = await run([row('DHS', T('10T00:00:00'), { title: 'AMENDED', fiscal_year: 'FY2027', last_synced_at: T('23T13:00:00') })], ALL, W0, T('24T11:00:00'));
    expect(r.ids).toEqual([]);
  });

  it('16 · a newly created search (NULL watermark) baselines silently — nothing that exists is new', async () => {
    const r = await run([row('DHS', T('23T10:00:00'))], { agency: 'VETERANS AFFAIRS|COMMERCE', horizons: { forecast: true } }, { seenThrough: null, gapSince: null }, T('23T11:00:00'));
    expect(r.o.kind).toBe('baseline');
    expect(r.next).toEqual({ seenThrough: T('23T11:00:00'), gapSince: { COMMERCE: T('23T11:00:00') } });
    expect(r.db.calls()).toBe(0);
  });

  it('17 · an existing search after the explicit baseline: the first run alerts only rows created after it', async () => {
    const baselined: ForecastWatermarkState = { seenThrough: T('23T20:00:00'), gapSince: null }; // what the baseline script writes
    const c = [row('DOE', T('01T12:00:00')), row('DHS', T('23T19:00:00')), row('DHS', T('24T02:00:00'))];
    expect((await run(c, ALL, baselined, T('24T11:00:00'))).ids).toEqual([c[2].external_id]);
  });

  it('a run with no elapsed interval reads nothing and keeps the watermark', async () => {
    const p = planForecastRun(W0, savedSearchForecastRequest(ALL, CTX).plan, W0.seenThrough!);
    expect(p.mode === 'measure' && p.main).toBe(null);
    expect(p.mode === 'measure' && p.nextState.seenThrough).toBe(W0.seenThrough);
  });

  it('candidate overflow fails the run (a missing floor must be loud, never an email of thousands)', async () => {
    const flood = Array.from({ length: FORECAST_CANDIDATE_CEILING + 50 }, (_, i) => row('HHS', new Date(Date.parse(T('23T00:00:00')) + i).toISOString()));
    const r = await run(flood, ALL, W0, T('23T11:00:00'));
    expect(r.o.kind).toBe('failed'); expect(r.next).toBe(W0);
  });
});

describe('floor predicate', () => {
  it('only ACTIVE floors admit rows; none active → fail closed', () => {
    expect(floorOrExpr([])).toBe('id.is.null');
    expect(floorOrExpr([{ source_agency: 'DHS', state: 'suspended', alertable_after: null }])).toBe('id.is.null');
    expect(floorOrExpr([{ source_agency: 'DHS', state: 'active', alertable_after: '2026-09-01T00:00:00+00:00' }]))
      .toBe('and(source_agency.eq.DHS,created_at.gt.2026-09-01T00:00:00.000Z)');
  });
  it('JS mirror agrees with the interval + floor rule', () => {
    const iv = { from: T('22T11:00:00'), to: T('23T11:00:00') };
    expect(isForecastCandidate({ source_agency: 'DHS', created_at: T('23T00:00:00') }, iv, FLOORS)).toBe(true);
    expect(isForecastCandidate({ source_agency: 'DHS', created_at: T('22T11:00:00') }, iv, FLOORS)).toBe(false); // open lower bound
    expect(isForecastCandidate({ source_agency: 'DHS', created_at: T('23T11:00:00') }, iv, FLOORS)).toBe(true);  // closed upper bound
    expect(isForecastCandidate({ source_agency: 'NASA', created_at: T('23T00:00:00') }, iv, FLOORS)).toBe(false);
  });
});
