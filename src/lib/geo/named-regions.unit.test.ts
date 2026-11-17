import { describe, it, expect } from 'vitest';
import { namedRegionsIn, regionForToken, resolveRegionStates } from './named-regions';
import { compileIntent, enforceIntent } from '@/lib/chat/intent-compiler';
import { resolveRegion } from '@/lib/opportunities/find-opportunities';

const NEW_ENGLAND = ['CT', 'ME', 'MA', 'NH', 'RI', 'VT'];
const NOW = new Date('2026-11-17T15:00:00Z');

describe('named regions → states (Agent 4 S3: "New England" was searched nationwide)', () => {
  it('"in New England" resolves to CT/ME/MA/NH/RI/VT', () => {
    expect(namedRegionsIn('I do structured cabling in New England. Where should I start?').map((r) => [...r.states])).toEqual([NEW_ENGLAND]);
  });
  it('several regions union; documented definitions', () => {
    const names = namedRegionsIn('midwest and gulf coast work').map((r) => r.name);
    expect(names).toEqual(['Gulf Coast', 'Midwest']);
    expect(namedRegionsIn('the DMV area')[0].states).toEqual(['DC', 'MD', 'VA']);
    expect(namedRegionsIn('Pacific Northwest')[0].states).toEqual(['WA', 'OR', 'ID']);
  });
  it('never a place or an organization name', () => {
    expect(namedRegionsIn('DMV license plate services')).toEqual([]);
    expect(namedRegionsIn('NAVFAC Mid-Atlantic contracts')).toEqual([]);
    expect(namedRegionsIn('janitorial in Southeast DC')).toEqual([]);
    expect(namedRegionsIn('Northeast Ohio HVAC')).toEqual([]);
    expect(namedRegionsIn('work in the southeast US')[0].name).toBe('Southeast');
  });
  it('whole tokens and mixed token lists', () => {
    expect(regionForToken('New England states')?.states).toEqual(NEW_ENGLAND);
    expect(regionForToken('Florida')).toBeNull();
    expect(resolveRegionStates(['New England', 'NY'])).toEqual([...NEW_ENGLAND, 'NY']);
  });
});

describe('the intent layer scopes FIND to a named region', () => {
  it('"in New England" → explicit states, added to find_opportunities.states with an honest note', () => {
    const intent = compileIntent('I do structured cabling in New England. Show me opportunities.', NOW);
    expect(intent.explicitStates).toEqual(NEW_ENGLAND);
    const r = enforceIntent('find_opportunities', JSON.stringify({ query: 'structured cabling' }), intent);
    const args = JSON.parse(r.args);
    expect(args.states).toEqual(NEW_ENGLAND);
    expect(r.applied.join(' ')).toContain('New England (CT, ME, MA, NH, RI, VT) from your request');
  });
  it('already covered (planner passed location "New England") → unchanged, no note', () => {
    const r = enforceIntent('find_opportunities', JSON.stringify({ query: 'cabling', location: 'New England' }), compileIntent('cabling in New England', NOW));
    expect(JSON.parse(r.args).states).toBeUndefined();
    expect(r.applied).toEqual([]);
  });
  it('no region named → FIND args untouched', () => {
    const r = enforceIntent('find_opportunities', JSON.stringify({ query: 'cabling' }), compileIntent('structured cabling opportunities', NOW));
    expect(JSON.parse(r.args)).toEqual({ query: 'cabling' });
  });
});

describe('FIND resolveRegion understands region names (MCP callers too)', () => {
  it('location "New England" is its six states, never "not a US state"', () => {
    expect(resolveRegion({ location: 'New England' })).toEqual({ requested: ['New England'], states: NEW_ENGLAND, unresolved: [] });
  });
  it('a real non-state place is still unresolved', () => {
    expect(resolveRegion({ location: 'Fort Bragg' })?.unresolved).toEqual(['Fort Bragg']);
  });
});
