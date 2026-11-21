import { describe, expect, it } from 'vitest';
import { findRowToFitResult, scoreFindHorizon } from './find-rows';

const NOW = Date.parse('2026-11-21T12:00:00Z');
const days = (n: number) => new Date(NOW + n * 86_400_000).toISOString();

// Rows shaped like find_opportunities horizon items plus the #2276 fields. Synthetic values.
const OPEN = {
  horizon: 'open_now', title: 'Laboratory Staffing Services', buyer: 'Department of Veterans Affairs',
  naics_code: '561320', psc_code: 'R499', response_deadline: days(30), place_of_performance_state: 'tn',
  set_aside: 'Total Small Business Set-Aside (FAR 19.5)', set_aside_description: 'Total Small Business Set-Aside (FAR 19.5)', set_aside_code: 'SBA',
};
const BACK = {
  horizon: 'coming_back', title: 'Administrative Clerk Support', buyer: 'Department of the Army', naics_code: '561320',
  current_end: days(300), potential_total_value: '2100000', total_obligation: 900_000, set_aside_type: null,
  awarding_sub_agency: 'Department of the Army', place_of_performance_state: 'TN',
};
const SOON = {
  horizon: 'coming_soon', title: 'Medical Staffing', buyer: 'Department of Veterans Affairs', naics_code: '561320',
  anticipated_award_date: days(200), estimated_value_min: 1_000_000, estimated_value_max: null,
  contracting_office: 'Network Contracting Office 9', set_aside_type: 'SDVOSB', place_of_performance_state: null,
};

describe('findRowToFitResult', () => {
  it('maps an open notice: raw set-aside, response deadline, state, no value', () => {
    expect(findRowToFitResult(OPEN)).toEqual({
      kind: 'open', title: 'Laboratory Staffing Services', naics: '561320', psc: 'R499',
      buyerAgency: 'Department of Veterans Affairs', state: 'TN',
      setAside: 'Total Small Business Set-Aside (FAR 19.5)', date: days(30), dateKind: 'response_deadline',
    });
  });

  it('open: null raw set-aside is unknown, never full and open; only literal "no set-aside" text is', () => {
    const unknown = findRowToFitResult({ ...OPEN, set_aside: null, set_aside_description: null, set_aside_code: null });
    expect(unknown).not.toHaveProperty('setAside');
    expect(unknown).not.toHaveProperty('fullAndOpen');
    const none = findRowToFitResult({ ...OPEN, set_aside_description: 'No Set aside used', set_aside_code: null });
    expect(none).toMatchObject({ fullAndOpen: true });
    expect(none).not.toHaveProperty('setAside');
  });

  it('open: raw fields win over the legacy combined set_aside; legacy is used only when raw fields are absent', () => {
    expect(findRowToFitResult({ ...OPEN, set_aside: 'Total Small Business', set_aside_description: null, set_aside_code: null })).not.toHaveProperty('setAside');
    const legacy = { ...OPEN } as Record<string, unknown>;
    delete legacy.set_aside_description; delete legacy.set_aside_code;
    expect(findRowToFitResult(legacy)).toMatchObject({ setAside: 'Total Small Business Set-Aside (FAR 19.5)' });
  });

  it('maps a coming-back row: value fallback order, current end, office, null set-aside unknown', () => {
    expect(findRowToFitResult(BACK)).toEqual({
      kind: 'coming_back', title: 'Administrative Clerk Support', naics: '561320', buyerAgency: 'Department of the Army',
      state: 'TN', value: 2_100_000, date: days(300), dateKind: 'current_end', buyerOffice: 'Department of the Army',
    });
    expect(findRowToFitResult({ ...BACK, potential_total_value: null })).toMatchObject({ value: 900_000 });
    expect(findRowToFitResult({ ...BACK, potential_total_value: null, total_obligation: 0 })).not.toHaveProperty('value');
  });

  it('coming back: an 8(a) sole source set-aside flags the incumbent sole source', () => {
    expect(findRowToFitResult({ ...BACK, set_aside_type: '8(a) Sole Source' })).toMatchObject({ setAside: '8(a) Sole Source', incumbentSoleSource8a: true });
    expect(findRowToFitResult({ ...BACK, set_aside_type: '8(a) Competed' })).not.toHaveProperty('incumbentSoleSource8a');
  });

  it('maps a forecast: one-sided value range, anticipated award, contracting office, unknown state', () => {
    expect(findRowToFitResult(SOON)).toEqual({
      kind: 'forecast', title: 'Medical Staffing', naics: '561320', buyerAgency: 'Department of Veterans Affairs',
      setAside: 'SDVOSB', value: { min: 1_000_000 }, date: days(200), dateKind: 'anticipated_award',
      buyerOffice: 'Network Contracting Office 9',
    });
    expect(findRowToFitResult({ ...SOON, estimated_value_min: null })).not.toHaveProperty('value');
  });

  it('an unknown horizon maps to null; an invalid state is unknown', () => {
    expect(findRowToFitResult({ horizon: 'something_else', title: 'x' })).toBeNull();
    expect(findRowToFitResult({ ...OPEN, place_of_performance_state: 'Tennessee' })).not.toHaveProperty('state');
  });
});

describe('scoreFindHorizon', () => {
  const profile = { naicsCodes: ['561320'], states: ['TN'], certifications: [], largestPastAward: 1_500_000 };

  it('scores the window best first, skips unknown horizons, and reports a partial window', () => {
    const w = scoreFindHorizon({ items: [{ horizon: 'weird' }, SOON, OPEN, BACK], matched_count: 6_864 }, profile, NOW);
    expect(w.window_size).toBe(3);
    expect(w.matched_count).toBe(6_864);
    expect(w.coverage_note).toMatch(/top 3 fetched of 6864/);
    expect(w.ranked[0].item).toBe(OPEN);
    const soon = w.ranked.find((x) => x.item === SOON)!;
    expect(soon.fit.route).toBe('subcontract'); // SDVOSB set-aside the company does not hold
  });

  it('a null matched_count stays unknown (no matched_count, no note)', () => {
    const w = scoreFindHorizon({ items: [OPEN], matched_count: null }, profile, NOW);
    expect(w).not.toHaveProperty('matched_count');
    expect(w).not.toHaveProperty('coverage_note');
  });
});
