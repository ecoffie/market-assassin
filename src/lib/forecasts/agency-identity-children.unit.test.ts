/**
 * SUBAGENCY (CHILD) forecast identity — the regression suite for the 2026-09-14 anchoring audit.
 *
 * Every count here is MEASURED against production (`npm run verify:forecast-agency` re-proves them
 * live). They are deliberately NOT the keyword-discovery numbers: that pass over-counted
 * descriptive words ("park" → NPS 221 when the truth is 14) and under-counted Navy commands whose
 * identity lives only in a DoDAAC (NAVSEA 194 → 773).
 */
import { describe, it, expect } from 'vitest';
import {
  FORECAST_CHILD_IDENTITIES,
  FORECAST_AGENCY_IDENTITIES,
  resolveForecastAgencies,
  resolveForecastChildIdentity,
  forecastAgencyOrExpr,
  childAnchorExpr,
  childrenOfForecastParent,
} from './agency-identity';

const expr = (term: string) => forecastAgencyOrExpr(resolveForecastAgencies(term));
const child = (k: string) => FORECAST_CHILD_IDENTITIES.find((c) => c.key === k)!;

describe('child aliases resolve to the child identity', () => {
  const CASES: Array<[string, string]> = [
    ['USCG', 'USCG'], ['Coast Guard', 'USCG'], ['United States Coast Guard', 'USCG'],
    ['CBP', 'CBP'], ['Customs and Border Protection', 'CBP'],
    ['FEMA', 'FEMA'], ['Federal Emergency Management Agency', 'FEMA'],
    ['TSA', 'TSA'], ['Transportation Security Administration', 'TSA'],
    ['USSS', 'USSS'], ['Secret Service', 'USSS'],
    ['CMS', 'CMS'], ['Centers for Medicare and Medicaid Services', 'CMS'],
    ['NIH', 'NIH'], ['National Institutes of Health', 'NIH'],
    ['FWS', 'FWS'], ['Fish and Wildlife Service', 'FWS'], ['USFWS', 'FWS'],
    ['NPS', 'NPS'], ['National Park Service', 'NPS'],
    ['Forest Service', 'FOREST_SERVICE'], ['USFS', 'FOREST_SERVICE'],
    ['FAS', 'FAS'], ['Federal Acquisition Service', 'FAS'],
    ['PBS', 'PBS'], ['Public Buildings Service', 'PBS'],
    ['NAVFAC', 'NAVFAC'], ['Naval Facilities Engineering Systems Command', 'NAVFAC'],
    ['NAVAIR', 'NAVAIR'], ['Naval Air Systems Command', 'NAVAIR'],
    ['NAVSEA', 'NAVSEA'], ['Naval Sea Systems Command', 'NAVSEA'],
  ];
  for (const [term, key] of CASES) {
    it(`"${term}" -> child ${key}`, () => {
      expect(resolveForecastChildIdentity(term)?.key).toBe(key);
      expect(resolveForecastAgencies(term).children.map((c) => c.key)).toEqual([key]);
      // A child NEVER contributes a parent source_agency code.
      expect(resolveForecastAgencies(term).codes).toEqual([]);
    });
  }
});

describe('structured child selection — the anchor, never the alias text', () => {
  it('DHS children anchor on the source-native APFS bureau component path', () => {
    expect(childAnchorExpr(child('USCG')))
      .toBe('and(source_agency.eq.DHS,or(bureau.eq.USCG,bureau.like.USCG/*))');
  });
  it('HHS/DOI/USDA/GSA children anchor on an exact bureau value', () => {
    expect(childAnchorExpr(child('NIH'))).toBe('and(source_agency.eq.HHS,bureau.in.("HHS NIH"))');
    expect(childAnchorExpr(child('FOREST_SERVICE'))).toBe('and(source_agency.eq.USDA,bureau.in.("Forest Service"))');
  });
  it('NAVY children anchor on an exact DoDAAC code set', () => {
    const e = childAnchorExpr(child('NAVFAC'));
    expect(e).toMatch(/^and\(source_agency\.eq\.NAVY,contracting_office\.in\.\(/);
    expect(e).toContain('N40085');
  });
  it('NO child selector uses an unrestricted %term% match, a title or a description', () => {
    for (const c of FORECAST_CHILD_IDENTITIES) {
      const e = childAnchorExpr(c);
      expect(e, `${c.key} uses a substring`).not.toMatch(/ilike/);
      expect(e, `${c.key} matches %…%`).not.toContain('%');
      expect(e, `${c.key} selects on title`).not.toContain('title');
      expect(e, `${c.key} selects on description`).not.toContain('description');
    }
  });
  it('every child scopes to its parent source_agency FIRST', () => {
    for (const c of FORECAST_CHILD_IDENTITIES) {
      expect(childAnchorExpr(c)).toContain(`source_agency.eq.${c.parentSourceAgency}`);
    }
  });
});

describe('hierarchy contract — parent rolls up, child never inherits', () => {
  it('a child expression is NOT the parent expression', () => {
    for (const c of FORECAST_CHILD_IDENTITIES) {
      expect(expr(c.key)).not.toBe(expr(c.parent));
    }
  });
  it('NAVFAC != all Navy', () => {
    expect(expr('NAVFAC')).not.toBe(expr('NAVY'));
    expect(expr('NAVFAC')).not.toContain('source_agency.in.');
    expect(expr('NAVY')).toContain('source_agency.in.(NAVY,ONR,NRL)');
  });
  it('NAVAIR != all Navy and NAVSEA != all Navy', () => {
    for (const k of ['NAVAIR', 'NAVSEA']) {
      expect(expr(k)).not.toBe(expr('NAVY'));
      expect(expr(k)).toContain('contracting_office.in.');
    }
  });
  it('USCG != all DHS', () => {
    expect(expr('USCG')).not.toBe(expr('DHS'));
    expect(expr('DHS')).toBe('source_agency.in.(DHS)');
  });
  it('NIH != all HHS', () => {
    expect(expr('NIH')).not.toBe(expr('HHS'));
    expect(expr('HHS')).toBe('source_agency.in.(HHS)');
  });
  it('the parent still resolves to its whole corpus (rollup preserved)', () => {
    for (const p of ['DHS', 'HHS', 'DOI', 'USDA', 'GSA']) {
      expect(expr(p)).toBe(`source_agency.in.(${p})`);
    }
  });
  it('USACE stays a source_agency identity — it must not become an Army child anchor', () => {
    expect(resolveForecastChildIdentity('USACE')).toBeNull();
    expect(resolveForecastAgencies('USACE').codes).toEqual(['USACE']);
  });
});

describe('sibling exclusivity is structural', () => {
  it('no two children of one parent share an anchor value', () => {
    for (const p of ['NAVY', 'DHS', 'HHS', 'DOI', 'GSA']) {
      const kids = childrenOfForecastParent(p);
      const seen = new Map<string, string>();
      for (const c of kids) {
        const vals = c.anchor.kind === 'office_code' ? c.anchor.codes
          : c.anchor.kind === 'bureau_exact' ? c.anchor.values : c.anchor.components;
        for (const v of vals) {
          expect(seen.has(v), `${v} claimed by both ${seen.get(v)} and ${c.key}`).toBe(false);
          seen.set(v, c.key);
        }
      }
    }
  });
  it('multi-select unions a child with a parent without collapsing either', () => {
    const e = expr('USCG|EPA')!;
    expect(e).toContain('source_agency.in.(EPA)');
    expect(e).toContain('and(source_agency.eq.DHS');
  });
});

describe('coverage honesty', () => {
  it('NPS ships its THIN true set, not a comfortable inferred one', () => {
    const nps = child('NPS');
    expect(nps.auditedRows).toBe(14);         // NOT the 221 a keyword pass claimed
    expect(nps.coverage).toBe('thin');
    expect(nps.note).toMatch(/THIN/);
  });
  it('the three Navy commands are PARTIAL with a documented mapping gap', () => {
    for (const k of ['NAVFAC', 'NAVAIR', 'NAVSEA']) {
      expect(child(k).coverage).toBe('partial');
      expect(child(k).confidence).toBe('high_confidence');
      expect(child(k).note).toMatch(/PARTIAL/);
    }
  });
  it('NAVFAC is 2,278 — the unverifiable N44225 is EXCLUDED, not tuned to the old 2,402', () => {
    expect(child('NAVFAC').auditedRows).toBe(2278);
    const codes = (child('NAVFAC').anchor as { codes: string[] }).codes;
    expect(codes).not.toContain('N44225');
  });
  it('the 12 deterministic children are marked as such', () => {
    const det = FORECAST_CHILD_IDENTITIES.filter((c) => c.confidence === 'deterministic');
    expect(det).toHaveLength(12);
    expect(FORECAST_CHILD_IDENTITIES).toHaveLength(15);
  });
});

describe('NAVSUP is deliberately NOT shipped', () => {
  it('has no child identity (its largest office is free text, not a DoDAAC)', () => {
    expect(resolveForecastChildIdentity('NAVSUP')).toBeNull();
    expect(FORECAST_CHILD_IDENTITIES.find((c) => c.key === 'NAVSUP')).toBeUndefined();
  });
  it('"NAVSUP" does NOT fall through to the Navy parent or a free-text child selector', () => {
    // Previously NAVSUP was a Navy alias → all 8,881 Navy rows. That is the same false-positive
    // class as NAVFAC-as-Navy. Until office-name normalisation gives it a DoDAAC, it is
    // UNRESOLVED (word-boundary fallback) — never a parent dump, never a `%NAVSUP%` child.
    expect(resolveForecastAgencies('NAVSUP').codes).toEqual([]);
    expect(resolveForecastAgencies('NAVSUP').children).toEqual([]);
    expect(resolveForecastAgencies('NAVSUP').unresolved).toEqual(['NAVSUP']);
    expect(expr('NAVSUP')).toMatch(/imatch\.\\mNAVSUP\\M/);
    expect(expr('NAVSUP')).not.toContain('ilike');
    expect(expr('NAVSUP')).not.toBe(expr('NAVY'));
  });
});

describe('parent-generic rows stay parent-only', () => {
  it('no child anchors on a parent-generic bureau value', () => {
    const GENERIC = ['Department of the Interior', 'Department of Agriculture',
                     'General Services Administration', 'Department of the Navy'];
    for (const c of FORECAST_CHILD_IDENTITIES) {
      if (c.anchor.kind !== 'bureau_exact') continue;
      for (const v of c.anchor.values) expect(GENERIC).not.toContain(v);
    }
  });
});

describe('department-level identity is unregressed', () => {
  it('parents still resolve to exact source_agency codes', () => {
    expect(resolveForecastAgencies('DOD').codes.sort()).toEqual(['NAVY', 'NRL', 'ONR', 'USACE']);
    expect(resolveForecastAgencies('EPA').codes).toEqual(['EPA']);
    expect(resolveForecastAgencies('ARMY').codes).toEqual(['USACE']);
  });
  it('a known agency with no coverage still returns an honest nothing', () => {
    expect(expr('SEC')).toBe('source_agency.is.null');
    expect(resolveForecastAgencies('SEC').children).toEqual([]);
  });
  it('TSA moved from a no-coverage parent entry to a real child — exactly one record of it', () => {
    expect(FORECAST_AGENCY_IDENTITIES.find((i) => i.key === 'TSA')).toBeUndefined();
    expect(resolveForecastChildIdentity('TSA')?.auditedRows).toBe(83);
  });
});
