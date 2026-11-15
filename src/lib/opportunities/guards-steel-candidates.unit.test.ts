import { describe, it, expect } from 'vitest';
import { interpretMarket } from './market-interpretation';
import { openCodeWindowNaics, openCodeWindowPsc } from './open-relevance';

/** Guards/steel diagnosis candidates F1 + F3 (Agent 3, 2026-11-15). Development branch only; not on any tag. */
const STEEL_LONG = 'We are a construction contractor. We erect pre-engineered steel buildings and install and replace metal roofing systems, including standing seam roofs, wall panels and structural steel framing.';
const cap = (q: string) => interpretMarket(q, null).capability;

describe('F1 · NAICS code-recall sub-window for trade presets', () => {
  it('steel draws its own three 6-digit codes; product presets keep the PSC window only', () => {
    expect(openCodeWindowNaics(cap(STEEL_LONG)).sort()).toEqual(['238120', '238160', '332311']);
    expect(openCodeWindowNaics(cap('We supply industrial valves.'))).toEqual([]);
    expect(openCodeWindowPsc(cap('We supply industrial valves.'))).toEqual(['4810', '4820']);
  });
  it('literal text and quoted phrases get none', () => {
    expect(openCodeWindowNaics(cap('"industrial valves"'))).toEqual([]);
  });
});

describe('F3 · steel code-only DIRECT needs a trade object in the title', () => {
  it('gutter maintenance, a vault toilet, a shelter floor → RELATED; roofs and sheds stay DIRECT', async () => {
    const { labelOpenRow } = await import('./find-opportunities');
    const { buildDiscoveryPlan } = await import('@/lib/discovery/plan');
    const { MCP_POLICY } = await import('@/lib/discovery/policy');
    const plan = buildDiscoveryPlan({ query: STEEL_LONG }, MCP_POLICY, { today: '2026-11-15', fiscalYear: 2027 });
    const l = (title: string, naics: string, psc: string) => labelOpenRow({ title, naics_code: naics, psc_code: psc, description: '' }, plan, cap(STEEL_LONG), null).cls;
    expect(l('Gutter Maintenance', '238160', 'J056')).toBe('RELATED_MARKET_CANDIDATE');
    expect(l('GAOA Single Vault Toilet Coyote Meadows CTNF', '332311', '5410')).toBe('RELATED_MARKET_CANDIDATE');
    expect(l('54--FLOOR,PORTABLE SHELTER', '332311', '54')).toBe('RELATED_MARKET_CANDIDATE');
    expect(l('NY MONTEZUMA NWR MAIN SHOP ROOF', '238160', 'Z2EB')).toBe('DIRECT_MATCH');
    expect(l('Equipment Shed', '332311', '5410')).toBe('DIRECT_MATCH');
  });
  it('other trades are unaffected', async () => {
    const { labelOpenRow } = await import('./find-opportunities');
    const { buildDiscoveryPlan } = await import('@/lib/discovery/plan');
    const { MCP_POLICY } = await import('@/lib/discovery/policy');
    const q = 'We provide security guards.';
    const plan = buildDiscoveryPlan({ query: q }, MCP_POLICY, { today: '2026-11-15', fiscalYear: 2027 });
    expect(labelOpenRow({ title: 'PANDHA-26-P-0000 046239 Security Support Services', naics_code: '561612', psc_code: 'R430', description: '' }, plan, cap(q), null).cls).toBe('DIRECT_MATCH');
  });
});

describe('Steel wording rank (Eric 2026-11-15, dev only): RELATED with steel-building wording ranks above other RELATED, never DIRECT', () => {
  it('a 236220 job with "pre-engineered metal buildings" is RELATED at tier 1.05; the same job without it stays 1.1; other trades unaffected', async () => {
    const { labelOpenRow } = await import('./find-opportunities');
    const { buildDiscoveryPlan } = await import('@/lib/discovery/plan');
    const { MCP_POLICY } = await import('@/lib/discovery/policy');
    const plan = buildDiscoveryPlan({ query: STEEL_LONG }, MCP_POLICY, { today: '2026-11-15', fiscalYear: 2027 });
    const job = { title: 'F-15 Aerospace Ground Equipment (AGE) Facility', naics_code: '236220', psc_code: 'Y1JZ' };
    const up = labelOpenRow({ ...job, description: 'Construct two pre-engineered metal buildings with standing seam roofs and steel framing.' }, plan, cap(STEEL_LONG), null);
    expect(up.cls).toBe('RELATED_MARKET_CANDIDATE');
    expect(up.tier).toBeCloseTo(1.05);
    const plain = labelOpenRow({ ...job, description: 'Construct an equipment facility with steel framing and wall panels.' }, plan, cap(STEEL_LONG), null);
    expect(plain.tier).toBeGreaterThan(up.tier);
    const q = 'We maintain HVAC systems.';
    const hplan = buildDiscoveryPlan({ query: q }, MCP_POLICY, { today: '2026-11-15', fiscalYear: 2027 });
    const h = labelOpenRow({ title: 'Renovate building', naics_code: '236220', psc_code: 'Y1JZ', description: 'HVAC upgrades and a new standing seam metal roof.' }, hplan, cap(q), null);
    expect(h.tier).not.toBeCloseTo(1.05);
  });
});
