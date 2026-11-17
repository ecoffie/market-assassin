/**
 * Drives the real check-data-freshness handler against a fake Supabase.
 * Proves two things end to end:
 *  1. a ?stamp= without evidence never writes last_built (it used to, for any key);
 *  2. dodaac_directory is judged by its rows, so the false 169-day alert is gone,
 *     and a partial producer run is still caught.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Op = { table: string; ops: Array<[string, unknown[]]> };
const updates: Array<{ table: string; values: unknown; filters: Array<[string, unknown[]]> }> = [];
let dodaac = { newest: '2026-11-06T09:00:31Z', total: 4902, inWindow: 4901 };

const DATA_SOURCES = [
  { key: 'dodaac_directory', name: 'DoDAAC directory', category: 'reference', refresh_cadence: 'as-published', last_built: '2026-06-01', is_active: true, notes: 'Office code → office name' },
  { key: 'tier2_sblo', name: 'Tier-2 / SBLO', category: 'curated', refresh_cadence: 'quarterly', last_built: '2026-11-01', is_active: true, notes: 'The 2,700+ contractor DB' },
];

function resolve(q: Op): { data: unknown; error: null; count?: number | null } {
  const has = (name: string) => q.ops.some(([n]) => n === name);
  const arg = (name: string) => q.ops.find(([n]) => n === name)?.[1];
  if (q.table === 'data_sources') {
    if (has('maybeSingle')) {
      const key = (arg('eq') as unknown[])[1];
      return { data: DATA_SOURCES.find((r) => r.key === key) ?? null, error: null };
    }
    return { data: DATA_SOURCES, error: null };
  }
  if (q.table === 'dodaac_directory') {
    const sel = arg('select') as unknown[];
    const head = (sel?.[1] as { head?: boolean } | undefined)?.head;
    if (head) return { data: null, error: null, count: has('gte') ? dodaac.inWindow : dodaac.total };
    return { data: { updated_at: dodaac.newest }, error: null };
  }
  if (q.table === 'federal_contacts') return { data: { updated_at: new Date().toISOString() }, error: null };
  return { data: null, error: null };
}

function builder(table: string) {
  const q: Op = { table, ops: [] };
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'order', 'limit', 'gte', 'not']) {
    b[m] = (...a: unknown[]) => { q.ops.push([m, a]); return b; };
  }
  b.update = (values: unknown) => {
    const rec = { table, values, filters: [] as Array<[string, unknown[]]> };
    updates.push(rec);
    const u = { eq: (...a: unknown[]) => { rec.filters.push(['eq', a]); return Promise.resolve({ error: null }); } };
    return u;
  };
  b.maybeSingle = () => { q.ops.push(['maybeSingle', []]); return Promise.resolve(resolve(q)); };
  b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(resolve(q)).then(ok, ko);
  return b;
}

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (t: string) => builder(t) }) }));
vi.mock('@/lib/ops-alert', () => ({ sendOpsAlert: vi.fn(async () => ({ ok: true })) }));

const { GET } = await import('./route');
const call = (qs: string) => GET(new NextRequest(`https://getmindy.ai/api/cron/check-data-freshness?password=pw&notify=false&${qs}`));

beforeEach(() => {
  process.env.ADMIN_PASSWORD = 'pw';
  updates.length = 0;
  dodaac = { newest: '2026-11-06T09:00:31Z', total: 4902, inWindow: 4901 };
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-17T13:05:00Z'));
});

describe('?stamp= cannot advance a freshness stamp without evidence', () => {
  it('a bare stamp is refused and writes nothing', async () => {
    const res = await call('stamp=tier2_sblo');
    expect(res.status).toBe(400);
    expect(updates).toHaveLength(0);
  });

  it('a table-measured source cannot be stamped even with evidence', async () => {
    const res = await call('stamp=dodaac_directory&records=4902&evidence=' + encodeURIComponent('ran refresh, see https://getmindy.ai/x'));
    expect(res.status).toBe(409);
    expect(updates).toHaveLength(0);
  });

  it('a stamp with a record count and cited evidence writes last_built, record_count and the evidence', async () => {
    const ev = 'Re-verified 41 SBLO contacts; diff in data/imports/sblo-refresh-2026-12.csv';
    const res = await call(`stamp=tier2_sblo&records=200&evidence=${encodeURIComponent(ev)}`);
    expect(res.status).toBe(200);
    expect(updates).toHaveLength(1);
    expect(updates[0].values).toMatchObject({ last_built: '2026-11-17', record_count: 200 });
    expect(String((updates[0].values as { notes: string }).notes)).toContain(ev);
  });
});

describe('DoDAAC freshness comes from its rows', () => {
  it('production state (refreshed 11-06, 4,901/4,902 rows, stamp 2026-06-01) raises no alert', async () => {
    const body = await (await call('')).json();
    expect(body.stale.map((s: { key: string }) => s.key)).not.toContain('dodaac_directory');
    expect(body.tableMeasured.dodaac_directory.status).toBe('healthy');
  });

  it('a partial run (only the SAM gap-fill inserted rows) is still flagged', async () => {
    dodaac = { newest: '2026-11-16T09:00:00Z', total: 4910, inWindow: 8 };
    const body = await (await call('')).json();
    const row = body.stale.find((s: { key: string }) => s.key === 'dodaac_directory');
    expect(row?.refreshWith).toMatch(/^partial:/);
  });

  it('a producer that stopped running is flagged stale', async () => {
    dodaac = { newest: '2026-09-06T09:00:00Z', total: 4902, inWindow: 0 };
    const body = await (await call('')).json();
    expect(body.stale.find((s: { key: string }) => s.key === 'dodaac_directory')?.refreshWith).toMatch(/^stale:/);
  });
});
