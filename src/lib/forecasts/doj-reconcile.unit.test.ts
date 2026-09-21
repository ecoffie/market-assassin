import { describe, it, expect } from 'vitest';
import {
  auditDojIdentity, planDojReconciliation, dojPlanReconciles, dojPlanIsSemanticallySane,
  dojWorkbookFingerprint, dojDataAdvanced, DOJ_SOURCE_OWNED_FIELDS, DOJ_DERIVED_FIELDS,
  type DojRow,
} from './doj-reconcile';
import { canonicalTitle, placeOf } from './doj-parse';

const audit = (atns: string[]) => auditDojIdentity(atns);
const plan = (up: DojRow[], rej: Set<string>, held: Map<string, Record<string, unknown>>, atns: string[]) =>
  planDojReconciliation(up, rej, held as never, audit(atns));

describe('identity — unique-ATN only', () => {
  it('rejects the ENTIRE duplicate group, not just the extras', () => {
    const a = audit(['A', 'B', 'B', 'B', 'C']);
    expect(a.duplicateAtnGroups).toEqual(['B']);
    expect(a.identityRejectedRows).toBe(3);      // all three B rows, not 2
    expect(a.usableUniqueIdentity).toBe(2);
    expect(a.usableUniqueIdentity + a.identityRejectedRows).toBe(a.rawUpstream);
  });

  it('a blank ATN is rejected, never given a fallback identity', () => {
    const a = audit(['A', '', '  ']);
    expect(a.blankAtnRows).toBe(2);
    expect(a.usableUniqueIdentity).toBe(1);
  });
});

describe('NULL-OVER-VALUE protection', () => {
  it('a held value is PRESERVED when the source stops supplying it', () => {
    const held = new Map([['FY26-A-1-1', { title: 'T', poc_email: 'real@doj.gov' }]]);
    const p = plan([{ external_id: 'FY26-A-1-1', title: 'T', poc_email: null }], new Set(), held, ['FY26-A-1-1']);
    expect(p.toUpdate).toHaveLength(0);
    expect(p.unchanged).toBe(1);
    expect(p.nullProtected.poc_email).toBe(1);
    expect(p.nullProtectedRows).toBe(1);
  });

  // The exact regression the contract asks for.
  it('a legitimate change still lands while the protected field is ABSENT from the payload', () => {
    // Title held constant: the cross-edition guard keys on title, and this test is
    // about null-protection, not identity.
    const held = new Map([['FY26-A-1-1', { title: 'T', psc_code: null, poc_email: 'real@doj.gov' }]]);
    const p = plan([{ external_id: 'FY26-A-1-1', title: 'T', psc_code: 'Z2FF', poc_email: null }], new Set(), held, ['FY26-A-1-1']);
    expect(p.toUpdate).toHaveLength(1);
    expect(p.toUpdate[0].patch).toEqual({ psc_code: 'Z2FF' });
    expect(p.toUpdate[0].patch).not.toHaveProperty('poc_email');
    expect(p.nullProtected.poc_email).toBe(1);
  });

  it('null -> null is not a change and not a protection', () => {
    const held = new Map([['FY26-A-1-1', { title: 'T', poc_email: null }]]);
    const p = plan([{ external_id: 'FY26-A-1-1', title: 'T', poc_email: null }], new Set(), held, ['FY26-A-1-1']);
    expect(p.unchanged).toBe(1);
    expect(p.nullProtectedRows).toBe(0);
  });
});

describe('CROSS-EDITION ATN reuse', () => {
  it('a different procurement under a matched ATN is SUSPECT — no update, no insert', () => {
    const held = new Map([['FY26-A-1-1', { title: 'Parking Services' }]]);
    const p = plan([{ external_id: 'FY26-A-1-1', title: 'Real Property Management Services' }], new Set(), held, ['FY26-A-1-1']);
    expect(p.crossEditionSuspect).toHaveLength(1);
    expect(p.toUpdate).toHaveLength(0);
    expect(p.toInsert).toHaveLength(0);           // never a second row under the same ATN
    expect(p.matchedExisting).toBe(0);
    expect(p.absentUpstream).toHaveLength(0);     // counted as suspect, not absent
  });

  it('a benign solicitation-code move is EQUIVALENT and still updates', () => {
    const held = new Map([['FY26-A-1-1', { title: 'Widget Purchase - 2026-SG-0036', psc_code: null }]]);
    const p = plan([{ external_id: 'FY26-A-1-1', title: '2026-SG-0036 - Widget Purchase', psc_code: 'X1' }], new Set(), held, ['FY26-A-1-1']);
    expect(p.crossEditionSuspect).toHaveLength(0);
    expect(p.toUpdate).toHaveLength(1);
    expect(p.toUpdate[0].changedFields).toContain('psc_code');
  });

  it('an EMPTY source title is null-protection, NOT a suspect', () => {
    const held = new Map([['FY26-A-1-1', { title: 'DENTAL HYGIENIST', psc_code: null }]]);
    const p = plan([{ external_id: 'FY26-A-1-1', title: null, psc_code: 'X1' }], new Set(), held, ['FY26-A-1-1']);
    expect(p.crossEditionSuspect).toHaveLength(0);
    expect(p.nullProtected.title).toBe(1);
    expect(p.toUpdate[0].patch).not.toHaveProperty('title');
  });
});

describe('canonicalTitle is deterministic, never fuzzy', () => {
  it('ignores case, punctuation and solicitation-code position', () => {
    expect(canonicalTitle('Widget Purchase - 2026-SG-0036')).toBe(canonicalTitle('2026-SG-0036 - Widget Purchase'));
    expect(canonicalTitle('Investigative Case (ICDE)')).toBe(canonicalTitle('2026-ST-0247 - Investigative Case (ICDE)'));
  });
  it('does NOT collapse genuinely different procurements', () => {
    expect(canonicalTitle('Parking Services')).not.toBe(canonicalTitle('Real Property Management Services'));
    expect(canonicalTitle('Helicopter Hoist Repair')).not.toBe(canonicalTitle('9mm Ammunition'));
  });
});

describe('field ownership', () => {
  it('derived and enrichment fields are not source-owned', () => {
    for (const f of [...DOJ_DERIVED_FIELDS, 'map_lat', 'map_lng', 'map_loc_source', 'last_synced_at']) {
      expect(DOJ_SOURCE_OWNED_FIELDS as readonly string[]).not.toContain(f);
    }
  });
  it('an excluded field cannot enter a patch even when another field changes', () => {
    const held = new Map([['FY26-A-1-1', { title: 'T', psc_code: null }]]);
    const up = { external_id: 'FY26-A-1-1', title: 'T', psc_code: 'Z2FF', map_lat: 99, anticipated_quarter: 'Q1' } as unknown as DojRow;
    const p = plan([up], new Set(), held, ['FY26-A-1-1']);
    expect(Object.keys(p.toUpdate[0].patch)).toEqual(['psc_code']);
  });
});

describe('bracketed place tokens', () => {
  it('[Nationwide] is a state placeholder, never a city', () => {
    expect(placeOf('[Nationwide]')).toEqual({ state: '[Nationwide]' });
    expect(placeOf('Seattle, WA')).toEqual({ city: 'Seattle', state: 'WA' });
  });
});

describe('gates', () => {
  it('the Navy shape — balanced arithmetic, zero matches — is rejected', () => {
    const held = new Map([['FY26-OLD-1-1', { title: 'x' }], ['FY26-OLD-1-2', { title: 'y' }]]);
    const p = plan([{ external_id: 'FY26-NEW-1-1', title: 'a' }], new Set(), held, ['FY26-NEW-1-1']);
    expect(dojPlanIsSemanticallySane(p, held.size).ok).toBe(false);
  });
  it('fingerprint: non-XLSX and empty are NULL, never a hash of nothing', () => {
    expect(dojWorkbookFingerprint(new Uint8Array())).toBeNull();
    expect(dojWorkbookFingerprint(new Uint8Array([0x3c, 0x68, 0x74]))).toBeNull();  // "<ht" = HTML
    expect(dojWorkbookFingerprint(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toMatch(/^[0-9a-f]{32}$/);
  });
  it('dataAdvanced only on a real mutation', () => {
    expect(dojDataAdvanced(0, 0)).toBe(false);
    expect(dojDataAdvanced(1, 0)).toBe(true);
  });
});
