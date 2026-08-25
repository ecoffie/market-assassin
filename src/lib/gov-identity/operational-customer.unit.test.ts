/**
 * NS-3 — two truths: administrative hierarchy AND operational customer.
 *
 * Permanent fixture: North Star's SABER task order under FA4610. A live session read it as
 * "an Air Force SABER" and moved on; it is Vandenberg Space Force Base / Space Launch
 * Delta 30, which changes the strategy.
 *
 * MEASURED: 399 notices name a Space Force installation in office_address.city, and ALL
 * 399 say AIR FORCE in sub_tier. The administrative data is CORRECT (these were Air Force
 * wings pre-USSF) — it is stale in a way that inverts strategy.
 *
 * ⚠️ NOTHING HERE MAY HARDCODE `FA4610 -> Space Force`. The resolver reads naming
 * CONVENTIONS (SFB/SFS, SLD/STARCOM/N CONS) so a base nobody enumerated still resolves.
 */
import { describe, it, expect } from 'vitest';
import { resolveOperationalCustomer } from './operational-customer';

/** The real production row behind the fixture. */
const VANDENBERG = {
  department: 'DEPT OF DEFENSE',
  subTier: 'DEPT OF THE AIR FORCE',
  officeAddressCity: 'VANDENBERG SFB',
  popCity: 'Lompoc',
  dodaac: 'FA4610',
  contractingOfficeName: '30 CONS PK',
  observedAt: '2026-08-06',
};

describe('NS-3 — the North Star SABER fixture', () => {
  it('⚠️ THE REGRESSION: resolves Space Launch Delta 30, not "an Air Force SABER"', () => {
    const r = resolveOperationalCustomer(VANDENBERG);
    expect(r.operational.component).toBe('U.S. Space Force');
    expect(r.operational.unit).toBe('Space Launch Delta 30');
    expect(r.operational.installation).toBe('VANDENBERG SFB');
  });

  it('PRESERVES the administrative truth rather than overwriting it', () => {
    const r = resolveOperationalCustomer(VANDENBERG);
    expect(r.administrative.subTier).toBe('DEPT OF THE AIR FORCE');
    expect(r.administrative.contractingOffice).toBe('30 CONS PK');
    expect(r.administrative.dodaac).toBe('FA4610');
  });

  it('flags the DIVERGENCE — the fact that changes strategy', () => {
    expect(resolveOperationalCustomer(VANDENBERG).divergesFromAdministrative).toBe(true);
  });

  it('carries provenance: which field, what value, when observed', () => {
    const r = resolveOperationalCustomer(VANDENBERG);
    const fields = r.evidence.map((e) => e.field);
    expect(fields).toContain('office_address.city');
    expect(fields).toContain('dodaac_directory.office_name');
    expect(r.evidence.every((e) => e.observedAt === '2026-08-06')).toBe(true);
  });

  it('explains itself in language safe to show a user', () => {
    const x = resolveOperationalCustomer(VANDENBERG).explanation!;
    expect(x).toMatch(/contracting authority/i);
    expect(x).toMatch(/operational customer/i);
    expect(x).toMatch(/Both are true/i);
  });
});

describe('generalizes — no base is hardcoded', () => {
  it.each([
    ['PETERSON SFB',   '21 CONS BLDG 350', 'Space Launch Delta 21'],
    ['PATRICK SFB',    '45 CONS PK',       'Space Launch Delta 45'],
    ['SCHRIEVER SFB',  '50 CONS PKP',      'Space Launch Delta 50'],
  ])('%s resolves from evidence alone', (city, office, unit) => {
    const r = resolveOperationalCustomer({ ...VANDENBERG, officeAddressCity: city, contractingOfficeName: office, dodaac: 'XXXXXX' });
    expect(r.operational.component).toBe('U.S. Space Force');
    expect(r.operational.unit).toBe(unit);
  });

  it('a base invented today still resolves (convention, not a list)', () => {
    const r = resolveOperationalCustomer({ ...VANDENBERG, officeAddressCity: 'NEWBASE SFS', contractingOfficeName: '99 CONS', dodaac: 'ZZ9999' });
    expect(r.operational.component).toBe('U.S. Space Force');
    expect(r.operational.unit).toBe('Space Launch Delta 99');
  });

  it('names a Space Force unit from the OFFICE even without an SFB address', () => {
    const r = resolveOperationalCustomer({ ...VANDENBERG, officeAddressCity: 'COLORADO SPRINGS', contractingOfficeName: 'STARCOM CONTRACTING PK' });
    expect(r.operational.component).toBe('U.S. Space Force');
    expect(r.operational.unit).toBe('STARCOM CONTRACTING PK');
  });
});

describe('never invents a component', () => {
  it('an ordinary Army notice is NOT Space Force', () => {
    const r = resolveOperationalCustomer({
      department: 'DEPT OF DEFENSE', subTier: 'DEPT OF THE ARMY',
      officeAddressCity: 'WEST POINT', dodaac: 'W911SD', contractingOfficeName: 'MICC WEST POINT',
    });
    expect(r.operational.component).toBeNull();
    expect(r.divergesFromAdministrative).toBe(false);
    expect(r.explanation).toBeNull();
  });

  it('a numbered CONS squadron alone proves nothing', () => {
    // "30 CONS" at a non-space installation must NOT become a Space Launch Delta.
    const r = resolveOperationalCustomer({
      department: 'DEPT OF DEFENSE', subTier: 'DEPT OF THE AIR FORCE',
      officeAddressCity: 'WRIGHT-PATTERSON AFB', contractingOfficeName: '30 CONS', dodaac: 'FA8601',
    });
    expect(r.operational.component).toBeNull();
    expect(r.operational.unit).toBeNull();
  });

  it('no evidence at all yields nulls, not guesses', () => {
    const r = resolveOperationalCustomer({});
    expect(r.operational.component).toBeNull();
    expect(r.operational.installation).toBeNull();
    expect(r.evidence).toEqual([]);
    expect(r.divergesFromAdministrative).toBe(false);
  });

  it('does NOT flag divergence when the hierarchy already says Space Force', () => {
    const r = resolveOperationalCustomer({ ...VANDENBERG, subTier: 'UNITED STATES SPACE FORCE' });
    expect(r.operational.component).toBe('U.S. Space Force');
    expect(r.divergesFromAdministrative).toBe(false);   // nothing surprising to report
  });

  it('keeps a non-space installation as the place, without a component', () => {
    const r = resolveOperationalCustomer({
      department: 'DEPT OF DEFENSE', subTier: 'DEPT OF THE NAVY', officeAddressCity: 'NORFOLK',
    });
    expect(r.operational.installation).toBe('NORFOLK');
    expect(r.operational.component).toBeNull();
  });
});
