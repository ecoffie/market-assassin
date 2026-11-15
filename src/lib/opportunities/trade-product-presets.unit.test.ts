import { describe, it, expect } from 'vitest';
import { interpretCapability, TRADE_PRESETS, PRODUCT_PRESETS } from './market-interpretation';
import { openRetrievalNaics, openRetrievalPsc, classifyOpenRecord } from './open-relevance';
import { buildDiscoveryPlan } from '@/lib/discovery/plan';
import { MCP_POLICY } from '@/lib/discovery/policy';
import { productIdentifier, matchesText } from '@/lib/discovery/matcher';
import { labelOpenRow } from './find-opportunities';

/**
 * Trade + product retrieval (Agent 3, 2026-11-14; Eric approved the phase). Agent 4's v4 benchmark: 0 of 14 phrasings
 * reached a code; 9 of 13 guard-coded notices never say "guard"; DLA titles name the item, not the category.
 * Record texts are real open-notice titles. One describe per rule.
 */
const CTX = { today: '2026-11-14', fiscalYear: 2027 };
const plan = (q: string) => buildDiscoveryPlan({ query: q }, MCP_POLICY, CTX);
const row = (o: Record<string, unknown>) => ({ title: '', description: '', department: 'DEPT OF DEFENSE', sub_tier: '', solicitation_number: 'X1', response_deadline: '2026-12-01', ...o });

describe('services: the trade\'s OWN codes, no related family', () => {
  it('guards: 561612 / S206, even though "guard services" is a physical-security phrase (keeps the not-cyber note)', () => {
    const cap = interpretCapability('We provide security guards.');
    expect(cap.direct.naics).toEqual(['561612']);
    expect(cap.direct.psc).toEqual(['S206']);
    expect(cap.related_market).toBeNull();
    const g = interpretCapability('guard services');
    expect(g.direct.naics).toEqual(['561612']);
    expect(g.excluded.some((e) => /physical security/.test(e.phrase))).toBe(true);
  });
  it('a protective-officer notice that never says "guard" is retrieved and DIRECT by its own code', () => {
    const p = plan('We provide security guards.');
    const cap = interpretCapability('We provide security guards.');
    const r = row({ title: 'Protective Security Officer Services, Los Angeles Area', naics_code: '561612', psc_code: 'S206' });
    expect(openRetrievalNaics(cap)).toContain('561612');
    expect(labelOpenRow(r, p, cap, null).cls).toBe('DIRECT_MATCH');
  });
  it('plain cleaning phrasing bridges to janitorial (561720 / S201) with no related family', () => {
    const cap = interpretCapability('We clean commercial office buildings.');
    expect(cap.direct.naics).toEqual(['561720']);
    expect(cap.direct.vocab).toEqual(expect.arrayContaining(['janitorial', 'custodial']));
    expect(cap.related_market).toBeNull();
  });
  it('existing janitorial/custodial interpretation is untouched (PHRASE_PRESET still claims it first)', () => {
    const cap = interpretCapability('janitorial services');
    expect(cap.direct.source).toBe('Facilities & Maintenance');
    expect(cap.direct.vocab).toBeUndefined();
  });
  it('grounds and HVAC', () => {
    expect(interpretCapability('We do landscaping and grounds maintenance.').direct.naics).toEqual(['561730']);
    expect(interpretCapability('We maintain HVAC systems.').direct.psc).toEqual(['J041']);
  });
});

describe('products: specific FSC codes retrieve; only item evidence makes DIRECT', () => {
  it('valves: 4810/4820 retrieve; no 2-digit group, no NAICS', () => {
    const cap = interpretCapability('We supply industrial valves.');
    expect(cap.related_market?.psc).toEqual(['4810', '4820']);
    expect(cap.direct.psc).toEqual([]);
    expect(openRetrievalPsc(cap)).toEqual(expect.arrayContaining(['4810', '4820']));
    for (const p of PRODUCT_PRESETS) for (const c of p.psc) expect(c).toMatch(/^[0-9][0-9A-Z][0-9]{2}$/); // specific 4-char PSC (IT: 7B22), never a 2-char group
    for (const t of TRADE_PRESETS) for (const c of t.naics) expect(c).toMatch(/^\d{6}$/);
  });
  it('a code-only row is RELATED (basis product_code), never DIRECT', () => {
    const q = 'We supply industrial valves.';
    const cap = interpretCapability(q);
    const r = row({ title: '48--ACTUATOR,HYDRAULIC-- AND SIMILAR REPLACEMENT PARTS', psc_code: '4810' });
    expect(classifyOpenRecord(r, cap)).toBe('RELATED_MARKET_CANDIDATE');
    const l = labelOpenRow(r, plan(q), cap, null);
    expect(l.cls).toBe('RELATED_MARKET_CANDIDATE');
    expect(l.basis).toContain('product_code');
  });
  it('the DLA abbreviation in the title is item evidence: "BUTTERFLY VLV 3.00" is retrieved', () => {
    const cap = interpretCapability('We supply industrial valves.');
    expect(cap.direct.vocab).toContain('vlv');
    expect(cap.direct.vocabCols).toEqual(['title']);
  });
  it('a typed exact phrase never reaches a preset (literal request)', () => {
    expect(interpretCapability('"security guards"').direct.vocab).toBeUndefined();
    expect(interpretCapability('"industrial valves"').related_market).toBeNull();
  });
  it('the customer\'s own text predicate is still present (presets only add)', () => {
    const p = plan('We supply industrial valves.');
    expect(p.matcher.mode).toBe('lexical');
    expect(p.matcher.alternatives[0].eligible.map((c) => c.label)).toEqual(['valves']);
  });
});

describe('NSN and part numbers are one identifier', () => {
  it('"4820-01-249-1348" is not NAICS 4820 + 5678; it matches every separator form in real titles', () => {
    for (const q of ['4820-01-249-1348', 'NSN 4820-01-249-1348', '4820012491348', 'NSN: 4820-012491348']) {
      const p = plan(q);
      expect(p.naics).toEqual([]);
      expect(p.matcher.mode).toBe('code');
      expect(matchesText(p.matcher, ['VALVE, RELIEF, PRESSURE AND TEMPERATURE - NSN 4820-01-249-1348'])).toBe(true);
      expect(matchesText(p.matcher, ['4820012491348 - Valve'])).toBe(true);
      expect(matchesText(p.matcher, ['NSN: 4820-012491348, Valve'])).toBe(true);
      expect(matchesText(p.matcher, ['NSN 4820-01-249-1349'])).toBe(false);
    }
  });
  it('part numbers with a label; bare NAICS / PSC codes unchanged', () => {
    expect(productIdentifier('P/N 12345-678')).toEqual({ kind: 'part_number', token: '12345-678' });
    expect(productIdentifier('MS27183-10')?.kind).toBe('part_number');
    expect(plan('541512').naics).toEqual(['541512']);
    expect(plan('S206').psc).toEqual(['S206']);
    expect(productIdentifier('janitorial services')).toBeNull();
  });
});
