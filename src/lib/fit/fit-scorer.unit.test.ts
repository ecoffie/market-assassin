import { describe, expect, it } from 'vitest';
import { RELATED_AT, SHOW_AT, SHOW_MIN_KNOWN_WEIGHT, WEIGHTS, eligibilityGate, resultValue, scoreWindow, reasonSentence, requiredCertification, scoreFit, type FitProfile, type FitResult } from './fit-scorer';

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
    expect(scoreFit(open({ setAside: undefined, fullAndOpen: true }), p, NOW).factors[3].points).toBe(4);
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

describe('a known zero work match is hidden, never "related" (Agent 4 / Ask Mindy builder, 2026-11-22)', () => {
  it('0 capability + open deadline + small business set-aside (22 of 55 known) is hidden, with the reason', () => {
    const f = scoreFit(open({ title: 'Grounds Maintenance', naics: '561730', psc: undefined, value: undefined, state: undefined, buyerAgency: undefined }), { ...STAFFING, pastPerformance: undefined }, NOW);
    expect(f.factors.find((x) => x.id === 'capability')?.points).toBe(0);
    expect(f.known_weight).toBe(55);
    expect(f.score).toBeGreaterThanOrEqual(RELATED_AT); // would have been 'related' on points alone
    expect(f.band).toBe('hidden');
    expect(f.hiddenBecause).toMatch(/no work match/);
  });

  it('unknown capability is not a zero: it is not hidden for that reason', () => {
    const f = scoreFit(open({ naics: undefined, psc: undefined, title: '' }), { ...STAFFING, queryConcepts: [] }, NOW);
    if (f.factors.find((x) => x.id === 'capability')?.points === null) {
      expect(f.hiddenBecause ?? '').not.toMatch(/no work match/);
    }
  });

  it('a real work match is unaffected', () => {
    expect(scoreFit(open(), STAFFING, NOW).band).toBe('show');
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

  it('nothing known → score null and band unscored, never a made-up 0', () => {
    const f = scoreFit({ kind: 'open' }, {}, NOW);
    expect(f.known_weight).toBe(0);
    expect(f.score).toBeNull();
    expect(f.band).toBe('unscored');
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
    expect(f.gate).toBe('subcontract route: set aside for SDVOSB, which you do not hold');
    expect(f.score).toBeGreaterThan(0);
  });

  it('not small under the notice NAICS relabels a small business set-aside to subcontract', () => {
    expect(eligibilityGate(open({ naics: '541512' }), { ...STAFFING, smallUnder: { '541512': false } })).toBe('subcontract route: you are not small under NAICS 541512');
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

describe('evidence floor for show (Agent 4 review, approved by Eric)', () => {
  it('the floor is capability known and 50 known points', () => {
    expect(SHOW_MIN_KNOWN_WEIGHT).toBe(50);
  });

  it('a location-only match does not score its way into show', () => {
    const f = scoreFit({ kind: 'open', state: 'TN' }, { states: ['TN'] }, NOW);
    expect(f.score).toBe(100);
    expect(f.band).toBe('related');
    expect(f.evidenceNote).toBe('limited evidence: only location could be checked');
  });

  it('capability unknown keeps a high score out of show, even with plenty of known weight', () => {
    const f = scoreFit(open({ naics: undefined, title: undefined, description: undefined }), { ...STAFFING, naicsCodes: undefined, queryConcepts: undefined }, NOW);
    expect(f.factors.find((x) => x.id === 'capability')?.points).toBeNull();
    expect(f.known_weight).toBeGreaterThanOrEqual(SHOW_MIN_KNOWN_WEIGHT);
    expect(f.score).toBeGreaterThanOrEqual(SHOW_AT);
    expect(f.band).toBe('related');
    expect(f.evidenceNote).toMatch(/^limited evidence: only past performance, timing, competition, size and location could be checked$/);
  });

  it('capability known but under 50 known points stays out of show', () => {
    const f = scoreFit({ kind: 'open', naics: '561320', date: days(30) }, { naicsCodes: ['561320'] }, NOW);
    expect(f.known_weight).toBe(45);
    expect(f.band).toBe('related');
  });

  it('a capability exact match with enough known weight is shown, with no evidence note', () => {
    const f = scoreFit(open(), STAFFING, NOW);
    expect(f.band).toBe('show');
    expect(f).not.toHaveProperty('evidenceNote');
  });
});

describe('subcontract route never reads as prime-eligible (Eric, 2026-11-21)', () => {
  const gated = [
    scoreFit(open({ setAside: 'SDVOSB' }), STAFFING, NOW),
    scoreFit(open({ setAside: '8(a) Set-Aside' }), STAFFING, NOW),
    scoreFit(open({ naics: '541512' }), { ...STAFFING, naicsCodes: ['541512'], smallUnder: { '541512': false } }, NOW),
  ];
  it('is labelled the subcontract route and leads its reasons with that label', () => {
    for (const f of gated) {
      expect(f.route).toBe('subcontract');
      expect(f.reasons[0]).toMatch(/^subcontract route: /);
      expect(reasonSentence(f)).toMatch(/^Subcontract route: /);
    }
  });
  it('never claims the company holds the set-aside or can prime it', () => {
    for (const f of gated) {
      for (const r of f.reasons) expect(r).not.toMatch(/which you hold|you can (bid|prime)|eligible/i);
      expect(f.factors.find((x) => x.id === 'competition')?.points ?? 0).toBeLessThan(10);
    }
  });
  it('a thin-evidence gated result still carries the route label (the gate itself is known evidence)', () => {
    const f = scoreFit({ kind: 'open', setAside: 'HUBZone' }, { certifications: [] }, NOW);
    expect(f).toMatchObject({ route: 'subcontract', known_weight: 10, score: 0, band: 'hidden' });
    expect(f.reasons).toEqual(['subcontract route: set aside for HUBZone, which you do not hold']);
  });
});

describe('Data Core contract (2026-11-21)', () => {
  it('a blank or missing set-aside is unknown; full and open only when the source says so', () => {
    for (const setAside of [undefined, null, '', '   ']) {
      expect(scoreFit(open({ setAside }), STAFFING, NOW).factors[3].points).toBeNull();
    }
    expect(scoreFit(open({ setAside: undefined, fullAndOpen: true }), STAFFING, NOW).factors[3].points).toBe(4);
    // A published set-aside still wins over the flag.
    expect(scoreFit(open({ setAside: 'Total Small Business', fullAndOpen: true }), STAFFING, NOW).factors[3].points).toBe(7);
  });

  it('a value range scores at its midpoint; a one-sided range at its known bound; nonsense is unknown', () => {
    expect(resultValue({ min: 1_000_000, max: 3_000_000 })).toBe(2_000_000);
    expect(resultValue({ max: 5_000_000 })).toBe(5_000_000);
    expect(resultValue({ min: 0, max: -1 })).toBeUndefined();
    expect(resultValue({})).toBeUndefined();
    expect(scoreFit(open({ kind: 'forecast', value: { min: 1_000_000, max: 2_000_000 } }), STAFFING, NOW).factors[4].points).toBe(10);
    expect(scoreFit(open({ value: {} }), STAFFING, NOW).factors[4].points).toBeNull();
  });

  it('dateKind: the matching kind scores; a contradicting kind makes the date unknown, never reinterpreted', () => {
    expect(scoreFit(open({ dateKind: 'response_deadline', date: days(30) }), STAFFING, NOW).factors[2].points).toBe(15);
    expect(scoreFit(open({ kind: 'coming_back', dateKind: 'current_end', date: days(300) }), STAFFING, NOW).factors[2].points).toBe(12);
    expect(scoreFit(open({ dateKind: 'current_end', date: days(30) }), STAFFING, NOW).factors[2].points).toBeNull();
    expect(scoreFit(open({ dateKind: 'current_end', date: days(-5) }), STAFFING, NOW).band).not.toBe('hidden');
  });

  it('scoreWindow ranks the whole fetched window before paging and reports window vs matched', () => {
    const rows = [
      { id: 'construction', r: open({ title: 'Roof Repair', naics: '238160', setAside: undefined, fullAndOpen: true, state: 'WA', buyerAgency: 'Department of the Interior' }) },
      { id: 'staffing', r: open() },
      { id: 'nothing', r: { kind: 'open' as const } },
    ];
    const w = scoreWindow(rows, (x) => x.r, STAFFING, { matchedCount: 6_864, nowMs: NOW });
    expect(w.ranked.map((x) => x.item.id)).toEqual(['staffing', 'construction', 'nothing']);
    expect(w).toMatchObject({ window_size: 3, matched_count: 6_864 });
    expect(w.coverage_note).toMatch(/top 3 fetched of 6864 matching; this is the best of what was scored, not of the whole market/);
  });

  it('scoreWindow sorts unscored (null) results after every scored one, including a real 0', () => {
    // Empty profile: a bare row is unscored; a row with a passed-in set-aside and deadline scores.
    const w = scoreWindow([{ kind: 'open' as const }, open({ setAside: 'SDVOSB', date: days(-3) }), open()], (r) => r, {}, { nowMs: NOW });
    expect(w.ranked.map((x) => x.fit.score === null)).toEqual([false, false, true]);
  });

  it('scoreWindow leaves matched_count absent when unknown, and adds no note when the window covers it', () => {
    const w1 = scoreWindow([open()], (r) => r, STAFFING, { nowMs: NOW });
    expect(w1).not.toHaveProperty('matched_count');
    expect(w1).not.toHaveProperty('coverage_note');
    const w2 = scoreWindow([open()], (r) => r, STAFFING, { matchedCount: 1, nowMs: NOW });
    expect(w2).not.toHaveProperty('coverage_note');
  });
});
