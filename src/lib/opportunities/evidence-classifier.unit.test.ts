import { describe, it, expect } from 'vitest';
import { classifyOpenEvidence, titleHead, maskOrgNames } from './evidence-classifier';
import { interpretCapability } from './market-interpretation';
import { buildDiscoveryPlan } from '@/lib/discovery/plan';
import { MCP_POLICY } from '@/lib/discovery/policy';
import { labelOpenRow } from './find-opportunities';

/**
 * RC2 evidence-based classification (Eric approved 2026-11-14). One describe per rule. Titles are real open notices from
 * Agent 4's v6 blind top-20 review of RC1 (where every top-20 row was DIRECT).
 */
const CTX = { today: '2026-11-14', fiscalYear: 2027 };
const v = (q: string, row: Record<string, unknown>) =>
  classifyOpenEvidence({ title: '', description: '', ...row }, buildDiscoveryPlan({ query: q }, MCP_POLICY, CTX), interpretCapability(q), q);
const GUARDS = 'We provide security guards.';
const VALVES = 'We supply industrial valves.';
const AIRCRAFT = 'We supply aircraft parts and components.';

describe('the procured thing is the title head; agency and program names never count', () => {
  it('beneficiary / location clauses are cut, org names masked', () => {
    expect(titleHead('Food Services for the Marine Security Guard (MSG) Detachment')).toBe('Food Services');
    expect(maskOrgNames('U.S. Coast Guard (USCG) Nationwide Environmental Engineering', 'guards')).not.toMatch(/guard/i);
    expect(maskOrgNames('Coast Guard station repairs', 'coast guard')).toMatch(/Coast Guard/); // typed → never masked
  });
  it('guards: Coast Guard / MSG notices are not DIRECT; a guard-services title and the own code are', () => {
    expect(v(GUARDS, { title: 'Food Services for the Marine Security Guard (MSG) Detachment', psc_code: '7310' }).cls).not.toBe('DIRECT_MATCH');
    expect(v(GUARDS, { title: 'Purchase Thermostatic Switch for U.S. Coast Guard HC-144 Aircraft', psc_code: '5930' }).cls).not.toBe('DIRECT_MATCH');
    expect(v(GUARDS, { title: 'Transition Security Guard Services — CDC Facilities, Metro Atlanta', psc_code: 'S206' }).cls).toBe('DIRECT_MATCH');
    expect(v(GUARDS, { title: 'INSCOM G-2 Access Control and Security Escorts', naics_code: '561612' })).toEqual({ cls: 'DIRECT_MATCH', basis: 'own_trade_code' });
  });
});

describe('a trade search needs the trade, not its generic word', () => {
  it('janitorial: grease-trap / hull cleaning is RELATED, custodial is DIRECT', () => {
    const q = 'We clean commercial office buildings.';
    expect(v(q, { title: 'FCC FLORENCE QUARTERLY GREASE TRAP CLEANING', psc_code: 'H979' }).cls).toBe('RELATED_MARKET_CANDIDATE');
    expect(v(q, { title: 'Custodial Services for the 88th ABW', psc_code: 'S201' }).cls).toBe('DIRECT_MATCH');
  });
});

describe('products: an item, in a product notice, in the item code or noun slot', () => {
  it('valve items are DIRECT; a code-only row is RELATED; a construction title is not DIRECT', () => {
    expect(v(VALVES, { title: '48--VALVE,CHECK', psc_code: '4820' })).toEqual({ cls: 'DIRECT_MATCH', basis: 'title_item' });
    expect(v(VALVES, { title: '48--ACTUATOR,HYDRAULIC-- AND SIMILAR REPLACEMENT PARTS', psc_code: '4810' }).basis).toBe('product_code_only');
    expect(v('We supply electrical and electronic components.', { title: 'Electrical Upgrades to Support Future Three-Phase Power Supply', psc_code: 'Y1PZ' }).cls).not.toBe('DIRECT_MATCH');
  });
  it('"aircraft" as a modifier outside the item codes is not DIRECT ("17--TOWBAR,AIRCRAFT", FSC 1730)', () => {
    expect(v(AIRCRAFT, { title: '17--TOWBAR,AIRCRAFT', psc_code: '1730' }).cls).not.toBe('DIRECT_MATCH');
    expect(v(AIRCRAFT, { title: '15--DOOR,AIRCRAFT', psc_code: '1560' }).cls).toBe('DIRECT_MATCH');
  });
  it('boilerplate in a DLA item description is NOT RELEVANT (NAVSUP "Hull, Mechanical and Electrical (HM&E) testing")', () => {
    const r = v('We supply electrical and electronic components.', {
      title: '53--HELICAL SPRING', psc_code: '5360',
      description: 'A statement for any Hull, Mechanical and Electrical (HM&E) testing required that include the name of the test.',
    });
    expect(r).toEqual({ cls: 'WEAK_NON_MARKET', basis: 'boilerplate_only' });
  });
});

describe('a parts-only seller is not a repair contractor', () => {
  it('repair in the title, in the requirement text, or a J/K service code → NOT RELEVANT', () => {
    expect(v(AIRCRAFT, { title: '16--WHEEL HALF,AIRCRAFT, IN REPAIR/MODIFICATION OF', psc_code: '1630' }).basis).toBe('repair_notice_for_parts');
    expect(v(AIRCRAFT, { title: 'SLAT,AIRCRAFT', psc_code: '1560', description: 'Articles to be furnished hereunder shall be repaired, tested and inspected.' }).basis).toBe('repair_notice_for_parts');
    expect(v(VALVES, { title: 'J048--Valve overhaul', psc_code: 'J048' }).basis).toBe('repair_notice_for_parts');
  });
  it('a business that says it repairs is evaluated normally', () => {
    expect(v('We repair and overhaul aircraft components.', { title: '16--WHEEL HALF,AIRCRAFT, IN REPAIR/MODIFICATION OF', psc_code: '1630' }).basis).not.toBe('repair_notice_for_parts');
  });
});

describe('pharmaceuticals only when the customer sells them', () => {
  it('generic medical supplies never reach FSC 6505; "we distribute pharmaceuticals" does', () => {
    expect(interpretCapability('We supply medical, dental and laboratory supplies.').related_market?.psc).not.toContain('6505');
    expect(interpretCapability('We distribute pharmaceuticals and medical supplies.').related_market?.psc).toContain('6505');
    expect(interpretCapability('drug testing services').related_market?.psc ?? []).not.toContain('6505');
  });
});

describe('labels never drop a row; only order changes', () => {
  it('NOT RELEVANT rows are still labelled (tier last) with a reason', () => {
    const q = 'We supply industrial valves.';
    const l = labelOpenRow({ title: 'J048--Valve overhaul', psc_code: 'J048', description: '' }, buildDiscoveryPlan({ query: q }, MCP_POLICY, CTX), interpretCapability(q), null);
    expect(l.cls).toBe('WEAK_NON_MARKET');
    expect(l.basis[0]).toBe('repair_notice_for_parts');
  });
});
