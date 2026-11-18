/**
 * loadHiddenRows over a fake Supabase: hiding is a READ-SIDE decision (no row is deleted or altered),
 * every hidden row carries its reason, and an independently confirmed future event is never hidden.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { _resetRetiredCache, loadHiddenRows } from './event-currency-live';

type Row = Record<string, unknown>;
const writes: string[] = [];
function fakeSb(tables: Record<string, Row[]>) {
  return {
    from: (table: string) => {
      const filters: Array<(r: Row) => boolean> = [];
      let lo = 0; let hi = Infinity;
      const b: Record<string, unknown> = {
        select: () => b, order: () => b,
        in: (c: string, v: unknown[]) => { filters.push((r) => v.includes(r[c])); return b; },
        or: (expr: string) => {
          const lt = /response_deadline\.lt\.(\d{4}-\d{2}-\d{2})/.exec(expr);
          if (lt) filters.push((r) => r.active === false || (!!r.response_deadline && String(r.response_deadline) < lt[1]));
          return b;
        },
        range: (f: number, t: number) => { lo = f; hi = t; return b; },
        insert: () => { writes.push(`insert:${table}`); return b; },
        update: () => { writes.push(`update:${table}`); return b; },
        upsert: () => { writes.push(`upsert:${table}`); return b; },
        delete: () => { writes.push(`delete:${table}`); return b; },
        then: (resolve: (v: unknown) => void) => {
          const rows = (tables[table] || []).filter((r) => filters.every((f) => f(r))).slice(lo, hi === Infinity ? undefined : hi + 1);
          resolve({ data: rows, error: null });
        },
      };
      return b;
    },
  };
}

beforeEach(() => { writes.length = 0; _resetRetiredCache(); });

describe('loadHiddenRows', () => {
  const today = new Date('2026-11-17T12:00:00Z');
  it('hides with a reason, never writes, and lets a newer family notice\'s future date win', async () => {
    const sb = fakeSb({
      sam_events: [
        { id: '1', notice_id: 'closed-undated', title: 'Widget Industry Day', event_type: 'industry_day', event_date: null, source: 'sam_gov', solicitation_number: 'W912PL26R0001' },
        { id: '2', notice_id: 'closed-confirmed', title: 'Gadget Industry Day', event_type: 'industry_day', event_date: null, source: 'sam_gov', solicitation_number: 'N0017426R1003' },
        { id: '3', notice_id: 'newer-amd', title: 'Gadget Industry Day Amendment 1', event_type: 'industry_day', event_date: '2026-12-02', source: 'sam_gov', solicitation_number: 'N0017426R1003' },
        { id: '4', notice_id: 'dead', title: 'Old Industry Day', event_type: 'industry_day', event_date: '2026-12-01', source: 'sam_gov', solicitation_number: 'FA861426R0001' },
      ],
      sam_opportunities: [
        { notice_id: 'closed-undated', active: true, response_deadline: '2026-11-01', posted_date: '2026-10-01' },
        { notice_id: 'closed-confirmed', active: true, response_deadline: '2026-11-01', posted_date: '2026-10-01' },
        { notice_id: 'newer-amd', active: true, response_deadline: '2026-12-15', posted_date: '2026-10-25' },
        { notice_id: 'dead', active: false, response_deadline: '2026-10-01', posted_date: '2026-09-01' },
      ],
    });
    const hidden = await loadHiddenRows(sb, today);
    expect(hidden).toEqual([
      { notice_id: 'closed-undated', reason: 'undated_closed_notice' },
      { notice_id: 'dead', reason: 'retired_source' },
    ]);
    expect(writes).toEqual([]);
  });
});
