/**
 * get_sblo_contact must return NO contact rather than another company's (Ask Mindy Backend Spec, Nov 21 2026).
 *
 * Measured 2026-11-21 against the real roster + 3,502-prime DB: the "contains" tier matched by CHARACTER
 * substring, so 246 of 1,200 realistic small-firm names returned a different company — "CA INC." inside
 * "Atlas TechniCAl", "NOVA GROUP" inside "InNOVAtions" — and real primes did too: "CACI" → CA INC.,
 * "Honeywell" → GROUP W INC. These fixtures carry those exact record names.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const bq = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>> }));
vi.mock('@/lib/bigquery/recipients', () => ({ searchRecipients: vi.fn(async () => ({ rows: bq.rows })) }));

vi.mock('@/data/sblo-roster-2026-06.json', () => ({
  default: {
    metadata: { verified: '2026-06' },
    contacts: [
      { company: 'NORTHROP GRUMMAN CORPORATION', sbloName: 'N Liaison', email: 'sb@ngc.example', source: 'Jun 2026' },
      { company: 'Leidos', sbloName: 'L Liaison', email: 'sb@leidos.example', source: 'Jun 2026' },
      { company: 'CACI Federal, Inc.', sbloName: 'C Liaison', email: 'sb@caci.example', source: 'Jun 2026' },
    ],
  },
}));
vi.mock('@/data/prime-contractors-database.json', () => ({
  default: {
    primes: [
      { name: 'CA  INC.', sbloName: null, email: null },
      { name: 'GROUP W INC.', sbloName: null, email: null },
      { name: 'NOVA GROUP  INC.', sbloName: null, email: null },
      { name: 'HONEYWELL INTERNATIONAL INC', sbloName: 'H Liaison', email: 'sb@honeywell.example' },
      { name: 'EAGLE INTEGRATED SERVICES, LLC', sbloName: 'E Liaison', email: 'sb@eagle.example' },
      { name: 'BECHTEL NATIONAL  INC.', sbloName: 'B1', email: 'b1@bechtel.example' },
      { name: 'BECHTEL PLANT MACHINERY  INC.', sbloName: 'B2', email: 'b2@bechtel.example' },
    ],
  },
}));

const { lookupSbloContact, lookupSbloContactEnriched, companyNameRelation } = await import('./sblo-lookup');

beforeEach(() => { bq.rows = []; });

describe('a name inside another word is never a match', () => {
  it.each([
    ['Atlas Technical Services', 'CA  INC.'],
    ['Summit Medical LLC', 'CA  INC.'],
    ['Atlas Innovations Inc', 'NOVA GROUP  INC.'],
  ])('%s → no contact (was %s)', (q) => {
    const r = lookupSbloContact(q);
    expect(r.contact).toBeNull();
    expect(r.matchType).toBe('none');
  });

  it('real primes resolve to themselves, not to a substring record', () => {
    expect(lookupSbloContact('CACI').contact?.company).toBe('CACI Federal, Inc.');
    expect(lookupSbloContact('Honeywell').contact?.company).toBe('HONEYWELL INTERNATIONAL INC');
  });
});

describe('shortened names and legal names', () => {
  it('a shortened name that picks one company still resolves ("Northrop")', () => {
    const r = lookupSbloContact('Northrop');
    expect(r.matchType).toBe('contains');
    expect(r.contact?.company).toBe('NORTHROP GRUMMAN CORPORATION');
  });

  it('a shortened name that starts several companies returns none, with the candidates', () => {
    const r = lookupSbloContact('Bechtel');
    expect(r.contact).toBeNull();
    expect(r.noMatchReason).toBe('ambiguous');
    expect(r.candidates.map((c) => c.company).sort()).toEqual(['BECHTEL NATIONAL  INC.', 'BECHTEL PLANT MACHINERY  INC.']);
  });

  it('a name longer than the record is a different legal entity ("Leidos Health LLC" is not Leidos)', () => {
    const r = lookupSbloContact('Leidos Health LLC');
    expect(r.contact).toBeNull();
    expect(r.noMatchReason).toBe('different_legal_name');
    expect(r.candidates).toEqual([{ company: 'Leidos', matched_from: 'roster' }]);
  });

  it('a FULL legal name (with LLC) that only starts a record is not that record', () => {
    const r = lookupSbloContact('Eagle Integrated LLC');
    expect(r.contact).toBeNull();
    expect(r.noMatchReason).toBe('different_legal_name');
  });

  it('the exact legal name still resolves', () => {
    expect(lookupSbloContact('Eagle Integrated Services LLC').contact?.company).toBe('EAGLE INTEGRATED SERVICES, LLC');
  });
});

describe('the live award-data (BigQuery) fallback uses the same rule', () => {
  it('a recipient whose name only contains the words is not returned', async () => {
    bq.rows = [{ recipient_name: 'BIG SUMMIT ROOFING LLC', recipient_uei: 'AAA111', total_obligated: 1e6, award_count: 3 }];
    const r = await lookupSbloContactEnriched('Summit Roofing');
    expect(r.contact).toBeNull();
  });

  it('one recipient whose name starts with the words is returned as award context (no liaison)', async () => {
    bq.rows = [{ recipient_name: 'SUMMIT ROOFING AND SHEET METAL LLC', recipient_uei: 'BBB222', total_obligated: 1e6, award_count: 3 }];
    const r = await lookupSbloContactEnriched('Summit Roofing');
    expect(r.contact?.company).toBe('SUMMIT ROOFING AND SHEET METAL LLC');
    expect(r.contact?.sblo_name).toBeNull();
  });

  it('a name that resembled curated records is not passed on to BigQuery to pick a company', async () => {
    bq.rows = [{ recipient_name: 'LEIDOS HEALTH LLC', recipient_uei: 'CCC333', total_obligated: 1e6, award_count: 3 }];
    const r = await lookupSbloContactEnriched('Leidos Health LLC');
    expect(r.contact).toBeNull();
    expect(r.noMatchReason).toBe('different_legal_name');
  });
});

describe('companyNameRelation (whole words only)', () => {
  it('compares words, never characters', () => {
    expect(companyNameRelation('ATLAS TECHNICAL', 'CA')).toBeNull();
    expect(companyNameRelation('NORTHROP', 'NORTHROP GRUMMAN')).toBe('query_prefix');
    expect(companyNameRelation('LEIDOS HEALTH', 'LEIDOS')).toBe('record_prefix');
    expect(companyNameRelation('LEIDOS', 'LEIDOS')).toBe('exact');
  });
});
