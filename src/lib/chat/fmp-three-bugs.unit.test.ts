/**
 * Three pre-existing FMP host bugs found during the benchmark-tuning removal (#2392), ranked by customer impact:
 *   1. a forecast row with no id crashed the evidence builder (the whole profile write-up failed);
 *   2. a person-shaped notice title ("Ranger Station Cleaning") was listed as a contact to call;
 *   3. the defense construction-oversight (PAE) section appeared for a non-construction firm because an Army buyer
 *      was in its evidence.
 */
import { describe, it, expect } from 'vitest';
import { accumulateFmpEvidence, buildFmpHostDocModel, fmpFirmDoesConstruction } from './fmp-writeup-grounding';

const forecasts = (rows: unknown[]) => JSON.stringify({ forecasts: rows });

describe('1. a forecast row with no id', () => {
  it('does not crash; the forecast is kept as a pathway and deduped by its title', () => {
    const run = () => accumulateFmpEvidence([{
      tool: 'get_agency_forecasts',
      content: forecasts([
        { title: 'Custodial services recompete', description: 'Base-wide custodial services.', agency: 'Air Force', naics_code: '561720', award_date: '2027-06-01' },
        { title: 'Custodial services recompete', description: 'Same row repeated by the publisher.', agency: 'Air Force', naics_code: '561720', award_date: '2027-06-01' },
      ]),
    }]);
    expect(run).not.toThrow();
    const fc = (run().pathways ?? []).filter((p) => p.kind === 'forecast');
    expect(fc.map((p) => p.title)).toEqual(['Custodial services recompete']);
    expect(fc[0].noticeId).toBeUndefined();
  });
});

describe('2. a notice title is never a contact', () => {
  it('a person-shaped title (title key, or a notice row\'s name) is skipped; a real POC is kept', () => {
    const find = JSON.stringify({ horizons: { open_now: { items: [
      { notice_id: 'c'.repeat(32), solicitation_number: '1240LT27Q0099', title: 'Ranger Station Cleaning', department: 'AGRICULTURE', naics_code: '561720', point_of_contact: 'Dana Whitfield' },
      { id: 'd'.repeat(32), solicitationNumber: '1240LT27Q0100', name: 'Visitor Center Janitorial', agency: { name: 'National Park Service' }, contact: { name: 'Noel Rangel' } },
    ] } } });
    const ev = accumulateFmpEvidence([{ tool: 'find_opportunities', content: find }]);
    expect(ev.contactNames).not.toContain('Ranger Station Cleaning');
    expect(ev.contactNames).not.toContain('Visitor Center Janitorial');
    expect(ev.contactNames).toEqual(expect.arrayContaining(['Dana Whitfield', 'Noel Rangel']));
  });
});

describe('3. the construction-oversight (PAE) section is for construction firms only', () => {
  const armyNotice = JSON.stringify({ horizons: { open_now: { items: [
    { notice_id: 'a'.repeat(32), solicitation_number: 'W9124D27R0011', title: 'Base Services Multiple Award Task Order Contract (MATOC)', department: 'DEPT OF THE ARMY', naics_code: '561720', notice_type: 'Presolicitation' },
    { notice_id: 'b'.repeat(32), solicitation_number: 'W9124D27R0012', title: 'Base Services Sources Sought', department: 'DEPT OF THE ARMY', naics_code: '561720', notice_type: 'Sources Sought' },
  ] } } });
  const history = (naics: string) => JSON.stringify({ recipient: 'Test Firm LLC', primary_naics: naics, total_obligations: 1000000, awards: [{ piid: 'W9124D26D0005', naics, awarding_agency: 'Department of the Army', amount: 1000000 }] });
  const headings = (naics: string, ask: string) => buildFmpHostDocModel(
    accumulateFmpEvidence([{ tool: 'get_contractor_award_history', content: history(naics) }, { tool: 'find_opportunities', content: armyNotice }]),
    { customerText: ask, defenseBuyersAppear: true, today: () => '2026-11-23' },
  ).sections.map((s) => s.heading);
  const PAE = /PAE|defense construction/i;

  it('a janitorial firm with an Army buyer (even with the defense flag on) gets no PAE section', () => {
    expect(headings('561720', 'Build a federal market profile for Test Firm LLC').some((h) => PAE.test(h))).toBe(false);
  });
  it('a construction firm with the same Army buyer still gets it', () => {
    expect(headings('236220', 'Build a federal market profile for Test Firm LLC').some((h) => PAE.test(h))).toBe(true);
  });
  it('construction is read from award NAICS, else profile NAICS, else the customer\'s words; unknown is no', () => {
    expect(fmpFirmDoesConstruction({ dominantNaics: '237310' }, '')).toBe(true);
    expect(fmpFirmDoesConstruction({ dominantNaics: '561720' }, 'we are a construction firm')).toBe(false);
    expect(fmpFirmDoesConstruction({ dominantNaics: null }, '', '238210')).toBe(true);
    expect(fmpFirmDoesConstruction({ dominantNaics: null }, 'a heavy civil contractor')).toBe(true);
    expect(fmpFirmDoesConstruction({ dominantNaics: null }, 'an IT services firm working for the Army')).toBe(false);
  });
});
