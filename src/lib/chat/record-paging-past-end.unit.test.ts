/**
 * Asking for a page past the end of a list (Agent 4, #2141 review, LOW): the renderer used to clamp the
 * offset to the last record, so "show offices 21 to 30" on a 20-office list repeated office #20 ("Showing
 * 20–20 of the 20…") and put its id in the source ledger again. A page past the end shows no rows, says
 * there are no more, and returns no ids.
 */
import { describe, it, expect } from 'vitest';
import { renderBuyingOffices, renderExpiringRecords, renderAwardList, renderVehicleMix } from './record-render';

const offices = Array.from({ length: 20 }, (_, i) => ({ office_name: `OFFICE ${i + 1}`, office_code: `C${String(i + 1).padStart(4, '0')}`, agency: 'Department of Defense', obligated: 1_000_000 - i * 10_000, share_pct: 5, award_count: 2 }));
const buying = (extra: Record<string, unknown> = {}) => ({ scope: { naics: ['561720'], state: 'GA', window: 'FY2025' }, offices, totals: { obligated: 19_000_000, award_count: 40, office_count: 20 }, notes: [], _meta: {}, ...extra });

describe('buying offices: a page past the end', () => {
  for (const offset of [20, 25, 400]) {
    it(`offset ${offset} shows no rows, says there are no more, and adds no ids`, () => {
      const r = renderBuyingOffices(buying(), { offset })!;
      expect(r.text).toMatch(/No more offices beyond #20\. All 20 offices with positive net obligations were shown\./);
      expect(r.text).not.toMatch(/^\| \d+\. /m);
      expect(r.text).not.toMatch(/Showing \d+–\d+/);
      expect(r.text).not.toMatch(/for the next/);
      expect(r.shown).toBe(0);
      expect(r.ids).toEqual([]);
      expect(r.officeExamples).toEqual([]);
      expect([r.from, r.to]).toEqual([0, 0]);
      expect(r.exhaustive).toBe(false);
      expect(r.total).toBe(20);
      // The headline and data note still describe the search.
      expect(r.text).toMatch(/^\*\*20 contracting offices\*\*/);
      expect(r.text).toMatch(/\*\*About this data:\*\*/);
    });
  }
  it('the last real page is unchanged', () => {
    const r = renderBuyingOffices(buying(), { offset: 10 })!;
    expect(r.text).toMatch(/Showing 11–20 of the 20 offices/);
    expect(r.ids[0]).toBe('C0011');
    expect(r.ids).toHaveLength(10);
  });
  it('past the end of the retrieved offices when more rank below them: points to narrowing', () => {
    const r = renderBuyingOffices(buying({ totals: { obligated: 19_000_000, award_count: 40, office_count: 52 } }), { offset: 20 })!;
    expect(r.text).toMatch(/No more offices beyond #20\./);
    expect(r.text).toMatch(/32 more offices rank below the top 20 retrieved/);
    expect(r.ids).toEqual([]);
  });
});

describe('expiring contracts: a page past the end', () => {
  const rec = (i: number, desc = 'JANITORIAL SERVICES') => ({ contract_id: `K${i}`, piid: `W912QR24C${String(i).padStart(4, '0')}`, incumbent_name: 'ACME LLC', awarding_agency: 'Department of Defense', place_of_performance_city: 'SAVANNAH', place_of_performance_state: 'GA', period_of_performance_current_end: `2027-01-${String(i + 1).padStart(2, '0')}`, total_obligation: 1000 + i, description: desc });
  const records = Array.from({ length: 12 }, (_, i) => rec(i));
  // Record 1 names a place outside GA, so it is a CHECK record; a past-end page must not re-list it either.
  records[1] = rec(1, 'GUARD SERVICES IN THE PHOENIX AREA');
  const res = { contracts: records, _meta: { total: 12, result_state: 'results', applied_filters: { state: ['GA'] } } };
  for (const offset of [12, 20]) {
    it(`offset ${offset} shows no rows, repeats no CHECK record, offers no continuation and adds no ids`, () => {
      const r = renderExpiringRecords(res, { offset })!;
      expect(r.text).toMatch(/No more expiring records beyond #12\. All 12 were shown\./);
      expect(r.text).not.toMatch(/^\| \d+\. /m);
      expect(r.text).not.toMatch(/Also marked CHECK/);
      expect(r.text).not.toMatch(/show expiring records/);
      expect(r.text).not.toMatch(/Showing \d+–\d+/);
      expect(r.shown).toBe(0);
      expect(r.ids).toEqual([]);
      expect([r.from, r.to]).toEqual([0, 0]);
      expect(r.exhaustive).toBe(false);
      expect(r.total).toBe(12);
    });
  }
  it('the last real page is unchanged', () => {
    const r = renderExpiringRecords(res, { offset: 10 })!;
    expect([r.from, r.to, r.shown]).toEqual([11, 12, 2]);
    expect(r.text).toMatch(/Showing 11–12 of 12/);
  });
  it('past the retrieved records when more matched: says how to see the rest', () => {
    const r = renderExpiringRecords({ ...res, _meta: { ...res._meta, total: 340 } }, { offset: 12 })!;
    expect(r.text).toMatch(/No more expiring records beyond #12\./);
    expect(r.text).toMatch(/Mindy retrieved 12 of the 340 matching records/);
    expect(r.ids).toEqual([]);
  });
});

describe('past-award list and vehicle mix do not page', () => {
  it('render every record they receive (no offset, so nothing to clamp)', () => {
    expect(renderAwardList.length).toBe(1);
    expect(renderVehicleMix.length).toBe(1);
  });
});

import { sourceFromToolResult } from './context-sources';
describe('the source ledger for a page past the end', () => {
  const owner = { email: 'pro@example.com', scope: 'personal' };
  it('buying offices: no referenceable items, so "#20" cannot resolve to a repeated office', () => {
    const p = buying();
    const s = sourceFromToolResult({ tool: 'get_buying_offices', toolCallId: 'c9', status: 'success', content: JSON.stringify(p), rendered: renderBuyingOffices(p, { offset: 20 }), owner, retrievedAt: '2026-11-17T00:00:00Z' });
    expect(s.items).toEqual([]);
    expect(s.shown).toBe(0);
  });
  it('expiring contracts: no referenceable items', () => {
    const p = { contracts: [{ contract_id: 'K1', piid: 'W912QR24C0001', period_of_performance_current_end: '2027-01-01', total_obligation: 5 }], _meta: { total: 1, result_state: 'results' } };
    const s = sourceFromToolResult({ tool: 'get_expiring_contracts', toolCallId: 'c8', status: 'success', content: JSON.stringify(p), rendered: renderExpiringRecords(p, { offset: 1 }), owner, retrievedAt: '2026-11-17T00:00:00Z' });
    expect(s.items).toEqual([]);
  });
  it('control: a real page has its items', () => {
    const p = buying();
    const s = sourceFromToolResult({ tool: 'get_buying_offices', toolCallId: 'c7', status: 'success', content: JSON.stringify(p), rendered: renderBuyingOffices(p, { offset: 10 }), owner, retrievedAt: '2026-11-17T00:00:00Z' });
    expect(s.items?.[0]).toMatchObject({ n: 11, key: 'C0011' });
  });
});

describe('percent columns: one precision per column', () => {
  it('buying offices Share: 7.00% beside 6.36%, never 7% beside 6.36%', () => {
    const offs = [{ office_name: 'A', office_code: 'A1', obligated: 7_000_000, share_pct: 7, award_count: 3 }, { office_name: 'B', office_code: 'B1', obligated: 6_360_000, share_pct: 6.36, award_count: 2 }, { office_name: 'C', office_code: 'C1', obligated: 1_000_000, share_pct: 0.5, award_count: 1 }];
    const r = renderBuyingOffices({ scope: { naics: ['561720'] }, offices: offs, totals: { obligated: 100_000_000, award_count: 6, office_count: 3 }, notes: [], _meta: {} })!;
    const col = r.text.split('\n').filter((l) => /^\| \d+\. /.test(l)).map((l) => l.split(' | ')[2]);
    expect(col).toEqual(['7.00%', '6.36%', '0.50%']);
  });
  it('a whole-number column stays whole; a missing share is a dash, never 0%', () => {
    const offs = [{ office_name: 'A', office_code: 'A1', obligated: 5, share_pct: 60, award_count: 1 }, { office_name: 'B', office_code: 'B1', obligated: 4, share_pct: null, award_count: 1 }];
    const r = renderBuyingOffices({ scope: {}, offices: offs, totals: { obligated: 9, award_count: 2, office_count: 2 }, notes: [], _meta: {} })!;
    const col = r.text.split('\n').filter((l) => /^\| \d+\. /.test(l)).map((l) => l.split(' | ')[2]);
    expect(col).toEqual(['60%', '—']);
  });
  it('vehicle mix Share uses one precision', () => {
    const r = renderVehicleMix({ scope: { naics: ['561720'], window: 'FY2025' }, total_obligated: 100, total_award_count: 3, buckets: [{ label: 'GSA Schedule', obligated: 40, share_pct: 40, award_count: 1 }, { label: 'BPA', obligated: 60, share_pct: 59.75, award_count: 2 }], rollups: {}, classification: {}, _meta: {} })!;
    expect(r.text).toMatch(/^\| GSA Schedule \| \$40 \| 40\.00% \| 1 \|$/m);
    expect(r.text).toMatch(/^\| BPA \| \$60 \| 59\.75% \| 2 \|$/m);
  });
});
