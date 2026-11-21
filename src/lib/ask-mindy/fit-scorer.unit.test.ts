import { describe, expect, it } from 'vitest';
import { RELATED_AT, SHOW_AT, WEIGHTS, eligibilityGate, reasonSentence, requiredCertification, scoreFit, type FitProfile, type FitResult } from './fit-scorer';

const NOW = Date.parse('2026-11-21T12:00:00Z');
const days = (n: number) => new Date(NOW + n * 86_400_000).toISOString();

// The spec's section 9 example company, plus fields a full profile would carry (labelled test values).
const STAFFING: FitProfile = {
  naicsCodes: ['561320'],
  certifications: [],
  smallUnder: { '561320': true },
  states: ['TN'],
  largestPastAward: 1_000_000,
  pastPerformance: { buyerAgencies: ['Department of Veterans Affairs'], naicsCodes: ['561320'] },
  vehiclesHeld: [],
  queryConcepts: ['staffing'],
};

const open = (over: Partial<FitResult> = {}): FitResult => ({
  kind: 'open', title: 'Laboratory Staffing Services', naics: '561320', setAside: 'Total Small Business',
  value: 1_500_000, date: days(30), state: 'TN', buyerAgency: 'Department of Veterans Affairs', vehicle: null, ...over,
});

describe('weights', () => {
  it('are the spec starting weights and sum to 100', () => {
    expect(WEIGHTS).toEqual({ capability: 30, past_performance: 15, timing: 15, competition: 10, size: 10, location: 10, pathway: 10 });
    expect(Object.values(WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
    expect([SHOW_AT, RELATED_AT]).toEqual([60, 40]);
  });
});

describe('scoreFit', () => {
  it('a strong match scores high, is shown, and explains itself in plain words', () => {
    const f = scoreFit(open(), STAFFING, NOW);
    // capability 30 + past perf (same agency) 10 + timing 15 + competition 7 + size 10 + location 10 = 82 of 90 known
    expect(f.known_weight).toBe(90); // pathway not applicable (open market)
    expect(f.score).toBe(Math.round((82 / 90) * 100));
    expect(f.band).toBe('show');
    expect(f.route).toBe('prime');
    expect(f.reasons).toHaveLength(2);
    expect(reasonSentence(f)).toBe('Matches your registered work codes and is open with time to respond.');
  });

  it('the spec failure case: a single generic word match does not pass as a fit ("food carts as transport")', () => {
    const f = scoreFit(open({ title: 'Food Cart Transport Lease', naics: '722330', psc: undefined, setAside: '', value: 50_000, state: 'CA', buyerAgency: 'Department of the Interior' }),
      { ...STAFFING, queryConcepts: ['wheelchair transport'] }, NOW);
    expect(f.factors.find((x) => x.id === 'capability')?.points).toBe(0);
    expect(f.band).toBe('hidden');
  });

  it('text-only match needs every query concept in the title or description, and scores 5', () => {
    const p = { ...STAFFING, naicsCodes: ['999999'], queryConcepts: ['wheelchair', 'transport'] };
    expect(scoreFit(open({ naics: undefined, title: 'Wheelchair van transport services' }), p, NOW).factors[0].points).toBe(5);
    expect(scoreFit(open({ naics: undefined, title: 'Transport services' }), p, NOW).factors[0].points).toBe(0);
  });

  it('same 4-digit industry group scores 15 on capability', () => {
    expect(scoreFit(open({ naics: '561311' }), STAFFING, NOW).factors[0].points).toBe(15);
  });

  it('timing: under 10 days scores 8; coming back in 6 to 18 months 12; forecast 8; a passed deadline is hidden', () => {
    expect(scoreFit(open({ date: days(5) }), STAFFING, NOW).factors[2].points).toBe(8);
    expect(scoreFit(open({ kind: 'coming_back', date: days(300) }), STAFFING, NOW).factors[2].points).toBe(12);
    expect(scoreFit(open({ kind: 'forecast', date: undefined }), STAFFING, NOW).factors[2].points).toBe(8);
    const late = scoreFit(open({ date: days(-1) }), STAFFING, NOW);
    expect(late).toMatchObject({ band: 'hidden', hiddenBecause: 'response deadline has passed' });
  });

  it('competition: held certification 10, small business 7, full and open 4, incumbent 8(a) sole source 2', () => {
    const p = { ...STAFFING, certifications: ['HUBZone'] };
    expect(scoreFit(open({ setAside: 'HUBZone Set-Aside' }), p, NOW).factors[3].points).toBe(10);
    expect(scoreFit(open({ setAside: 'Total Small Business' }), p, NOW).factors[3].points).toBe(7);
    expect(scoreFit(open({ setAside: '' }), p, NOW).factors[3].points).toBe(4);
    expect(scoreFit(open({ kind: 'coming_back', setAside: '', incumbentSoleSource8a: true, date: days(300) }), p, NOW).factors[3].points).toBe(2);
  });

  it('size: 0.5x to 3x scores 10, up to 10x 5, beyond 2', () => {
    expect(scoreFit(open({ value: 3_000_000 }), STAFFING, NOW).factors[4].points).toBe(10);
    expect(scoreFit(open({ value: 9_000_000 }), STAFFING, NOW).factors[4].points).toBe(5);
    expect(scoreFit(open({ value: 50_000_000 }), STAFFING, NOW).factors[4].points).toBe(2);
  });

  it('location: same state 10, same census region 6, nationwide 6, elsewhere 2', () => {
    expect(scoreFit(open({ state: 'TN' }), STAFFING, NOW).factors[5].points).toBe(10);
    expect(scoreFit(open({ state: 'GA' }), STAFFING, NOW).factors[5].points).toBe(6);
    expect(scoreFit(open({ state: undefined, nationwide: true }), STAFFING, NOW).factors[5].points).toBe(6);
    expect(scoreFit(open({ state: 'WA' }), STAFFING, NOW).factors[5].points).toBe(2);
  });

  it('pathway: held vehicle 10, open vehicle 6, closed 2; open market is not applicable', () => {
    const p = { ...STAFFING, vehiclesHeld: ['GSA MAS'] };
    expect(scoreFit(open({ vehicle: { name: 'GSA MAS' } }), p, NOW).factors[6].points).toBe(10);
    expect(scoreFit(open({ vehicle: { name: 'OASIS+', openToNewBidders: true } }), p, NOW).factors[6].points).toBe(6);
    expect(scoreFit(open({ vehicle: { name: 'SEWP V', openToNewBidders: false } }), p, NOW).factors[6].points).toBe(2);
    expect(scoreFit(open({ vehicle: null }), p, NOW).factors[6].points).toBeNull();
  });
});

describe('unknown is never guessed', () => {
  it('unknown factors are left out and the score scales over what is known; known_weight says how much', () => {
    const f = scoreFit(open({ value: undefined, state: undefined }), { naicsCodes: ['561320'] }, NOW);
    const unknown = f.factors.filter((x) => x.points === null).map((x) => x.id).sort();
    expect(unknown).toEqual(['location', 'past_performance', 'pathway', 'size']);
    expect(f.known_weight).toBe(30 + 15 + 10);
    expect(f.score).toBe(Math.round(((30 + 15 + 7) / 55) * 100));
  });

  it('an empty profile and an empty result score 0 on nothing, never a made-up number', () => {
    const f = scoreFit({ kind: 'open' }, {}, NOW);
    expect(f.known_weight).toBe(0);
    expect(f.score).toBe(0);
    expect(f.band).toBe('hidden');
    expect(f.reasons).toEqual([]);
  });

  it('unknown certifications do not count as missing ones', () => {
    const f = scoreFit(open({ setAside: 'SDVOSB' }), { ...STAFFING, certifications: undefined }, NOW);
    expect(f.factors[3].points).toBeNull();
    expect(f.route).toBe('prime');
  });
});

describe('eligibility gate (step 1)', () => {
  it('a set-aside the company does not hold relabels to the subcontract route instead of dropping', () => {
    const f = scoreFit(open({ setAside: 'Service-Disabled Veteran-Owned Small Business' }), STAFFING, NOW);
    expect(f.route).toBe('subcontract');
    expect(f.gate).toBe('set aside for SDVOSB, which you do not hold');
    expect(f.score).toBeGreaterThan(0);
  });

  it('not small under the notice NAICS relabels a small business set-aside to subcontract', () => {
    expect(eligibilityGate(open({ naics: '541512' }), { ...STAFFING, smallUnder: { '541512': false } })).toBe('you are not small under NAICS 541512');
  });

  it('full and open work is never gated on size', () => {
    expect(eligibilityGate(open({ naics: '541512', setAside: '' }), { ...STAFFING, smallUnder: { '541512': false } })).toBeNull();
  });

  it('requiredCertification reads published set-aside names', () => {
    expect(requiredCertification('8(a) Sole Source')).toBe('8(a)');
    expect(requiredCertification('Women-Owned Small Business (WOSB) Program Set-Aside')).toBe('WOSB');
    expect(requiredCertification('Total Small Business Set-Aside (FAR 19.5)')).toBe('small');
    expect(requiredCertification('')).toBeNull();
  });
});
