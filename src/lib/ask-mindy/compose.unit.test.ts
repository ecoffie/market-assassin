import { describe, expect, it } from 'vitest';
import { composeProfileSetup, composeWhereToStart, toAskMindyProfile, toFitProfile, MAX_TOP_PICKS } from './compose';
import { buildCompanyProfile } from './company-profile';
import type { RecipeRun } from './orchestrator';

const NOW = Date.parse('2026-11-21T12:00:00Z');
const days = (n: number) => new Date(NOW + n * 86_400_000).toISOString();

// Synthetic (illustrative) company and rows.
const PROFILE = buildCompanyProfile({
  bidder: { naicsCodes: ['561320'], agencies: ['Department of Veterans Affairs'], setAsides: ['SDVOSB'], locationStates: ['TN'] },
  vault: {
    has_any: true,
    identity: { legal_name: 'Example Staffing Co', certifications: ['WOSB'], contract_vehicles: ['GSA MAS'] },
    past_performance: [{ agency: 'Department of Veterans Affairs', contract_value: '$1,500,000', role: 'Prime', naics_codes: ['561320'] }],
  },
});

const open = (over: Record<string, unknown> = {}) => ({
  horizon: 'open_now', title: 'Laboratory Staffing Services', buyer: 'Department of Veterans Affairs', naics_code: '561320',
  response_deadline: days(30), relevant_date: days(30).slice(0, 10), relevant_date_label: 'Responses due',
  place_of_performance_state: 'TN', set_aside_description: 'Total Small Business', set_aside_code: 'SBA', value_label: null, ...over,
});

function run(horizons: Record<string, unknown>): RecipeRun {
  return {
    recipe: 'where_to_start', status: 'ran',
    steps: [
      { id: 'open', tool: 'find_opportunities', wave: 0, outcome: { state: 'ok', value: { horizons } } },
      { id: 'expiring', tool: 'get_expiring_contracts', wave: 0, outcome: { state: 'unavailable', reason: 'timeout' } },
    ],
    results: { open: { state: 'ok', value: { horizons } }, expiring: { state: 'unavailable', reason: 'timeout' } },
  };
}

describe('profile adapters', () => {
  it('toFitProfile uses Vault certifications, never set-aside preferences; unknown stays absent', () => {
    const f = toFitProfile(PROFILE);
    expect(f.certifications).toEqual(['WOSB']);
    expect(f.certifications).not.toContain('SDVOSB');
    expect(f).toMatchObject({ naicsCodes: ['561320'], states: ['TN'], largestPastAward: 1_500_000, vehiclesHeld: ['GSA MAS'] });
    expect(f).not.toHaveProperty('smallUnder');
    expect(f).not.toHaveProperty('pscCodes');
  });

  it('toFitProfile leaves certifications absent (not []) when the profile does not know them', () => {
    expect(toFitProfile(buildCompanyProfile({ bidder: {}, vault: { has_any: false } }))).not.toHaveProperty('certifications');
  });

  it('toAskMindyProfile carries target agencies but no set-aside preferences', () => {
    const a = toAskMindyProfile(PROFILE);
    expect(a).toMatchObject({ companyName: 'Example Staffing Co', naicsCodes: ['561320'], agencies: ['Department of Veterans Affairs'] });
    expect(a).not.toHaveProperty('setAsides');
  });
});

describe('composeWhereToStart', () => {
  it('ranks by the shared scorer, keeps only show-band picks, and explains each', () => {
    const ctx = composeWhereToStart(run({
      open_now: { status: 'grounded', matched_count: 2, items: [open(), open({ title: 'Roof Repair', naics_code: '238160', place_of_performance_state: 'WA', buyer: 'Department of the Interior', set_aside_description: null, set_aside_code: null })] },
      coming_back: { status: 'empty', matched_count: 0, items: [] },
      coming_soon: { status: 'unavailable', matched_count: null, items: [] },
    }), PROFILE, { nowMs: NOW });
    expect(ctx.top_picks.map((p) => p.title)).toEqual(['Laboratory Staffing Services']);
    expect(ctx.top_picks[0]).toMatchObject({ horizon: 'open_now', route: 'prime', date_label: `Responses due: ${days(30).slice(0, 10)}` });
    expect(ctx.top_picks[0].why).toMatch(/^Matches your registered work codes/);
  });

  it('an unavailable horizon is reported as unavailable, never zero; a missing horizon too', () => {
    const ctx = composeWhereToStart(run({ open_now: { status: 'grounded', matched_count: 1, items: [open()] }, coming_soon: { status: 'unavailable', matched_count: null, items: [] } }), PROFILE, { nowMs: NOW });
    expect(ctx.horizons).toEqual([
      { horizon: 'open_now', status: 'grounded', matched_count: 1 },
      { horizon: 'coming_back', status: 'unavailable', matched_count: null },
      { horizon: 'coming_soon', status: 'unavailable', matched_count: null },
    ]);
  });

  it('a partial window carries its coverage note', () => {
    const ctx = composeWhereToStart(run({ open_now: { status: 'grounded', matched_count: 500, items: [open()] } }), PROFILE, { nowMs: NOW });
    expect(ctx.horizons[0].coverage_note).toMatch(/top 1 fetched of 500/);
  });

  it('caps top picks at five across horizons, best first', () => {
    const items = Array.from({ length: 8 }, (_, i) => open({ title: `Notice ${i}`, response_deadline: days(i < 4 ? 30 : 5) }));
    const ctx = composeWhereToStart(run({ open_now: { status: 'grounded', matched_count: 8, items } }), PROFILE, { nowMs: NOW });
    expect(ctx.top_picks).toHaveLength(MAX_TOP_PICKS);
    for (let i = 1; i < ctx.top_picks.length; i++) expect(ctx.top_picks[i - 1].score).toBeGreaterThanOrEqual(ctx.top_picks[i].score);
  });

  it('a subcontract-route pick says so first', () => {
    const ctx = composeWhereToStart(run({ open_now: { status: 'grounded', matched_count: 1, items: [open({ set_aside_description: 'HUBZone Set-Aside', set_aside_code: 'HZC' })] } }), PROFILE, { nowMs: NOW });
    // Company holds WOSB, not HUBZone: strong fit on everything else, so it is shown, but on the subcontract route.
    expect(ctx.top_picks).toHaveLength(1);
    expect(ctx.top_picks[0].route).toBe('subcontract');
    expect(ctx.top_picks[0].why).toMatch(/^Subcontract route: set aside for HUBZone, which you do not hold/);
  });

  it('lists what the recipe could not check, and profile gaps once', () => {
    const ctx = composeWhereToStart(run({ open_now: { status: 'grounded', matched_count: 1, items: [open()] } }), PROFILE, { nowMs: NOW });
    expect(ctx.not_checked).toEqual([{ step: 'expiring', state: 'unavailable', reason: 'timeout' }]);
    expect(ctx.profile_gaps.unknown).toContain('uei');
    expect(ctx.next_steps).toEqual([]);
  });

  it('value first: an empty profile still gets picks ranked on what is known, plus only the optional completion step', () => {
    const empty = buildCompanyProfile({ bidder: {}, vault: { has_any: false } });
    const ctx = composeWhereToStart(run({ open_now: { status: 'grounded', matched_count: 1, items: [open()] } }), empty, { nowMs: NOW, queryConcepts: ['staffing'] });
    expect(ctx.next_steps).toEqual(['Complete your company profile for better ranking']);
    expect(ctx.horizons[0].status).toBe('grounded');
  });

  it('a run that never reached find_opportunities reports every horizon unavailable', () => {
    const ctx = composeWhereToStart({ recipe: 'where_to_start', status: 'not_implemented' }, PROFILE, { nowMs: NOW });
    expect(ctx.top_picks).toEqual([]);
    expect(ctx.horizons.every((h) => h.status === 'unavailable')).toBe(true);
  });
});

describe('composeProfileSetup', () => {
  const ranRun = (results: Record<string, unknown>): RecipeRun => ({
    recipe: 'profile_setup', status: 'ran', steps: [], results: results as never,
  });
  const ENTITY = {
    registrationStatus: 'Active', registrationExpirationDate: '2027-03-01', daysUntilExpiration: 45,
    naicsList: [{ naicsCode: '561320' }], pscList: [], pointsOfContact: [{ name: 'A', title: 'B' }, { name: 'C' }],
  };
  const sbaMissing = { state: 'missing_tool', reason: 'SBA profile lookup', unknownFields: ['owner', 'sba_keywords'] };

  it('builds the checklist from the records: ok, missing, counts and renewal warning copied from SAM', () => {
    const items = composeProfileSetup(ranRun({
      sam: { state: 'ok', value: { entity: ENTITY, _meta: { lookup_status: 'found' } } },
      awards: { state: 'ok', value: {} }, keywords: { state: 'ok', value: {} }, sba_profile: sbaMissing,
    }));
    const by = Object.fromEntries(items.map((i) => [i.item, i]));
    expect(by.sam_registration).toEqual({ item: 'sam_registration', status: 'ok', detail: 'Active until 2027-03-01. Renew soon: 45 days left.' });
    expect(by.naics_codes.status).toBe('ok');
    expect(by.service_codes).toMatchObject({ status: 'missing' });
    expect(by.points_of_contact.detail).toBe('2 points of contact registered.');
    expect(by.sba_profile).toEqual({ item: 'sba_profile', status: 'unavailable', detail: 'SBA profile lookup is not available yet; unknown until then: owner, sba keywords.' });
    expect(by.website.status).toBe('unknown');
  });

  it('a failed SAM lookup is unavailable, never "unregistered"; dependent items are unknown', () => {
    const items = composeProfileSetup(ranRun({ sam: { state: 'unavailable', reason: 'timeout' }, awards: { state: 'skipped', reason: 'x' }, sba_profile: sbaMissing }));
    const by = Object.fromEntries(items.map((i) => [i.item, i]));
    expect(by.sam_registration.status).toBe('unavailable');
    expect(by.sam_registration.detail).toMatch(/not a finding that the company is unregistered/);
    expect(by.naics_codes.status).toBe('unknown');
    expect(by.past_performance.status).toBe('unknown');
  });

  it('a lookup_failed result is unavailable; not_found is missing; an inactive registration is missing', () => {
    const at = (v: unknown) => Object.fromEntries(composeProfileSetup(ranRun({ sam: { state: 'ok', value: v } })).map((i) => [i.item, i])).sam_registration.status;
    expect(at({ entity: null, _meta: { lookup_status: 'lookup_failed' } })).toBe('unavailable');
    expect(at({ entity: null, _meta: { lookup_status: 'not_found' } })).toBe('missing');
    expect(at({ entity: { ...ENTITY, registrationStatus: 'Expired' }, _meta: { lookup_status: 'found' } })).toBe('missing');
  });

  it('a failed award history is unavailable, not "no past performance"', () => {
    const by = Object.fromEntries(composeProfileSetup(ranRun({ sam: { state: 'skipped', reason: 'x' }, awards: { state: 'unavailable', reason: 'quota' } })).map((i) => [i.item, i]));
    expect(by.past_performance).toMatchObject({ status: 'unavailable' });
    expect(by.past_performance.detail).toMatch(/not a finding of no past performance/);
  });
});
