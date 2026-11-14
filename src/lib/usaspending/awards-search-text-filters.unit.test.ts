/**
 * R10 / R3 (Ask Mindy Phase 1): keyword + piid_prefix on spending_by_award, and the sub-tier
 * agency helper on every awards caller. HTTP is mocked.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { searchAwardsByLocation, normalizePiidPrefix, rowMatchesKeyword, PREFIX_SCAN_MAX_PAGES } from './awards-search';
import { searchIDVContracts } from '@/lib/idv-search';

type Row = Record<string, unknown>;
const row = (id: string, desc: string, amount = 1000): Row => ({ 'Award ID': id, 'Recipient Name': 'R', 'Award Amount': amount, Description: desc, generated_internal_id: `CONT_AWD_${id}` });

function mockFetch(pages: (body: Record<string, any>) => { results: Row[]; hasNext?: boolean }) {
  const f = vi.fn(async (_u: unknown, init?: { body?: string }) => {
    const body = JSON.parse(String(init?.body));
    const p = pages(body);
    return { ok: true, status: 200, json: async () => ({ results: p.results, page_metadata: { hasNext: !!p.hasNext } }) };
  });
  vi.stubGlobal('fetch', f);
  return f;
}
const bodies = (f: ReturnType<typeof vi.fn>) => f.mock.calls.map((c) => JSON.parse(String((c[1] as { body: string }).body)));

afterEach(() => vi.unstubAllGlobals());

describe('keyword / piid_prefix', () => {
  it('keyword alone is sent as one USASpending keyword phrase', async () => {
    const f = mockFetch(() => ({ results: [row('N0018921F3006', 'IDENTIFICATION CARD ADMINISTRATION')] }));
    const r = await searchAwardsByLocation({ keyword: 'identification card' });
    expect(bodies(f)[0].filters.keywords).toEqual(['identification card']);
    expect(r.awards).toHaveLength(1);
    expect(r.textFilters?.keyword).toEqual({ value: 'identification card', applied: 'server_keyword' });
  });

  it('piid_prefix alone: sent as keyword, and non-prefix rows (description mentions) are dropped', async () => {
    const f = mockFetch(() => ({ results: [row('W912EQ26CA009', 'TEMP PILOTS'), row('W9127S26C0001', 'SEE W912EQ ORDER')] }));
    const r = await searchAwardsByLocation({ piidPrefix: 'w912eq' });
    expect(bodies(f)[0].filters.keywords).toEqual(['W912EQ']);
    expect(r.awards.map((a) => a.awardId)).toEqual(['W912EQ26CA009']);
    expect(r.textFilters?.piid_prefix?.value).toBe('W912EQ');
  });

  it('prefix + keyword: server query is the prefix (USASpending ORs keywords); keyword matched client-side across pages', async () => {
    const f = mockFetch((b) => {
      if (b.page === 1) return { results: [row('W912EQ23P0063', 'MRC TEMPORARY HELP SERVICES', 900), row('W912EQ26FA017', 'CRANE BARGE OIL', 800)], hasNext: true };
      if (b.page === 2) return { results: [row('W912EQ21P0048', 'FURNISH TEMPORARY SUPPORT PERSONNEL', 300)], hasNext: false };
      return { results: [] };
    });
    const r = await searchAwardsByLocation({ piidPrefix: 'W912EQ', keyword: 'temporary', dateFrom: '2019-01-01' });
    const sent = bodies(f);
    expect(sent.every((b) => JSON.stringify(b.filters.keywords) === '["W912EQ"]')).toBe(true);
    expect(sent.every((b) => b.limit === 100)).toBe(true);
    expect(r.awards.map((a) => a.awardId)).toEqual(['W912EQ23P0063', 'W912EQ21P0048']);
    expect(r.textFilters?.keyword?.applied).toBe('client_side_description_recipient');
    expect(r.textFilters?.scanned_rows).toBe(3);
    expect(r.textFilters?.scan_truncated).toBe(false);
  });

  it('prefix + keyword: reports truncation when the page cap is hit with more rows remaining', async () => {
    mockFetch(() => ({ results: [row('W912EQ1', 'TEMPORARY')], hasNext: true }));
    const r = await searchAwardsByLocation({ piidPrefix: 'W912EQ', keyword: 'temporary' });
    expect(r.textFilters?.scan_truncated).toBe(true);
    expect(r.textFilters?.scanned_rows).toBe(PREFIX_SCAN_MAX_PAGES);
  });

  it('normalizePiidPrefix / rowMatchesKeyword', () => {
    expect(normalizePiidPrefix(' w912-eq ')).toBe('W912EQ');
    expect(normalizePiidPrefix('x')).toBeNull();
    expect(normalizePiidPrefix('W912EQ; DROP')).toBeNull();
    expect(rowMatchesKeyword({ description: 'TEMPORARY HELP SERVICES', recipientName: '' }, 'temporary help')).toBe(true);
    expect(rowMatchesKeyword({ description: 'FURNISH TEMPORARY SUPPORT PERSONNEL', recipientName: '' }, 'temporary personnel')).toBe(true);
    expect(rowMatchesKeyword({ description: 'CONTEMPORARY ART', recipientName: '' }, 'temporary')).toBe(true); // phrase substring, as USASpending would
    expect(rowMatchesKeyword({ description: 'CRANE BARGE OIL', recipientName: '' }, 'temporary')).toBe(false);
  });
});

describe('military departments go to USASpending as SUB-tier agencies', () => {
  it('search_past_contracts (awards-search) — Navy → subtier Department of the Navy', async () => {
    const f = mockFetch(() => ({ results: [] }));
    await searchAwardsByLocation({ agency: 'Navy' });
    expect(bodies(f)[0].filters.agencies).toEqual([{ type: 'awarding', tier: 'subtier', name: 'Department of the Navy' }]);
  });

  it('IDV search — Navy → subtier (was toptier-only, which returns empty for military departments)', async () => {
    const f = mockFetch(() => ({ results: [] }));
    await searchIDVContracts({ agency: 'Department of the Navy' });
    expect(bodies(f)[0].filters.agencies).toEqual([{ type: 'awarding', tier: 'subtier', name: 'Department of the Navy' }]);
  });

  it('IDV search — a civilian toptier stays toptier', async () => {
    const f = mockFetch(() => ({ results: [] }));
    await searchIDVContracts({ agency: 'Department of Veterans Affairs' });
    expect(bodies(f)[0].filters.agencies).toEqual([{ type: 'awarding', tier: 'toptier', name: 'Department of Veterans Affairs' }]);
  });
});
