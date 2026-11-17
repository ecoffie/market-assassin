/**
 * /recompetes/[slug] SEO record pages (2026-11-17): the URL contract, the thin gate, the rebid
 * estimate, honest failure on reads, and the paged sitemap.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  pages: [] as Array<{ data?: unknown[] | null; error?: { message: string } | null; count?: number | null }>,
  calls: [] as Array<{ table: string; ops: string[]; range?: [number, number] }>,
}));

vi.mock('@vercel/kv', () => ({ kv: { incr: vi.fn(), expire: vi.fn(), mget: vi.fn() } }));
// PostgREST-shaped fake: records every builder call; a terminal (range / limit / await) takes the
// next queued response.
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      const call: { table: string; ops: string[]; range?: [number, number] } = { table, ops: [] };
      m.calls.push(call);
      const next = () => Promise.resolve(m.pages.shift() ?? { data: [], error: null, count: null });
      const q: Record<string, unknown> = {};
      for (const f of ['select', 'eq', 'neq', 'is', 'gt', 'gte', 'lte', 'like', 'or', 'order']) {
        q[f] = (...a: unknown[]) => { call.ops.push(`${f}:${a.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join('|')}`); return q; };
      }
      q.limit = (n: number) => { call.ops.push(`limit:${n}`); return next(); };
      q.range = (a: number, b: number) => { call.range = [a, b]; return next(); };
      q.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => next().then(res, rej);
      return q;
    },
  }),
}));

import {
  contractIdFromSlug,
  estimateRebidWindow,
  getOtherAgencyRecompetes,
  getRecompeteById,
  getRecompeteChangeCount,
  getRecompeteSitemapChunk,
  headlineValue,
  recompeteIndexVerdict,
  recompeteSlug,
  RECOMPETE_SITEMAP_CHUNK,
  RECOMPETE_SITEMAP_CHILD_COUNT,
  type RecompeteRecord,
} from './recompetes';

const NOW = new Date('2026-11-17T15:00:00Z');
const ID = 'CONT_AWD_FA850126F0034_9700_FA850124D0005_9700';

const row = (over: Partial<Record<string, unknown>> = {}) => ({
  contract_id: ID,
  piid: 'FA850126F0034',
  incumbent_name: 'RCA CONTRACTING LLC',
  incumbent_uei: 'ABCDEF123456',
  awarding_agency: 'Department of Defense',
  awarding_sub_agency: 'Department of the Air Force',
  awarding_office: null,
  naics_code: '238220',
  naics_description: null,
  psc_code: 'Z2PZ',
  psc_description: null,
  description: 'HVAC REPAIR',
  total_obligation: '1250000.00',
  potential_total_value: null,
  period_of_performance_start: '2025-10-01',
  period_of_performance_current_end: '2027-06-30',
  place_of_performance_state: 'GA',
  place_of_performance_city: null,
  contract_type: 'DELIVERY ORDER',
  set_aside_type: null,
  set_aside_enriched: null,
  last_synced_at: '2026-11-17T10:00:00Z',
  quality_flag: null,
  ...over,
});

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://sb.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
  m.pages = [];
  m.calls = [];
});

describe('URL contract', () => {
  it('slug = kebab(incumbent agency)--contract_id and resolves back by the id only', () => {
    const slug = recompeteSlug({ contract_id: ID, incumbent_name: 'RCA Contracting, LLC', awarding_sub_agency: 'Department of the Air Force' });
    expect(slug).toBe(`rca-contracting-llc-department-of-the-air-force--${ID}`);
    expect(contractIdFromSlug(slug)).toBe(ID);
    // a stale or edited prefix still resolves (the page then 308s to the canonical slug)
    expect(contractIdFromSlug(`old-name--${ID}`)).toBe(ID);
    expect(contractIdFromSlug(ID)).toBe(ID);
  });
  it('the -NONE- parent marker survives (it contains no "--")', () => {
    const id = 'CONT_AWD_W9133L18C0001_9700_-NONE-_-NONE-';
    expect(contractIdFromSlug(recompeteSlug({ contract_id: id, incumbent_name: 'X', awarding_agency: 'Y' }))).toBe(id);
  });
  it('rejects ids that cannot be a contract_id', () => {
    expect(contractIdFromSlug('foo--bad id')).toBeNull();
    expect(contractIdFromSlug('x--a')).toBeNull();
    expect(contractIdFromSlug('foo--%3Cscript%3E')).toBeNull();
  });
});

describe('thin gate', () => {
  const ok = { contract_id: ID, incumbent_name: 'ACME', awarding_agency: 'Department of Energy', period_of_performance_current_end: '2027-03-01', potential_total_value: 5e6, total_obligation: null };
  it('a real, named, valued, current contract is indexable', () => {
    expect(recompeteIndexVerdict(ok, NOW)).toEqual({ indexable: true });
  });
  it.each([
    [{ incumbent_name: 'Unknown' }, 'no_incumbent'],
    [{ incumbent_name: '' }, 'no_incumbent'],
    [{ awarding_agency: 'Unknown' }, 'no_agency'],
    [{ potential_total_value: null, total_obligation: 0 }, 'no_value'],
    [{ period_of_performance_current_end: null }, 'no_end_date'],
    [{ period_of_performance_current_end: '2026-08-01' }, 'ended'],
    [{ contract_id: 'FA850126F0034' }, 'legacy_id'],
  ])('%j → %s', (over, reason) => {
    expect(recompeteIndexVerdict({ ...ok, ...over } as typeof ok, NOW)).toEqual({ indexable: false, reason });
  });
  it('recently ended (≤ 90 days) stays indexable; the sitemap horizon is 24 months', () => {
    expect(recompeteIndexVerdict({ ...ok, period_of_performance_current_end: '2026-09-01' }, NOW).indexable).toBe(true);
    expect(recompeteIndexVerdict({ ...ok, period_of_performance_current_end: '2029-01-01' }, NOW).indexable).toBe(true);
    expect(recompeteIndexVerdict({ ...ok, period_of_performance_current_end: '2029-01-01' }, NOW, { forSitemap: true }))
      .toEqual({ indexable: false, reason: 'beyond_horizon' });
  });
  it('headline value prefers potential, falls back to obligated, else null (never 0)', () => {
    expect(headlineValue({ potential_total_value: 9, total_obligation: 3 })).toBe(9);
    expect(headlineValue({ potential_total_value: null, total_obligation: 3 })).toBe(3);
    expect(headlineValue({ potential_total_value: 0, total_obligation: null })).toBeNull();
  });
});

describe('rebid window estimate', () => {
  it('Sources Sought 12→6 months and RFP 4→2 months before the end date', () => {
    const w = estimateRebidWindow('2027-06-30', NOW)!;
    expect(w.sourcesSought).toEqual({ from: '2026-06-30', to: '2026-12-30' });
    expect(w.rfp).toEqual({ from: '2027-02-28', to: '2027-04-30' });
    expect(w.phase).toBe('sources_sought');
  });
  it('phases and the no-date case', () => {
    expect(estimateRebidWindow('2028-12-31', NOW)!.phase).toBe('before_sources_sought');
    expect(estimateRebidWindow('2027-02-15', NOW)!.phase).toBe('rfp');
    expect(estimateRebidWindow('2026-12-01', NOW)!.phase).toBe('final_months');
    expect(estimateRebidWindow('2026-10-01', NOW)!.phase).toBe('ended');
    expect(estimateRebidWindow(null, NOW)).toBeNull();
  });
});

describe('record reads', () => {
  it('maps a real row, deriving NAICS description and lineage', async () => {
    m.pages.push({ data: [row()], error: null });
    const r = (await getRecompeteById(ID)) as RecompeteRecord;
    expect(r.total_obligation).toBe(1_250_000);
    expect(r.potential_total_value).toBeNull();
    expect(r.award_kind).toBe('order_under_vehicle');
    expect(r.parent_vehicle_piid).toBe('FA850124D0005');
    expect(m.calls[0].ops).toContain(`eq:contract_id|${ID}`);
  });
  it('a grouped_synthetic (or any flagged) row gets no page', async () => {
    m.pages.push({ data: [row({ quality_flag: 'grouped_synthetic' })], error: null });
    expect(await getRecompeteById(ID)).toBeNull();
  });
  it('absent → null; a READ ERROR throws (never a false 404)', async () => {
    m.pages.push({ data: [], error: null });
    expect(await getRecompeteById(ID)).toBeNull();
    m.pages.push({ data: null, error: { message: 'timeout' } });
    await expect(getRecompeteById(ID)).rejects.toThrow(/SEO_TEMPORARILY_UNAVAILABLE/);
  });
  it('change count: exact number, and unknown (null) on error — never 0', async () => {
    m.pages.push({ data: null, error: null, count: 4 });
    expect(await getRecompeteChangeCount(ID)).toBe(4);
    m.pages.push({ data: null, error: { message: 'boom' }, count: null });
    expect(await getRecompeteChangeCount(ID)).toBeNull();
    m.pages.push({ data: null, error: null, count: null });
    expect(await getRecompeteChangeCount(ID)).toBeNull();
  });
  it('related contracts are scoped by agency + NAICS inside the query, before the limit', async () => {
    m.pages.push({ data: [
      row({ contract_id: 'CONT_AWD_A1_9700_-NONE-_-NONE-', total_obligation: 5 }),
      row({ contract_id: 'CONT_AWD_A2_9700_-NONE-_-NONE-', incumbent_name: 'Unknown' }), // gated out
    ], error: null });
    const base = (await (async () => { m.pages.unshift({ data: [row()], error: null }); return getRecompeteById(ID); })())!;
    const rel = await getOtherAgencyRecompetes(base, 10, NOW);
    expect(rel).toHaveLength(1);
    expect(rel![0].href).toMatch(/--CONT_AWD_A1_9700_-NONE-_-NONE-$/);
    const ops = m.calls[1].ops;
    expect(ops).toEqual(expect.arrayContaining([
      'is:quality_flag|null', 'eq:awarding_agency|Department of Defense', 'eq:naics_code|238220', `neq:contract_id|${ID}`,
    ]));
    // scope filters come before the limit (the limit is the terminal call)
    expect(ops[ops.length - 1]).toBe('limit:20');
    m.pages.push({ data: null, error: { message: 'x' } });
    expect(await getOtherAgencyRecompetes(base, 10, NOW)).toBeNull(); // unavailable, not "none"
  });
});

describe('sitemap chunks', () => {
  it('pages with .range() in 1,000-row steps, gated in SQL and again in TS', async () => {
    const good = (i: number) => row({ contract_id: `CONT_AWD_P${i}_9700_-NONE-_-NONE-` });
    m.pages.push({ data: Array.from({ length: 1000 }, (_, i) => good(i)), error: null });
    m.pages.push({ data: [good(1000), row({ contract_id: 'CONT_AWD_X_9700_-NONE-_-NONE-', total_obligation: 0 })], error: null });
    const out = await getRecompeteSitemapChunk(0, NOW);
    expect(out).toHaveLength(1001);
    expect(m.calls.map((c) => c.range)).toEqual([[0, 999], [1000, 1999]]);
    expect(m.calls[0].ops).toEqual(expect.arrayContaining([
      'is:quality_flag|null', 'neq:incumbent_name|Unknown', 'neq:awarding_agency|Unknown', 'order:contract_id|{"ascending":true}',
    ]));
  });
  it('the second child starts where the first ends', async () => {
    m.pages.push({ data: [], error: null });
    await getRecompeteSitemapChunk(1, NOW);
    expect(m.calls[0].range).toEqual([RECOMPETE_SITEMAP_CHUNK, RECOMPETE_SITEMAP_CHUNK + 999]);
  });
  it('a read error throws (→ 503), never a short family', async () => {
    m.pages.push({ data: null, error: { message: 'timeout' } });
    await expect(getRecompeteSitemapChunk(0, NOW)).rejects.toThrow(/timeout/);
    await expect(getRecompeteSitemapChunk(RECOMPETE_SITEMAP_CHILD_COUNT, NOW)).rejects.toThrow(/no chunk/);
  });
  it('the last child refuses when rows remain past total capacity', async () => {
    const last = RECOMPETE_SITEMAP_CHILD_COUNT - 1;
    const full = Array.from({ length: 1000 }, (_, i) => row({ contract_id: `CONT_AWD_Q${i}_9700_-NONE-_-NONE-` }));
    for (let i = 0; i < RECOMPETE_SITEMAP_CHUNK / 1000; i++) m.pages.push({ data: full, error: null });
    m.pages.push({ data: [row()], error: null }); // overflow probe finds one more row
    await expect(getRecompeteSitemapChunk(last, NOW)).rejects.toThrow(/add a child/);
  });
});
