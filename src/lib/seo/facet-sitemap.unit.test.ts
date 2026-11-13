/** Facet sitemap selection (2026-11-13): deterministic, route-valid, capped at the existing size. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ pages: [] as Array<{ data: unknown[] | null; error: { message: string } | null }>, orders: [] as string[] }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      const q: Record<string, unknown> = {};
      q.select = () => q; q.eq = () => q;
      q.order = (c: string) => { m.orders.push(c); return q; };
      q.range = () => Promise.resolve(m.pages.shift() ?? { data: [], error: null });
      return q;
    },
  }),
}));

import { getFacetSlugsForSitemap, FACET_SITEMAP_CAPS, SET_ASIDE_CODE_MAP } from './facets';

const sbaCode = Object.values(SET_ASIDE_CODE_MAP)[0][0];
const row = (naics: string, state: string, psc: string, sa: string | null = null) => ({ naics_code: naics, pop_state: state, psc_code: psc, set_aside_code: sa });

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://sb';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
  m.pages = []; m.orders = [];
});

describe('getFacetSlugsForSitemap', () => {
  it('drops codes the routes would 404 (3-digit NAICS, bad PSC, unknown state)', async () => {
    m.pages = [{ data: [row('531', 'DC', 'R4'), row('541512', 'ZZ', 'TOO-LONG'), row('541512', 'VA', 'D302', sbaCode), row('236', 'VA', 'Y1', sbaCode)], error: null }];
    const f = await getFacetSlugsForSitemap();
    expect(f.naicsState).toEqual([{ naics: '541512', state: 'VA' }]);
    expect(f.psc.sort()).toEqual(['D302', 'R4', 'Y1']);
    expect(f.setAsideNaics.map((x) => x.naics)).toEqual(['541512']);
  });

  it('reads every page in a stable order and ranks by opportunity count, ties by key', async () => {
    const many = (n: number, naics: string) => Array.from({ length: n }, () => row(naics, 'VA', 'D302'));
    m.pages = [{ data: [...many(600, '541512'), ...many(400, '541611')], error: null }, { data: [...many(2, '236220'), ...many(2, '236118')], error: null }];
    const f = await getFacetSlugsForSitemap();
    expect(m.orders).toEqual(['notice_id', 'notice_id']);
    expect(f.naicsState.map((x) => x.naics)).toEqual(['541512', '541611', '236118', '236220']);
  });

  it('caps each type at the pre-existing sitemap size', async () => {
    m.pages = [{ data: Array.from({ length: 1000 }, (_, i) => row(String(100000 + i), 'VA', `A${i % 999}`)), error: null }, { data: [], error: null }];
    const f = await getFacetSlugsForSitemap();
    expect(f.naicsState).toHaveLength(FACET_SITEMAP_CAPS.naicsState);
    expect(f.psc.length).toBeLessThanOrEqual(FACET_SITEMAP_CAPS.psc);
  });

  it('throws on a read error instead of returning a partial set', async () => {
    m.pages = [{ data: Array.from({ length: 1000 }, () => row('541512', 'VA', 'D302')), error: null }, { data: null, error: { message: 'timeout' } }];
    await expect(getFacetSlugsForSitemap()).rejects.toThrow(/timeout/);
  });
});
