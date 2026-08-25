/**
 * NS-1 — the local fallback must return the same identity contract as the primary path.
 *
 * Permanent regression fixture: NORTH STAR GOVERNMENT SERVICES (FCJCDUZV7RM3), from the
 * blind chain run of 2026-08-25. The fallback returned status "Unknown", NO NAICS, and
 * 8(a)/HUBZone/WOSB `undefined`, while the stored row held Active, 12 NAICS and
 * ["8(a)","HUBZone","WOSB"] — so the reconciled answer was strictly WORSE than the row we
 * had already stored, and the two certifications that most determine what this company
 * should pursue came back as `undefined`.
 *
 * TRI-STATE RULE: true / false / unknown are three different answers. A missing fallback
 * field must NEVER become false, inactive, or uncertified.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFrom = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (t: string) => mockFrom(t) }),
}));

const { localEntityByUEI, localEntitiesByName } = await import('./entity-local-fallback');

/** The real production row, verbatim. */
const NORTH_STAR_ROW = {
  uei: 'FCJCDUZV7RM3',
  cage_code: '7JGA3',
  legal_business_name: 'NORTH STAR GOVERNMENT SERVICES',
  dba_name: null,
  physical_city: 'SAN DIEGO', physical_state: 'CA', physical_zip: '92101', physical_country: 'USA',
  primary_naics: '236220',
  naics_codes: ['236210','236220','237110','237210','237990','238210','238220','238390','238910','238990','561210','562910'],
  certifications: ['8(a)', 'HUBZone', 'WOSB'],
  certification_records: [
    { certification_type: '8(a)', certification_status: 'current', source_code: 'A620291221' },
    { certification_type: 'HUBZone', certification_status: 'current' },
  ],
  registration_status: 'Active',
  registration_expiry: '2027-03-10',
  exclusion_flag: false,
  sam_url: 'https://sam.gov/entity/FCJCDUZV7RM3',
  synced_at: '2026-08-25T00:01:33.678+00:00',
};

function stubRow(row: unknown) {
  const chain = {
    select: () => chain, eq: () => chain, ilike: () => chain,
    limit: () => Promise.resolve({ data: row ? [row] : [], error: null }),
  };
  mockFrom.mockReturnValue(chain);
}

beforeEach(() => { mockFrom.mockReset(); process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://x'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'k'; });

describe('NS-1 — identity contract parity (North Star fixture)', () => {
  it('⚠️ THE REGRESSION: returns Active, all 12 NAICS, and the stored certifications', async () => {
    stubRow(NORTH_STAR_ROW);
    const e = (await localEntityByUEI('FCJCDUZV7RM3'))!.entity as never as Record<string, unknown>;

    expect(e.registrationStatus).toBe('Active');            // was hardcoded 'Unknown'
    expect((e.naicsList as unknown[]).length).toBe(12);     // was absent entirely
    expect(e.has8a).toBe(true);                             // was undefined
    expect(e.hasHUBZone).toBe(true);                        // was undefined
    expect(e.hasWOSB).toBe(true);                           // was undefined
  });

  it('carries the full identity contract', async () => {
    stubRow(NORTH_STAR_ROW);
    const e = (await localEntityByUEI('FCJCDUZV7RM3'))!.entity as never as Record<string, unknown>;
    expect(e.ueiSAM).toBe('FCJCDUZV7RM3');
    expect(e.cageCode).toBe('7JGA3');
    expect(e.registrationExpirationDate).toBe('2027-03-10');
    expect(e.primaryNaics).toBe('236220');
    expect(e.hasExclusions).toBe(false);
  });

  it('flags the PRIMARY naics inside naicsList', async () => {
    stubRow(NORTH_STAR_ROW);
    const e = (await localEntityByUEI('FCJCDUZV7RM3'))!.entity as never as Record<string, unknown>;
    const list = e.naicsList as Array<{ naicsCode: string; isPrimary: boolean }>;
    expect(list.filter((n) => n.isPrimary).map((n) => n.naicsCode)).toEqual(['236220']);
  });

  it('reports freshness so a cached row is never presented as a live check', async () => {
    stubRow(NORTH_STAR_ROW);
    expect((await localEntityByUEI('FCJCDUZV7RM3'))!.asOf).toBe('2026-08-25T00:01:33.678+00:00');
  });

  describe('TRI-STATE — true / false / unknown stay distinct', () => {
    it('an UNKNOWN certification is ABSENT, never false', async () => {
      stubRow(NORTH_STAR_ROW);   // no SDVOSB anywhere in the row
      const e = (await localEntityByUEI('FCJCDUZV7RM3'))!.entity as never as Record<string, unknown>;
      expect('hasSDVOSB' in e).toBe(false);      // absent = we do not know
      expect(e.hasSDVOSB).not.toBe(false);       // and specifically NOT a negative claim
    });

    it('an EXPIRED record is a real false, not unknown', async () => {
      stubRow({ ...NORTH_STAR_ROW, certifications: [],
        certification_records: [{ certification_type: '8(a)', certification_status: 'expired' }] });
      const e = (await localEntityByUEI('X'))!.entity as never as Record<string, unknown>;
      expect(e.has8a).toBe(false);               // measured lapse — a claim we can defend
    });

    it('a missing registration_status does not become "Active"', async () => {
      stubRow({ ...NORTH_STAR_ROW, registration_status: null });
      const e = (await localEntityByUEI('X'))!.entity as never as Record<string, unknown>;
      expect(e.registrationStatus).toBe('Unknown');
    });

    it('missing NAICS yields an empty list, not a fabricated one', async () => {
      stubRow({ ...NORTH_STAR_ROW, naics_codes: null, primary_naics: null });
      const e = (await localEntityByUEI('X'))!.entity as never as Record<string, unknown>;
      expect(e.naicsList).toEqual([]);
      expect('primaryNaics' in e).toBe(false);
    });
  });

  it('the NAME path returns the same contract as the UEI path', async () => {
    stubRow(NORTH_STAR_ROW);
    const byName = (await localEntitiesByName('North Star Government Services'))[0].entity as never as Record<string, unknown>;
    stubRow(NORTH_STAR_ROW);
    const byUei = (await localEntityByUEI('FCJCDUZV7RM3'))!.entity as never as Record<string, unknown>;
    expect(Object.keys(byName).sort()).toEqual(Object.keys(byUei).sort());
    expect(byName.has8a).toBe(byUei.has8a);
    expect((byName.naicsList as unknown[]).length).toBe((byUei.naicsList as unknown[]).length);
  });
});
