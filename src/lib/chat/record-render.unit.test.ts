/**
 * PR E: verified record lists are rendered from tool data. Regression tests for missing records,
 * duplicates, ordering, truncation/continuation, capped retrieval, unsupported filters, and
 * summaries that contradict the verified counts.
 */
import { describe, it, expect } from 'vitest';
import { renderExpiringRecords, collectExpiringRecords, checkSummaryAgainstRecords, prepareChatToolArgs, CHAT_FETCH_LIMIT } from './record-render';

const rec = (piid: string, end: string, extra: Record<string, unknown> = {}) => ({
  contract_id: `CONT_${piid}`, piid, incumbent_name: 'ALLPRO STAFFNET LLC', awarding_agency: 'Department of Veterans Affairs',
  awarding_sub_agency: null, place_of_performance_city: 'MEMPHIS', place_of_performance_state: 'TN',
  period_of_performance_current_end: end, total_obligation: 123456.7, description: 'temporary laboratory staffing', ...extra,
});
const meta = (extra: Record<string, unknown> = {}) => ({
  grounded: true, degraded: false, result_state: 'results', ignored_args: [],
  applied_filters: { naics: ['561320', '561110'], state: ['TN', 'MS'], months_window: 18 },
  window: { after: '2026-11-14', through: '2028-05-14', as_of: '2026-11-14', months: 18 }, ...extra,
});

describe('every record, once, in order', () => {
  it('lists contracts, in-window orders and parentless orders together (nothing nested away)', () => {
    const r = renderExpiringRecords({
      contracts: [rec('S1', '2027-02-03')],
      expiring_orders_in_window: [rec('36C24927N0097', '2027-03-31', { parent_vehicle_piid: '36C24918D0001' })],
      unresolved_orders: [rec('U1', '2027-01-01')],
      vehicles: [{ orders: [{ contract_id: 'CONT_36C24927N0097' }] }],
      _meta: meta({ total: 3 }),
    })!;
    expect(r.ids).toEqual(['U1', 'S1', '36C24927N0097']); // soonest end first
    expect(r.text).toMatch(/36C24927N0097 · Allpro Staffnet LLC · Department of Veterans Affairs · Memphis, TN · ends 2027-03-31 · task\/delivery order under 36C24918D0001/);
    expect(r.text).toMatch(/Showing all 3/);
    expect(r.exhaustive).toBe(true);
  });
  it('de-duplicates a record that appears in two sections', () => {
    const dup = rec('D1', '2027-05-01');
    const r = renderExpiringRecords({ contracts: [dup], expiring_orders_in_window: [dup], _meta: meta({ total: 1 }) })!;
    expect(r.ids).toEqual(['D1']);
    expect(r.total).toBe(1);
  });
  it('ties on end date are ordered by number (stable, deterministic)', () => {
    const rows = collectExpiringRecords({ contracts: [rec('B2', '2027-01-01'), rec('A1', '2027-01-01')] });
    expect(rows.map((x) => x.piid)).toEqual(['A1', 'B2']);
  });
  it('a record with a missing field says so instead of dropping the record', () => {
    const r = renderExpiringRecords({ contracts: [rec('M1', '2027-01-01', { place_of_performance_state: null, incumbent_name: null })], _meta: meta({ total: 1 }) })!;
    expect(r.text).toMatch(/M1 · incumbent not recorded · .* · place of performance not reported/);
  });
});

describe('counts, pages and continuation', () => {
  const many = Array.from({ length: 26 }, (_, i) => rec(`P${String(i + 1).padStart(2, '0')}`, `2027-01-${String((i % 28) + 1).padStart(2, '0')}`));
  it('distinguishes the full count from the displayed range and gives an explicit continuation', () => {
    const r = renderExpiringRecords({ contracts: many, _meta: meta({ total: 26 }) })!;
    expect(r.shown).toBe(20);
    expect(r.text).toMatch(/^26 expiring records match/);
    expect(r.text).toMatch(/Showing 1–20 of 26/);
    expect(r.text).toMatch(/This is not the full list\. Ask "show expiring records 21 to 26" to continue\./);
    expect(r.exhaustive).toBe(false);
  });
  it('a continuation page shows the next records with the same total', () => {
    const r = renderExpiringRecords({ contracts: many, _meta: meta({ total: 26 }) }, { offset: 20 })!;
    expect([r.from, r.to, r.shown]).toEqual([21, 26, 6]);
    expect(r.text).toMatch(/Showing 21–26 of 26/);
    expect(r.exhaustive).toBe(false); // not every record is in THIS block
  });
  it('a capped retrieval (more matched than retrieved) is never presented as complete', () => {
    const r = renderExpiringRecords({ contracts: many.slice(0, 5), _meta: meta({ total: 340 }) })!;
    expect(r.text).toMatch(/340 expiring records match/);
    expect(r.text).toMatch(/Mindy retrieved 5 of the 340 matching records/);
    expect(r.text).not.toMatch(/Showing all/);
    expect(r.exhaustive).toBe(false);
  });
  it('never shows a total smaller than what was retrieved', () => {
    const r = renderExpiringRecords({ contracts: many.slice(0, 4), _meta: meta({ total: 2 }) })!;
    expect(r.total).toBe(4);
  });
});

describe('filters and states', () => {
  it('shows every applied filter and discloses unsupported ones', () => {
    const r = renderExpiringRecords({
      contracts: [rec('S1', '2027-02-03')],
      _meta: meta({ total: 1, ignored_args: [{ arg: 'city', value: 'Memphis', reason: 'unknown_argument', detail: 'not a parameter of this tool' }] }),
    })!;
    expect(r.text).toMatch(/NAICS 561320, 561110 · place of performance TN, MS · ending after 2026-11-14 through 2028-05-14/);
    expect(r.text).toMatch(/Not applied: city "Memphis" \(not a parameter of this tool\)\. Results do not reflect that filter\./);
  });
  it('an unavailable lookup is never rendered as zero', () => {
    const r = renderExpiringRecords({ contracts: [], _meta: meta({ grounded: false, degraded: true, result_state: 'unavailable', total: 0 }) })!;
    expect(r.text).toMatch(/lookup failed .* This is not a zero/);
  });
  it('a verified zero says no records match, with the filters', () => {
    const r = renderExpiringRecords({ contracts: [], _meta: meta({ grounded: false, total: 0, result_state: 'none_found' }) })!;
    expect(r.text).toMatch(/^No expiring contracts or task orders match \(NAICS/);
  });
  it('a filter that could not run is reported, not shown as a zero', () => {
    const r = renderExpiringRecords({ contracts: [], _meta: meta({ grounded: false, total: 0, result_state: 'filter_not_applied', applied_filters: {}, ignored_args: [{ arg: 'state', value: 'Narnia', reason: 'invalid_value' }] }) })!;
    expect(r.text).toMatch(/was not run as asked/);
    expect(r.text).toMatch(/Not applied: state "Narnia"/);
  });
});

describe('summaries that contradict the verified records', () => {
  const r = renderExpiringRecords({ contracts: Array.from({ length: 26 }, (_, i) => rec(`P${i}`, '2027-01-01')), _meta: meta({ total: 26 }) })!;
  it('flags a wrong total', () => {
    expect(checkSummaryAgainstRecords('I found 3 contracts expiring in Tennessee.', [r])).toHaveLength(1);
    expect(checkSummaryAgainstRecords('There are three records in the window.', [r])).toHaveLength(1);
    expect(checkSummaryAgainstRecords('A total of 12 orders expire soon.', [r])).toHaveLength(1);
  });
  it('flags a "none" claim when records exist', () => {
    expect(checkSummaryAgainstRecords('I found no contracts expiring in this window.', [r])).toEqual(['claimed there were none while verified records exist']);
  });
  it('accepts the verified total and the displayed range', () => {
    expect(checkSummaryAgainstRecords('There are 26 records; the first 20 are shown above.', [r])).toEqual([]);
  });
  it('does not flag subset analysis or qualified statements (a false correction is also a defect)', () => {
    expect(checkSummaryAgainstRecords('Five of the orders are with the VA, and 3 contracts are with DOE. There are no contracts in Arkansas in this list.', [r])).toEqual([]);
    expect(checkSummaryAgainstRecords('The soonest ends in 2027 and two incumbents hold most of the work.', [r])).toEqual([]);
  });
});

describe('chat argument preparation', () => {
  it('fetches the whole matched set and strips the chat-only display_offset', () => {
    const p = prepareChatToolArgs('get_expiring_contracts', JSON.stringify({ naics: '561320', state: 'TN', limit: 10, display_offset: 20 }));
    expect(JSON.parse(p.args)).toEqual({ naics: '561320', state: 'TN', limit: CHAT_FETCH_LIMIT });
    expect(p.displayOffset).toBe(20);
  });
  it('leaves other tools and unparseable arguments untouched', () => {
    expect(prepareChatToolArgs('search_contractors', '{"x":1}')).toEqual({ args: '{"x":1}', displayOffset: 0 });
    expect(prepareChatToolArgs('get_expiring_contracts', '{"naics":')).toEqual({ args: '{"naics":', displayOffset: 0 });
  });
});
