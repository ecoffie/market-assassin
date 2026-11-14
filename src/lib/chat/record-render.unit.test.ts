/**
 * PR E: verified record lists are rendered from tool data. Regression tests for missing records,
 * duplicates, ordering, truncation/continuation, capped retrieval, unsupported filters, and
 * summaries that contradict the verified counts.
 */
import { describe, it, expect } from 'vitest';
import { renderExpiringRecords, renderStatusChecks, renderBuyingOffices, renderPricing, renderKeywords, renderVehicleMix, describedStateConflict, describedPlaceConflict, describedOtherWork, crossCheckOffices, lintAnalysis, collectExpiringRecords, checkSummaryAgainstRecords, prepareChatToolArgs, CHAT_FETCH_LIMIT } from './record-render';

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
    expect(r.text).toMatch(/36C24927N0097 · Allpro Staffnet LLC · Department of Veterans Affairs · Memphis, TN · ends 2027-03-31 · order under 36C24918D0001/);
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
    expect(r.text).toMatch(/^3 awards match \(keyword "identification card" · agency Department of the Navy · state TN\)/); // fixture state carries no scope
    expect(r.text).toMatch(/N0018921F3006 · Magellan Federal · .* · EXPIRED: ended 2026-07-31 \(105 days ago\) · candidate successor \(unconfirmed; USASpending does not link follow-ons\): N0018926FD111 · Gemini Tech Services LLC/);
    expect(r.text).toMatch(/N0018925CZ092 · .* · ACTIVE: ends 2027-07-31 \(259 days left\)/);
    expect(r.text).toMatch(/1 more matching award was not status-checked; this is not the full list\./);
  });
  it('a failed successor check is not a none', () => {
    const r = renderStatusChecks({ ...result, status_checks: [{ award_id: 'X1', status: 'expired', days_until_end: -3, end_date: '2026-11-11', successor: { state: 'unavailable' } }], _meta: { total: 1 } })!;
    expect(r.text).toMatch(/successor check unavailable \(source error, not a none\)/);
  });
  it('returns null without status_checks or awards to show', () => {
    expect(renderStatusChecks({ _meta: {} })).toBeNull();
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
    expect(r.text).toMatch(/^10 contracting offices recorded award actions for this work \(NAICS 5613, 5611 · work performed in TN · Memphis metro \(cities within 30 miles, in TN only\) · FY2024-FY2026\), \$65,723,501 net obligated \(after deobligations\) across 74 awards/);
    expect(r.text).toMatch(/Showing the top 2 of 10 by net obligations: 2 with positive net obligations are listed below\./);
    expect(r.text).toMatch(/1\. NAVSUP FLT LOG CTR NORFOLK \(N00189\) · Department Of Defense \/ Department Of The Navy|1\. NAVSUP FLT LOG CTR NORFOLK \(N00189\) · Department of Defense \/ Department of the Navy/);
    expect(r.text).toMatch(/customers: Navy Personnel Command \$50,000,000 · work performed in Millington, TN/);
    expect(r.text).toMatch(/These are federal government contracting offices \(buyers\), not companies\./);
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
    expect(r.text).toMatch(/Left out on purpose \(company names and places are not search terms\): memphis, superb\./);
  });
});

describe('freshness: empty recent-window search', () => {
  it('states the lag note verbatim and says it is not a verified zero', () => {
    const r = renderStatusChecks({ awards: [], _meta: { result_state: 'partial', as_of: '2026-11-13', lag_note: 'Contract actions by this agency are published with a ~90-day delay, so the data is only reliably current through about 2026-08-15. Treat an empty or thin result as "not yet published", NOT as "no award was made".' } })!;
    expect(r.text).toMatch(/NOT a verified zero/);
    expect(r.text).toMatch(/reliably current through about 2026-08-15 only \(last loaded 2026-11-13\)/);
    expect(r.text).not.toMatch(/no award was made|Treat an empty/);
  });
  it('acc6 R5: an empty search with no lag note is rendered with its filters and never as proof of none', () => {
    const r = renderStatusChecks({ awards: [], _meta: { applied_filters: { agency: { name: 'Department of the Navy' }, keyword: { value: 'Navy ID card' }, state: { value: 'TN', scope: 'pop' } } } })!;
    expect(r.text).toMatch(/^No awards matched this search \(keyword "Navy ID card" · agency Department of the Navy · state TN \(place of performance\)\)\. This is NOT proof that no such contract exists/);
    expect(renderStatusChecks({ awards: [], _meta: { degraded: true } })).toBeNull();
  });
  it('acc6 R5: a keyword retry is disclosed in the filters', () => {
    const r = renderStatusChecks({ awards: [], _meta: { applied_filters: { keyword: { value: 'identification card' }, keyword_retry: { requested: 'Navy ID card', used: 'identification card' } } } })!;
    expect(r.text).toMatch(/keyword "identification card" \(your wording "Navy ID card" matched nothing/);
  });
});

describe('independent-review fixes', () => {
  it('flags a record whose description names another state; no false flag for West Virginia', () => {
    expect(describedStateConflict('PSO SERVICES THROUGHOUT THE STATE OF PENNSYLVANIA (PA)', 'TX')).toBe('Pennsylvania');
    expect(describedStateConflict('guard services in West Virginia', 'WV')).toBeNull();
    expect(describedStateConflict('guard services at Fort Hood', 'TX')).toBeNull();
  });
  it('does not label records by keyword guesswork (a court-security-officer order is not flagged as unrelated)', () => {
    const r = renderExpiringRecords({ contracts: [rec('C1', '2027-01-01', { description: 'CSO PROGRAM FUNDING' })], _meta: meta({ total: 1 }) }, { relevancePhrases: ['security guard'] })!;
    expect(r.text).not.toMatch(/matched by industry code only/);
  });
  it('flags a description naming a city outside the reported state via a place cue; unknown names are not flagged', () => {
    expect(describedPlaceConflict('AIRPORT SECURITY SCREENING SERVICES AT PORTSMOUTH INTERNATIONAL AIRPORT(PSM)', 'TX')).toBe('Portsmouth');
    expect(describedPlaceConflict('ENFORCEMENT AND REMOVAL OPERATIONS IN THE PHOENIX AREA', 'TX')).toBe('Phoenix');
    expect(describedPlaceConflict('GUARD SERVICES IN THE SAN ANTONIO AREA', 'TX')).toBeNull();
    expect(describedPlaceConflict('GUARD SERVICES AT ZZQX AIRPORT', 'TX')).toBeNull();
  });
  it('adds a deterministic by-agency breakdown and counts the CHECK records', () => {
    const r = renderExpiringRecords({
      contracts: [rec('A1', '2027-01-01'), rec('A2', '2027-01-02', { awarding_agency: 'Department of Justice', description: 'PSO SERVICES THROUGHOUT THE STATE OF PENNSYLVANIA (PA)' })],
      _meta: meta({ total: 2 }),
    })!;
    expect(r.text).toMatch(/By awarding agency: Department of Justice 1; Department of Veterans Affairs 1\./);
    expect(r.text).toMatch(/Mindy marked 1 record CHECK because the description names a place outside the reported state or describes different work\. This check only catches wording it recognizes/);
  });
  it('plain award search: every award with dates, the date-filter meaning, not-the-full-list and data status', () => {
    const r = renderStatusChecks({
      awards: [{ awardId: 'W912EQ17P0020', recipientName: 'GRAND SLAM', description: 'chefs', startDate: '2017-03-03', endDate: '2017-04-21', awardAmount: 1000, popState: 'TN' }],
      basis: { date_filter: 'date_from/date_to select awards by transaction activity; an award that started earlier can appear.' },
      _meta: { total: 14, result_state: 'partial', lag_note: 'data current through about 2026-08-15', applied_filters: { office: { code: 'W912EQ', name: 'W07V ENDIST MEMPHIS', requested: 'Memphis', candidates: ['W500TW W07V ENDIST MEMPHIS', 'W912EQ W07V ENDIST MEMPHIS'] }, naics: '561320', date_from: '2019-01-01' } },
    })!;
    expect(r.text).toMatch(/^14 awards match \(office W912EQ W07V ENDIST MEMPHIS · NAICS 561320 · activity 2019-01-01 to today\)/);
    expect(r.text).toMatch(/Showing 1 of 14 \(largest first\); this is not the full list\./);
    expect(r.text).toMatch(/Date filter: .*started earlier can appear/);
    expect(r.text).toMatch(/W912EQ17P0020 · Grand Slam · chefs · 2017-03-03 to 2017-04-21/);
    expect(r.text).toMatch(/Data status: may be incomplete\./);
    expect(r.text).toMatch(/1 of the awards shown started before 2019-01-01 \(W912EQ17P0020 started 2017-03-03\)/);
    expect(r.text).toMatch(/Other office codes matching "Memphis" were found but not searched: W500TW W07V ENDIST MEMPHIS\./);
  });
  it('vehicle mix: every bucket with dollars and share, plus rollups and classification quality', () => {
    const r = renderVehicleMix({
      scope: { naics: ['561320'], window: 'FY2024-FY2026' }, total_obligated: 2712483324.53, total_award_count: 12941,
      buckets: [{ label: 'Agency IDIQs', obligated: 965000000, share_pct: 35.6, award_count: 4000 }, { label: 'Standalone contracts', obligated: 503000000, share_pct: 18.6, award_count: 3000 }],
      rollups: { all_schedules: { obligated: 921000000, share_pct: 33.98 } },
      classification: { verified_share_of_parented_pct: 89.07, heuristic_share_of_total_pct: 3.83, unresolved_share_of_total_pct: 0.87 },
    })!;
    expect(r.text).toMatch(/\$2,712,483,325 obligated across 12941 awards\. Every bucket is listed/);
    expect(r.text).toMatch(/2\. Standalone contracts: \$503,000,000 \(18\.6%\)/);
    expect(r.text).toMatch(/Rollups: all schedules \$921,000,000 \(33\.98%\)/);
  });
});

describe('lintAnalysis', () => {
  it('keeps next-step guidance and drops sentences that state facts, numbers, superlatives or magnitudes', () => {
    const r = lintAnalysis('Review the CHECK lines before pursuing those records. The USACE Memphis District awarded 12 contracts since 2019. GT Services LLC appears frequently. The most recent award went to The J Group. Open each solicitation on SAM.gov to confirm the scope.');
    expect(r.text).toBe('Review the CHECK lines before pursuing those records. Open each solicitation on SAM.gov to confirm the scope.');
    expect(r.dropped).toHaveLength(3);
  });
  it('never returns empty text', () => {
    expect(lintAnalysis('Spending is substantial.').text).toBe('Review each record and its CHECK lines above before pursuing it.');
    expect(lintAnalysis('Spending is substantial.', 'Check SAM.gov award notices.').text).toBe('Check SAM.gov award notices.');
  });
});


describe('successor search limits are disclosed', () => {
  it('says when the successor probe hit its row limit', () => {
    const r = renderStatusChecks({
      awards: [{ awardId: 'N1', recipientName: 'X' }],
      status_checks: [{ award_id: 'N1', status: 'expired', days_until_end: -1, end_date: '2026-11-13', successor: { state: 'candidates', candidates: [{ awardId: 'N2', recipientName: 'Y' }], checked: { truncated: true } } }],
      _meta: { total: 1 },
    })!;
    expect(r.text).toMatch(/successor search hit its row limit; a smaller follow-on could be missed/);
  });
});

describe('run-E review: place conflicts from the record text', () => {
  it('flags scope words and a trailing out-of-state place; leaves in-state and unknown names alone', () => {
    expect(describedPlaceConflict('THIS TASK ORDER PROVIDES NATIONWIDE TRANSPORTATION OF UNACCOMPANIED MINORS', 'TX')).toMatch(/nationwide/);
    // acc4 R11: the southern border includes Texas, so a TX record is not a conflict; a TN one is.
    expect(describedPlaceConflict('PROTECTIVE SECURITY OFFICER (PSO) SERVICES THROUGHOUT THE SOUTHERN BORDER', 'TX')).toBeNull();
    expect(describedPlaceConflict('PROTECTIVE SECURITY OFFICER (PSO) SERVICES THROUGHOUT THE SOUTHERN BORDER', 'TN')).toMatch(/southern border/);
    // Names without a place cue are never guessed (Jacobs Creek Job Corps is in TN; a guess flagged it as out of state).
    expect(describedPlaceConflict('JOB CORPS PRIORITY 3 SUPPORT SERVICES NON-CLINICAL COLLBRAN', 'TX')).toBeNull();
    expect(describedPlaceConflict('JOB CORPS PRIORITY 3 SUPPORT SERVICES JACOBS CREEK', 'TN')).toBeNull();
    expect(describedPlaceConflict('GUARD SERVICES', 'TX')).toBeNull();
    expect(describedPlaceConflict('CIRCUIT 5 D79 - FY 2027 CSO PROGRAM FUNDING', 'TX')).toBeNull();
    expect(describedPlaceConflict('JOB CORPS PRIORITY 3 NON-CLINICAL SUPPORT SERVICES COLUMBIA BASIN', 'TX')).toBeNull();
  });
  it('expiring lists carry the industry-code caveat', () => {
    const r = renderExpiringRecords({ contracts: [rec('A1', '2027-01-01')], _meta: meta({ total: 1 }) })!;
    expect(r.text).toMatch(/Matched by industry \(NAICS\) code: .* check each description/);
  });
  it('an empty lagged search points to SAM.gov award notices', () => {
    const r = renderStatusChecks({ awards: [], _meta: { lag_note: 'published with a ~90-day delay, so the data is only reliably current through about 2026-08-15.' } })!;
    expect(r.text).toMatch(/check SAM\.gov award notices/);
  });
});

describe('different work: positive evidence only', () => {
  it('flags a description that names a different capability; never flags by missing keywords', () => {
    expect(describedOtherWork('THIS TASK ORDER PROVIDES FOR THE TRANSPORTATION OF ICE DETAINEES', ['security guards'])).toBe('transportation');
    expect(describedOtherWork('PROGRAM AND ADMINISTRATIVE SUPPORT SERVICES', ['security guards'])).toBe('clerical and administrative support');
    expect(describedOtherWork('CIRCUIT 5 D79 - FY 2027 CSO PROGRAM FUNDING', ['security guards'])).toBeNull();
    expect(describedOtherWork('FACT WITNESS CLERK', ['temporary staffing', 'clerical and administrative support'])).toBeNull();
    expect(describedOtherWork('ADMINISTRATIVE CLERK', ['clerical and administrative support'])).toBeNull();
  });
  it('an office resting on a CHECK record says so (no contradiction between halves of one answer)', () => {
    const exp = { flaggedIds: ['70T05026F5900N004'], ids: ['70T05026F5900N004'] } as never;
    const offices = { text: 'offices', ids: [], officeExamples: [{ office: 'MISSION ESSENTIALS (70T050)', ids: ['70T05026F5900N004'] }, { office: 'OTHER (X1)', ids: ['A1'] }] } as never;
    crossCheckOffices([exp, offices]);
    expect((offices as { text: string }).text).toMatch(/CHECK: MISSION ESSENTIALS \(70T050\): its award 70T05026F5900N004 is marked CHECK in the expiring list/);
    expect((offices as { text: string }).text).not.toMatch(/OTHER \(X1\)/);
  });
});

describe('run-G review: buying offices show the example awards they reference', () => {
  it('lists up to two example awards per office', () => {
    const r = renderBuyingOffices({ scope: { state: 'TN', naics: ['5613'] }, offices: [{ office_name: 'NCO 9', office_code: '36C249', obligated: 100, share_pct: 50, award_count: 2, example_awards: [{ piid: '36C24926N0041', obligated: 60 }, { piid: '36C24925P0001', obligated: 40 }, { piid: 'X3', obligated: 1 }] }], totals: { obligated: 200, award_count: 4, office_count: 2 }, notes: [], _meta: {} })!;
    expect(r.text).toMatch(/example awards \(obligations in this window\): 36C24926N0041 \$60; 36C24925P0001 \$40$/m);
  });
});

describe('Phase B: semantic relevance vs industry-code match', () => {
  it('tags each record by its basis and counts them in the header; never calls a code-only record suspect', () => {
    const r = renderExpiringRecords({
      contracts: [rec('S1', '2027-01-01', { description: 'TEMPORARY LABORATORY STAFFING' }), rec('S2', '2027-01-02', { description: 'FACT WITNESS CLERK' })],
      _meta: meta({ total: 2 }),
    }, { requestedLabels: ['temporary staffing', 'clerical and administrative support'] })!;
    expect(r.text).toMatch(/S1 · [^\n]*description confirms: temporary staffing/);
    // FACT WITNESS CLERK now confirms (clerk is clerical); nothing is labelled code-only or counted as unconfirmed.
    expect(r.text).toMatch(/S2 · [^\n]*description confirms: clerical and administrative support/);
    expect(r.text).not.toMatch(/industry-code match|of 2 retrieved records/);
    expect(r.text).toMatch(/Untagged records match by industry code/);
  });
  it('a zero or negative net office is flagged, not presented as a buyer', () => {
    const r = renderBuyingOffices({ scope: { naics: ['561612'] }, offices: [{ office_name: 'X', office_code: 'X1', obligated: -1200, share_pct: -1, award_count: 1 }], totals: { obligated: 100, award_count: 5, office_count: 3 }, notes: [], _meta: {} })!;
    expect(r.text).toMatch(/Also returned, with zero or negative net obligations in this window \(deobligations, so not evidence of buying\): X \(X1\) -\$1,200\./);
    expect(r.text).not.toMatch(/^1\. X/m);
  });
});

describe('run-1 acceptance fixes', () => {
  it('term match handles underscores and clerk/guard-service wording', () => {
    const r = renderExpiringRecords({ contracts: [rec('W91YTZ24P0018', '2027-01-01', { description: 'APPOINTMENT CLERKS_FORT CAMPBELL' }), rec('G1', '2027-01-02', { description: 'FY26 TIS GUARD SERVICE QTR1' })], _meta: meta({ total: 2 }) }, { requestedLabels: ['clerical and administrative support', 'security guards'] })!;
    expect(r.text).toMatch(/W91YTZ24P0018 · [^\n]*description confirms: clerical and administrative support/);
    expect(r.text).toMatch(/G1 · [^\n]*description confirms: security guards/);
  });
  it('no rendered text states a reporting-lag figure the tool did not provide', () => {
    const b = renderBuyingOffices({ scope: { naics: ['5613'] }, offices: [{ office_name: 'A', obligated: 10, share_pct: 100, award_count: 1 }], totals: { obligated: 10, award_count: 1, office_count: 1 }, notes: [], _meta: { as_of: '2026-09-30', lag_note: 'prime contracts only; ingested weekly' } })!;
    expect(b.text).toMatch(/Data freshness: latest action loaded 2026-09-30; prime contracts only; ingested weekly\./);
    expect(b.text).not.toMatch(/90 days/);
  });
});

describe('attempt-2 fixes', () => {
  // Option B (R11, flagged by every RC review): reversed. A shared prefix does not put a statewide record inside a metro office total.
  it('an office is NOT cautioned only because flagged orders share its code as the contract-number prefix', () => {
    const exp = { flaggedIds: ['70CDCR26FR0000079', '70CDCR26FR0000053'], ids: [] } as never;
    const offices = { text: 'offices', ids: [], officeExamples: [{ office: 'DETENTION COMPLIANCE AND REMOVALS (70CDCR)', ids: ['70CDCR25FR0000001'] }] } as never;
    crossCheckOffices([exp, offices]);
    expect((offices as { text: string }).text).not.toMatch(/DETENTION COMPLIANCE AND REMOVALS \(70CDCR\)[^\n]*marked CHECK/);
  });
  it('CHECK records outside the shown page are listed so every reference is visible', () => {
    const rows = Array.from({ length: 22 }, (_, i) => rec(`P${String(i).padStart(2, '0')}`, `2027-01-${String(i + 1).padStart(2, '0')}`));
    rows[21] = rec('PA1', '2027-02-01', { description: 'PSO SERVICES THROUGHOUT THE STATE OF PENNSYLVANIA (PA)' });
    const r = renderExpiringRecords({ contracts: rows, _meta: meta({ total: 22 }) })!;
    expect(r.text).toMatch(/Also marked CHECK \(outside the rows shown above\):\n22\. PA1 · /);
    expect(r.ids).toContain('PA1');
  });
  it('tool-internal notes are not shown; a defaulted window is stated in plain words', () => {
    const r = renderBuyingOffices({ scope: { naics: ['5613'], window: 'FY2024-FY2026' }, offices: [{ office_name: 'A', obligated: 5, share_pct: 100, award_count: 1 }], totals: { obligated: 5, award_count: 1, office_count: 1 }, notes: ['No window given: defaulted to FY2024-FY2026.', 'see top_places'], _meta: {} })!;
    expect(r.text).toMatch(/FY2024-FY2026 \(default window; none was given\)/);
    expect(r.text).not.toMatch(/top_places|No window given/);
  });
});

describe('truth gate: closing sentences must be next-step guidance', () => {
  it('drops declarative summaries that characterize the records; keeps imperative next steps', () => {
    const r = lintAnalysis('You have a solid list of agencies in the San Antonio area that purchase security guard services. Next, review the expiring contracts to identify potential opportunities.');
    expect(r.text).toBe('Next, review the expiring contracts to identify potential opportunities.');
    const r1 = lintAnalysis('You have several expiring contracts in Tennessee for warehouse work. Review each description to confirm the work aligns with your capabilities.');
    expect(r1.text).toBe('Review each description to confirm the work aligns with your capabilities.');
  });
  it('drops hedged suggestions that carry assumptions ("Consider", "If you are interested")', () => {
    expect(lintAnalysis('If you\'re interested in pursuing similar opportunities, consider reaching out to the listed contractors.', 'FALLBACK').text).toBe('FALLBACK');
  });
});

import { freshnessSentence as fs4, renderKeywords as rk4 } from './record-render';
describe('acceptance attempt 4 fixes', () => {
  it('names DoD in the delay sentence instead of "this agency"', () => {
    const t = fs4({ lag_note: 'contract actions by DoD (including Navy, Army, Air Force) are published with a ~90-day delay; data is current through about 2026-08-15.' });
    expect(t).toMatch(/^Defense \(DoD, including Navy, Army and Air Force\) contract actions reach USASpending/);
    expect(t).not.toMatch(/this agency/i);
  });
  it('labels word-matched labor categories as word matches, not titles for this work', () => {
    const r = rk4({ keyword_sources: [{ keyword: 'staffing', sources: [{ type: 'input_text' }] }], occupational_titles: [{ keyword: 'industrial engineer', sources: [{ type: 'gsa_calc' }] }] })!;
    expect(r.text).toMatch(/GSA CALC labor categories found by a word from your description/);
    expect(r.text).not.toMatch(/used for this work/);
  });
});

import { renderStatusChecks as rsc5, freshnessSentence as fs5 } from './record-render';
describe('acceptance attempt 5 fixes', () => {
  const meta = { total: 0, applied_filters: { agency: { type: 'awarding', tier: 'subtier', name: 'Department of the Navy' }, date_from: '2026-10-01', date_to: '2026-10-31', keyword: { value: 'business management support', applied: 'server_keyword' } }, lag_note: 'USASpending data was last loaded 2026-11-14, but contract actions by this agency are published with a ~90-day delay, so the data is only reliably current through about 2026-08-16.' };
  it('an empty award search states what it searched', () => {
    const r = rsc5({ awards: [], _meta: meta })!;
    expect(r.text).toMatch(/^No awards were found for this search \(keyword "business management support" · agency Department of the Navy · activity 2026-10-01 to 2026-10-31\), and that is NOT a verified zero/);
  });
  it('the delay sentence names the applied agency when the note says "this agency"', () => {
    expect(fs5(meta)).toMatch(/^Department of the Navy contract actions reach USASpending with about a 90-day delay/);
  });
});

import { renderSbloContact } from './record-render';
describe('acc6c review fixes', () => {
  const res = { contact: { company: 'CONCORD PROFESSIONAL SERVICES, INC.', sblo_name: null, uei: 'NZ7CS4E6R7K6', source: 'USASpending (BigQuery, live)' }, registered_points_of_contact: { label: 'registered SAM point of contact, not a designated small business liaison', as_of: '2026-08-15T17:41:45.047+00:00', contacts: [{ name: 'Geoff Haas', title: 'President', roles: ['government business POC'] }] }, _meta: { has_named_sblo: false } };
  it('R8: SAM contacts keep the source label that they are not a small business liaison', () => {
    const r = renderSbloContact(res)!;
    expect(r.text).toMatch(/^No designated small business liaison is on record for Concord Professional Services, INC\. \(UEI NZ7CS4E6R7K6\)\./);
    expect(r.text).toMatch(/labeled by the source as "registered SAM point of contact, not a designated small business liaison", as of 2026-08-15/);
    expect(r.text).toMatch(/1\. Geoff Haas, President · government business POC/);
    expect(r.text).toMatch(/withholds these contacts' email and phone/);
  });
  it('R6: the related-titles heading states each source honestly', () => {
    const r = rk4({ keyword_sources: [{ keyword: 'staffing', sources: [{ type: 'input_text' }] }], occupational_titles: [{ keyword: 'forklift operator', sources: [{ type: 'solicitation_text', n: 5 }] }] })!;
    expect(r.text).toMatch(/"solicitation text" titles appeared in SAM solicitations under the industry codes for this work/);
    expect(r.text).not.toMatch(/that share a word with your description/);
  });
});

describe('acc7b R10: no location sentence when no location was asked', () => {
  it('omits the widened-location sentence without a state filter', () => {
    const r = rsc5({ awards: [], _meta: { auto_widened: true, applied_filters: { keyword: { value: 'x' } } } })!;
    expect(r.text).not.toMatch(/widest location scope|company location/i);
  });
});

describe('release check: buying-office label follows rank_by', () => {
  const base = (rank_by: string, offices: Record<string, unknown>[]) => renderBuyingOffices({ offices, scope: { state: 'TN' }, totals: { obligated: 11226, award_count: 2, office_count: offices.length }, _meta: { office_count: offices.length, applied_filters: { rank_by } } })!.text;
  it('a funding ranking is labeled customer (funding) offices, never contracting offices, and names their contracting offices', () => {
    const t = base('funding', [
      { office_name: 'NAVY PERSONNEL COMMAND', agency: 'Department of Defense', obligated: 18120, share_pct: 100, award_count: 1, top_awarding_offices: [{ code: 'N00189', name: 'NAVSUP FLT LOG CTR NORFOLK', obligated: 18120 }] },
      { office_name: 'MRPBS MINNEAPOLIS MN', agency: 'Department of Agriculture', obligated: -6895.2, share_pct: -61, award_count: 1 },
    ]);
    expect(t).toMatch(/^2 customer \(funding\) offices have award actions recorded for this work/);
    expect(t).not.toMatch(/paid for|contracting offices? recorded award actions/);
    expect(t).toMatch(/contracting offices: NAVSUP FLT LOG CTR NORFOLK \(N00189\) \$18,120/);
  });
  it('an awarding ranking keeps the accepted wording exactly', () => {
    const t = base('awarding', [{ office_name: 'W07V ENDIST MEMPHIS', office_code: 'W912EQ', agency: 'Department of Defense', obligated: 5, share_pct: 100, award_count: 2 }]);
    expect(t).toMatch(/^1 contracting office recorded award actions for this work/);
    expect(t).toMatch(/These are federal government contracting offices \(buyers\), not companies\./);
  });
});
