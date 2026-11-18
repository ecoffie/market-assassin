/**
 * Internal-link surfaces over /recompetes/[slug]: the /recompetes hub and the contractor
 * profile's "Contracts expiring soon" block. Proves the scope + real-row filters run IN the
 * query before the limit, the thin gate drops rows a page would noindex, and a failed read is
 * never an empty list.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Res = { data: unknown[] | null; error: { message: string } | null };
const m = vi.hoisted(() => ({
  pages: [] as Res[],
  calls: [] as Array<{ table: string; ops: string[] }>,
}));

vi.mock('@vercel/kv', () => ({ kv: { incr: vi.fn(), expire: vi.fn(), mget: vi.fn() } }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      const call = { table, ops: [] as string[] };
      m.calls.push(call);
      const q: Record<string, unknown> = {};
      for (const f of ['select', 'eq', 'neq', 'is', 'gt', 'gte', 'lte', 'like', 'or', 'order', 'in']) {
        q[f] = (...a: unknown[]) => { call.ops.push(`${f}:${a.map((x) => (Array.isArray(x) ? x.join(',') : String(x))).join('|')}`); return q; };
      }
      q.limit = (n: number) => { call.ops.push(`limit:${n}`); return Promise.resolve(m.pages.shift() ?? { data: [], error: null }); };
      return q;
    },
  }),
}));

import { getExpiringRecompetesForUeis, getRecompeteHubLinks, toRecompeteLinks, ueiChunks } from './recompetes';

const NOW = new Date('2026-11-18T15:00:00Z');
const row = (id: string, end: string, extra: Record<string, unknown> = {}) => ({
  contract_id: `CONT_AWD_${id}_9700_-NONE-_-NONE-`,
  piid: id,
  incumbent_name: 'ACME CORP',
  incumbent_uei: 'ABCDEFGHJKLM',
  awarding_agency: 'Department of Defense',
  awarding_sub_agency: 'Department of the Army',
  period_of_performance_current_end: end,
  potential_total_value: '1000000',
  total_obligation: null,
  ...extra,
});

beforeEach(() => {
  m.pages = [];
  m.calls = [];
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://sb.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
});

describe('toRecompeteLinks', () => {
  it('keeps only gate-passing rows, soonest first, deduplicated, capped', () => {
    const out = toRecompeteLinks([
      row('B', '2027-03-01'),
      row('A', '2026-12-01'),
      row('A', '2026-12-01'), // duplicate
      row('C', '2027-01-01', { incumbent_name: 'Unknown' }), // no incumbent → noindex page
      row('D', '2027-01-01', { potential_total_value: null }), // no value → noindex page
      { ...row('E', '2027-02-01'), contract_id: 'legacy-123' }, // legacy id → noindex page
    ], 10, NOW);
    expect(out.map((l) => l.piid)).toEqual(['A', 'B']);
    expect(out[0].href).toBe('/recompetes/acme-corp-department-of-the-army--CONT_AWD_A_9700_-NONE-_-NONE-');
    expect(out[0].value).toBe(1_000_000);
    expect(toRecompeteLinks([row('A', '2026-12-01'), row('B', '2027-01-01')], 1, NOW)).toHaveLength(1);
  });
});

describe('ueiChunks', () => {
  it('uppercases, dedupes, drops malformed UEIs and chunks', () => {
    const ueis = ['abcdefghjklm', 'ABCDEFGHJKLM', 'bad', '', ...Array.from({ length: 5 }, (_, i) => `ZZZZZZZZZZZ${i}`)];
    expect(ueiChunks(ueis, 4)).toEqual([
      ['ABCDEFGHJKLM', 'ZZZZZZZZZZZ0', 'ZZZZZZZZZZZ1', 'ZZZZZZZZZZZ2'],
      ['ZZZZZZZZZZZ3', 'ZZZZZZZZZZZ4'],
    ]);
  });
});

describe('getRecompeteHubLinks', () => {
  it('applies real-row + future-date filters in the query before the limit, ordered by end date', async () => {
    m.pages = [{ data: [row('A', '2026-12-01')], error: null }];
    const out = await getRecompeteHubLinks(200, NOW);
    expect(out).toHaveLength(1);
    const ops = m.calls[0].ops;
    expect(ops).toContain('is:quality_flag|null');
    expect(ops).toContain('gte:period_of_performance_current_end|2026-11-18');
    expect(ops).toContain('like:contract_id|CONT_%');
    const iLimit = ops.findIndex((o) => o.startsWith('limit:'));
    expect(ops.findIndex((o) => o.startsWith('order:period_of_performance_current_end'))).toBeLessThan(iLimit);
  });

  it('throws on a read error instead of returning an empty hub', async () => {
    m.pages = [{ data: null, error: { message: 'timeout' } }];
    await expect(getRecompeteHubLinks(200, NOW)).rejects.toThrow(/recompete hub/);
  });
});

describe('getExpiringRecompetesForUeis', () => {
  it('scopes every chunk to the profile UEIs in the query and merges to the exact soonest N', async () => {
    const ueis = Array.from({ length: 151 }, (_, i) => `U${String(i).padStart(11, '0')}`);
    m.pages = [
      { data: [row('LATE', '2027-06-01'), row('MID', '2027-02-01')], error: null },
      { data: [row('SOON', '2026-12-15')], error: null },
    ];
    const out = await getExpiringRecompetesForUeis(ueis, 2, NOW);
    expect(out!.map((l) => l.piid)).toEqual(['SOON', 'MID']);
    expect(m.calls).toHaveLength(2);
    for (const c of m.calls) {
      expect(c.ops.some((o) => o.startsWith('in:incumbent_uei|'))).toBe(true);
      expect(c.ops).toContain('is:quality_flag|null');
    }
  });

  it('returns [] without querying when the profile has no valid UEI', async () => {
    expect(await getExpiringRecompetesForUeis(['nope'], 10, NOW)).toEqual([]);
    expect(m.calls).toHaveLength(0);
  });

  it('returns null (block omitted) on a read error — never an empty "0 expiring"', async () => {
    m.pages = [{ data: null, error: { message: 'boom' } }];
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await getExpiringRecompetesForUeis(['ABCDEFGHJKLM'], 10, NOW)).toBeNull();
    spy.mockRestore();
  });
});
