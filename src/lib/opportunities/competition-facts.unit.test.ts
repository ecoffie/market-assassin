import { describe, it, expect, vi, afterEach } from 'vitest';
import { classifyCompetition, competitionFactsFor, competitionCounts, fetchAwardCompetition, awardRecordFacts } from './competition-facts';

// Field values copied from the live USASpending award records (2026-11-16).
const GULFSTREAM_GOODWILL = { // W912EP22C0005 — the $15.4M row the FL answer called "Full and open"
  extent_competed: 'C', extent_competed_description: 'NOT COMPETED', type_set_aside_description: 'NO SET ASIDE USED.',
  other_than_full_and_open_description: 'ONLY ONE SOURCE-OTHER (FAR 6.302-1 OTHER)', number_of_offers_received: '1',
  business_categories: ['AbilityOne Program Participant', 'Nonprofit Organization'],
};
const GENCO = { // 70B02C23P00000103
  extent_competed: 'B', extent_competed_description: 'NOT AVAILABLE FOR COMPETITION', type_set_aside_description: '8(A) SOLE SOURCE',
  other_than_full_and_open_description: 'AUTHORIZED BY STATUTE (FAR 6.302-5(A)(2)(I))', number_of_offers_received: '1', business_categories: [],
};
const COMPETED_SB = {
  extent_competed: 'A', extent_competed_description: 'FULL AND OPEN COMPETITION', type_set_aside_description: 'SMALL BUSINESS SET ASIDE - TOTAL',
  number_of_offers_received: '4', business_categories: ['Small Business'],
};

describe('classifyCompetition — every fact traces to the award record', () => {
  it('AbilityOne holder, not competed → restricted, labelled, never "Full and open"', () => {
    const f = classifyCompetition(GULFSTREAM_GOODWILL);
    expect(f).toMatchObject({ class: 'not_competed', label: 'Not competed · AbilityOne', abilityone_holder: true, set_aside: null, offers_received: 1 });
    expect(f.detail).toMatch(/not competed/i);
    expect(f.detail).toMatch(/AbilityOne Program participant/);
    expect(f.detail).not.toMatch(/cannot|can't|never/i); // describes the current award, not the follow-on
  });
  it('8(a) sole source → restricted with its own label', () => {
    expect(classifyCompetition(GENCO)).toMatchObject({ class: 'not_competed', label: '8(a) sole source', abilityone_holder: false });
  });
  it('competed small-business set-aside → competed, short label, offers stated', () => {
    const f = classifyCompetition(COMPETED_SB);
    expect(f).toMatchObject({ class: 'competed', label: 'Competed · SB set-aside', offers_received: 4 });
    expect(f.detail).toMatch(/4 offers were received/);
  });
  it('no record, empty fields or an unknown code → unknown, never competed', () => {
    expect(classifyCompetition(null).class).toBe('unknown');
    expect(classifyCompetition({}).class).toBe('unknown');
    expect(classifyCompetition({ extent_competed: 'ZZ' }).class).toBe('unknown');
    expect(classifyCompetition({ extent_competed: null, type_set_aside_description: 'NO SET ASIDE USED.' }).label).toBe('Not established');
  });
  it('AbilityOne is unknown (null) when the record carries no business categories', () => {
    expect(classifyCompetition({ extent_competed: 'C' }).abilityone_holder).toBeNull();
  });
});

describe('competitionFactsFor — fails open, bounded', () => {
  it('a failed or slow lookup is unknown; the others still classify', async () => {
    const lookup = async (id: string) => {
      if (id === 'boom') throw new Error('500');
      if (id === 'slow') return new Promise<null>((r) => setTimeout(() => r(null), 200));
      return id === 'goodwill' ? GULFSTREAM_GOODWILL : GENCO;
    };
    const m = await competitionFactsFor(['goodwill', 'genco', 'boom', 'slow', 'goodwill'], lookup, { budgetMs: 50 });
    expect(m.size).toBe(4);
    expect(m.get('goodwill')!.class).toBe('not_competed');
    expect(m.get('boom')!.class).toBe('unknown');
    expect(m.get('slow')!.class).toBe('unknown');
    expect(competitionCounts(m.values())).toEqual({ competed: 0, not_competed: 2, unknown: 2 });
  });
});

describe('orders: the fair-opportunity field when no extent code is recorded', () => {
  it('"FAIR OPPORTUNITY GIVEN" → competed; an exception → not competed with the exception as the reason', () => {
    expect(classifyCompetition({ fair_opportunity_limited_sources_description: 'FAIR OPPORTUNITY GIVEN', number_of_offers_received: '4' })).toMatchObject({ class: 'competed', offers_received: 4 });
    expect(classifyCompetition({ fair_opportunity_limited_sources_description: 'ONLY ONE SOURCE - OTHER' })).toMatchObject({ class: 'not_competed', sole_source_reason: 'ONLY ONE SOURCE - OTHER' });
  });
  it('an extent code still wins; "NO SET ASIDE USED." is kept as set_aside_reported, not as set_aside', () => {
    const f = classifyCompetition({ extent_competed: 'A', fair_opportunity_limited_sources_description: 'URGENCY', type_set_aside_description: 'NO SET ASIDE USED.' });
    expect(f).toMatchObject({ class: 'competed', set_aside: null, set_aside_reported: 'NO SET ASIDE USED.' });
  });
});

describe('fetchAwardCompetition reads the fields USASpending actually returns (2026-11-28)', () => {
  afterEach(() => vi.unstubAllGlobals());
  // Live shape: CONT_AWD_W91YTZ25FA168_9700_GS10F0311W_4700 (order under GS10F0311W).
  const LIVE = {
    latest_transaction_contract_data: { extent_competed: null, number_of_offers_received: '3', fair_opportunity_limited: 'FAIR', fair_opportunity_limited_description: 'FAIR OPPORTUNITY GIVEN' },
    place_of_performance: { city_name: 'MARIETTA', state_code: 'GA' },
    period_of_performance: { start_date: '2025-09-01', end_date: '2027-08-31', potential_end_date: '2028-08-31 00:00:00' },
    recipient: { business_categories: [] },
  };
  it('fair_opportunity_limited_description (the real name) reaches classification; place and period are read', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => LIVE })));
    const f = await fetchAwardCompetition('X');
    expect(f).toMatchObject({ fair_opportunity_limited_sources_description: 'FAIR OPPORTUNITY GIVEN', place_of_performance_city: 'MARIETTA', place_of_performance_state: 'GA', period_current_end: '2027-08-31', period_potential_end: '2028-08-31 00:00:00' });
    const c = classifyCompetition(f);
    expect(c).toMatchObject({ class: 'competed', label: 'Competed (fair opportunity)', offers_received: 3, offers_source: 'usaspending_award' });
    expect(c.award_record).toEqual({ place_of_performance_city: 'MARIETTA', place_of_performance_state: 'GA', period_current_end: '2027-08-31', period_potential_end: '2028-08-31' });
  });
  it('a record with no place or period facts → award_record null (never empty strings)', () => {
    expect(awardRecordFacts({ extent_competed: 'A' })).toBeNull();
    expect(classifyCompetition(null).award_record).toBeNull();
  });
});

