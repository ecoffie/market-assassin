/**
 * R5 — event readers do not list a row whose source notice is inactive AND past its response
 * window (22 such upcoming rows on 2026-11-09). Excluded inside the query so totals stay exact.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { queryFederalEvents, queryScopedEvents } from './query';

type Row = { notice_id: string; title: string; event_type: string; event_date: string; agency: string };
const state: { rows: Row[]; retired: string[] | null; nots: string[] } = { rows: [], retired: [], nots: [] };

vi.mock('@/lib/events/event-currency-live', () => ({
  loadRetiredSourceNoticeIds: async () => state.retired,
  loadHiddenRows: async () => (state.retired ? state.retired.map((notice_id) => ({ notice_id, reason: 'retired_source' })) : null),
  notInList: (ids: string[] | null) => (ids && ids.length ? `(${ids.join(',')})` : null),
}));
vi.mock('@/lib/events/ai-event-discovery', () => ({ searchEventsViaAI: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      const excluded: string[] = [];
      let notices = false;
      const b: Record<string, unknown> = {
        select: () => b, gte: () => b, lte: () => b, order: () => b, limit: () => b, in: () => b, eq: () => b, ilike: () => b,
        or: (f: string) => { if (f.includes('event_type.not.in')) notices = true; return b; },
        not: (_c: string, _o: string, v: string) => { state.nots.push(v); excluded.push(...v.replace(/[()]/g, '').split(',')); return b; },
        then: (resolve: (v: unknown) => void) => {
          const rows = notices ? [] : state.rows.filter((r) => !excluded.includes(r.notice_id));
          resolve({ data: rows, count: rows.length, error: null });
        },
      };
      return b;
    },
  }),
}));

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
beforeEach(() => {
  state.rows = [
    { notice_id: 'live1', title: 'Live Industry Day', event_type: 'industry_day', event_date: inDays(10), agency: 'DEPT OF THE ARMY' },
    { notice_id: 'dead1', title: 'Dead Industry Day', event_type: 'industry_day', event_date: inDays(12), agency: 'DEPT OF THE ARMY' },
  ];
  state.retired = ['dead1'];
  state.nots = [];
});

describe('R5: retired-source rows are not listed', () => {
  it('search_federal_events excludes them and its total counts only listed rows', async () => {
    const r = await queryFederalEvents({ agency: 'Army', currentYear: 2026 });
    expect(r.events.map((e) => e.title)).toEqual(['Live Industry Day']);
    expect(r.samAttendableTotal).toBe(1);
    expect(state.nots).toContain('(dead1)');
  });

  it('opportunity/office-scoped events exclude them too', async () => {
    const r = await queryScopedEvents({ agency: 'Army' });
    expect(r.events.map((e) => e.notice_id)).toEqual(['live1']);
  });

  it('history view (includeHidden): hidden rows are returned, untouched, with the reason recorded', async () => {
    const r = await queryFederalEvents({ agency: 'Army', currentYear: 2026, includeHidden: true });
    expect(r.events.map((e) => [e.title, e.hidden_reason])).toEqual([
      ['Live Industry Day', null],
      ['Dead Industry Day', 'retired_source'],
    ]);
    expect(state.nots).toEqual([]);
  });

  it('when liveness cannot be established the reader still answers (unfiltered), never empty', async () => {
    state.retired = null;
    const r = await queryFederalEvents({ agency: 'Army', currentYear: 2026 });
    expect(r.events).toHaveLength(2);
    expect(r.degraded).toBe(false);
  });
});
