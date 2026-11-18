/**
 * Internal-link surfaces over /forecasts/[id]: the hub's "Recently published" list and the
 * agency page's upcoming forecasts. Links must only point at pages that pass the thin gate, the
 * agency scope must be in the query, and a failed read is null (section omitted), never [].
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Res = { data: unknown[] | null; error: { message: string } | null };
const m = vi.hoisted(() => ({ pages: [] as Res[], ops: [] as string[][] }));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      const ops: string[] = [];
      m.ops.push(ops);
      const q: Record<string, unknown> = {};
      for (const f of ['select', 'eq', 'neq', 'not', 'gte', 'order', 'in']) {
        q[f] = (...a: unknown[]) => { ops.push(`${f}:${a.map((x) => (Array.isArray(x) ? x.join(',') : String(x))).join('|')}`); return q; };
      }
      q.limit = (n: number) => { ops.push(`limit:${n}`); return Promise.resolve(m.pages.shift() ?? { data: [], error: null }); };
      return q;
    },
  }),
}));

import {
  forecastAgencySeo,
  forecastSourceCodesForAgencySlug,
  getForecastLinksForAgencySlug,
  getRecentForecastLinks,
  toForecastLinks,
} from './forecast-pages';

const NOW = new Date('2026-11-18T12:00:00Z');
const f = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  source_agency: 'DOJ',
  title: 'Network operations support services',
  naics_code: '541512',
  estimated_value_min: 1_000_000,
  estimated_value_max: 5_000_000,
  estimated_value_range: null,
  anticipated_award_date: '2027-03-01',
  solicitation_date: null,
  fiscal_year: 'FY2027',
  anticipated_quarter: 'Q2',
  status: null,
  ...extra,
});
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

beforeEach(() => {
  m.pages = [];
  m.ops = [];
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://sb.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
});

describe('forecastSourceCodesForAgencySlug', () => {
  it('reverses forecastAgencySeo, including the DoD component codes', () => {
    const dod = forecastAgencySeo('NAVY')!.slug;
    const codes = forecastSourceCodesForAgencySlug(dod);
    expect(codes).toEqual(expect.arrayContaining(['NAVY', 'USACE']));
    for (const c of codes) expect(forecastAgencySeo(c)?.slug).toBe(dod);
    expect(forecastSourceCodesForAgencySlug('no-such-agency')).toEqual([]);
  });
});

describe('toForecastLinks', () => {
  it('drops stale, thin, closed and duplicate rows; keeps the smallest id of a duplicate', () => {
    const out = toForecastLinks([
      f(ID(5)),
      f(ID(2)), // same duplicate key as ID(5) → ID(2) is canonical
      f(ID(3), { title: 'Other title for a stale forecast', anticipated_award_date: '2025-01-01', fiscal_year: 'FY2025' }),
      f(ID(4), { title: 'Thin forecast row', naics_code: null, estimated_value_min: null, estimated_value_max: null }),
      f(ID(6), { title: 'Awarded already forecast', status: 'Awarded' }),
    ] as never, 10, NOW);
    expect(out.map((l) => l.slug)).toEqual([`network-operations-support-services-${ID(2)}`]);
    expect(out[0].value).toBeTruthy();
  });
});

describe('getRecentForecastLinks', () => {
  it('orders by created_at desc and caps the result', async () => {
    m.pages = [{ data: [f(ID(1)), f(ID(7), { title: 'Second distinct forecast title' })], error: null }];
    const out = await getRecentForecastLinks(1, NOW);
    expect(out).toHaveLength(1);
    expect(m.ops[0]).toContain('order:created_at|[object Object]');
  });

  it('returns null on a read error', async () => {
    m.pages = [{ data: null, error: { message: 'down' } }];
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await getRecentForecastLinks(50, NOW)).toBeNull();
    spy.mockRestore();
  });
});

describe('getForecastLinksForAgencySlug', () => {
  it('scopes to the agency source codes in the query', async () => {
    const doj = forecastAgencySeo('DOJ')!.slug;
    m.pages = [{ data: [f(ID(1))], error: null }];
    const out = await getForecastLinksForAgencySlug(doj, 10, NOW);
    expect(out).toHaveLength(1);
    expect(m.ops[0].some((o) => o.startsWith('in:source_agency|') && o.includes('DOJ'))).toBe(true);
    expect(m.ops[0].some((o) => o.startsWith('gte:anticipated_award_date|'))).toBe(true);
  });

  it('returns [] without a read for an agency with no forecast source', async () => {
    expect(await getForecastLinksForAgencySlug('no-such-agency', 10, NOW)).toEqual([]);
    expect(m.ops).toHaveLength(0);
  });
});
