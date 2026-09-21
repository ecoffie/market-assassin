import { describe, it, expect } from 'vitest';
import { resolveAgency, isValidOfficeCode } from './agency-resolver';

/**
 * REGRESSION FIXTURES FOR PROVEN MIS-ATTRIBUTIONS.
 *
 * Every case below was reproduced live against `agency_intelligence` on
 * 2026-09-13 and traced to its mechanism by EXECUTING the real
 * `extractAgenciesFromTitle` from src/lib/agency-intelligence/fetchers/govinfo.ts.
 *
 * Two distinct unanchored-substring collisions were proven:
 *   "ICE" => Department of Homeland Security  matches inside "Serv-ICE-s"
 *   "EPA" => Environmental Protection Agency  matches inside "D-epa-rtment"
 *
 * The rule these pin: a SUBSTRING must never establish agency identity.
 */

const CANON = {
  VA: 'Department of Veterans Affairs',
  DHS: 'Department of Homeland Security',
  EPA: 'Environmental Protection Agency',
  DOT: 'Department of Transportation',
  HHS: 'Department of Health and Human Services',
  DOI: 'Department of the Interior',
} as const;

describe('resolveAgency — proven mis-attribution regressions', () => {
  // ── The "ICE" inside "Services" collision (HHS/SSA filed under DHS) ──
  it('does not resolve an HHS report to DHS (the "Serv-ICE-s" collision)', () => {
    const r = resolveAgency({ agencyName: 'Department of Health and Human Services' });
    expect(r.canonicalAgency).toBe(CANON.HHS);
    expect(r.canonicalAgency).not.toBe(CANON.DHS);
  });

  it('does not resolve SSA to DHS (the "Serv-ICE" collision)', () => {
    const r = resolveAgency({ agencyName: 'Social Security Administration' });
    expect(r.canonicalAgency).not.toBe(CANON.DHS);
  });

  it('"Services" alone never establishes DHS identity', () => {
    for (const probe of ['Services', 'Customer Service', 'World-Class Service']) {
      expect(resolveAgency({ agencyName: probe }).canonicalAgency).not.toBe(CANON.DHS);
    }
  });

  /**
   * THE SUBSTRING PATH ITSELF. These inputs are NOT generic-token labels and NOT
   * canonical names, so they fall all the way through to the refuse branch — which
   * is exactly where an unanchored `key.includes(alias)` sweep would fire.
   * Proven to go red when that sweep is injected.
   */
  it('never resolves a title-shaped string by substring ("ICE" inside "Services")', () => {
    for (const probe of [
      'SSA Customer Services Review',
      'Human Services Strategic Planning',
      'Broad Service Delivery Plan Needed',
    ]) {
      const r = resolveAgency({ agencyName: probe });
      expect(r.canonicalAgency).not.toBe(CANON.DHS);
      expect(r.resolved).toBe(false);
    }
  });

  it('never resolves a title-shaped string by substring ("EPA" inside "Department")', () => {
    for (const probe of ['Departmental Performance Plan Review', 'Interior Departmental Oversight']) {
      const r = resolveAgency({ agencyName: probe });
      expect(r.canonicalAgency).not.toBe(CANON.EPA);
      expect(r.resolved).toBe(false);
    }
  });

  // ── The "EPA" inside "Department" collision (Interior filed under EPA) ──
  it('does not resolve an Interior report to EPA (the "D-epa-rtment" collision)', () => {
    const r = resolveAgency({ agencyName: 'Department of the Interior' });
    expect(r.canonicalAgency).toBe(CANON.DOI);
    expect(r.canonicalAgency).not.toBe(CANON.EPA);
  });

  it('the bare word "Department" never establishes EPA (or any) identity', () => {
    const r = resolveAgency({ agencyName: 'Department' });
    expect(r.resolved).toBe(false);
    expect(r.canonicalAgency).toBeNull();
  });

  // ── EPA / FAA / Interior must never land on VA ──
  it('EPA, FAA and Interior never resolve to VA', () => {
    for (const name of ['Environmental Protection Agency', 'Federal Aviation Administration', 'Department of the Interior']) {
      expect(resolveAgency({ agencyName: name }).canonicalAgency).not.toBe(CANON.VA);
    }
  });
});

describe('resolveAgency — generic labels never establish identity', () => {
  // "General Government" is the junk bucket: 141/446 GAO rows (32%), measured live.
  it.each(['General Government', 'Department of the', 'Various', 'Unknown', 'N/A', 'Office', 'Agency', 'Administration', 'Department of'])(
    'refuses %s',
    (label) => {
      const r = resolveAgency({ agencyName: label });
      expect(r.resolved).toBe(false);
      expect(r.canonicalAgency).toBeNull();
      expect(r.method).toBe('unresolved');
      expect(r.confidence).toBe('unresolved');
    },
  );
});

describe('resolveAgency — identifiers beat names', () => {
  it('a source CGAC code resolves even when the name is junk', () => {
    const r = resolveAgency({ agencyName: 'Department of the', toptierCode: '036' });
    expect(r.canonicalAgency).toBe(CANON.VA);
    expect(r.method).toBe('cgac_code');
    expect(r.confidence).toBe('high');
  });

  it('zero-pads a short code', () => {
    expect(resolveAgency({ toptierCode: '97' }).canonicalAgency).toBe('Department of Defense');
  });

  it('an unknown code does not become a guess', () => {
    const r = resolveAgency({ agencyName: 'Completely Unknown Body', toptierCode: '999' });
    expect(r.resolved).toBe(false);
    expect(r.canonicalAgency).toBeNull();
  });
});

describe('resolveAgency — resolution paths', () => {
  it('exact canonical name', () => {
    const r = resolveAgency({ agencyName: 'Department of Veterans Affairs' });
    expect(r.canonicalAgency).toBe(CANON.VA);
    expect(r.method).toBe('exact_name');
  });

  it('explicit abbreviation', () => {
    const r = resolveAgency({ agencyName: 'VA' });
    expect(r.canonicalAgency).toBe(CANON.VA);
    expect(r.method).toBe('alias');
  });

  it('the SAM "X, DEPARTMENT OF" structural pattern', () => {
    const r = resolveAgency({ agencyName: 'VETERANS AFFAIRS, DEPARTMENT OF' });
    expect(r.canonicalAgency).toBe(CANON.VA);
    expect(r.method).toBe('department_of');
  });

  it('unresolved stays unresolved — no nearest-match', () => {
    const r = resolveAgency({ agencyName: 'Ministry of Magic' });
    expect(r.resolved).toBe(false);
    expect(r.canonicalAgency).toBeNull();
    expect(r.note).toMatch(/rather than guessed/);
  });

  it('echoes a sub-agency without promoting it to the parent', () => {
    const r = resolveAgency({ agencyName: 'Department of Defense', subAgencyName: 'Defense Logistics Agency' });
    expect(r.canonicalAgency).toBe('Department of Defense');
    expect(r.subAgency).toBe('Defense Logistics Agency');
  });

  it('an unresolved parent does not inherit identity from its sub-agency', () => {
    const r = resolveAgency({ agencyName: 'Some Unlisted Office', subAgencyName: 'Defense Logistics Agency' });
    expect(r.resolved).toBe(false);
    expect(r.canonicalAgency).toBeNull();
  });

  it('keeps a valid DoDAAC and drops an invalid one', () => {
    expect(resolveAgency({ agencyName: 'Department of Defense', officeCode: 'W912PL' }).officeCode).toBe('W912PL');
    expect(resolveAgency({ agencyName: 'Department of Defense', officeCode: 'nope' }).officeCode).toBeNull();
    expect(isValidOfficeCode('W912BV')).toBe(true);
  });

  it('empty input is unresolved, not a crash', () => {
    expect(resolveAgency({}).resolved).toBe(false);
  });
});
