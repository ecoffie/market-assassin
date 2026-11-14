/**
 * Option B (final release pass, 2026-11-14). rel2 R9: a model-written closing pointed to contracts the
 * answer did not show. rel1 R11: an office's only award, described as work throughout the southern
 * border, was presented as San Antonio work without qualification.
 */
import { describe, it, expect } from 'vitest';
import { deterministicNextSteps, describedRegionNote, describedPlaceConflict, crossCheckOffices, renderBuyingOffices, renderExpiringRecords, renderVehicleMix, renderStatusChecks, lintAnalysis, type RenderedRecords } from './record-render';

describe('R9: deterministic next steps reference only what is shown', () => {
  const mix = renderVehicleMix({ buckets: [{ label: 'GSA Schedules', obligated: 100, share_pct: 100, award_count: 3, top_parents: [{ parent_piid: '36F79722D0185', awarding_agency: 'Department of Veterans Affairs' }] }], scope: { naics: ['561320'], window: 'FY2024-FY2026' }, total_obligated: 100, total_award_count: 3, rollups: {}, classification: {}, _meta: {} })!;
  it('a vehicle-bucket answer gets a bucket next step, never "review the specific contracts"', () => {
    const t = deterministicNextSteps([mix]);
    expect(t).toBe('Compare the vehicle buckets above to decide which contract vehicles to pursue.');
    expect(t).not.toMatch(/contracts and agencies|specific contracts/i);
    expect(mix.text).not.toMatch(/36F79722D0185/); // the parent contracts are not shown, so no step may point to them
  });
  it('every step passes the truth gate unchanged (imperative, no numbers or magnitude words)', () => {
    const t = deterministicNextSteps([mix]);
    expect(lintAnalysis(t).text).toBe(t);
  });
  it('an empty award search points to newer sources, not to records', () => {
    const empty = renderStatusChecks({ awards: [], _meta: { applied_filters: { keyword: { value: 'x' } } } })!;
    expect(deterministicNextSteps([empty])).toBe('Check SAM.gov award notices or the agency\'s announcements for awards newer than this data.');
  });
  it('at most three steps, CHECK first when any record is marked', () => {
    const exp = { tool: 'get_expiring_contracts', text: 'x CHECK: y', total: 30, retrieved: 30, from: 1, to: 20, shown: 20, exhaustive: false, ids: [], allowedCounts: [], standalone: 0, orders: 0 } as RenderedRecords;
    const t = deterministicNextSteps([exp, mix]);
    expect(t.split(/(?<=\.)\s/).length).toBeLessThanOrEqual(3);
    expect(t.startsWith('Review the records marked CHECK above')).toBe(true);
  });
});

describe('R11: region-wide work is never presented as specific to the office\'s recorded place', () => {
  const desc = 'PROTECTIVE SECURITY OFFICER (PSO) SERVICES THROUGHOUT THE SOUTHERN BORDER';
  it('a border region that includes the reported state is a factual qualifier, not a CHECK', () => {
    expect(describedPlaceConflict(desc, 'TX')).toBeNull();
    expect(describedRegionNote(desc, 'TX')).toBe('the description says the work is throughout the southern border (a region spanning CA, AZ, NM, TX), so it is not specific to one city or to TX alone');
    expect(describedRegionNote(desc, 'TN')).toBeNull();
    expect(describedRegionNote('GUARD SERVICES AT FORT SAM HOUSTON', 'TX')).toBeNull();
  });
  it('the office whose own award is that record carries a place qualifier, even when the record is not on the shown page', () => {
    const offices = renderBuyingOffices({ offices: [{ office_name: 'FPS EAST CCG DIV 4 ACQ DIV', office_code: '70RFP4', agency: 'Department of Homeland Security', obligated: 22605469, share_pct: 100, award_count: 1, top_places: [{ city: 'SAN ANTONIO', state: 'TX', obligated: 22605469 }], example_awards: [{ piid: '70RFP426FRE700022', obligated: 22605469 }] }], scope: { state: 'TX' }, totals: { obligated: 22605469, award_count: 1, office_count: 1 }, _meta: { office_count: 1, applied_filters: { rank_by: 'awarding' } } })!;
    const recs = Array.from({ length: 25 }, (_, i) => ({ piid: `P${i}`, description: 'GUARD SERVICES', place_of_performance_state: 'TX', period_of_performance_current_end: '2027-01-01', total_obligation: 1 }));
    recs.push({ piid: '70RFP426FRE700022', description: desc, place_of_performance_state: 'TX', period_of_performance_current_end: '2027-12-31', total_obligation: 1 });
    const expiring = renderExpiringRecords({ contracts: recs, expiring_orders_in_window: [], _meta: { total: recs.length } }, { requestedLabels: ['security guards'] })!;
    expect(expiring.ids).not.toContain('70RFP426FRE700022'); // not on the shown page
    crossCheckOffices([offices, expiring]);
    expect(offices.text).toMatch(/PLACE NOTE: FPS EAST CCG DIV 4 ACQ DIV \(70RFP4\): for its award 70RFP426FRE700022 \(listed above for this office\), the description says the work is throughout the southern border/);
    expect(offices.text).toMatch(/not a limit on where this work happens/);
    expect(offices.text).not.toMatch(/San-Antonio-specific/);
  });
  it('a shown row carries the qualifier inline', () => {
    const r = renderExpiringRecords({ contracts: [{ piid: 'A1', description: desc, place_of_performance_state: 'TX', period_of_performance_current_end: '2027-01-01', total_obligation: 5 }], expiring_orders_in_window: [], _meta: { total: 1 } })!;
    expect(r.text).toMatch(/A1 · .* · note: the description says the work is throughout the southern border/);
    expect(r.text).not.toMatch(/A1 · [^\n]*CHECK/);
  });
  it('no office qualifier without evidence (award not in any list)', () => {
    const offices = { tool: 'get_buying_offices', text: 'offices', total: 1, retrieved: 1, from: 1, to: 1, shown: 1, exhaustive: true, ids: [], allowedCounts: [], standalone: 0, orders: 0, officeExamples: [{ office: 'X (X1)', ids: ['Z9'] }] } as RenderedRecords;
    crossCheckOffices([offices]);
    expect(offices.text).toBe('offices');
  });
});
