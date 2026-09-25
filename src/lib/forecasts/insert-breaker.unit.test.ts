/**
 * The daily-sync breaker is ALL-OR-NOTHING (tasks/saved-search-forecast-watermark-2026-09-24.md §4b).
 *
 * When a daily writer would create more than DAILY_SYNC_MAX_NEW_ROWS new rows for a publisher whose alert floor is
 * active, the run must (1) write ZERO new rows — never a prefix from earlier pages/batches, (2) keep the refused rows
 * replayable (forecast_refused_loads), (3) still apply updates to rows that already exist, and (4) report the
 * refusal so the route fails and alerts operations. These tests drive the real HHS ingest end to end against an
 * in-memory PostgREST fake, then pin the ordering at every other call site.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runHhsIngest } from './hhs-ingest';
import { applyInsertGuard, DAILY_SYNC_MAX_NEW_ROWS } from './writer';

type Row = Record<string, unknown>;

function fakeDb(opts: { floor: { state: string } | null; held: Row[]; quarantineFails?: boolean }) {
  const tables: Record<string, Row[]> = { agency_forecasts: [...opts.held], forecast_refused_loads: [] };
  const writes: Array<{ table: string; op: string; n: number }> = [];
  const db = {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      let range: [number, number] | null = null;
      let op: 'select' | 'insert' | 'update' = 'select';
      let payload: Row | Row[] | null = null;
      const run = async () => {
        if (table === 'forecast_publisher_alert_floor') return { data: opts.floor, error: null };
        if (op === 'insert') {
          const rows = Array.isArray(payload) ? payload : [payload as Row];
          if (table === 'forecast_refused_loads' && opts.quarantineFails) return { data: null, error: { message: 'quarantine down' }, count: null };
          (tables[table] ??= []).push(...rows);
          writes.push({ table, op, n: rows.length });
          return { data: null, error: null, count: rows.length };
        }
        const hit = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
        if (op === 'update') {
          for (const r of hit) Object.assign(r, payload);
          writes.push({ table, op, n: hit.length });
          return { data: null, error: null, count: hit.length };
        }
        return { data: range ? hit.slice(range[0], range[1] + 1) : hit, error: null };
      };
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return q; },
        in: (c: string, v: unknown[]) => { filters.push((r) => v.includes(r[c])); return q; },
        limit: () => q,
        range: (a: number, b: number) => { range = [a, b]; return q; },
        insert: (p: Row | Row[]) => { op = 'insert'; payload = p; return q; },
        update: (p: Row) => { op = 'update'; payload = p; return q; },
        maybeSingle: run,
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => run().then(res, rej),
      };
      return q;
    },
  };
  return { db, tables, writes };
}

const NEW = DAILY_SYNC_MAX_NEW_ROWS + 100;     // 600: straddles the 500-row insert batch, so a prefix WOULD be possible
const upstream = Array.from({ length: 10 + NEW }, (_, i) => ({ uuid: `u${i}`, title: `Forecast number ${i}`, divisionAcronym: 'IHS', status: 'PUBLISHED' }));
// The first 10 are already held — one with a stale title, so there is an UPDATE to apply.
const held: Row[] = upstream.slice(0, 10).map((r, i) => ({
  source_agency: 'HHS', external_id: `HHS-${r.uuid.toUpperCase()}`,
  title: i === 0 ? 'OLD TITLE' : r.title, status: 'forecasted', contracting_office: 'IHS', bureau: 'HHS IHS',
  source_url: 'https://procurementforecast.hhs.gov/api/forecast', description: null,
}));
const fetchImpl = (async () => new Response(JSON.stringify(upstream), { status: 200 })) as unknown as typeof fetch;

describe('breaker — HHS ingest end to end', () => {
  it(`active floor + ${NEW} new rows: ZERO inserted, full payload quarantined, updates still applied, refusal reported`, async () => {
    const f = fakeDb({ floor: { state: 'active' }, held: held.map((r) => ({ ...r })) });
    const r = await runHhsIngest(f.db as never, { apply: true, fetchImpl });
    expect(r.newProven).toBe(NEW);
    expect(r.insertRefused).toMatch(/would create 600 new rows/);
    expect(r.insertQuarantined).toBe(true);
    expect(r.insertAttempted).toBe(0);
    expect(r.inserted).toBe(0);
    expect(f.writes.filter((w) => w.table === 'agency_forecasts' && w.op === 'insert')).toEqual([]);   // no prefix
    expect(f.tables.agency_forecasts).toHaveLength(10);
    const q = f.tables.forecast_refused_loads;
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ source_agency: 'HHS', new_row_count: NEW });
    expect((q[0].rows as Row[]).map((x) => x.external_id)).toEqual(upstream.slice(10).map((u) => `HHS-${u.uuid.toUpperCase()}`));
    expect(r.updated).toBeGreaterThanOrEqual(1);   // existing-row updates are not held hostage
  });
  it('quarantine write fails: still ZERO inserted, and the result says the rows were NOT saved', async () => {
    const f = fakeDb({ floor: { state: 'active' }, held: held.map((r) => ({ ...r })), quarantineFails: true });
    const r = await runHhsIngest(f.db as never, { apply: true, fetchImpl });
    expect(r.insertRefused).toBeTruthy();
    expect(r.insertQuarantined).toBe(false);
    expect(f.tables.agency_forecasts).toHaveLength(10);
  });
  it('suspended floor (a backfill): all rows insert, nothing quarantined', async () => {
    const f = fakeDb({ floor: { state: 'suspended' }, held: held.map((r) => ({ ...r })) });
    const r = await runHhsIngest(f.db as never, { apply: true, fetchImpl });
    expect(r.insertRefused).toBeUndefined();
    expect(r.inserted).toBe(NEW);
    expect(f.tables.forecast_refused_loads).toHaveLength(0);
  });
});

describe('applyInsertGuard', () => {
  it('at exactly the limit: allowed in full', async () => {
    const f = fakeDb({ floor: { state: 'active' }, held: [] });
    const rows = Array.from({ length: DAILY_SYNC_MAX_NEW_ROWS }, (_, i) => ({ external_id: `x${i}` }));
    const g = await applyInsertGuard(f.db, 'DHS', rows);
    expect(g.refused).toBeNull();
    expect(g.allowed).toHaveLength(DAILY_SYNC_MAX_NEW_ROWS);
  });
  it('one over the limit: allowed is EMPTY (never a truncated prefix)', async () => {
    const f = fakeDb({ floor: { state: 'active' }, held: [] });
    const rows = Array.from({ length: DAILY_SYNC_MAX_NEW_ROWS + 1 }, (_, i) => ({ external_id: `x${i}` }));
    const g = await applyInsertGuard(f.db, 'DHS', rows);
    expect(g.allowed).toEqual([]);
    expect(g.refused?.quarantined).toBe(true);
    expect((f.tables.forecast_refused_loads[0].rows as Row[])).toHaveLength(DAILY_SYNC_MAX_NEW_ROWS + 1);
  });
});

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
describe('ordering at every call site — the decision precedes the first write', () => {
  for (const lib of ['hhs', 'doj', 'nasa', 'ssa']) {
    it(`${lib}-ingest: applyInsertGuard runs before the first agency_forecasts insert, and only allowed rows insert`, () => {
      const s = read(`src/lib/forecasts/${lib}-ingest.ts`);
      const guard = s.indexOf('await applyInsertGuard(sb,');
      const firstInsert = s.indexOf(".from('agency_forecasts').insert(");
      expect(guard).toBeGreaterThan(0);
      expect(firstInsert).toBeGreaterThan(guard);
      expect(s).not.toMatch(/guardForecastInserts/);
    });
  }
  it('sync-forecasts: every publisher is decided (and refused ones quarantined) before the first upsert', () => {
    const s = read('src/app/api/cron/sync-forecasts/route.ts');
    const decide = s.indexOf('guardForecastInserts(supabase, src');
    const quarantine = s.indexOf('quarantineRefusedLoad(supabase, src');
    const upsert = s.indexOf(".upsert(batch, { onConflict: 'source_agency,external_id' })");
    expect(decide).toBeGreaterThan(0);
    expect(quarantine).toBeGreaterThan(decide);
    expect(upsert).toBeGreaterThan(quarantine);
    expect(s).toMatch(/const writable = deduped\.filter\(\(r\) => !refusedSources\.has/);
  });
  for (const a of ['hhs', 'doj', 'nasa', 'ssa']) {
    it(`${a}-forecast-sync route fails the run AND alerts operations on a refusal`, () => {
      const s = read(`src/app/api/cron/${a}-forecast-sync/route.ts`);
      const block = s.slice(s.indexOf('if (r.insertRefused)'), s.indexOf('if (r.insertRefused)') + 1200);
      expect(block).toMatch(/sendOpsAlert\(/);
      expect(block).toMatch(/status: 500/);
    });
  }
});
