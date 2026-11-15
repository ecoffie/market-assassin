import { describe, it, expect } from 'vitest';
import { compileOps, cachedOpenRetrieval, buildOpenSnapshot, SNAPSHOT_MAX_AGE_MS, DELTA_MAX, type OpenSnapshot } from './open-cache';
import { buildDiscoveryPlan } from '@/lib/discovery/plan';
import { MAPS_POLICY } from '@/lib/discovery/policy';
import { matchesText } from '@/lib/discovery/matcher';

/**
 * Cached open retrieval (RC2, development only). Live benchmark (harness/cache-bench.mts, 2026-11-14): on all 17 benchmark
 * searches where SQL completes, the cache returned the identical count and 500-row window; on the 11 long phrasings the
 * SQL count timed out (null) while the cache answered in 1.4–2.5 s. These tests pin the refusal contract and evaluator
 * parity without a database.
 */
const CTX = { today: '2026-11-14', fiscalYear: 2027 };
const plan = (q: string) => buildDiscoveryPlan({ query: q }, MAPS_POLICY, CTX);
const row = (o: Record<string, string | null>) => ({ notice_id: 'n', title: '', description: '', sow_text: null, department: 'DEPT OF DEFENSE', sub_tier: '', solicitation_number: 'X1', naics_code: null, psc_code: null, set_aside_code: null, set_aside_description: null, response_deadline: '2026-12-01', ...o });

describe('in-memory evaluation of the plan\'s own ops matches the matcher', () => {
  const rows = [
    row({ title: '48--VALVE,CHECK', psc_code: '4820' }),
    row({ title: 'Custodial Services, Building 12', naics_code: '561720' }),
    row({ title: 'Grease trap cleaning', description: 'quarterly' }),
    row({ title: 'Snow removal', description: 'Includes janitorial support' }),
    row({ title: 'Security Guard Services', psc_code: 'S206' }),
  ];
  for (const q of ['We supply industrial valves.', 'janitorial services', 'We provide security guards.', 'grease trap', '"snow removal"']) {
    it(`agrees with matchesText for "${q}" on the text clause`, () => {
      const p = plan(q);
      const pass = compileOps(p.horizons.open.ops);
      // Every row the matcher admits on text must pass the compiled ops (codes / vocabulary may add more, never fewer).
      for (const r of rows) if (matchesText(p.matcher, [r.title, r.description, r.sow_text, r.department, r.solicitation_number])) expect(pass(r)).toBe(true);
    });
  }
  it('an op on a column the snapshot does not hold makes the plan uncacheable (throws, never guesses)', () => {
    expect(() => compileOps([{ op: 'or', expr: 'office_address.ilike.*VA*' } as never])).toThrow(/not in snapshot/);
  });
});

/** A minimal chainable fake: every query resolves to the queued result for its kind. */
function fakeClient(opts: { changed?: number; delta?: number; verify?: Array<{ count: number; data: unknown[] }>; head?: number[]; pages?: unknown[][] }) {
  const heads = [...(opts.head || [])]; const pages = [...(opts.pages || [])]; const verify = [...(opts.verify || [])];
  return {
    from() {
      const st: { head?: boolean; changed?: boolean; plan?: boolean; inIds?: boolean; ranged?: boolean } = {};
      const q: Record<string, unknown> = {};
      const chain = (k: string) => (...a: unknown[]) => {
        if (k === 'select') st.head = !!(a[1] as { head?: boolean })?.head;
        if (k === 'or' && String(a[0]).includes('.gt.')) st.changed = true;
        if (k === 'or' && /\.(imatch|match|eq|like)\./.test(String(a[0]))) st.plan = true;
        if (k === 'in') st.inIds = true;
        if (k === 'range') st.ranged = true;
        return q;
      };
      for (const k of ['select', 'eq', 'gt', 'gte', 'lte', 'lt', 'or', 'in', 'order', 'limit', 'range', 'is', 'not', 'ilike', 'like', 'neq', 'filter', 'contains', 'overlaps']) q[k] = chain(k);
      q.then = (res: (v: unknown) => void) => {
        if (st.ranged) return res({ data: pages.shift() || [], error: null });
        if (st.inIds) { const v = verify.shift() || { count: 0, data: [] }; return res({ ...v, error: null }); }
        if (st.head && st.changed && st.plan) return res({ count: opts.delta ?? 0, error: null });
        if (st.head && st.changed) return res({ count: opts.changed ?? 0, error: null });
        if (st.head && heads.length) return res({ count: heads.shift(), error: null });
        if (st.head) return res({ count: opts.delta ?? 0, error: null });
        return res({ data: [], error: null });
      };
      return q;
    },
  };
}
const SNAP = (builtAt: string): OpenSnapshot => ({ builtAt, count: 2, rows: [row({ notice_id: 'a', title: '48--VALVE,CHECK', psc_code: '4820' }) as never, row({ notice_id: 'b', title: 'Snow removal' }) as never] });
const NOW = new Date('2026-11-14T12:00:00Z');

describe('refuse, never substitute', () => {
  it('no snapshot / over-age snapshot → cache_unavailable', async () => {
    expect((await cachedOpenRetrieval({ client: fakeClient({}), plan: plan('valves'), snapshot: null, select: '*', windowLimit: 500, now: NOW })).status).toBe('cache_unavailable');
    const old = new Date(NOW.getTime() - SNAPSHOT_MAX_AGE_MS - 60_000).toISOString();
    const r = await cachedOpenRetrieval({ client: fakeClient({}), plan: plan('valves'), snapshot: SNAP(old), select: '*', windowLimit: 500, now: NOW });
    expect(r).toMatchObject({ status: 'cache_unavailable' });
  });
  it(`more than ${DELTA_MAX} rows changed since the snapshot → cache_unavailable (stale), not a partial answer`, async () => {
    const r = await cachedOpenRetrieval({ client: fakeClient({ changed: DELTA_MAX + 1 }), plan: plan('valves'), snapshot: SNAP('2026-11-14T11:00:00Z'), select: '*', windowLimit: 500, now: NOW });
    expect(r.status).toBe('cache_unavailable');
    if (r.status === 'cache_unavailable') expect(r.reason).toMatch(/changed since the snapshot/);
  });
  it('a genuine zero is ok with count 0 (not unavailable)', async () => {
    const r = await cachedOpenRetrieval({ client: fakeClient({ changed: 0, delta: 0 }), plan: plan('zzqxv'), snapshot: SNAP('2026-11-14T11:00:00Z'), select: '*', windowLimit: 500, now: NOW });
    expect(r).toMatchObject({ status: 'ok', count: 0 });
  });
  it('the count is live verification + delta, not the snapshot candidate count', async () => {
    const r = await cachedOpenRetrieval({ client: fakeClient({ changed: 3, delta: 1, verify: [{ count: 0, data: [] }] }), plan: plan('We supply industrial valves.'), snapshot: SNAP('2026-11-14T11:00:00Z'), select: '*', windowLimit: 500, now: NOW });
    // candidate "a" exists in the snapshot, but live verification returned 0 (e.g. closed since); the delta adds 1.
    expect(r).toMatchObject({ status: 'ok', count: 1 });
  });
  it('an incomplete snapshot is refused at build time', async () => {
    await expect(buildOpenSnapshot(fakeClient({ head: [3, 3], pages: [[{ notice_id: 'a' }]] }), NOW)).rejects.toThrow(/incomplete/);
  });
});
