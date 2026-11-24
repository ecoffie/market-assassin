/**
 * A company the profile was never tuned on (synthetic: Ridgeline Test Facilities, janitorial, GA/SC) gets the same
 * report structure as before the benchmark-tuning removal, built only from its own evidence, with nothing from the
 * benchmark company leaking in: no project titles, solicitations, people, region or trade defaults.
 */
import { describe, it, expect } from 'vitest';
import { accumulateFmpEvidence, buildFmpHostDocModel, requiredSnippetsForWriteup } from './fmp-writeup-grounding';
import { validateFmpWriteup } from './fmp-writeup-validate';
import { buildFmpPathwayFindArgs, buildFmpNextMarketReportArgs, buildFmpPathwaySupplementalCalls } from './tool-selection';
import { initialFmpPhaseState } from './fmp-phase-machine';

const ASK = 'Build a federal market profile for Ridgeline Test Facilities LLC, a janitorial and custodial firm in Georgia and South Carolina.';
const NAME_ONLY = 'Build a federal market profile for Ridgeline Test Facilities LLC';
const BENCHMARK = /Clara Barton|GWMP|JBAB|Capitol Perimeter|693C73|FA706027|W912DR27|HQ0034|Helson|Bogner|Agena|Kingman|highway bridge heavy civil|237310|Pentagon paving|VA,MD,DC/i;

const history = JSON.stringify({
  recipient: 'Ridgeline Test Facilities LLC', primary_naics: '561720', total_obligations: 4250000, award_count: 12,
  awards: [
    { piid: 'W9124D26D0005', description: 'Custodial services Fort Gordon', naics: '561720', awarding_agency: 'Department of the Army', amount: 2100000, state: 'GA' },
    { piid: '36C24726P0100', description: 'Janitorial VA medical center', naics: '561720', awarding_agency: 'Department of Veterans Affairs', amount: 900000, state: 'SC' },
  ],
});
const find = JSON.stringify({ horizons: { open_now: { items: [
  { notice_id: 'a'.repeat(32), solicitation_number: 'W9124D27R0011', title: 'Custodial Services Multiple Award Task Order Contract (MATOC)', department: 'DEPT OF THE ARMY', naics_code: '561720', response_deadline: '2027-01-10T17:00:00Z', notice_type: 'Presolicitation', description: 'Base-wide custodial services at Fort Gordon, GA.' },
  { notice_id: 'b'.repeat(32), solicitation_number: '36C24727Q0042', title: 'Janitorial Services Sources Sought', department: 'VETERANS AFFAIRS, DEPARTMENT OF', naics_code: '561720', response_deadline: '2026-12-20T17:00:00Z', notice_type: 'Sources Sought' },
  { notice_id: 'c'.repeat(32), solicitation_number: '1240LT27Q0099', title: 'Ranger Station Cleaning', department: 'AGRICULTURE', naics_code: '561720', response_deadline: '2026-12-05T17:00:00Z', notice_type: 'Combined Synopsis/Solicitation' },
] } } });
const forecasts = JSON.stringify({ forecasts: [{ id: 'fc-1', title: 'Custodial services recompete Charleston', description: 'Custodial and grounds at Joint Base Charleston.', agency: 'Air Force', naics_code: '561720', award_date: '2027-06-01' }] });

const ev = accumulateFmpEvidence([
  { tool: 'get_contractor_award_history', content: history },
  { tool: 'find_opportunities', content: find },
  { tool: 'get_agency_forecasts', content: forecasts },
]);

describe('a non-benchmark company: same structure, its own evidence, no benchmark leakage', () => {
  it('host report keeps the structure and passes the write-up gate (no construction-oversight section for a janitorial firm)', () => {
    const model = buildFmpHostDocModel(ev, { customerText: ASK, today: () => '2026-11-23' });
    // Headings measured on main, minus the defense construction-oversight (PAE) section: it is for construction
    // firms only, and this firm's award NAICS is 561720 even though an Army buyer appears.
    expect(model.sections.map((s) => s.heading)).toEqual([
      'The read', 'Pathways in priority order', 'Where the money is moving',
      'What buyers are under pressure to fix',
      'Who to talk to and what to say', 'Readiness checklist: what these buyers will ask to see',
    ]);
    const v = validateFmpWriteup(model, { defenseBuyersAppear: false, requiredSnippets: requiredSnippetsForWriteup(ev) });
    expect(v.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(JSON.stringify(model)).not.toMatch(BENCHMARK);
  });

  it('pathways and the vehicle reference come from this company\'s own records', () => {
    expect((ev.pathways ?? []).map((p) => p.title)).toEqual([
      'Custodial Services Multiple Award Task Order Contract (MATOC)', 'Janitorial Services Sources Sought',
      'Custodial services recompete Charleston', 'Ranger Station Cleaning',
    ]);
    // The office code of the firm's own IDV (W9124D26D0005), not a code from any benchmark.
    expect(ev.vehicleTokens).toEqual(['MATOC', 'W9124D']);
    expect(requiredSnippetsForWriteup(ev)).toEqual(['561720', '$4.3M', 'W9124D']);
  });

  it('no-profile host calls use the customer\'s words and say nothing they did not give', () => {
    expect(buildFmpPathwayFindArgs(NAME_ONLY)).toEqual({ query: NAME_ONLY, limit_per_horizon: 15 });
    expect(buildFmpNextMarketReportArgs(ASK, 0)).toEqual({ state: 'GA', keyword: 'janitorial', client_name: 'Ridgeline Test Facilities LLC' });
    expect(buildFmpNextMarketReportArgs(NAME_ONLY, 0)).toEqual({ client_name: 'Ridgeline Test Facilities LLC' });
    expect(buildFmpPathwaySupplementalCalls(ASK, { awardStates: ['GA', 'SC'] })).toEqual([]);
    expect(initialFmpPhaseState(NAME_ONLY).marketReportTarget).toBe(1);
  });
});
