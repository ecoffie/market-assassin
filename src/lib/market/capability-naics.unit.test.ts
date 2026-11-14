import { describe, it, expect } from 'vitest';
import { CAPABILITY_LEXICON, interpretCapabilityNaics, capabilityPlannerNote } from './capability-naics';
import { getNaics } from '@/lib/codes/lookup';

describe('lexicon integrity', () => {
  it('every code is a real NAICS in Mindy\'s reference (never an invented code)', () => {
    for (const e of CAPABILITY_LEXICON) for (const c of e.naics) expect(getNaics(c)?.title, `${e.label} ${c}`).toBeTruthy();
  });
});

describe('interpretation', () => {
  const codes = (t: string) => interpretCapabilityNaics(t).codes;
  it('is deterministic: the same words always give the same codes', () => {
    const q = 'temporary staffing, clerical, admin and warehouse work';
    expect(codes(q)).toEqual(['561320', '561110', '493110']);
    expect(codes(q)).toEqual(codes(q));
  });
  it('covers ordinary language beyond any single test question', () => {
    expect(codes('janitorial and landscaping')).toEqual(['561720', '561730']);
    expect(codes('armed security guards')).toEqual(['561612']);
    expect(codes('HVAC maintenance and plumbing')).toEqual(['238220']);
    expect(codes('IT help desk support')).toEqual(['541513', '541519']);
    expect(codes('forklift operators')).toEqual(['493110']);
    expect(codes('translation services')).toEqual(['541930']);
    expect(codes('food service and catering')).toEqual(['722310', '722320']);
  });
  it('specific phrases win over generic ones', () => {
    expect(codes('medical staffing')).toEqual(['561320', '621399']);
    expect(interpretCapabilityNaics('medical staffing').items.map((i) => i.label)).toEqual(['medical staffing']);
  });
  it('does not read an agency name as a capability ("Corps of Engineers" is not engineering services)', () => {
    expect(codes('All USACE Corps of Engineers Memphis District awards')).toEqual([]);
    expect(codes('Navy ID card administration order in Millington')).toEqual([]);
  });
  it('leaves words it does not know unmapped (no guessing)', () => {
    expect(codes('quantum annealing widgets')).toEqual([]);
    expect(capabilityPlannerNote('quantum annealing widgets')).toBeNull();
  });
  it('reports codes the customer typed so they win', () => {
    expect(interpretCapabilityNaics('staffing under 561320 in TN').typedCodes).toEqual(['561320']);
  });
  it('planner note scopes lists to tools that accept them', () => {
    const n = capabilityPlannerNote('temporary staffing and warehouse work')!;
    expect(n).toMatch(/"561320,493110" in one call/);
    expect(n).toMatch(/call it once per code/);
    expect(n).toMatch(/561320 Temporary Help Services/);
  });
});

describe('acceptance run 1 fixes', () => {
  it('clerk and guard-service wording map to the right capability; Coast Guard and National Guard do not', () => {
    expect(interpretCapabilityNaics('APPOINTMENT CLERKS FORT CAMPBELL').codes).toEqual(['561110']);
    expect(interpretCapabilityNaics('FY26 TIS GUARD SERVICE QTR1').codes).toEqual(['561612']);
    expect(interpretCapabilityNaics('US Coast Guard services').codes).toEqual([]);
    expect(interpretCapabilityNaics('National Guard services').codes).toEqual([]);
  });
});
