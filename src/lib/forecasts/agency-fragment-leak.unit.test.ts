/**
 * #1666 — a generic comma fragment ("DEPARTMENT", "DEPARTMENT OF", "THE") must never become an
 * agency needle (2026-09-23).
 *
 * The resolver used to split EVERY name on commas before resolving it. "STATE, DEPARTMENT" became
 * STATE + "DEPARTMENT", and the unresolved "DEPARTMENT" went to the text fallback
 * `department.imatch.\mDEPARTMENT\M`, which matches every "Department of …" row: measured 7,196
 * forecasts from Interior/Agriculture/VA/Transportation/Labor/Navy for State (which holds 0), and the
 * same leak for every SAM-style "X, DEPARTMENT OF" name (HHS 12,702 vs 5,506 real).
 */
import { describe, it, expect } from 'vitest';
import { resolveForecastAgencies, forecastAgencyOrExpr } from './agency-identity';
import { buildDiscoveryPlan, MCP_POLICY, type PlanContext } from '@/lib/discovery';

const CTX: PlanContext = { today: '2026-09-23', fiscalYear: 2026 };
const r = (s: string) => resolveForecastAgencies(s);
/** No generic-only word may reach a text-fallback clause. */
const GENERIC_CLAUSE = /imatch\.\\m(?:DEPARTMENT|DEPARTMENTS|DEPT|OF|THE|AND|FOR|BUREAU|OFFICE|AGENCY|ADMINISTRATION)(?:\[\^a-zA-Z0-9\]\+(?:DEPARTMENT|OF|THE|AND))*\\M/i;

describe('SAM-style "X, DEPARTMENT OF" resolves to X and nothing else', () => {
  it.each([
    ['STATE, DEPARTMENT', ['STATE']],
    ['STATE, DEPARTMENT OF', ['STATE']],
    ['HEALTH AND HUMAN SERVICES, DEPARTMENT OF', ['HHS']],
    ['VETERANS AFFAIRS, DEPARTMENT OF', ['VA']],
    ['INTERIOR, DEPARTMENT OF THE', ['DOI']],
    ['TREASURY, DEPARTMENT OF THE', ['Treasury']],
    ['ENERGY, DEPARTMENT OF', ['DOE']],
  ])('%s → codes %j, no fallback needle', (name, codes) => {
    const res = r(name);
    expect(res.codes).toEqual(codes);
    expect(res.unresolved).toEqual([]);
    expect(forecastAgencyOrExpr(res)).toBe(`source_agency.in.(${codes.join(',')})`);
  });

  it.each([
    ['COMMERCE, DEPARTMENT OF', ['COMMERCE']],
    ['EDUCATION, DEPARTMENT OF', ['EDUCATION']],
    ['HOUSING AND URBAN DEVELOPMENT, DEPARTMENT OF', ['HOUSING AND URBAN DEVELOPMENT']],
    ['SENATE, THE', ['SENATE']],
  ])('unresolved %s keeps only its distinctive words — never "DEPARTMENT OF" / "THE"', (name, unresolved) => {
    const res = r(name);
    expect(res.codes).toEqual([]);
    expect(res.unresolved).toEqual(unresolved);
    expect(forecastAgencyOrExpr(res)).not.toMatch(GENERIC_CLAUSE);
  });

  it('a known identity written with commas resolves whole (ATF) instead of splitting into fragments', () => {
    const res = r('Bureau of Alcohol, Tobacco, Firearms and Explosives');
    expect(res.identities.map((i) => i.key)).toEqual(['ATF']);
    expect(res.unresolved).toEqual([]);
  });
});

describe('existing behaviour preserved', () => {
  it('MCP comma list still means distinct buyers ("NAVY,HHS")', () => {
    expect(r('NAVY,HHS').codes).toEqual(['NAVY', 'ONR', 'NRL', 'HHS']); // unchanged from before #1666 (NAVY rolls up to its labs)
  });
  it('a comma list with an unknown buyer keeps that buyer unresolved ("NAVY,NOAA")', () => {
    const res = r('NAVY,NOAA');
    expect(res.codes).toEqual(['NAVY', 'ONR', 'NRL']);
    expect(res.unresolved).toEqual(['NOAA']);
  });
  it('pipe multi-select, aliases and children unchanged', () => {
    expect(r('VA|DOJ').codes).toEqual(['VA', 'DOJ']);
    expect(r('DEFENSE').codes).toEqual(['NAVY', 'ONR', 'NRL', 'USACE']);
    expect(r('DEPARTMENT OF STATE').codes).toEqual(['STATE']);
    expect(r('NAVFAC').children.length).toBe(1);
  });
  it('no Maps agency preset produces a generic text-fallback clause', () => {
    for (const p of ['DEFENSE', 'VETERANS AFFAIRS', 'INTERIOR', 'HOMELAND SECURITY', 'AGRICULTURE', 'HEALTH AND HUMAN SERVICES', 'STATE, DEPARTMENT', 'JUSTICE', 'COMMERCE', 'NATIONAL AERONAUTICS', 'GENERAL SERVICES', 'ENERGY', 'TRANSPORTATION', 'LABOR', 'ENVIRONMENTAL PROTECTION', 'TREASURY']) {
      expect(forecastAgencyOrExpr(r(p)) || '', p).not.toMatch(GENERIC_CLAUSE);
    }
  });
});

describe('canonical coverage for State (acceptance B)', () => {
  it('"STATE, DEPARTMENT" is a covered publisher → coverage ok; its genuine 0 is a measured 0', () => {
    const f = buildDiscoveryPlan({ query: '', agency: 'STATE, DEPARTMENT' }, MCP_POLICY, CTX).horizons.forecast;
    expect(f.coverage).toBe('ok');
    expect(f.forecastFilters.agency).toBe('STATE, DEPARTMENT');
  });
  it('"COMMERCE, DEPARTMENT OF" stays unavailable (unresolved publisher), not a leak and not a 0', () => {
    const f = buildDiscoveryPlan({ query: '', agency: 'COMMERCE, DEPARTMENT OF' }, MCP_POLICY, CTX).horizons.forecast;
    expect(f.coverage).toBe('unestablished');
    expect(f.coverageGaps?.[0]).toMatchObject({ requested: 'COMMERCE, DEPARTMENT OF', reason: 'unresolved_publisher' });
  });
});
