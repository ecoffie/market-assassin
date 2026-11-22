/**
 * Map set-aside split (2026-11-22): veteran-owned VSA/VSS/VSB get their own `VOSB` group, true SDVOSB
 * codes get `SDVOSB_ONLY` — and the bare legacy key `'SDVOSB'` (stored unversioned in
 * saved_searches.filters, anon watches, localStorage and `?setAside=` links) keeps returning EXACTLY
 * the code list it always did. Never silently change what an existing saved search returns.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseMapFilters, applyMapFilters } from './map-filters';
import {
  SET_GROUPS, LEGACY_SET_ALIASES, LEGACY_SDVOSB_FILTER_CODES, setAsideFilterCodes, setGroupKey,
  mapSetAside, SET_LABEL, SET_COLOR, companySetAsideBuckets,
} from './map-data';
import { mapsRecompeteRequest, recompeteSetAsideValue } from '@/lib/recompete/maps-recompete-discovery';
import { setAsideToUsaspendingCodes } from '@/mcp/tools/market-report';
import { extractSowCardFacts } from './sow-card-facts';

function stubQuery() {
  const calls: { method: string; arg: string }[] = [];
  const q: Record<string, (...a: unknown[]) => unknown> = {};
  const chain = (method: string) => (...a: unknown[]) => { calls.push({ method, arg: String(a[0] ?? '') }); return q; };
  for (const m of ['or', 'in', 'eq', 'gt', 'lt', 'lte', 'gte', 'not', 'neq', 'ilike', 'imatch', 'select', 'order', 'limit', 'is']) q[m] = chain(m);
  return { q, calls };
}
const saExpr = (params: Record<string, string>) => {
  const { q, calls } = stubQuery();
  applyMapFilters(q, parseMapFilters((k) => params[k] ?? null));
  return calls.find((c) => c.method === 'or' && c.arg.includes('set_aside_code'))?.arg;
};
const LEGACY_EXPR = 'set_aside_code.in.(SDVOSBC,SDVOSBS,VSA,VSB,SDVOSB)';

describe('legacy SDVOSB filter key — frozen, byte-identical to the pre-split expansion', () => {
  it('the frozen list is exactly the old SET_GROUPS SDVOSB codes', () => {
    expect([...LEGACY_SDVOSB_FILTER_CODES]).toEqual(['SDVOSBC', 'SDVOSBS', 'VSA', 'VSB', 'SDVOSB']);
    expect(setAsideFilterCodes('SDVOSB')).toEqual(['SDVOSBC', 'SDVOSBS', 'VSA', 'VSB', 'SDVOSB']);
  });
  it('via setAside (saved-search filters JSON / ?setAside=SDVOSB URL)', () => {
    expect(saExpr({ setAside: 'SDVOSB' })).toBe(LEGACY_EXPR);
    const url = new URLSearchParams('setAside=SDVOSB&status=active');
    const { q, calls } = stubQuery();
    applyMapFilters(q, parseMapFilters((k) => url.get(k)));
    expect(calls.find((c) => c.method === 'or' && c.arg.includes('set_aside_code'))?.arg).toBe(LEGACY_EXPR);
  });
  it('via setAsideMulti (the client merges setAside+setAsideMulti into one ?setAside= list)', () => {
    expect(saExpr({ setAside: 'SDVOSB,SB' })).toBe('set_aside_code.in.(SDVOSBC,SDVOSBS,VSA,VSB,SDVOSB,SBA,SBP,SB)');
  });
  it('is no longer offered as a checkbox, and aliases to both replacement boxes', () => {
    expect(SET_GROUPS.some((g) => g.key === 'SDVOSB')).toBe(false);
    expect(LEGACY_SET_ALIASES).toEqual({ SDVOSB: ['SDVOSB_ONLY', 'VOSB'] });
  });
});

describe('new keys', () => {
  it('VOSB → VSA,VSS,VSB (VSS was in no list before)', () => {
    expect(saExpr({ setAside: 'VOSB' })).toBe('set_aside_code.in.(VSA,VSS,VSB)');
  });
  it('SDVOSB_ONLY excludes every veteran-owned code', () => {
    const e = saExpr({ setAside: 'SDVOSB_ONLY' })!;
    expect(e).toBe('set_aside_code.in.(SDVOSBC,SDVOSBS,SDVOSB)');
    for (const c of ['VSA', 'VSB', 'VSS']) expect(e).not.toContain(c);
  });
  it('lookup stays case-sensitive — a stored lowercase key keeps its old meaning (raw code)', () => {
    expect(setAsideFilterCodes('sdvosb')).toBeNull();
    expect(saExpr({ setAside: 'sdvosb' })).toBe('set_aside_code.in.(sdvosb)');
  });
});

describe('pin display bucket', () => {
  it('VSA/VSS/VSB pins are VOSB; true SDVOSB codes stay SDVOSB', () => {
    for (const c of ['VSA', 'VSS', 'VSB']) {
      expect(setGroupKey(c)).toBe('VOSB');
      expect(mapSetAside(c)).toEqual({ key: 'VOSB', open: false });
    }
    for (const c of ['SDVOSBC', 'SDVOSBS', 'SDVOSB']) expect(setGroupKey(c)).toBe('SDVOSB');
    expect(mapSetAside('Veteran-Owned Small Business Set-Aside').key).toBe('VOSB');
  });
  it('both buckets have a label + color (never fall through to None)', () => {
    expect(SET_LABEL.SDVOSB).toBe('SDVOSB');
    expect(SET_LABEL.VOSB).toBe('VOSB (veteran-owned)');
    expect(SET_COLOR.VOSB).toBeTruthy();
    expect(SET_COLOR.VOSB).not.toBe(SET_COLOR.SDVOSB);
  });
});

describe('translations — new keys never silently match nothing', () => {
  it('contacts-map (Players BigQuery buckets)', () => {
    expect(companySetAsideBuckets('SDVOSB_ONLY')).toEqual({ buckets: 'SDVOSB', unsupported: [] });
    expect(companySetAsideBuckets('SDVOSB')).toEqual({ buckets: 'SDVOSB', unsupported: [] });
    expect(companySetAsideBuckets('VOSB')).toEqual({ buckets: '', unsupported: ['VOSB'] });
    expect(companySetAsideBuckets('SB,VOSB')).toEqual({ buckets: 'SB', unsupported: ['VOSB'] });
    const src = readFileSync(join(__dirname, '../../app/api/app/contacts-map/route.ts'), 'utf8');
    expect(src).toContain('companySetAsideBuckets(');
    expect(src).toMatch(/setAsideNote && !setAside\)[\s\S]{0,200}notApplicable: setAsideNote/);
  });
  it('recompete discovery (set_aside_type) — translation only, legacy unchanged', () => {
    expect(recompeteSetAsideValue('SDVOSB_ONLY')).toBe('SDVOSB');
    expect(recompeteSetAsideValue('VOSB')).toBe('VOSB');
    expect(recompeteSetAsideValue('SDVOSB')).toBe('SDVOSB');
    expect(recompeteSetAsideValue('SB')).toBe('SB');
    const ctx = { today: '2026-11-22', fiscalYear: 2027 };
    expect(mapsRecompeteRequest((k) => (k === 'setAside' ? 'SDVOSB_ONLY' : null), { ctx }).surface.setAside).toBe('SDVOSB');
    expect(mapsRecompeteRequest((k) => (k === 'setAside' ? 'SDVOSB' : null), { ctx }).surface.setAside).toBe('SDVOSB');
  });
  it('market report (USASpending codes)', () => {
    expect(setAsideToUsaspendingCodes('SDVOSB_ONLY')).toEqual(['SDVOSBC', 'SDVOSBS']);
    expect(setAsideToUsaspendingCodes('VOSB')).toEqual(['VSA', 'VSS']);
    expect(setAsideToUsaspendingCodes('SDVOSB')).toEqual(['SDVOSBC', 'SDVOSBS']);
  });
});

describe('SOW card facts — text VOSB is the VOSB family', () => {
  it('text VOSB vs structured VSA is not a mismatch; vs SDVOSBC it is', async () => {
    const text = 'This acquisition is a Veteran-Owned Small Business set aside under 38 U.S.C. 8127.';
    const vsa = await extractSowCardFacts(text, 'VSA', { useLLMFallback: false });
    expect(vsa.setAsideFromText).toBe('VOSB');
    expect(vsa.setAsideMismatch).toBe(false);
    const sd = await extractSowCardFacts(text, 'SDVOSBC', { useLLMFallback: false });
    expect(sd.setAsideMismatch).toBe(true);
  });
});

describe('map client wiring (source)', () => {
  const route = readFileSync(join(__dirname, '../../app/opportunity-map/route.ts'), 'utf8');
  const tpl = readFileSync(join(__dirname, '../../app/opportunity-map/template.html'), 'utf8');
  it('every client set map knows VOSB', () => {
    expect(route).toMatch(/const SET_TO_EVC[^}]*VOSB: 'VOSB'/);
    expect(route).toMatch(/var SETMAP=\{[^}]*VOSB:'VOSB'/);
    expect(tpl).toMatch(/\{key:"VOSB",label:"VOSB \(veteran-owned\)"[^}]*s==="VOSB"/);
    expect(tpl).toMatch(/\{key:"SDVOSB",label:"SDVOSB",col:"--grnd",match:s=>s==="SDVOSB"\}/);
  });
  it('plain-English sdvosb/vosb map to the canonical keys where they are appended', () => {
    expect(route).toContain("var _saCanon={sdvosb:'SDVOSB_ONLY',vosb:'VOSB'};");
  });
  it('restore ticks the alias boxes and keeps the original legacy token until a box changes', () => {
    expect(route).toContain("window.__SET_ALIASES=' + JSON.stringify(LEGACY_SET_ALIASES)");
    expect(route).toContain('window.__saLegacy={ setAside:FILT.setAside, setAsideMulti:FILT.setAsideMulti');
    expect(route).toContain("else { FILT.setAside=''; window.__saLegacy=null; }");
  });
});
