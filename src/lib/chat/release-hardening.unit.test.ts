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

describe('2. Defense freshness comes from the tool evidence, never computed in the renderer', () => {
  const note = 'Defense (DoD, including Navy, Army and Air Force) contract actions are published with a ~90-day delay, so Defense dollars after about 2026-08-16 may not be in these totals yet; the window runs through 2026-09-30.';
  it('shows the tool\'s defense_lag note verbatim', () => {
    expect(defenseLagSentence({ defense_lag: { applies: true, note } })).toBe(note);
  });
  it('shows nothing when the tool returned no defense_lag (no date the evidence lacks)', () => {
    expect(defenseLagSentence({ as_of: '2026-09-30', applied_filters: { fiscal_year_to: 2026 } })).toBeNull();
    const res = (meta: Record<string, unknown>) => ({ buckets: [{ label: 'GSA Schedules', obligated: 100, share_pct: 100, award_count: 1 }], scope: { naics: ['561320'], window: 'FY2024-FY2026' }, total_obligated: 100, total_award_count: 1, rollups: {}, classification: {}, _meta: meta });
    expect(renderVehicleMix(res({}))!.text).not.toMatch(/Defense \(DoD/);
    expect(renderVehicleMix(res({ defense_lag: { applies: true, note } }))!.text).toContain(note);
    expect(renderVehicleMix(res({}))!.text).toMatch(/· 1 award$/m);
  });
});

describe('2b. funding-ranked offices are labeled as customers, with their contracting offices', () => {
  it('R4 final: rank_by funding is never called "contracting offices"', () => {
    const t = renderBuyingOffices({ offices: [{ office_name: 'NAVY PERSONNEL COMMAND', agency: 'Department of Defense', obligated: 18120, share_pct: 100, award_count: 1, top_awarding_offices: [{ code: 'N00189', name: 'NAVSUP FLT LOG CTR NORFOLK', obligated: 18120 }] }], scope: { state: 'TN' }, totals: { obligated: 18120, award_count: 1, office_count: 1 }, _meta: { office_count: 1, applied_filters: { rank_by: 'funding' } } })!.text;
    expect(t).toMatch(/^1 customer \(funding\) office paid for this work/);
    expect(t).not.toMatch(/contracting offices? recorded award actions/);
    expect(t).toMatch(/contracting offices: NAVSUP FLT LOG CTR NORFOLK \(N00189\) \$18,120/);
  });
  it('rank_by awarding keeps the contracting-office wording', () => {
    const t = renderBuyingOffices({ offices: [{ office_name: 'W07V ENDIST MEMPHIS', office_code: 'W912EQ', agency: 'Department of Defense', obligated: 5, share_pct: 100, award_count: 2 }], scope: {}, totals: { obligated: 5, award_count: 2, office_count: 1 }, _meta: { office_count: 1, applied_filters: { rank_by: 'awarding' } } })!.text;
    expect(t).toMatch(/^1 contracting office recorded award actions for this work/);
  });
});

describe('3. industry codes Mindy chose are disclosed', () => {
  const title = (c: string) => ({ '541611': 'Administrative Management and General Management Consulting Services', '561320': 'Temporary Help Services' } as Record<string, string>)[c] ?? null;
  it('R10: a code the planner picked for words is disclosed with its title', () => {
    const intent = compileIntent('Who won the Navy business management support services contract in October 2026?', NOW);
    expect(inferredCodeDisclosure([{ name: 'search_past_contracts', args: JSON.stringify({ naics: '541611', agency: 'Navy' }) }], intent, title))
      .toBe('Industry codes chosen by Mindy for the work you described (you did not give any): 541611 Administrative Management and General Management Consulting Services. Results are limited to these codes, so work filed under other codes is not included');
  });
  it('final R6: a keyword tool is not described as limited to codes', () => {
    const intent = compileIntent('Keywords for a light industrial, clerical and warehouse staffing firm in Memphis', NOW);
    expect(inferredCodeDisclosure([{ name: 'derive_company_keywords', args: JSON.stringify({ naics: '561320,493110' }) }], intent, title)).toBeNull();
  });
  it('codes the customer typed are not presented as chosen by Mindy', () => {
    const intent = compileIntent('staffing under 561320 in TN', NOW);
    expect(inferredCodeDisclosure([{ name: 'get_expiring_contracts', args: JSON.stringify({ naics: '561320' }) }], intent, title)).toBeNull();
  });
  it('a prefix code is described as a code family, never given an invented title', () => {
    const intent = compileIntent('temp staffing in Memphis', NOW);
    expect(inferredCodeDisclosure([{ name: 'get_buying_offices', args: JSON.stringify({ naics: '5613' }) }], intent, () => null)).toMatch(/5613 \(all codes starting 5613\)/);
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
