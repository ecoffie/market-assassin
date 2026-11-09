/**
 * Downstream consumers of ATTENDABLE_TYPES once `forecast` is no longer attendable (2026-11-09).
 *
 * The mock APPLIES the event_type filters the real code sends (`.in('event_type', …)` and
 * `or('…event_type.not.in.(…)')`), so these tests prove that the production queries exclude
 * forecasts, not that a mock happens to hide them.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

type Row = { title: string; event_type: string | null; event_date: string; description?: string | null; agency?: string };
const state: { rows: Row[] } = { rows: [] };

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      let rows = [...state.rows];
      let limit = Infinity;
      const b: Record<string, unknown> = {
        select: () => b, gte: () => b, lte: () => b, lt: () => b, order: () => b, eq: () => b, ilike: () => b,
        limit: (n: number) => { limit = n; return b; },
        in: (col: string, list: string[]) => { rows = rows.filter((r) => list.includes(String((r as Record<string, unknown>)[col]))); return b; },
        or: (f: string) => {
          const m = f.match(/event_type\.not\.in\.\(([^)]*)\)/);
          if (m) { const list = m[1].split(','); rows = rows.filter((r) => r.event_type == null || !list.includes(r.event_type)); }
          return b;
        },
        then: (resolve: (v: unknown) => void) => resolve({ data: rows.slice(0, limit), count: rows.length, error: null }),
      };
      return b;
    },
  }),
}));
vi.mock('@/lib/events/ai-event-discovery', () => ({ searchEventsViaAI: vi.fn() }));

import { queryBuyerEventDna, queryFederalEvents, queryScopedEvents } from './query';
import { searchFederalEvents } from '@/mcp/tools/federal-events';

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const row = (title: string, event_type: string, days: number, description: string | null = null): Row =>
  ({ title, event_type, event_date: inDays(days), description, agency: 'DEPT OF THE ARMY' });

beforeEach(() => { state.rows = []; });

describe('buyer badges after "Forecasts Frequently" was retired', () => {
  it('never emits the retired badge, even when the buyer has many forecast rows', async () => {
    state.rows = [
      ...Array.from({ length: 6 }, (_, i) => row(`USTRANSCOM Procurement Forecast ${i}`, 'forecast', -30 - i)),
      row('Industry Day A', 'industry_day', -40),
      row('Industry Day B', 'industry_day', -50),
    ];
    const dna = await queryBuyerEventDna({ agency: 'Army' });
    expect(dna?.signals.map((s) => s.key)).toEqual(['runs_industry_days']);
    expect(JSON.stringify(dna)).not.toMatch(/forecast/i);
  });

  it('a buyer with only forecast rows gets no badges at all (renders nothing)', async () => {
    state.rows = Array.from({ length: 10 }, (_, i) => row(`FY27 Forecast ${i}`, 'forecast', -10 - i));
    expect(await queryBuyerEventDna({ agency: 'Army' })).toBeNull();
  });

  it('"Runs Industry Days" and "Small Business Outreach" still work, and forecasts do not feed them', async () => {
    state.rows = [
      row('Industry Day A', 'industry_day', -40, 'Open to small business.'),
      row('Industry Day B', 'industry_day', -50),
      row('Small Business Webinar', 'webinar', -60),
      row('Small Business Procurement Forecast', 'forecast', -20),
      row('Small Business Procurement Forecast 2', 'forecast', -25),
    ];
    const dna = await queryBuyerEventDna({ agency: 'Army' });
    expect(dna?.signals.map((s) => [s.key, s.count])).toEqual([
      ['runs_industry_days', 2],
      ['small_business_outreach', 2],
    ]);
    expect(dna?.pastYear).toBe(3);
  });

  it('the badge cannot come back by accident: no code path emits its key', () => {
    const src = readFileSync(join(__dirname, 'query.ts'), 'utf8');
    expect(src).not.toMatch(/key:\s*'forecasts_frequently'/);
    expect(src).not.toMatch(/'forecasts_frequently'\s*\|/);
  });
});

describe('search and map: forecasts are notices, events stay events', () => {
  const mixed = () => [
    row('VA Air Ambulance Virtual Industry Day', 'industry_day', 31),
    row('JPL Spacecraft Power Systems Webinar', 'webinar', 20),
    row('NVSBE Conference', 'conference', 40),
    row('MARFORSOC Acquisition Forecast', 'forecast', 10),
    row('Sources Sought - Snow Removal', 'rfi', 5),
  ];

  it('search: the forecast is still returned, as a notice, and is not counted as attendable', async () => {
    state.rows = mixed();
    const res = await queryFederalEvents({ agency: 'Army', currentYear: 2026 });
    expect(res.samAttendableTotal).toBe(3);
    expect(res.samNoticeTotal).toBe(2);
    const types = res.events.map((e) => e.event_type);
    expect(types.slice(0, 3).sort()).toEqual(['conference', 'industry_day', 'webinar']);
    expect(types.slice(3).sort()).toEqual(['forecast', 'rfi']);
  });

  it('MCP search_federal_events: attendable_count excludes the forecast, notice_count includes it', async () => {
    state.rows = mixed();
    const res = await searchFederalEvents({ agency: 'Army' });
    expect(res._meta.attendable_count).toBe(3);
    expect(res._meta.notice_count).toBe(2);
    expect(res.events.some((e) => e.event_type === 'forecast')).toBe(true);
  });

  it('map (scoped events): only industry days, webinars and conferences; no forecast, no RFI', async () => {
    state.rows = mixed();
    const res = await queryScopedEvents({ agency: 'Army', limit: 25 });
    expect(res.events.map((e) => e.event_type).sort()).toEqual(['conference', 'industry_day', 'webinar']);
  });

  it('map and search agree on which rows are attendable', async () => {
    state.rows = mixed();
    const map = await queryScopedEvents({ agency: 'Army', limit: 25 });
    const search = await queryFederalEvents({ agency: 'Army', currentYear: 2026 });
    expect(map.events.length).toBe(search.samAttendableTotal);
  });
});
