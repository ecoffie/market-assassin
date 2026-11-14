/**
 * Release hardening after 11/11 acceptance (2026-11-14). One test per issue the independent reviewers
 * marked as a near-miss: office attribution, Defense freshness on warehouse totals, inferred industry
 * codes, region-aware geography, cosmetic duplicates.
 */
import { describe, it, expect } from 'vitest';
import { crossCheckOffices, describedRegionNote, describedPlaceConflict, defenseLagSentence, renderBuyingOffices, renderVehicleMix, type RenderedRecords } from './record-render';
import { compileIntent, inferredCodeDisclosure } from './intent-compiler';

const NOW = new Date('2026-11-14T15:00:00Z');
const base = (p: Partial<RenderedRecords>): RenderedRecords => ({ tool: 't', text: '', total: 0, retrieved: 0, from: 0, to: 0, shown: 0, exhaustive: true, ids: [], allowedCounts: [], standalone: 0, orders: 0, ...p });

describe('1. office attribution uses evidence, not a contract-number prefix', () => {
  it('does not tie statewide CHECK records to a metro office by prefix alone', () => {
    const offices = base({ text: 'offices', officeExamples: [{ office: 'SAN ANTONIO OFFICE (70CDCR)', ids: ['70CDCR26FR0000054'] }] });
    const expiring = base({ text: 'expiring', flaggedIds: ['70CDCR26FR0000053', '70CDCR26FR0000079'] });
    crossCheckOffices([offices, expiring]);
    expect(offices.text).toBe('offices');
  });
  it('links an award the office itself lists as an in-window example', () => {
    const offices = base({ text: 'offices', officeExamples: [{ office: 'MISSION ESSENTIALS (70T050)', ids: ['70T05026F5900N004'] }] });
    crossCheckOffices([offices, base({ flaggedIds: ['70T05026F5900N004'] })]);
    expect(offices.text).toMatch(/its in-window award 70T05026F5900N004 \(listed above for this office\) is marked CHECK/);
  });
});

describe('2. Defense freshness on warehouse-backed totals (same rule as search_past_contracts)', () => {
  const meta = { as_of: '2026-09-30', applied_filters: { fiscal_year_from: 2024, fiscal_year_to: 2026 } };
  it('applies when the window ends after the DoD cutoff and Defense dollars can be in the totals', () => {
    expect(defenseLagSentence(meta, true, NOW)).toMatch(/^Defense \(DoD, including Navy, Army and Air Force\) contract actions reach USASpending with about a 90-day delay, so Defense dollars after about 2026-08-1\d may not be in these totals yet; the window runs through 2026-09-30\.$/);
  });
  it('does not apply to an old window or when no Defense dollars can be included', () => {
    expect(defenseLagSentence({ applied_filters: { fiscal_year_from: 2022, fiscal_year_to: 2024 } }, true, NOW)).toBeNull();
    expect(defenseLagSentence(meta, false, NOW)).toBeNull();
  });
  it('buying offices: shown when a Defense office is listed, not for civilian-only lists', () => {
    const res = (agency: string) => ({ offices: [{ office_name: 'X OFFICE', office_code: 'N00189', agency, obligated: 100, share_pct: 100, award_count: 1 }], scope: { naics: ['561320'], state: 'TN' }, totals: { total_obligated: 100, total_awards: 1, office_count: 1 }, _meta: { ...meta, office_count: 1 } });
    expect(renderBuyingOffices(res('Department of Defense'))!.text).toMatch(/Defense \(DoD/);
    expect(renderBuyingOffices(res('Department of Veterans Affairs'))!.text).not.toMatch(/Defense \(DoD/);
  });
  it('vehicle mix: shown unless a non-Defense agency was filtered', () => {
    const res = (agency: string | null) => ({ buckets: [{ label: 'GSA Schedules', obligated: 100, share_pct: 100, award_count: 1 }], scope: { naics: ['561320'], agency, window: 'FY2024-FY2026' }, total_obligated: 100, total_award_count: 1, rollups: {}, classification: {}, _meta: meta });
    expect(renderVehicleMix(res(null))!.text).toMatch(/Defense \(DoD/);
    expect(renderVehicleMix(res('Department of Veterans Affairs'))!.text).not.toMatch(/Defense \(DoD/);
    expect(renderVehicleMix(res(null))!.text).toMatch(/· 1 award$/m);
  });
});

describe('3. industry codes Mindy chose are disclosed', () => {
  const title = (c: string) => ({ '541611': 'Administrative Management and General Management Consulting Services', '561320': 'Temporary Help Services' } as Record<string, string>)[c] ?? null;
  it('R10: a code the planner picked for words is disclosed with its title', () => {
    const intent = compileIntent('Who won the Navy business management support services contract in October 2026?', NOW);
    expect(inferredCodeDisclosure([JSON.stringify({ naics: '541611', agency: 'Navy' })], intent, title))
      .toBe('Industry codes chosen by Mindy for the work you described (you did not give any): 541611 Administrative Management and General Management Consulting Services. Results are limited to these codes, so work filed under other codes is not included');
  });
  it('codes the customer typed are not presented as chosen by Mindy', () => {
    const intent = compileIntent('staffing under 561320 in TN', NOW);
    expect(inferredCodeDisclosure([JSON.stringify({ naics: '561320' })], intent, title)).toBeNull();
  });
  it('a prefix code is described as a code family, never given an invented title', () => {
    const intent = compileIntent('temp staffing in Memphis', NOW);
    expect(inferredCodeDisclosure([JSON.stringify({ naics: '5613' })], intent, () => null)).toMatch(/5613 \(all codes starting 5613\)/);
  });
});

describe('4. geography from evidence', () => {
  it('a named border region that includes the reported state is a factual note, not a CHECK', () => {
    const d = 'PROTECTIVE SECURITY OFFICER (PSO) SERVICES THROUGHOUT THE SOUTHERN BORDER';
    expect(describedPlaceConflict(d, 'TX')).toBeNull();
    expect(describedRegionNote(d, 'TX')).toMatch(/southern border, a region spanning CA, AZ, NM, TX; it includes the reported state TX/);
    expect(describedRegionNote(d, 'TN')).toBeNull();
    expect(describedPlaceConflict(d, 'TN')).toMatch(/southern border/);
  });
  it('a site name with no state in the record is never guessed into a conflict', () => {
    expect(describedPlaceConflict('JOB CORPS PRIORITY 3 SUPPORT SERVICES CURLEW', 'TX')).toBeNull();
    expect(describedPlaceConflict('GUARD SERVICES JACOBS CREEK', 'TN')).toBeNull();
  });
});

describe('5. cosmetic', () => {
  it('does not repeat an office code already in the name, or a repeated agency; singular award', () => {
    const t = renderBuyingOffices({ offices: [{ office_name: '249-NETWORK CONTRACT OFFICE 9 (36C249)', office_code: '36C249', agency: 'Department of Veterans Affairs', sub_agency: 'Department of Veterans Affairs', obligated: 5, share_pct: 100, award_count: 1 }], scope: {}, totals: { total_obligated: 5, total_awards: 1, office_count: 1 }, _meta: { office_count: 1 } })!.text;
    expect(t).toMatch(/1\. 249-NETWORK CONTRACT OFFICE 9 \(36C249\) · Department Of Veterans Affairs · \$5 \(100%\) · 1 award\b/i);
  });
});
