import { describe, it, expect } from 'vitest';
import { interpretCapability } from './market-interpretation';
import { openRetrievalPsc } from './open-relevance';
import { labelOpenRow } from './find-opportunities';
import { buildDiscoveryPlan } from '@/lib/discovery/plan';
import { MCP_POLICY } from '@/lib/discovery/policy';

/**
 * Nursing short retrieval (Agent 4 v7, 2026-11-15: "We provide nurses and medical staffing." retrieved 10 of 23 relevant;
 * 11 of the 13 misses are clinical services under Q201/Q403/Q501/Q511/Q518/Q519/Q701). Titles are the real misses.
 */
const SHORT = 'We provide nurses and medical staffing.';
const CTX = { today: '2026-11-15', fiscalYear: 2027 };
const label = (title: string, psc: string) => labelOpenRow({ title, psc_code: psc, description: '' }, buildDiscoveryPlan({ query: SHORT }, MCP_POLICY, CTX), interpretCapability(SHORT), null);

describe('nurse staffing: adjacent clinical-service codes retrieve as RELATED, never DIRECT', () => {
  it('the related family is retrieved; Q401 stays the only direct code', () => {
    const cap = interpretCapability(SHORT);
    expect(cap.direct.psc).toEqual(['Q401']);
    expect(openRetrievalPsc(cap)).toEqual(expect.arrayContaining(['Q401', 'Q501', 'Q518', 'Q701']));
    expect(openRetrievalPsc(cap)).not.toContain('Q201');
    expect(label('Occupational Therapy Services', 'Q518').cls).toBe('RELATED_MARKET_CANDIDATE');
  });
  it('a locum staffing title is item evidence (DIRECT), like "medical staffing"', () => {
    expect(label('Q501--Locum - Anesthesiology Physician Services', 'Q501').cls).toBe('DIRECT_MATCH');
  });
  it('other trades keep NO related family (guards, janitorial)', () => {
    expect(interpretCapability('We provide security guards.').related_market).toBeNull();
    expect(interpretCapability('We clean commercial office buildings.').related_market).toBeNull();
  });
});

describe('the RELATED reason fits the code type', () => {
  it('a service code talks about adjacent work, a product code about the item', async () => {
    const { productCodeWhy } = await import('./match-evidence');
    expect(productCodeWhy('nurse staffing', { psc_code: 'Q201' })).toMatch(/service code Q201/);
    expect(productCodeWhy('nurse staffing', { psc_code: 'Q201' })).not.toMatch(/item/);
    expect(productCodeWhy('industrial valves', { psc_code: '4820' })).toMatch(/does not name the item/);
  });
});
