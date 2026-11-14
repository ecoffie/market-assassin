/**
 * PR E: verified record lists are rendered from tool data. Regression tests for missing records,
 * duplicates, ordering, truncation/continuation, capped retrieval, unsupported filters, and
 * summaries that contradict the verified counts.
 */
import { describe, it, expect } from 'vitest';
import { renderExpiringRecords, renderStatusChecks, renderBuyingOffices, renderPricing, renderKeywords, collectExpiringRecords, checkSummaryAgainstRecords, prepareChatToolArgs, CHAT_FETCH_LIMIT } from './record-render';

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

describe('status checks (search_past_contracts include_status)', () => {
  const result = {
    awards: [
      { awardId: 'N0018921F3006', recipientName: 'MAGELLAN FEDERAL', description: 'ID card administration Millington' },
      { awardId: 'N0018925CZ092', recipientName: 'CHENEGA ANALYTIC BUSINESS SOLUTIONS', description: 'identification card services' },
      { awardId: 'N0018920CZ037', recipientName: 'CHENEGA', description: 'id card' },
    ],
    status_checks: [
      { award_id: 'N0018921F3006', status: 'expired', days_until_end: -105, end_date: '2026-07-31', successor: { state: 'candidates', candidates: [{ awardId: 'N0018926FD111', recipientName: 'GEMINI TECH SERVICES LLC', description: 'MNCC ICA CONUS ID SERVICES', startDate: '2026-07-16', evidence: { same_piid_office_prefix: 'N00189' } }] } },
      { award_id: 'N0018925CZ092', status: 'active', days_until_end: 259, end_date: '2027-07-31', successor: { state: 'not_checked' } },
    ],
    _meta: { total: 3, applied_filters: { keyword: { value: 'identification card' }, agency: { name: 'Department of the Navy' }, state: { value: 'TN' } } },
  };
  it('renders every checked award with status, end date and successor; never picks one', () => {
    const r = renderStatusChecks(result)!;
    expect(r.text).toMatch(/^3 awards match \(keyword "identification card" · agency Department of the Navy · place of performance TN\)/);
    expect(r.text).toMatch(/N0018921F3006 · Magellan Federal · .* · EXPIRED: ended 2026-07-31 \(105 days ago\) · possible successor found: N0018926FD111 · Gemini Tech Services LLC/);
    expect(r.text).toMatch(/N0018925CZ092 · .* · ACTIVE: ends 2027-07-31 \(259 days left\)/);
    expect(r.text).toMatch(/1 more matching award was not status-checked; this is not the full list\./);
  });
  it('a failed successor check is not a none', () => {
    const r = renderStatusChecks({ ...result, status_checks: [{ award_id: 'X1', status: 'expired', days_until_end: -3, end_date: '2026-11-11', successor: { state: 'unavailable' } }], _meta: { total: 1 } })!;
    expect(r.text).toMatch(/successor check unavailable \(source error, not a none\)/);
  });
  it('returns null without status_checks', () => {
    expect(renderStatusChecks({ awards: [], _meta: {} })).toBeNull();
  });
});

describe('buying offices', () => {
  const res = {
    scope: { state: 'TN', naics: ['5613', '5611'], cities: ['MEMPHIS', 'MILLINGTON'], window: 'FY2024-FY2026' },
    offices: [
      { office_name: 'NAVSUP FLT LOG CTR NORFOLK', office_code: 'N00189', agency: 'Department of Defense', sub_agency: 'Department of the Navy', obligated: 58880000.12, share_pct: 89.6, award_count: 12, top_funding_offices: [{ name: 'NAVY PERSONNEL COMMAND', obligated: 50000000 }], top_places: [{ city: 'MILLINGTON', state: 'TN', obligated: 58880000 }] },
      { office_name: 'W07V ENDIST MEMPHIS', office_code: 'W912EQ', agency: 'Department of Defense', sub_agency: 'Department of the Army', obligated: 1093000, share_pct: 1.7, award_count: 4, top_places: [{ city: 'MEMPHIS', state: 'TN', obligated: 1093000 }] },
    ],
    totals: { obligated: 65723500.81, award_count: 74, office_count: 10 },
    notes: [],
    _meta: { applied_filters: { metro: { core_city: 'MEMPHIS', radius_miles: 30 } } },
  };
  it('renders offices with codes, exact dollars, customers and place of performance, and says it is the top N of M', () => {
    const r = renderBuyingOffices(res)!;
    expect(r.text).toMatch(/^10 buying offices bought this work \(NAICS 5613, 5611 · work performed in TN · Memphis metro \(cities within 30 miles\) · FY2024-FY2026\), \$65,723,501 obligated across 74 awards/);
    expect(r.text).toMatch(/Showing the top 2 of 10 by obligated dollars\./);
    expect(r.text).toMatch(/1\. NAVSUP FLT LOG CTR NORFOLK \(N00189\) · Department Of Defense \/ Department Of The Navy|1\. NAVSUP FLT LOG CTR NORFOLK \(N00189\) · Department of Defense \/ Department of the Navy/);
    expect(r.text).toMatch(/customers: Navy Personnel Command \$50,000,000 · work performed in Millington, TN/);
  });
  it('no offices is stated with its filters', () => {
    expect(renderBuyingOffices({ ...res, offices: [], totals: null })!.text).toMatch(/^No buying offices found \(NAICS 5613, 5611/);
  });
});

describe('pricing and keywords', () => {
  it('pricing: every rate on its own line with percentile and n; the median is identified as the competitive figure', () => {
    const r = renderPricing({ rate_summary: {
      unit: 'USD per hour, GSA Schedule ceiling rate', ordering: 'aggressive <= competitive (market median) <= premium', ordering_holds: true,
      population: { description: 'All GSA CALC+ records matching "Material Handler"', n: 50 },
      rates: [
        { label: 'aggressive', percentile: 25, hourly: 35.34, n: 50 },
        { label: 'competitive', also_called: 'market median', percentile: 50, hourly: 44.08, n: 50 },
        { label: 'premium', percentile: 75, hourly: 52.53, n: 50 },
      ] } })!;
    expect(r.text).toMatch(/Aggressive: \$35\.34\/hr · 25th percentile · n=50/);
    expect(r.text).toMatch(/Competitive: \$44\.08\/hr \(market median\)/);
    expect(r.text).toMatch(/Median: \$44\.08\/hr \(same figure as the competitive rate/);
    expect(r.text).toMatch(/Premium: \$52\.53\/hr/);
  });
  it('keywords: every keyword and the extra job titles, each with its source; exclusions stated', () => {
    const r = renderKeywords({
      keywords: ['warehouse worker', 'light industrial'],
      keyword_sources: [
        { keyword: 'warehouse worker', sources: [{ type: 'calc_labor_category', n: 12 }] },
        { keyword: 'light industrial', sources: [{ type: 'input_text' }] },
      ],
      occupational_titles: [
        { keyword: 'warehouse worker', sources: [{ type: 'calc_labor_category', n: 12 }] },
        { keyword: 'forklift operator', sources: [{ type: 'solicitation_text', n: 5 }] },
      ],
      excluded_terms: { locations: ['memphis'], brand: ['superb'] },
    })!;
    expect(r.text).toMatch(/1\. warehouse worker · calc labor category n=12/);
    expect(r.text).toMatch(/3\. forklift operator · solicitation text n=5/);
    expect(r.text.match(/warehouse worker/g)).toHaveLength(1); // not duplicated
    expect(r.text).toMatch(/Left out on purpose \(not search terms\): locations: memphis; brand: superb\./);
  });
});
