/**
 * /forecasts/[id] — slug, field honesty, the thin gate, staleness, dedupe and the paged sitemap.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const m = vi.hoisted(() => ({
  pages: [] as Array<{ data: unknown[] | null; error: { message: string } | null }>,
  calls: [] as Array<{ filters: string[]; range: [number, number] }>,
}));

// PostgREST-shaped fake: each .range() resolves the next queued page for that request's label.
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      const filters: string[] = [];
      const q: Record<string, unknown> = {};
      for (const f of ['select', 'eq', 'neq', 'like', 'not', 'or', 'gte', 'order', 'limit']) {
        q[f] = (...a: unknown[]) => { filters.push(`${f}:${a.map(String).join('|')}`); return q; };
      }
      q.range = (from: number, to: number) => {
        m.calls.push({ filters: [...filters], range: [from, to] });
        const isDescribed = filters.some((f) => f.startsWith('like:description'));
        const idx = m.pages.findIndex((p) => ((p as { described?: boolean }).described ?? false) === isDescribed);
        const page = idx >= 0 ? m.pages.splice(idx, 1)[0] : { data: [], error: null };
        return Promise.resolve(page);
      };
      return q;
    },
  }),
}));

import {
  forecastSlug, parseForecastSlug, forecastIndexability, isForecastStale, forecastValueLabel,
  positiveAmount, parseFiscalYear, fiscalPeriodLabel, forecastAgencyLabel, forecastAgencySeo,
  forecastSubAgency, hasRealDescription, forecastDuplicateKey, getForecastSitemapEntries,
  type ForecastRow,
} from './forecast-pages';

const NOW = new Date('2026-11-17T12:00:00Z');
const ID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

const row = (over: Partial<ForecastRow> = {}): ForecastRow => ({
  id: ID, source_agency: 'DHS', title: 'Cybersecurity operations support services',
  naics_code: '541512', estimated_value_min: null, estimated_value_max: 5_000_000, estimated_value_range: null,
  anticipated_award_date: '2027-03-01', solicitation_date: null, fiscal_year: 'FY2027', anticipated_quarter: 'Q2',
  status: 'forecast', ...over,
});

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://sb.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
  m.pages = [];
  m.calls = [];
});

describe('slug', () => {
  it('reads well and resolves by the uuid alone', () => {
    const s = forecastSlug('IT Help Desk & Tier-2 Support (DHS/CBP)', ID);
    expect(s).toBe(`it-help-desk-and-tier-2-support-dhs-cbp-${ID}`);
    expect(parseForecastSlug(s)).toBe(ID);
    expect(parseForecastSlug(ID.toUpperCase())).toBe(ID);
    expect(parseForecastSlug('some-title-123')).toBeNull();
    expect(parseForecastSlug('')).toBeNull();
  });
});

describe('absent is "not stated", never zero', () => {
  it('value', () => {
    expect(positiveAmount(0)).toBeNull();
    expect(positiveAmount('-5')).toBeNull();
    expect(forecastValueLabel(0, 0, null)).toBeNull();
    expect(forecastValueLabel(null, null, 'TBD')).toBeNull(); // no digit → not a value
    expect(forecastValueLabel(250_000, 7_500_000, null)).toBe('$250K – $7.5M');
    expect(forecastValueLabel(null, 2_000_000, null)).toBe('Up to $2M');
    expect(forecastValueLabel(null, null, 'R2 – $250K–$7.5M')).toBe('R2 – $250K–$7.5M');
  });
  it('fiscal period', () => {
    expect(parseFiscalYear('FY2026')).toBe(2026);
    expect(parseFiscalYear('FY26')).toBe(2026);
    expect(parseFiscalYear('FY2026-2027')).toBe(2027);
    expect(parseFiscalYear('TBD')).toBeNull();
    expect(fiscalPeriodLabel('2027', 'Q3')).toBe('FY2027 Q3');
    expect(fiscalPeriodLabel(null, 'Q3')).toBeNull();
  });
  it('a department name in `bureau` is not a sub-agency', () => {
    expect(forecastSubAgency('Department of the Interior')).toBeNull();
    expect(forecastSubAgency('U.S. Fish and Wildlife Service')).toBe('U.S. Fish and Wildlife Service');
    expect(forecastSubAgency(null)).toBeNull();
  });
  it('the page never puts POC values or a set-aside default into HTML', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/forecasts/[id]/page.tsx'), 'utf8');
    expect(src).not.toMatch(/poc_?(email|phone|name)|pocEmail|pocPhone|pocName/i);
    expect(src).not.toMatch(/Full (&|and) Open|open to (everyone|all)/i);
  });
});

describe('agency mapping', () => {
  it('labels via the shared forecast identity and links DoD components to DoD', () => {
    expect(forecastAgencyLabel('DHS')).toBe('Department of Homeland Security');
    expect(forecastAgencySeo('NAVY')?.slug).toBe('department-of-defense');
    expect(forecastAgencySeo('USACE')?.slug).toBe('department-of-defense');
    expect(forecastAgencySeo('STATE')?.slug).toBe('department-of-state');
    expect(forecastAgencySeo('Treasury')?.slug).toBe('department-of-the-treasury');
    expect(forecastAgencySeo('VA')?.slug).toBe('department-of-veterans-affairs');
    expect(forecastAgencySeo('NOPE')).toBeNull();
  });
});

describe('staleness', () => {
  it('uses the latest named date, else the fiscal-year end, else unknown (not stale)', () => {
    expect(isForecastStale(row({ anticipated_award_date: '2026-03-01' }), NOW)).toBe(true); // > 180 d ago
    expect(isForecastStale(row({ anticipated_award_date: '2026-08-01' }), NOW)).toBe(false); // within 180 d
    expect(isForecastStale(row({ anticipated_award_date: '2025-01-01', solicitation_date: '2026-12-01' }), NOW)).toBe(false);
    expect(isForecastStale(row({ anticipated_award_date: null, fiscal_year: 'FY2025' }), NOW)).toBe(true); // FY ended 2025-09-30
    expect(isForecastStale(row({ anticipated_award_date: null, fiscal_year: 'FY2026' }), NOW)).toBe(false); // ended 2026-09-30
    expect(isForecastStale(row({ anticipated_award_date: null, fiscal_year: null }), NOW)).toBe(false);
  });
});

describe('the thin gate', () => {
  it('indexes a forecast with title + agency + two signals', () => {
    const r = forecastIndexability(row({ estimated_value_max: null }), false, NOW); // naics + timing
    expect(r).toEqual(expect.objectContaining({ indexable: true, reasons: [] }));
  });
  it('refuses fewer than two signals', () => {
    const r = forecastIndexability(row({ naics_code: null, estimated_value_max: null }), false, NOW); // timing only
    expect(r.indexable).toBe(false);
    expect(r.reasons).toContain('thin');
    expect(forecastIndexability(row({ naics_code: null, estimated_value_max: null }), true, NOW).indexable).toBe(true);
  });
  it('refuses a missing / tiny title, a missing agency, stale and closed rows', () => {
    expect(forecastIndexability(row({ title: 'IT' }), true, NOW).reasons).toContain('no-title');
    expect(forecastIndexability(row({ source_agency: null }), true, NOW).reasons).toContain('no-agency');
    expect(forecastIndexability(row({ anticipated_award_date: '2025-06-01' }), true, NOW).reasons).toContain('stale');
    expect(forecastIndexability(row({ status: 'Awarded' }), true, NOW).reasons).toContain('closed-status');
    expect(forecastIndexability(row({ status: 'cancelled' }), true, NOW).reasons).toContain('closed-status');
  });
  it('a $0 value and a non-numeric NAICS are not signals', () => {
    const r = forecastIndexability(row({ naics_code: 'TBD', estimated_value_max: 0, anticipated_award_date: '2027-01-01' }), false, NOW);
    expect(r.signals).toEqual({ naics: false, value: false, timing: true, description: false });
    expect(r.indexable).toBe(false);
  });
  it('a description that only repeats the title is not one', () => {
    const t = 'Facilities maintenance and repair services, region 4';
    expect(hasRealDescription(t, t)).toBe(false);
    expect(hasRealDescription(t, 'short')).toBe(false);
    expect(hasRealDescription(t, 'Recurring and on-call maintenance for 14 buildings at the regional campus.')).toBe(true);
  });
});

describe('sitemap', () => {
  const id = (i: number) => `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`;
  const rows = (from: number, n: number, over: Partial<ForecastRow> = {}) =>
    Array.from({ length: n }, (_, k) => row({ id: id(from + k), title: `Engineering support services ${from + k}`, ...over }));

  it('pages past the 1,000-row clip and never selects descriptions', async () => {
    m.pages = [
      { data: rows(0, 1000), error: null }, { data: rows(1000, 1000), error: null }, { data: rows(2000, 3), error: null },
    ];
    const out = await getForecastSitemapEntries(NOW);
    expect(out).toHaveLength(2003);
    expect(m.calls.filter((c) => !c.filters.some((f) => f.startsWith('like:'))).map((c) => c.range[0])).toEqual([0, 1000, 2000]);
    for (const c of m.calls) {
      const select = c.filters.find((f) => f.startsWith('select:'))!;
      expect(select).not.toMatch(/description/);
      expect(c.filters).toContain('order:id|[object Object]');
    }
    expect(out[0].slug).toBe(`engineering-support-services-0-${id(0)}`);
  });

  it('applies the thin gate, using the in-database description test', async () => {
    const thin = row({ id: id(1), title: 'Janitorial services at HQ', naics_code: null, estimated_value_max: null });
    const thinDescribed = row({ id: id(2), title: 'Grounds maintenance services', naics_code: null, estimated_value_max: null });
    const stale = row({ id: id(3), title: 'Old requirement for software', anticipated_award_date: '2024-01-01' });
    m.pages = [
      { data: [thin, thinDescribed, stale], error: null },
      Object.assign({ data: [{ id: id(2) }], error: null }, { described: true }),
    ];
    const out = await getForecastSitemapEntries(NOW);
    expect(out.map((r) => r.slug)).toEqual([forecastSlug(thinDescribed.title, id(2))]);
    const desc = m.calls.find((c) => c.filters.some((f) => f.startsWith('like:description')))!;
    expect(desc.filters).toContain(`like:description|${'_'.repeat(40)}*`);
  });

  it('lists one row per duplicate forecast (the smallest id)', async () => {
    const a = row({ id: id(5) });
    const b = row({ id: id(9) });
    expect(forecastDuplicateKey(a)).toBe(forecastDuplicateKey(b));
    m.pages = [{ data: [b, a], error: null }];
    const out = await getForecastSitemapEntries(NOW);
    expect(out.map((r) => r.slug)).toEqual([forecastSlug(a.title, id(5))]);
  });

  it('throws on a read error instead of returning a partial list', async () => {
    m.pages = [{ data: rows(0, 1000), error: null }, { data: null, error: { message: 'statement timeout' } }];
    await expect(getForecastSitemapEntries(NOW)).rejects.toThrow(/statement timeout/);
  });
});
