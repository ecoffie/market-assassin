/**
 * Parent-contract / vehicle scope — the pure contract every reader applies (Map PostgREST path, its
 * SQL twin, the MCP task-order search). Hermetic: the compiled registry is mocked so these tests do
 * not depend on a verification run.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/data/vehicles/vehicle-parents.json', () => ({
  default: {
    verified_at: '2026-09-24T00:00:00.000Z',
    source: 'test',
    candidate_population: 'test',
    candidates: 4,
    unresolved_candidates: 0,
    vehicles: {
      oasis_plus: {
        members: [
          { parent_id: 'CONT_IDV_47QRCA25DA002_4732', solicitation_identifier: '47QRCA23R0002', recipient_name: 'AEC-WESTON JV, LLC' },
          { parent_id: 'CONT_IDV_47QRCA24DH016_4732', solicitation_identifier: '47QRCA23R0003', recipient_name: 'NIYAMIT, INC.' },
          // A compiled row whose solicitation is NOT an OASIS+ solicitation must never count as a member.
          { parent_id: 'CONT_IDV_47QRAD20D1001_4732', solicitation_identifier: 'GS00Q-13-DR-0002', recipient_name: 'NOUDYNE LLC' },
        ],
      },
    },
  },
}));

import {
  naicsCodesForTerm, parentPrefilterExpr, parentScopeExpr, parseParentId, recordedParent, resolveParentScope, workEvidence, workScopeExprs, workTerms,
  type ParentRef,
} from './parent-scope';
import { resolveVehicle, vehicleOfParent } from './registry';

/** JS evaluation of the PostgREST `contract_id.match."<re>"` leaves in a parentScopeExpr body. */
function matches(expr: string, contractId: string): boolean {
  const res = [...expr.matchAll(/contract_id\.match\."((?:[^"\\]|\\.)*)"/g)].map((m) => m[1].replace(/\\\\/g, '\\'));
  expect(res.length).toBeGreaterThan(0);
  return res.some((re) => new RegExp(re).test(contractId));
}

describe('vehicle resolution — authoritative mapping only', () => {
  it('OASIS+ and its spellings resolve to the verified members (solicitation-checked)', () => {
    for (const name of ['OASIS+', 'oasis plus', 'OASIS Plus', 'GSA OASIS+', 'oasis_plus']) {
      const r = resolveVehicle(name);
      expect(r.status, name).toBe('resolved');
      if (r.status === 'resolved') {
        expect(r.members.map((m) => m.parent_id).sort()).toEqual(['CONT_IDV_47QRCA24DH016_4732', 'CONT_IDV_47QRCA25DA002_4732']);
      }
    }
  });
  it('a member whose recorded solicitation is original OASIS is excluded even if compiled under OASIS+', () => {
    expect(vehicleOfParent('CONT_IDV_47QRAD20D1001_4732')).toBeNull();
    expect(vehicleOfParent('CONT_IDV_47QRCA25DA002_4732')).toMatchObject({ key: 'oasis_plus', pool: '8(a)' });
  });
  it('"OASIS" alone is ambiguous — never silently OASIS+', () => {
    const r = resolveVehicle('OASIS');
    expect(r.status).toBe('ambiguous');
    expect(resolveVehicle('oasis sb').status).toBe('ambiguous');
  });
  it('an unregistered vehicle is unknown, with a reason', () => {
    const r = resolveVehicle('Alliant 3');
    expect(r.status).toBe('unknown');
    if (r.status === 'unknown') expect(r.reason).toMatch(/No authoritative mapping/);
  });
});

describe('resolveParentScope', () => {
  it('no scope → none', () => {
    expect(resolveParentScope({})).toEqual({ status: 'none' });
  });
  it('exact parent ids parse, dedupe, and keep the agency as identity', () => {
    const s = resolveParentScope({ parent: 'cont_idv_47qrca25da002_4732, CONT_IDV_47QRCA25DA002_4732,CONT_IDV_FA850124D0005_9700' });
    expect(s.status).toBe('resolved');
    if (s.status === 'resolved') expect(s.parents).toEqual([{ piid: '47QRCA25DA002', agency: '4732' }, { piid: 'FA850124D0005', agency: '9700' }]);
  });
  it('a bare PIID / malformed id is invalid, never guessed', () => {
    for (const parent of ['47QRCA25DA002', 'CONT_AWD_X_4732_Y_4732', 'CONT_IDV_47QRCA25DA002']) {
      const s = resolveParentScope({ parent });
      expect(s.status, parent).toBe('unresolved');
      if (s.status === 'unresolved') expect(s.reason_code).toBe('invalid_parent_id');
    }
  });
  it('vehicle AND parent together is refused', () => {
    expect(resolveParentScope({ vehicle: 'OASIS+', parent: 'CONT_IDV_47QRCA25DA002_4732' }).status).toBe('unresolved');
  });
  it('unknown / ambiguous vehicles carry distinct reason codes', () => {
    const u = resolveParentScope({ vehicle: 'Alliant 3' });
    const a = resolveParentScope({ vehicle: 'OASIS' });
    expect(u.status === 'unresolved' && u.reason_code).toBe('unknown_vehicle');
    expect(a.status === 'unresolved' && a.reason_code).toBe('ambiguous_vehicle');
  });
});

describe('parentScopeExpr — anchored on the PARENT slot, exact', () => {
  const oasisPlus: ParentRef[] = [{ piid: '47QRCA25DA002', agency: '4732' }, { piid: '47QRCA24DH016', agency: '4732' }];
  const expr = parentScopeExpr(oasisPlus);

  it('admits orders placed under a member parent', () => {
    expect(matches(expr, 'CONT_AWD_W91CRB26F0001_9700_47QRCA25DA002_4732')).toBe(true);
    expect(matches(expr, 'CONT_AWD_70RSAT26FR0000011_7001_47QRCA24DH016_4732')).toBe(true);
  });
  it('negative controls: original OASIS, unrelated vehicle, standalone, other agency', () => {
    expect(matches(expr, 'CONT_AWD_W58RGZ25F0101_9700_47QRAD20D1001_4732')).toBe(false); // original OASIS
    expect(matches(expr, 'CONT_AWD_FA850126F0034_9700_FA850124D0005_9700')).toBe(false); // Mech-Elec II
    expect(matches(expr, 'CONT_AWD_47QRCA25DA002_4732_-NONE-_-NONE-')).toBe(false);        // the PIID as the ORDER, no parent
    expect(matches(expr, 'CONT_AWD_X1_9700_47QRCA25DA002_9700')).toBe(false);              // same PIID, different parent agency
    expect(matches(expr, 'CONT_AWD_X1_9700_47QRCA25DA0021_4732')).toBe(false);             // prefix of a longer PIID
    expect(matches(expr, 'CONT_AWD_X1_9700_147QRCA25DA002_4732')).toBe(false);             // suffix inside a longer PIID
    expect(matches(expr, '47QRCA25DA002')).toBe(false);                                    // raw-PIID legacy row (no recorded parent)
  });
  it('an empty parent set selects NOTHING (fail closed)', () => {
    const none = parentScopeExpr([]);
    expect(matches(none, 'CONT_AWD_W91CRB26F0001_9700_47QRCA25DA002_4732')).toBe(false);
    expect(matches(none, '')).toBe(true); // only the empty string — contract_id is never empty
  });
  it('recordedParent reads the same slot', () => {
    expect(recordedParent('CONT_AWD_W91CRB26F0001_9700_47QRCA25DA002_4732')).toEqual({ piid: '47QRCA25DA002', agency: '4732' });
    expect(recordedParent('CONT_AWD_X_4732_-NONE-_-NONE-')).toBeNull();
    expect(parseParentId('CONT_IDV_47QRCA25DA002_4732')).toEqual({ piid: '47QRCA25DA002', agency: '4732' });
  });
});

describe('parentPrefilterExpr — a superset of the exact scope, derived from the parents', () => {
  const likeMatch = (expr: string, id: string) => expr.split(',').some((leaf) => {
    const pat = leaf.replace(/^contract_id\.like\./, '');
    return new RegExp('^' + pat.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/_/g, '.')).join('.*') + '$').test(id);
  });
  it('admits every order the exact expression admits', () => {
    const parents: ParentRef[] = [{ piid: '47QRCA25DA002', agency: '4732' }, { piid: 'FA850124D0005', agency: '9700' }];
    const pre = parentPrefilterExpr(parents), exact = parentScopeExpr(parents);
    for (const id of ['CONT_AWD_W91CRB26F0001_9700_47QRCA25DA002_4732', 'CONT_AWD_FA850126F0034_9700_FA850124D0005_9700']) {
      expect(matches(exact, id)).toBe(true);
      expect(likeMatch(pre, id)).toBe(true);
    }
    expect(pre.split(',')).toHaveLength(2);
  });
  it('empty → never matches', () => {
    expect(parentPrefilterExpr([])).toBe('contract_id.match."^$"');
  });
});

describe('work subject — WORK fields only, every term required', () => {
  it('terms drop filler words', () => {
    expect(workTerms('Management Consulting services')).toEqual(['management', 'consulting']);
  });
  it('one or() body per term, over the work fields + codes whose OFFICIAL NAICS title has the word', () => {
    const exprs = workScopeExprs('management consulting');
    expect(exprs).toHaveLength(2);
    for (const e of exprs) {
      expect(e).toMatch(/^description\.imatch\..*,naics_description\.imatch\..*,psc_description\.imatch\./);
      expect(e).not.toMatch(/incumbent_name|awarding_agency/);
      expect(e).toContain('naics_code.eq.541611');
    }
  });
  it('NAICS title codes come from the official titles only (whole word)', () => {
    expect(naicsCodesForTerm('consulting')).toContain('541611');
    expect(naicsCodesForTerm('consulting')).not.toContain('541511'); // Custom Computer Programming Services
    expect(naicsCodesForTerm('zzzzqq')).toEqual([]);
  });
  it('naics_description being empty still yields grounded evidence from the official code title', () => {
    expect(workEvidence({ naics_code: '541611', naics_description: null, description: 'SUPPORT' }, 'management consulting')
      .every((e) => e.fields.some((f) => f.startsWith('naics_title(541611')))).toBe(true);
  });
  it('evidence names the field each term was found in; agency/incumbent words are not evidence', () => {
    const row = {
      description: 'PROGRAM SUPPORT', naics_description: 'ADMINISTRATIVE MANAGEMENT AND GENERAL MANAGEMENT CONSULTING SERVICES',
      psc_description: null, incumbent_name: 'ACME CONSULTING LLC', awarding_agency: 'FEDERAL EMERGENCY MANAGEMENT AGENCY',
    };
    expect(workEvidence({ ...row, naics_code: null }, 'management consulting')).toEqual([
      { term: 'management', fields: ['naics_description'] },
      { term: 'consulting', fields: ['naics_description'] },
    ]);
    const decoy = { description: 'JANITORIAL SERVICES', naics_description: 'JANITORIAL SERVICES', incumbent_name: 'ACME CONSULTING', awarding_agency: 'EMERGENCY MANAGEMENT AGENCY' };
    expect(workEvidence(decoy, 'management consulting').every((e) => e.fields.length === 0)).toBe(true);
  });
  it('whole words only — inflections match, substrings inside other words do not', () => {
    expect(workEvidence({ description: 'CONSULTING' }, 'consult')[0].fields).toEqual(['description']);
    expect(workEvidence({ description: 'MANAGEMENTS' }, 'management')[0].fields).toEqual(['description']);
    expect(workEvidence({ description: 'MISMANAGEMENT' }, 'management')[0].fields).toEqual([]);
  });
});
