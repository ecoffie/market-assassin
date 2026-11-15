import { describe, it, expect, afterEach } from 'vitest';
import { openQueryFactory, CachedOpenQuery, currentOpenSnapshot, __setOpenSnapshotForTests, DELTA_MAX, type OpenSnapshot } from './open-cache';
import { buildDiscoveryPlan } from '@/lib/discovery/plan';
import { MAPS_POLICY } from '@/lib/discovery/policy';

/**
 * Cached open retrieval — integration contract (RC3, development; flag OFF by default). A tiny in-memory "database"
 * stands in for PostgREST so updates, deletes, new notices, concurrency and failures can be exercised exactly.
 */
const CTX = { today: '2026-11-14', fiscalYear: 2027 };
const plan = buildDiscoveryPlan({ query: 'We supply industrial valves.' }, MAPS_POLICY, CTX);
const AT = '2026-11-14T11:00:00Z';
const NOW = new Date('2026-11-14T12:00:00Z');
type Row = Record<string, string | null>;
const R = (id: string, title: string, o: Partial<Row> = {}): Row => ({ notice_id: id, title, description: '', sow_text: null, department: 'DEPT OF DEFENSE', sub_tier: '', solicitation_number: id, naics_code: null, psc_code: null, set_aside_code: null, set_aside_description: null, response_deadline: '2026-12-01', synced_at: '2026-11-14T10:00:00Z', active: 'true', ...o });

/** Fake PostgREST over `db` rows: evaluates in / changed-since / unchanged-since / is / order / limit; other filters pass. */
function fakeDb(db: Row[], opts: { failVerify?: boolean } = {}) {
  let calls = 0;
  const client = {
    calls: () => calls,
    from() {
      const st: { in?: string[]; changed?: boolean; unchanged?: boolean; head?: boolean; count?: boolean; isNull?: string; limit?: number; textPlan?: boolean } = {};
      const q: Record<string, unknown> = {};
      const ret = () => q;
      q.select = (_c: string, o?: { count?: string; head?: boolean }) => { st.head = !!o?.head; st.count = !!o?.count; return q; };
      q.in = (_c: string, ids: string[]) => { st.in = ids; return q; };
      q.or = (e: string) => { if (/\.gt\./.test(e)) st.changed = true; else if (/\.lte\./.test(e)) st.unchanged = true; else if (/imatch|match/.test(e)) st.textPlan = true; return q; };
      q.is = (c: string, v: null) => { if (v === null) st.isNull = c; return q; };
      q.limit = (n: number) => { st.limit = n; return q; };
      for (const k of ['eq', 'gt', 'gte', 'lt', 'lte', 'order', 'neq', 'ilike', 'like', 'not', 'filter', 'range', 'contains']) q[k] = ret;
      q.then = (res: (v: unknown) => void) => {
        calls++;
        if (opts.failVerify && st.in) return res({ data: null, count: null, error: { message: 'boom' } });
        let rows = db.filter((r) => r.active === 'true');
        if (st.in) rows = rows.filter((r) => st.in!.includes(r.notice_id as string));
        if (st.changed) rows = rows.filter((r) => String(r.synced_at) > AT);
        if (st.unchanged) rows = rows.filter((r) => !(String(r.synced_at) > AT));
        if (st.textPlan) rows = rows.filter((r) => /valve/i.test(String(r.title)));
        if (st.isNull) rows = rows.filter((r) => r[st.isNull!] == null);
        rows = [...rows].sort((a, b) => String(a.response_deadline).localeCompare(String(b.response_deadline)));
        const count = rows.length;
        if (st.limit != null) rows = rows.slice(0, st.limit);
        return res({ data: st.head ? null : rows, count: st.count ? count : null, error: null });
      };
      return q;
    },
  };
  return client;
}
const snap = (rows: Row[]): OpenSnapshot => ({ builtAt: AT, count: rows.length, rows: rows as never });
const on = () => { process.env.OPEN_SNAPSHOT_RETRIEVAL = 'true'; };
afterEach(() => { delete process.env.OPEN_SNAPSHOT_RETRIEVAL; __setOpenSnapshotForTests(null); });

describe('flag OFF: exactly today\'s query', () => {
  it('the factory returns the SQL path and never touches the snapshot', async () => {
    const f = await openQueryFactory(fakeDb([]), plan, snap([R('a', '48--VALVE,CHECK')]), NOW);
    expect(f).toMatchObject({ path: 'sql', reason: null });
    expect(f.query('notice_id')).not.toBeInstanceOf(CachedOpenQuery);
  });
});

describe('flag ON: exact current results', () => {
  const base = [R('a', '48--VALVE,CHECK'), R('b', '48--VALVE,GATE', { response_deadline: '2026-11-20' }), R('c', 'Snow removal')];
  it('unchanged world: count and order equal the database', async () => {
    on();
    const f = await openQueryFactory(fakeDb(base), plan, snap(base), NOW);
    expect(f.path).toBe('snapshot');
    const r = await f.query('notice_id', { count: 'exact' }).order('response_deadline', { ascending: true }).limit(500);
    expect(r.count).toBe(2);
    expect(r.data.map((x: Row) => x.notice_id)).toEqual(['b', 'a']);
  });
  it('a NEW notice after the snapshot is found (delta)', async () => {
    on();
    const db = [...base, R('d', '48--VALVE,FLOAT', { synced_at: '2026-11-14T11:30:00Z' })];
    const r = await (await openQueryFactory(fakeDb(db), plan, snap(base), NOW)).query('notice_id', { count: 'exact' });
    expect(r.count).toBe(3);
  });
  it('an UPDATED notice is answered from the live row, never the snapshot text', async () => {
    on();
    const db = [R('a', 'Snow removal', { synced_at: '2026-11-14T11:30:00Z' }), base[1], base[2]]; // "a" no longer a valve
    const r = await (await openQueryFactory(fakeDb(db), plan, snap(base), NOW)).query('notice_id', { count: 'exact' });
    expect(r.count).toBe(1);
  });
  it('a DELETED (or closed) notice drops out: live verification by id', async () => {
    on();
    const db = [base[1], base[2]]; // "a" gone, no stamp possible
    const r = await (await openQueryFactory(fakeDb(db), plan, snap(base), NOW)).query('notice_id', { count: 'exact' });
    expect(r.count).toBe(1);
  });
  it('a caller\'s extra filter (e.g. unmapped: map_lat IS NULL) is applied in every live part', async () => {
    on();
    const db = [R('a', '48--VALVE,CHECK', { map_lat: '30.1' }), R('b', '48--VALVE,GATE', { map_lat: null })];
    const r = await (await openQueryFactory(fakeDb(db), plan, snap(db), NOW)).query('notice_id', { count: 'exact', head: true }).is('map_lat', null);
    expect(r.count).toBe(1);
  });
  it('concurrent queries share one snapshot and do not interfere', async () => {
    on();
    const f = await openQueryFactory(fakeDb(base), plan, snap(base), NOW);
    const rs = await Promise.all(Array.from({ length: 20 }, () => f.query('notice_id', { count: 'exact' })));
    expect(new Set(rs.map((r: { count: number }) => r.count))).toEqual(new Set([2]));
  });
});

describe('failures are explicit, never empty', () => {
  it('a live verification error surfaces as an error (the caller reports it), not as zero rows', async () => {
    on();
    const r = await (await openQueryFactory(fakeDb(base0(), { failVerify: true }), plan, snap(base0()), NOW)).query('notice_id', { count: 'exact' });
    expect(r.error).toEqual({ message: 'boom' });
    expect(r.count).toBeNull();
  });
  it(`too many changed rows (> ${DELTA_MAX}) → SQL path with the reason`, async () => {
    on();
    const many = Array.from({ length: DELTA_MAX + 1 }, (_, i) => R(`x${i}`, 'Thing', { synced_at: '2026-11-14T11:30:00Z' }));
    const f = await openQueryFactory(fakeDb(many), plan, snap([]), NOW);
    expect(f.path).toBe('sql');
    expect(f.reason).toMatch(/changed since the snapshot/);
  });
  it('an unknown chained method throws instead of being silently ignored', async () => {
    on();
    const q = (await openQueryFactory(fakeDb(base0()), plan, snap(base0()), NOW)).query('notice_id') as unknown as Record<string, () => unknown>;
    expect(() => q.textSearch()).toThrow(/unsupported method/);
  });
  it('no snapshot yet: the holder starts one build and returns null (callers use SQL meanwhile)', () => {
    let builds = 0;
    const client = { from: () => { builds++; throw new Error('db down'); } };
    expect(currentOpenSnapshot(client, NOW)).toBeNull();
    expect(currentOpenSnapshot(client, NOW)).toBeNull();
    expect(builds).toBe(1); // single-flight: the second call does not start a second build
  });
});
function base0() { return [R('a', '48--VALVE,CHECK'), R('c', 'Snow removal')]; }
