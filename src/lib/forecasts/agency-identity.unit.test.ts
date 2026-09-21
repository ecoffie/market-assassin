/**
 * Forecast agency identity — the regression suite for the 2026-09-14 surface audit.
 *
 * Every case here is a MEASURED live defect or a measured-correct behaviour we must not lose.
 * The counts quoted in comments are exact, taken over all 35,751 `agency_forecasts` rows.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveForecastAgencies,
  resolveForecastAgencyIdentity,
  resolveForecastChildIdentity,
  forecastAgencyOrExpr,
  childAnchorExpr,
  childrenOfForecastParent,
  FORECAST_AGENCY_IDENTITIES,
  FORECAST_CHILD_IDENTITIES,
  FORECAST_SOURCE_AGENCY_CODES,
} from './agency-identity';

const codesFor = (term: string) => resolveForecastAgencies(term).codes;
const expr = (term: string) => forecastAgencyOrExpr(resolveForecastAgencies(term));

describe('accepted aliases resolve to exact source_agency codes', () => {
  const CASES: Array<[string, string[]]> = [
    // ── the 9 dropdown presets that returned ZERO forecasts on prod ──────────────────
    ['DEFENSE', ['NAVY', 'ONR', 'NRL', 'USACE']],           // was 0; 11,789 rows exist
    ['Department of Defense', ['NAVY', 'ONR', 'NRL', 'USACE']],
    ['DOD', ['NAVY', 'ONR', 'NRL', 'USACE']],
    ['HEALTH AND HUMAN SERVICES', ['HHS']],                  // was 0; 5,504 rows
    ['HOMELAND SECURITY', ['DHS']],                          // was 0; 1,644 rows
    ['ENERGY', ['DOE']],                                     // was 0; 1,301 rows
    ['JUSTICE', ['DOJ']],                                    // was 0; 619 rows
    ['NATIONAL AERONAUTICS', ['NASA']],                      // was 0; 189 rows
    ['ENVIRONMENTAL PROTECTION', ['EPA']],                   // was 0; 50 rows
    // ── presets that already worked — must not regress ───────────────────────────────
    ['VETERANS AFFAIRS', ['VA']],
    ['INTERIOR', ['DOI']],
    ['AGRICULTURE', ['USDA']],
    ['GENERAL SERVICES', ['GSA']],
    ['TRANSPORTATION', ['DOT']],
    ['LABOR', ['DOL']],
    ['TREASURY', ['Treasury']],
    // ── abbreviations, full names, and spelling variants ─────────────────────────────
    ['NAVY', ['NAVY', 'ONR', 'NRL']],
    ['Department of the Navy', ['NAVY', 'ONR', 'NRL']],
    ['DON', ['NAVY', 'ONR', 'NRL']],
    ['ARMY', ['USACE']],
    ['Department of the Army', ['USACE']],
    ['USACE', ['USACE']],
    ['Army Corps of Engineers', ['USACE']],
    ['ONR', ['ONR']],
    ['Office of Naval Research', ['ONR']],
    ['NRL', ['NRL']],
    ['Naval Research Laboratory', ['NRL']],
    ['HHS', ['HHS']],
    ['DHS', ['DHS']],
    ['GSA', ['GSA']],
    ['VA', ['VA']],
    ['NRC', ['NRC']],
    ['NSF', ['NSF']],
    ['SSA', ['SSA']],
  ];
  for (const [term, expected] of CASES) {
    it(`"${term}" -> [${expected.join(', ')}]`, () => {
      expect(codesFor(term).sort()).toEqual([...expected].sort());
    });
  }

  it('resolves through the shared 454-alias corpus (agency-aliases.json), not a private list', () => {
    // "PENTAGON" appears in agency-aliases.json, NOT in this module's own alias arrays.
    expect(FORECAST_AGENCY_IDENTITIES.find((i) => i.key === 'DOD')!.aliases)
      .not.toContain('PENTAGON_NOT_LOCAL');
    expect(codesFor('PENTAGON').sort()).toEqual(['NAVY', 'NRL', 'ONR', 'USACE']);
  });

  it('is case- and punctuation-insensitive', () => {
    for (const t of ['navy', 'Navy', 'N A V Y'.replace(/ /g, ''), 'U.S. Navy', 'department of the navy']) {
      expect(codesFor(t)).toContain('NAVY');
    }
  });
});

describe('rejected false positives — a substring is NOT an identity', () => {
  // Each of these was a MEASURED live over-match before the fix.
  it('EPA resolves to EPA only — never "d-EPA-rtment" (was 7,246 rows vs a real corpus of 50)', () => {
    expect(codesFor('EPA')).toEqual(['EPA']);
    const e = expr('EPA')!;
    expect(e).toBe('source_agency.in.(EPA)');
    expect(e).not.toMatch(/ilike/);
    expect(e).not.toMatch(/%/);
  });

  it('SEC does NOT match "Social SECurity Administration" (was 170 rows)', () => {
    expect(codesFor('SEC')).toEqual([]);
    expect(resolveForecastAgencyIdentity('SEC')!.coverage).toBe('none');
    // Zero coverage must match NOTHING, never the unfiltered corpus.
    expect(expr('SEC')).toBe('source_agency.is.null');
  });

  it('short acronyms never emit a bare substring clause', () => {
    for (const a of ['EPA', 'FBI', 'DEA', 'ATF', 'TSA', 'FAA', 'DLA', 'SEC', 'GSA', 'VA', 'USCG', 'CBP', 'NIH', 'CMS', 'NPS', 'FWS', 'FAS', 'PBS', 'NAVFAC', 'NAVAIR', 'NAVSEA', 'SOCOM', 'USSOCOM']) {
      const e = expr(a);
      expect(e, `${a} produced a substring match`).not.toMatch(/ilike\.%/);
      expect(e, `${a} produced a bare %term%`).not.toMatch(/%[A-Za-z]/);
    }
  });

  it('an unknown needle falls back to a WORD-BOUNDARY regex, not a substring', () => {
    const e = expr('Bureau of Reclamation')!;
    expect(e).toMatch(/imatch\.\\m/);      // \m…\M word boundaries
    expect(e).not.toMatch(/ilike\.%/);
    expect(resolveForecastAgencies('Bureau of Reclamation').unresolved).toEqual(['Bureau of Reclamation']);
  });

  it('an asked-for agency that cannot match resolves to NO rows, never the whole corpus', () => {
    // The dangerous failure mode is a filter that silently disappears.
    expect(expr('SEC')).not.toBeNull();
    expect(expr('FAA')).toBe('source_agency.is.null');
  });

  it('no agency filter at all → null (do not filter)', () => {
    expect(expr('')).toBeNull();
    expect(forecastAgencyOrExpr(resolveForecastAgencies(null))).toBeNull();
    expect(forecastAgencyOrExpr(resolveForecastAgencies(undefined))).toBeNull();
    expect(resolveForecastAgencies('').empty).toBe(true);
  });
});

describe('parent behaviour — rollup is parent → child ONLY', () => {
  it('DOD rolls up to the DoD components we actually hold', () => {
    expect(codesFor('DOD').sort()).toEqual(['NAVY', 'NRL', 'ONR', 'USACE']);
    expect(resolveForecastAgencyIdentity('DOD')!.coverage).toBe('partial');
  });

  it('NAVY rolls up its own labs (ONR, NRL) — matching what the map already returned', () => {
    // Live pre-fix: agency=NAVY returned 5,053 pins = NAVY 5,033 + ONR 8 + NRL 12,
    // because ONR/NRL carry department="Department of the Navy". Parity preserved.
    expect(codesFor('NAVY').sort()).toEqual(['NAVY', 'NRL', 'ONR']);
  });

  it('ARMY is PARTIALLY represented through USACE — not full coverage, not absent', () => {
    const id = resolveForecastAgencyIdentity('ARMY')!;
    expect(id.codes).toEqual(['USACE']);
    expect(id.coverage).toBe('partial');
    expect(id.note).toMatch(/PARTIALLY REPRESENTED THROUGH USACE/);
  });

  it('a department-level CHILD-with-no-corpus never inherits its parent rows', () => {
    // FAA/FBI/… must not return the parent department corpus; that is the EPA bug in another hat.
    // TSA used to be in this list — it is now a real CHILD identity (DHS bureau anchor) and is
    // covered in the subagency suite below.
    for (const [child, parent] of [['FAA', 'DOT'], ['FBI', 'DOJ'], ['DEA', 'DOJ'], ['ATF', 'DOJ'], ['DLA', 'DOD'], ['SOCOM', 'DOD']] as const) {
      const id = resolveForecastAgencyIdentity(child)!;
      expect(id.codes, `${child} inherited ${parent}`).toEqual([]);
      expect(id.coverage).toBe('none');
      expect(id.parentWithData).toBe(parent);
    }
  });
});

describe('child behaviour', () => {
  it('USACE resolves to itself, and is reachable both directly and via ARMY/DOD', () => {
    expect(codesFor('USACE')).toEqual(['USACE']);
    expect(codesFor('ARMY')).toContain('USACE');
    expect(codesFor('DOD')).toContain('USACE');
  });

  it('NRL is its own code — never silently attributed to ONR', () => {
    // The retired private map in utils/agency-forecasts-live.ts matched /\bonr\b|\bnrl\b/ -> 'ONR',
    // attributing Naval Research Laboratory forecasts to the Office of Naval Research.
    expect(codesFor('NRL')).toEqual(['NRL']);
    expect(codesFor('ONR')).toEqual(['ONR']);
  });
});

describe('multi-select and input shapes', () => {
  it('pipe-joined multi-select unions the codes, de-duplicated', () => {
    expect(codesFor('NAVY|HHS').sort()).toEqual(['HHS', 'NAVY', 'NRL', 'ONR'].sort());
    // NAVY and DOD overlap; the union must not repeat a code (a repeat is a broken .in() list).
    const c = codesFor('NAVY|DOD');
    expect(new Set(c).size).toBe(c.length);
  });

  it('accepts a real array (saved_searches.filters can store one)', () => {
    expect(resolveForecastAgencies(['NAVY', 'HHS']).codes.sort())
      .toEqual(['HHS', 'NAVY', 'NRL', 'ONR'].sort());
    expect(resolveForecastAgencies([]).empty).toBe(true);
  });

  it('accepts a comma-joined list (the MCP tool documents comma-separated)', () => {
    expect(codesFor('NAVY,HHS').sort()).toEqual(['HHS', 'NAVY', 'NRL', 'ONR'].sort());
  });

  it('every emitted code is a member of the closed source_agency vocabulary', () => {
    for (const id of FORECAST_AGENCY_IDENTITIES) {
      for (const c of id.codes) {
        expect(FORECAST_SOURCE_AGENCY_CODES as readonly string[]).toContain(c);
      }
    }
  });

  it('covers every code in the closed vocabulary with at least one identity', () => {
    const covered = new Set(FORECAST_AGENCY_IDENTITIES.flatMap((i) => i.codes));
    for (const c of FORECAST_SOURCE_AGENCY_CODES) expect(covered).toContain(c);
  });
});

describe('subagency (child) identities — structured anchors, never alias text', () => {
  it('ships exactly 15 children: 12 deterministic + 3 high_confidence partial Navy', () => {
    expect(FORECAST_CHILD_IDENTITIES).toHaveLength(15);
    expect(FORECAST_CHILD_IDENTITIES.filter((c) => c.confidence === 'deterministic')).toHaveLength(12);
    expect(FORECAST_CHILD_IDENTITIES.filter((c) => c.confidence === 'high_confidence').map((c) => c.key).sort())
      .toEqual(['NAVAIR', 'NAVFAC', 'NAVSEA']);
  });

  it('NAVSUP is NOT a child and does NOT resolve to the Navy parent', () => {
    expect(resolveForecastChildIdentity('NAVSUP')).toBeNull();
    // Unresolved → word-boundary fallback, never the 8,881-row Navy corpus via parent alias.
    expect(resolveForecastAgencies('NAVSUP').children).toEqual([]);
    expect(resolveForecastAgencies('NAVSUP').codes).toEqual([]);
    expect(resolveForecastAgencies('NAVSUP').unresolved).toEqual(['NAVSUP']);
  });

  it('child aliases resolve to the child, not the parent', () => {
    expect(resolveForecastChildIdentity('Coast Guard')!.key).toBe('USCG');
    expect(resolveForecastChildIdentity('Naval Facilities Engineering Systems Command')!.key).toBe('NAVFAC');
    expect(resolveForecastChildIdentity('National Institutes of Health')!.key).toBe('NIH');
    expect(resolveForecastChildIdentity('Fish and Wildlife Service')!.key).toBe('FWS');
    expect(resolveForecastChildIdentity('Forest Service')!.key).toBe('FOREST_SERVICE');
    expect(resolveForecastChildIdentity('National Park Service')!.key).toBe('NPS');
  });

  it('NAVFAC / NAVAIR / NAVSEA are NOT Navy — their exprs are DoDAAC-scoped subsets', () => {
    for (const key of ['NAVFAC', 'NAVAIR', 'NAVSEA'] as const) {
      const child = resolveForecastChildIdentity(key)!;
      const e = expr(key)!;
      expect(resolveForecastAgencies(key).codes).toEqual([]); // no parent codes
      expect(resolveForecastAgencies(key).children.map((c) => c.key)).toEqual([key]);
      expect(e).toMatch(/^and\(source_agency\.eq\.NAVY,contracting_office\.in\./);
      expect(e).not.toBe(expr('NAVY'));
      expect(child.anchor.kind).toBe('office_code');
      if (child.anchor.kind === 'office_code') {
        expect(child.anchor.codes.length).toBeGreaterThan(0);
        expect(child.anchor.codes).not.toContain('N44225'); // unverified against directory
      }
    }
  });

  it('USCG / TSA / NIH are NOT the whole parent department', () => {
    expect(expr('USCG')).toMatch(/source_agency\.eq\.DHS/);
    expect(expr('USCG')).toMatch(/bureau\.(eq|like)\.USCG/);
    expect(expr('USCG')).not.toBe(expr('DHS'));
    expect(expr('TSA')).toMatch(/bureau\.(eq|like)\.TSA/);
    expect(expr('TSA')).not.toBe(expr('DHS'));
    expect(expr('NIH')).toBe('and(source_agency.eq.HHS,bureau.in.("HHS NIH"))');
    expect(expr('NIH')).not.toBe(expr('HHS'));
  });

  it('NPS is THIN and exact — National Park Service only, never a %park% substring', () => {
    const nps = resolveForecastChildIdentity('NPS')!;
    expect(nps.coverage).toBe('thin');
    expect(nps.auditedRows).toBe(14);
    expect(expr('NPS')).toBe('and(source_agency.eq.DOI,bureau.in.("National Park Service"))');
    expect(expr('NPS')).not.toMatch(/%/);
  });

  it('structured child selection never uses unrestricted %term% matching', () => {
    for (const c of FORECAST_CHILD_IDENTITIES) {
      const e = childAnchorExpr(c);
      expect(e, c.key).not.toMatch(/ilike/);
      expect(e, c.key).not.toMatch(/%[A-Za-z]/);
      expect(e, c.key).toMatch(new RegExp(`source_agency\\.eq\\.${c.parentSourceAgency}`));
    }
  });

  it('parent → child rollup listing works; child never inherits parent via codes', () => {
    expect(childrenOfForecastParent('DHS').map((c) => c.key).sort())
      .toEqual(['CBP', 'FEMA', 'TSA', 'USCG', 'USSS']);
    expect(childrenOfForecastParent('NAVY').map((c) => c.key).sort())
      .toEqual(['NAVAIR', 'NAVFAC', 'NAVSEA']);
    // Parent still resolves to its source_agency codes (full corpus including parent-generic).
    expect(codesFor('DHS')).toEqual(['DHS']);
    expect(codesFor('NAVY').sort()).toEqual(['NAVY', 'NRL', 'ONR']);
  });

  it('sibling exclusivity of anchors — no shared bureau values or DoDAAC codes across children of one parent', () => {
    for (const parent of ['DHS', 'HHS', 'DOI', 'USDA', 'GSA', 'NAVY']) {
      const kids = childrenOfForecastParent(parent);
      const seen = new Set<string>();
      for (const k of kids) {
        const keys = k.anchor.kind === 'office_code' ? k.anchor.codes
          : k.anchor.kind === 'bureau_exact' ? k.anchor.values
          : k.anchor.components;
        for (const x of keys) {
          expect(seen.has(x), `${parent}: ${x} claimed by two children`).toBe(false);
          seen.add(x);
        }
      }
    }
  });

  it('audited row totals for the 15 children sum to 7,586', () => {
    const sum = FORECAST_CHILD_IDENTITIES.reduce((s, c) => s + c.auditedRows, 0);
    expect(sum).toBe(7586);
  });
});
