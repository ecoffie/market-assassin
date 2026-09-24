/**
 * Publisher alert floors — semantics (Phase A/D). Pure decisions + the backfill wrapper + the guard that the
 * ordinary sync can never move a floor.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { decideFloorChange, runPublisherBackfill, type FloorRow } from './alert-floor';

const base = { reason: 'test', set_by: 'unit' };
const active = (at: string): FloorRow => ({ source_agency: 'DHS', state: 'active', alertable_after: at });

describe('decideFloorChange', () => {
  it('normal publisher already in the corpus: seeded once at its last created_at; a re-seed never overwrites', () => {
    const d = decideFloorChange(null, { kind: 'seed', source_agency: 'DOE', alertable_after: '2026-09-23T13:00:38Z', ...base });
    expect(d).toMatchObject({ ok: true, noop: false, next: { state: 'active', alertable_after: '2026-09-23T13:00:38.000Z' } });
    expect(decideFloorChange(active('2026-09-01T00:00:00Z'), { kind: 'seed', source_agency: 'DHS', alertable_after: '2026-09-30T00:00:00Z', ...base }))
      .toMatchObject({ ok: true, noop: true, next: { alertable_after: '2026-09-01T00:00:00Z' } });
  });
  it('newly onboarded publisher / unresolved publisher becoming available: suspend, then activate at the load boundary', () => {
    const s = decideFloorChange(null, { kind: 'suspend', source_agency: 'SSA', ...base });
    expect(s).toMatchObject({ ok: true, next: { state: 'suspended', alertable_after: null } });
    const a = decideFloorChange(s.ok ? s.next : null, { kind: 'activate', source_agency: 'SSA', alertable_after: '2026-09-24T02:00:00Z', ...base });
    expect(a).toMatchObject({ ok: true, next: { state: 'active', alertable_after: '2026-09-24T02:00:00.000Z' } });
  });
  it('historical backfill into an existing publisher moves the floor FORWARD; backward needs an explicit rewind', () => {
    expect(decideFloorChange(active('2026-09-20T00:00:00Z'), { kind: 'activate', source_agency: 'DHS', alertable_after: '2026-09-24T00:00:00Z', ...base }).ok).toBe(true);
    const back = decideFloorChange(active('2026-09-20T00:00:00Z'), { kind: 'activate', source_agency: 'DHS', alertable_after: '2026-09-10T00:00:00Z', ...base });
    expect(back.ok).toBe(false);
    expect(decideFloorChange(active('2026-09-20T00:00:00Z'), { kind: 'activate', source_agency: 'DHS', alertable_after: '2026-09-10T00:00:00Z', allowRewind: true, ...base }).ok).toBe(true);
  });
  it('key must be a canonical Discovery publisher code; reason and actor are required', () => {
    expect(decideFloorChange(null, { kind: 'seed', source_agency: 'COMMERCE', alertable_after: '2026-09-01T00:00:00Z', ...base }).ok).toBe(false);
    expect(decideFloorChange(null, { kind: 'seed', source_agency: 'DHS', alertable_after: '2026-09-01T00:00:00Z', reason: ' ', set_by: 'x' }).ok).toBe(false);
    expect(decideFloorChange(null, { kind: 'seed', source_agency: 'DHS', alertable_after: 'nope', ...base }).ok).toBe(false);
  });
});

/** Minimal fake for the floor tables + the publisher's last created_at. */
function floorDb(lastCreatedAt: string | null) {
  const floors = new Map<string, FloorRow>();
  const log: unknown[] = [];
  const from = (t: string) => {
    const ops: Array<[string, unknown[]]> = [];
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'limit', 'order']) q[m] = (...a: unknown[]) => { ops.push([m, a]); return q; };
    q.maybeSingle = async () => {
      if (t === 'agency_forecasts') return { data: lastCreatedAt ? { created_at: lastCreatedAt } : null, error: null };
      const key = ops.find((o) => o[0] === 'eq')?.[1][1] as string;
      return { data: floors.get(key) ?? null, error: null };
    };
    q.upsert = async (r: FloorRow) => { floors.set(r.source_agency, r); return { error: null }; };
    q.insert = async (r: unknown) => { log.push(r); return { error: null }; };
    return q;
  };
  return { db: { from }, floors, log };
}

describe('runPublisherBackfill', () => {
  it('success: suspended during the load, then active at the last created_at — logged twice', async () => {
    const f = floorDb('2026-09-24T02:00:00.123Z');
    const states: string[] = [];
    await runPublisherBackfill(f.db, 'SSA', 'initial SSA onboarding', 'unit', async () => { states.push(f.floors.get('SSA')!.state); });
    expect(states).toEqual(['suspended']);
    expect(f.floors.get('SSA')).toMatchObject({ state: 'active', alertable_after: '2026-09-24T02:00:00.123Z' });
    expect(f.log).toHaveLength(2);
  });
  it('failed ingest: the floor stays SUSPENDED (no burst, no silent reopen) and the error propagates', async () => {
    const f = floorDb('2026-09-24T02:00:00Z');
    await expect(runPublisherBackfill(f.db, 'SSA', 'x', 'unit', async () => { throw new Error('portal 503'); })).rejects.toThrow('portal 503');
    expect(f.floors.get('SSA')).toMatchObject({ state: 'suspended' });
  });
});

describe('the ordinary sync can never move a floor', () => {
  it('no sync/ingest cron imports the floor module', () => {
    const roots = ['src/app/api/cron', 'src/lib/forecasts'];
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        if (!/\.ts$/.test(n) || /\.test\.ts$/.test(n) || /alert-floor\.ts$/.test(n)) continue;
        if (/alert-floor/.test(readFileSync(p, 'utf8'))) offenders.push(p);
      }
    };
    for (const r of roots) walk(join(process.cwd(), r));
    expect(offenders).toEqual([]);
  });
});
