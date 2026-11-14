import { describe, it, expect } from 'vitest';
import aliasData from '@/data/agency-aliases.json';
import { resolveBuyer, buyerMatches } from './buyer';

/**
 * C1 (Agent 3, 2026-11-14): a buyer's one-word identity set that is a word of its own longer name is
 * dropped, because it only ever admitted OTHER agencies (HHS "health" → Defense Health Agency).
 *
 * Measured live before the change (scratch evidence summarized in
 * tasks/search-accuracy-assessment-2026-11-14.md §C1): over the 67 buyers the rule touches, it removes
 * 298 active Open notices and 3,022 Recompete awards, and EVERY removed row belongs to a different
 * agency. Three would-be valid losses found by that measurement (ASPR's legacy office name, Rural
 * Housing Service under Rural Development, the FPAC Business Center that buys for NRCS) are covered by
 * explicit aliases instead of keeping the generic single word.
 *
 * The agency strings below are copied from live `sam_opportunities.department/sub_tier` and
 * `recompete_opportunities.awarding_agency/awarding_sub_agency` values.
 */

const match = (buyer: string, ...texts: string[]) => buyerMatches([resolveBuyer(buyer)], texts);

// The 20 agencies evaluated in the assessment, with their identity sets after C1.
const EXPECTED_20: Record<string, string[][]> = {
  HUD: [['hud'], ['housing', 'urban', 'development']],
  VA: [['va'], ['veterans', 'affairs'], ['vet']],
  SBA: [['sba'], ['small', 'business', 'administration'], ['small', 'business']],
  DOJ: [['doj'], ['justice']],
  USDA: [['usda'], ['agriculture'], ['ag']],
  DHS: [['dhs'], ['homeland', 'security']],
  DOE: [['doe'], ['energy']],
  Navy: [['navy'], ['usn']],
  Army: [['army'], ['usa']],
  GSA: [['gsa'], ['general', 'services', 'administration']],
  NASA: [['nasa'], ['national', 'aeronautics', 'space', 'administration']],
  EPA: [['epa'], ['environmental', 'protection', 'agency'], ['environment']],
  DOT: [['dot'], ['transportation']],
  Commerce: [['commerce'], ['doc']],
  Interior: [['interior'], ['doi']],
  State: [['state'], ['dos']],
  Labor: [['labor'], ['dol']],
  Treasury: [['treasury'], ['treas']],
  Education: [['education'], ['ed'], ['doed']],
  HHS: [['hhs'], ['health', 'human', 'services']],
};

describe('C1 — the 20 evaluated agencies', () => {
  for (const [agency, identity] of Object.entries(EXPECTED_20)) {
    it(`${agency} identity is exactly the measured post-C1 set`, () => {
      expect(resolveBuyer(agency).identity).toEqual(identity);
    });
  }

  it('the only sets removed among the 20 are housing, veterans, homeland and health', () => {
    // 18 of 20 kept every row in the live measurement (VA and DHS lose a set but no notice: their
    // single word never matched a row the full name did not). HUD 6→4, HHS 608→413.
    const removed = Object.keys(EXPECTED_20).filter((a) => resolveBuyer(a).identity.length < unprunedIdentity(a).length);
    expect(removed.sort()).toEqual(['DHS', 'HHS', 'HUD', 'VA']);
  });
});

describe('C1 — false agency matches are removed', () => {
  it.each([
    ['HHS', 'DEPT OF DEFENSE', 'DEFENSE HEALTH AGENCY (DHA)'],
    ['HHS', 'AGRICULTURE, DEPARTMENT OF', 'ANIMAL AND PLANT HEALTH INSPECTION SERVICE'],
    ['HHS', 'DEPT OF DEFENSE', 'UNIFORMED SERVICES UNIVERSITY OF THE HEALTH SCIENCES  (USUHS)'],
    ['HHS', 'Occupational Safety and Health Review Commission', 'Occupational Safety and Health Review Commission'],
    ['HUD', 'FEDERAL HOUSING FINANCE AGENCY', 'FEDERAL HOUSING FINANCE AGENCY'],
    ['HUD', 'Department of Agriculture', 'Rural Housing Service'],
    ['CBP', 'HOMELAND SECURITY, DEPARTMENT OF', 'US IMMIGRATION AND CUSTOMS ENFORCEMENT'],
    ['ICE', 'HOMELAND SECURITY, DEPARTMENT OF', 'US CITIZENSHIP AND IMMIGRATION SERVICES'],
    ['FHWA', 'TRANSPORTATION, DEPARTMENT OF', 'NATIONAL HIGHWAY TRAFFIC SAFETY ADMINISTRATION'],
    ['AFC', 'COMMODITY FUTURES TRADING COMMISSION', 'COMMODITY FUTURES TRADING COMMISSION'],
    ['RECLAMATION', 'INTERIOR, DEPARTMENT OF THE', 'OFFICE OF SURFACE MINING, RECLAMATION AND ENFORCEMENT'],
    ['MARAD', 'FEDERAL MARITIME COMMISSION', 'FEDERAL MARITIME COMMISSION'],
    ['FRA', 'Railroad Retirement Board', 'Railroad Retirement Board'],
    ['OCC', 'Government Accountability Office', 'GAO, Except Comptroller General'],
    ['LOC', 'Institute of Museum and Library Services', 'Institute of Museum and Library Services'],
    ['IMLS', 'UNITED STATES HOLOCAUST MEMORIAL MUSEUM', 'UNITED STATES HOLOCAUST MEMORIAL MUSEUM'],
    ['AOC', 'THE LEGISLATIVE BRANCH', 'UNITED STATES CAPITOL POLICE'],
    ['EERE', 'Council of the Inspectors General on Integrity and Efficiency', 'Council of the Inspectors General on Integrity and Efficiency'],
  ])('%s does not match %s / %s', (buyer, dept, sub) => {
    expect(match(buyer, dept, sub)).toBe(false);
  });
});

describe('C1 — valid notices are kept', () => {
  it.each([
    ['HHS', 'HEALTH AND HUMAN SERVICES, DEPARTMENT OF', 'NATIONAL INSTITUTES OF HEALTH'],
    ['HHS', 'Department of Health and Human Services', 'Centers for Disease Control and Prevention'],
    ['HUD', 'HOUSING AND URBAN DEVELOPMENT, DEPARTMENT OF', 'HOUSING AND URBAN DEVELOPMENT, DEPARTMENT OF'],
    ['VA', 'VETERANS AFFAIRS, DEPARTMENT OF', 'VETERANS AFFAIRS, DEPARTMENT OF'],
    ['DHS', 'HOMELAND SECURITY, DEPARTMENT OF', 'US IMMIGRATION AND CUSTOMS ENFORCEMENT'],
    ['CBP', 'HOMELAND SECURITY, DEPARTMENT OF', 'U.S. CUSTOMS AND BORDER PROTECTION'],
    ['ICE', 'HOMELAND SECURITY, DEPARTMENT OF', 'US IMMIGRATION AND CUSTOMS ENFORCEMENT'],
    ['FAA', 'TRANSPORTATION, DEPARTMENT OF', 'FEDERAL AVIATION ADMINISTRATION'],
    // The three would-be losses the live measurement caught, now covered by explicit aliases:
    ['ASPR', 'HEALTH AND HUMAN SERVICES, DEPARTMENT OF', 'OFFICE OF ASSISTANT SECRETARY FOR PREPAREDNESS AND RESPONSE'],
    ['RD', 'Department of Agriculture', 'Rural Housing Service'],
    ['NRCS', 'AGRICULTURE, DEPARTMENT OF', 'FARM PRODUCTION AND CONSERVATION BUSINESS CENTER'],
  ])('%s still matches %s / %s', (buyer, dept, sub) => {
    expect(match(buyer, dept, sub)).toBe(true);
  });
});

// The identity resolveBuyer produced BEFORE C1, rebuilt independently so the invariants below
// compare against the old behaviour rather than against the function under test.
import { resolveBuyerIdentity } from '@/lib/opportunities/market-interpretation';
const NON = new Set(['department', 'dept', 'of', 'the', 'and', 'u', 's', 'us', 'for', 'office']);
function unprunedIdentity(requested: string): string[][] {
  const b = resolveBuyerIdentity(requested);
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const n of b.needles.length ? b.needles : [requested]) {
    const w = n.toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((x) => x && !NON.has(x));
    const k = [...w].sort().join(' ');
    if (!w.length || seen.has(k)) continue;
    seen.add(k);
    out.push(w);
  }
  return out;
}

describe('C1 — invariants over every alias key', () => {
  const keys = Object.keys((aliasData as { aliases: Record<string, string> }).aliases);

  it('is narrowing only: every post-C1 set existed before', () => {
    for (const k of keys) {
      const before = new Set(unprunedIdentity(k).map((w) => w.join(' ')));
      for (const w of resolveBuyer(k).identity) expect(before.has(w.join(' '))).toBe(true);
    }
  });

  it('never leaves a buyer with no identity', () => {
    for (const k of keys) expect(resolveBuyer(k).identity.length).toBeGreaterThan(0);
  });

  it('no single word survives that is part of the same buyer\'s longer name', () => {
    for (const k of keys) {
      const id = resolveBuyer(k).identity;
      for (const w of id) {
        if (w.length !== 1) continue;
        expect(id.some((o) => o.length > 1 && o.includes(w[0]))).toBe(false);
      }
    }
  });

  it('an unknown buyer passes through unchanged', () => {
    expect(resolveBuyer('Zzyzx Regional Authority').identity).toEqual([['zzyzx', 'regional', 'authority']]);
  });
});
