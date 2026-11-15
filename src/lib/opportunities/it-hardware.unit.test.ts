import { describe, it, expect } from 'vitest';
import { classifyOpenEvidence } from './evidence-classifier';
import { interpretCapability } from './market-interpretation';
import { buildDiscoveryPlan } from '@/lib/discovery/plan';
import { MCP_POLICY } from '@/lib/discovery/policy';

/**
 * RC3 IT hardware (Eric, 2026-11-14: "almost no relevant top-20"). Root cause: no preset fired, "IT" became the
 * information-technology concept (IT SERVICES were DIRECT), and the benchmark code floor 7A is software. Titles are real
 * open notices from the RC2/RC3 top-20.
 */
const CTX = { today: '2026-11-14', fiscalYear: 2027 };
const Q = 'We sell computer hardware and IT equipment.';
const v = (row: Record<string, unknown>, q = Q) =>
  classifyOpenEvidence({ title: '', description: '', ...row }, buildDiscoveryPlan({ query: q }, MCP_POLICY, CTX), interpretCapability(q), q);

describe('IT hardware interpretation', () => {
  it('retrieves the hardware-bearing IT product PSCs only (no 7A software, no D-series services)', () => {
    const cap = interpretCapability(Q);
    expect(cap.codePresets?.products).toEqual(['it_hardware']);
    expect(cap.related_market?.psc).toEqual(expect.arrayContaining(['7B22', '7E20', '7G21', '7K20']));
    for (const c of cap.related_market?.psc || []) expect(c).not.toMatch(/^(7A|7F|D)/);
  });
  it('item lists trigger it too; "IT services" does not', () => {
    expect(interpretCapability('We sell laptops, desktops and servers.').codePresets?.products).toContain('it_hardware');
    expect(interpretCapability('IT services').codePresets).toBeUndefined();
  });
});

describe('DIRECT = a hardware item, filed as an IT product', () => {
  it('DLA and commercial hardware items are DIRECT', () => {
    expect(v({ title: 'COMPUTER,TABLET', psc_code: '7B22' }).cls).toBe('DIRECT_MATCH');
    expect(v({ title: 'Dell Latitude 5430 Rugged Laptops', psc_code: '7E20' }).cls).toBe('DIRECT_MATCH');
    expect(v({ title: 'KEYBOARD,DATA ENTRY', psc_code: '7E20' }).cls).toBe('DIRECT_MATCH');
  });
  it('avionics / instrument "computers" and "monitors" are not DIRECT (kept, RELATED or lower)', () => {
    expect(v({ title: '66--COMPUTER,FLIGHT CON', psc_code: '6615' }).cls).not.toBe('DIRECT_MATCH');
    expect(v({ title: 'COMPUTER,AIR DATA; F-16', psc_code: '6610' }).cls).not.toBe('DIRECT_MATCH');
    expect(v({ title: '61--ELEC POWER MONITOR', psc_code: '61' }).cls).not.toBe('DIRECT_MATCH');
  });
  it('software and IT services are not DIRECT on the word "IT"', () => {
    expect(v({ title: 'IT Solution for UIN', psc_code: '7A20' }).cls).not.toBe('DIRECT_MATCH');
    expect(v({ title: 'IT Support Services for the Regional Office', psc_code: 'DA01' }).cls).not.toBe('DIRECT_MATCH');
  });
  it('the strict rule is IT-hardware only: valve items outside 48xx keep their noun-slot DIRECT', () => {
    expect(v({ title: 'VALVE,FUEL SYSTEM', psc_code: '2915' }, 'We supply industrial valves.').cls).toBe('DIRECT_MATCH');
  });
});
