import { describe, it, expect } from 'vitest';
import { interpretCapability } from './market-interpretation';
import { labelOpenRow } from './find-opportunities';
import { buildDiscoveryPlan } from '@/lib/discovery/plan';
import { MCP_POLICY } from '@/lib/discovery/policy';

/** Parts short + steel long (Agent 4 v7, 2026-11-15: parts short 7-9/20, steel long 6-7/20). Real notice titles. */
const CTX = { today: '2026-11-15', fiscalYear: 2027 };
const PARTS = 'We supply industrial and defense replacement parts.';
const STEEL_LONG = 'We are a construction contractor. We erect pre-engineered steel buildings and install and replace metal roofing systems, including standing seam roofs, wall panels and structural steel framing.';
const label = (q: string, title: string, psc: string | null, description = '') =>
  labelOpenRow({ title, psc_code: psc, description }, buildDiscoveryPlan({ query: q }, MCP_POLICY, CTX), interpretCapability(q), null);

describe('S1: a named trade wins over the bare word "construction"', () => {
  it('steel long reaches the steel-buildings trade (own codes 238120 / 238160 / 332311), not NAICS 236/237/238', () => {
    const cap = interpretCapability(STEEL_LONG);
    expect(cap.codePresets?.trades).toContain('steel_buildings_roofing');
    expect(cap.direct.naics).toEqual(expect.arrayContaining(['238160']));
    expect(cap.direct.naics).not.toContain('236');
  });
  it('a construction sentence with no named trade keeps the Construction preset', () => {
    expect(interpretCapability('We are a general construction company.').direct.source).toBe('Construction');
  });
});

describe('P1: a literal parts supplier is not a repair contractor', () => {
  it('"This RFQ is for repair." → NOT RELEVANT; a plain parts buy is evaluated normally', () => {
    expect(label(PARTS, '43--PUMP,CENTRIFUGAL - AND SIMILAR REPLACEMENT PARTS', '4320', 'All freight is FOB Origin. This RFQ is for repair.').basis[0]).toBe('repair_notice_for_parts');
    expect(label(PARTS, '53--KNOB - AND OTHER REPLACEMENT PARTS', '5355', 'Quantity 10 each.').cls).toBe('DIRECT_MATCH');
  });
  it('a business that repairs is evaluated normally', () => {
    expect(label('We supply and repair industrial replacement parts.', '43--PUMP,CENTRIFUGAL - AND SIMILAR REPLACEMENT PARTS', '4320', 'This RFQ is for repair.').basis[0]).not.toBe('repair_notice_for_parts');
  });
});

describe('P2: a supplier\'s words only in a service / construction notice\'s requirement text are NOT RELEVANT', () => {
  it('construction and service notices that mention "replacement parts" in their text', () => {
    for (const [t, psc] of [['Eddyville Quarters Window Replacement', 'Z1FA'], ['Hydrant Repair/Replacement, Midewin National Tallgrass Prairie', 'Z2PZ'], ['Wire Rope Replacement Services at PSNS', 'J040']] as const) {
      const l = label(PARTS, t, psc, 'Contractor shall furnish all replacement parts and labor.');
      expect(l.cls, t).toBe('WEAK_NON_MARKET');
      // "Repair/Replacement" in a title is caught first by the repair rule — NOT RELEVANT either way.
      expect(['service_notice_for_supplier', 'repair_notice_for_parts']).toContain(l.basis[0]);
    }
  });
  it('a product notice with the words in its text stays RELATED; a missing code is not evidence against', () => {
    expect(label(PARTS, 'Replacement Hydraulic Accumulator Bank & Panel', '4320', 'Furnish replacement parts per drawing.').cls).toBe('RELATED_MARKET_CANDIDATE');
    expect(label(PARTS, 'Market Survey', null, 'Furnish replacement parts.').cls).toBe('RELATED_MARKET_CANDIDATE');
  });
  it('a service business is untouched ("we provide" is not a supplier)', () => {
    expect(label('We provide replacement parts installation services.', 'Window Replacement', 'Z1FA', 'replacement parts').basis[0]).not.toBe('service_notice_for_supplier');
  });
});
