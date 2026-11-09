/**
 * search_federal_events: attendable events must survive the limit, and curated dated events must
 * reach the result. Measured 2026-11-07: a VA query returned 23 items, all sources-sought notices,
 * and no conference. get_federal_event_series found 0 for a query naming NVSBE.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildEventsIcs } from './ics';
import { catalogOccurrencesForAgency, currentOccurrence } from './catalog-occurrences';
import { allocateEventSlots, ATTENDABLE_TYPES, queryFederalEvents } from './query';
import { getFederalEventSeries, seriesQueryScore } from '@/mcp/tools/event-series';
import { searchFederalEvents } from '@/mcp/tools/federal-events';
import { classifyBillingOutcome } from '@/lib/mcp/credit-integrity';

type Row = { title: string; event_type: string | null; event_date: string };
const state: { rows: Row[]; fail: boolean; orFilters: string[] } = { rows: [], fail: false, orFilters: [] };

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      let limit = Infinity;
      let kind: 'attendable' | 'notice' = 'attendable';
      const b: Record<string, unknown> = {
        select: () => b, gte: () => b, lte: () => b, order: () => b,
        limit: (n: number) => { limit = n; return b; },
        in: () => { kind = 'attendable'; return b; },
        or: (f: string) => { state.orFilters.push(f); if (f.includes('event_type.not.in')) kind = 'notice'; return b; },
        then: (resolve: (v: unknown) => void) => {
          if (state.fail) return resolve({ data: null, count: null, error: { message: 'boom' } });
          const all = state.rows.filter((r) => ATTENDABLE_TYPES.includes(r.event_type || '') === (kind === 'attendable'));
          resolve({ data: all.slice(0, limit), count: all.length, error: null });
        },
      };
      return b;
    },
  }),
}));
vi.mock('@/lib/events/ai-event-discovery', () => ({ searchEventsViaAI: vi.fn() }));

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const rfi = (i: number): Row => ({ title: `Sources sought ${i}`, event_type: 'rfi', event_date: inDays(1) });
const day = (i: number): Row => ({ title: `Industry day ${i}`, event_type: 'industry_day', event_date: inDays(30) });

beforeEach(() => { state.rows = []; state.fail = false; state.orFilters = []; });

describe('allocateEventSlots', () => {
  it('gives notices whatever attendable events leave', () => {
    expect(allocateEventSlots(3, 100, 50)).toEqual({ attendable: 3, notices: 47 });
  });
  it('keeps a fifth of a full page for notices', () => {
    expect(allocateEventSlots(100, 100, 50)).toEqual({ attendable: 40, notices: 10 });
  });
  it('hands unused notice slots back to attendable events', () => {
    expect(allocateEventSlots(100, 2, 50)).toEqual({ attendable: 48, notices: 2 });
  });
  it('a limit of 1 shows the attendable event', () => {
    expect(allocateEventSlots(1, 1, 1)).toEqual({ attendable: 1, notices: 0 });
  });
});

describe('queryFederalEvents ranking', () => {
  it('a later industry day beats sooner notices through the limit, and notices still appear', async () => {
    state.rows = [...Array.from({ length: 30 }, (_, i) => rfi(i)), day(1)];
    const res = await queryFederalEvents({ agency: 'Army', currentYear: 2026, limit: 5 });
    expect(res.events.map((e) => e.event_type)).toEqual(['industry_day', 'rfi', 'rfi', 'rfi', 'rfi']);
    expect(res.samAttendableTotal).toBe(1);
    expect(res.samNoticeTotal).toBe(30);
  });

  it('a row with no event_type stays in the notice read, never dropped', async () => {
    await queryFederalEvents({ agency: 'Army', currentYear: 2026 });
    expect(state.orFilters.some((f) => f.includes('event_type.is.null'))).toBe(true);
  });

  it('a failed read is unknown, never a zero', async () => {
    state.fail = true;
    const res = await queryFederalEvents({ agency: 'Army', currentYear: 2026 });
    expect(res.degraded).toBe(true);
    expect(res.samAttendableTotal).toBeNull();
    expect(res.samNoticeTotal).toBeNull();
  });

  it('adds no catalog row unless asked, so SAM-evidence callers keep SAM-only counts', async () => {
    const res = await queryFederalEvents({ agency: 'Veterans Affairs', monthsAhead: 12, currentYear: 2026 });
    expect(res.catalogCount).toBe(0);
    expect(res.events.some((e) => e.source === 'catalog')).toBe(false);
  });
});

describe('catalog occurrences', () => {
  it('finds NVSBE by every common name for VA, and only VA', () => {
    for (const a of ['VA', 'Veterans Affairs', 'Department of Veterans Affairs', 'VETERANS AFFAIRS, DEPARTMENT OF']) {
      expect(catalogOccurrencesForAgency(a, '2026-11-07', '2027-02-05').map((r) => r.event_date), a).toEqual(['2026-12-08']);
    }
    expect(catalogOccurrencesForAgency('Navy', '2026-11-07', '2027-02-05')).toEqual([]);
    // A fragment of the name is not the agency.
    expect(catalogOccurrencesForAgency('Affairs', '2026-11-07', '2027-02-05')).toEqual([]);
  });
  it('is outside the window until the horizon reaches its start', () => {
    expect(catalogOccurrencesForAgency('VA', '2026-11-07', '2026-12-07')).toEqual([]);
  });
  it('still shows on its last day and disappears the day after', () => {
    expect(catalogOccurrencesForAgency('VA', '2026-12-09', '2027-03-01')).toHaveLength(1);
    expect(catalogOccurrencesForAgency('VA', '2026-12-10', '2027-03-01')).toEqual([]);
    const o = { start: '2026-12-08', end: '2026-12-09', location: null, registration_url: null, verified_at: '2026-11-07', source_url: 'x' };
    expect(currentOccurrence(o, '2026-12-10')).toBeNull();
  });
});

// These read the real catalog, whose NVSBE date eventually passes. Freeze the clock inside the window.
describe('search_federal_events tool', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-07T12:00:00Z')); });
  afterEachRestore();

  it('VA, 3 months: NVSBE comes back ahead of notices, with its source and counts', async () => {
    state.rows = Array.from({ length: 23 }, (_, i) => rfi(i));
    const res = await searchFederalEvents({ agency: 'Department of Veterans Affairs', months_ahead: 3 });
    expect(res.events[0]).toMatchObject({
      source: 'catalog', event_type: 'conference', event_date: '2026-12-08', event_end_date: '2026-12-09',
      location: 'Huntington Convention Center, Cleveland, OH', source_url: 'https://www.va.gov/osdbu/nvsbe/',
    });
    expect(res._meta).toMatchObject({ grounded: true, catalog_count: 1, attendable_count: 1, notice_count: 23, sam_count: 23, ai_count: 0 });
  });

  it('the .ics covers both days of a multi-day event', async () => {
    const res = await searchFederalEvents({ agency: 'VA', months_ahead: 3, include_ics: true });
    const ics = Buffer.from(res.ics!, 'base64').toString();
    expect(ics).toContain('DTSTART;VALUE=DATE:20261208');
    expect(ics).toContain('DTEND;VALUE=DATE:20261210');
  });

  it('SAM down with only a catalog row left: returned, but not grounded and not billed', async () => {
    state.fail = true;
    const res = await searchFederalEvents({ agency: 'VA', months_ahead: 3 });
    expect(res.events).toHaveLength(1);
    expect(res._meta).toMatchObject({ grounded: false, degraded: true, sam_attendable_total: null, sam_notice_total: null });
    expect(classifyBillingOutcome(res)).toBe('nonbillable_system_failure');
  });
});

describe('get_federal_event_series', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-07T12:00:00Z')); });
  afterEachRestore();

  it('finds NVSBE from the query that returned 0, ranked first', () => {
    const r = getFederalEventSeries({ query: 'veteran small business engagement NVSBE' });
    expect(r.series[0].name).toBe('National Veterans Small Business Engagement (NVSBE)');
    expect(r.series.length).toBeLessThanOrEqual(3);
  });
  it('carries the dated occurrence and the agency', () => {
    const [nvsbe] = getFederalEventSeries({ query: 'NVSBE' }).series;
    expect(nvsbe.next_occurrence).toMatchObject({ start: '2026-12-08', end: '2026-12-09', verified_at: '2026-11-07' });
    expect(nvsbe.agencies).toContain('VA');
  });
  it('stops presenting the date as "next" after the event', () => {
    vi.setSystemTime(new Date('2026-12-10T12:00:00Z'));
    expect(getFederalEventSeries({ query: 'NVSBE' }).series[0].next_occurrence).toBeNull();
  });
  it('a full review is dated, but currency is per entry, not per file', () => {
    // 2026-11-09: every entry re-checked against its organizer (catalog-integrity.unit.test.ts).
    // A file-level review date says nothing about whether an entry is current — catalog_verification does.
    const { _meta } = getFederalEventSeries({});
    expect(_meta.catalog_updated).toBe('2026-11-09');
    expect(_meta.catalog_last_full_review).toBe('2026-11-09');
    expect(_meta.catalog_verification.verified_upcoming).toBeLessThan(_meta.total_in_catalog);
  });
  it('generic queries do not flood', () => {
    const total = getFederalEventSeries({})._meta.total_in_catalog;
    expect(getFederalEventSeries({ query: 'federal contracting events' }).series.length).toBeLessThan(5);
    expect(getFederalEventSeries({ query: 'government industry' }).series.length).toBeLessThan(total / 4);
    expect(getFederalEventSeries({ query: 'zzzz qqqq' }).series).toEqual([]);
  });
  it('a query where one strong word misses most of the words does not match', () => {
    const row = { name: 'AFCEA West', notes: null, audience: null, categories: [] };
    expect(seriesQueryScore(row, 'afcea veterans nursing dental')).toBe(0);
  });
  it('an exact phrase still passes, and word stems match', () => {
    expect(getFederalEventSeries({ query: 'cyber' }).series.some((s) => /TechNet Cyber/.test(s.name))).toBe(true);
    const row = { name: 'Veterans Summit', notes: null, audience: null, categories: [] };
    expect(seriesQueryScore(row, 'veteran')).toBeGreaterThan(0);
  });
});

describe('buildEventsIcs end date', () => {
  const base = { date: '2026-12-08', title: 'X' };
  it('an end before the start, or malformed, falls back to one day', () => {
    expect(buildEventsIcs([{ ...base, endDate: '2026-12-01' }]).ics).toContain('DTEND;VALUE=DATE:20261209');
    expect(buildEventsIcs([{ ...base, endDate: 'soon' }]).ics).toContain('DTEND;VALUE=DATE:20261209');
  });
});

function afterEachRestore() {
  // Local helper so both describes restore real timers.
  return afterEach(() => { vi.useRealTimers(); });
}
