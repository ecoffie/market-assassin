/**
 * 2026-11-22 critical regression (36C24825C0020). Asked for the incumbent of CONTRACT 36C24825C0020 (Blue Cord
 * Design and Construction, $8.44M, ending 2026-11-23), get_solicitation_incumbent took the SAM public index's top
 * full-text hit, the award notice of solicitation 36C24824R0177 that MENTIONS the contract number, and named
 * Daniels Building Co (36C77624C0154, $14.0M, ending 2026-10-15) as the incumbent with high confidence.
 *
 * The SAM public payload below is the shape of the live response (trimmed). These tests fail on main.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/sam/resolve-solicitation', async (orig) => ({
  ...(await orig<typeof import('@/lib/sam/resolve-solicitation')>()),
  resolveCanonicalSolicitation: vi.fn(async () => null), // not in our cache, as in production
}));

import { noticeIdentity, normalizeIdentifier, resolveSamNotice, resolveSolicitationIncumbent, MENTIONED_ONLY_NOTE } from './solicitation-incumbent';

const AWARD_NOTICE_HIT = {
  _id: 'a0931c2de70f4f32a4d183c3a1ce84c2',
  solicitationNumber: '36C24824R0177',
  title: 'Y1DA--FY25: NRM (PROJ: 673-21-149) BB Convert 6 West to Private  Patient Rooms',
  type: { value: 'Award Notice' },
  naics: [{ code: '236220' }],
  psc: [{ code: 'Y1DA' }],
  organizationHierarchy: [{ name: 'VETERANS AFFAIRS, DEPARTMENT OF' }],
  publishDate: '2025-07-10T13:40:33+00:00',
};

const fetchMock = vi.fn();
const savedKeys = { a: process.env.SAM_API_KEY, b: process.env.SAM_GOV_API_KEY };

beforeEach(() => {
  delete process.env.SAM_API_KEY;
  delete process.env.SAM_GOV_API_KEY;
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (savedKeys.a !== undefined) process.env.SAM_API_KEY = savedKeys.a;
  if (savedKeys.b !== undefined) process.env.SAM_GOV_API_KEY = savedKeys.b;
});

const samPublic = (results: unknown[]) => fetchMock.mockImplementation(async (url: string) => {
  if (String(url).includes('sam.gov/api/prod/sgs')) return new Response(JSON.stringify({ _embedded: { results } }), { status: 200 });
  // USASpending prior-award search: nothing (only reached when the notice IS the identifier).
  return new Response(JSON.stringify({ results: [] }), { status: 200 });
});

describe('36C24825C0020: a contract number is never resolved to a notice that only mentions it', () => {
  it('SAM public search: the top full-text hit is NOT taken when its number differs from the query', async () => {
    samPublic([AWARD_NOTICE_HIT]);
    const { notice } = await resolveSamNotice('36C24825C0020');
    expect(notice).toBeNull();
  });

  it('a partial identifier does not match a longer solicitation number', async () => {
    samPublic([{ ...AWARD_NOTICE_HIT, solicitationNumber: '36C24824R0177A' }]);
    expect((await resolveSamNotice('36C24824R0177')).notice).toBeNull();
  });

  it('get_solicitation_incumbent names no incumbent and points to get_award_detail', async () => {
    samPublic([AWARD_NOTICE_HIT]);
    const r = await resolveSolicitationIncumbent('36C24825C0020');
    expect(r.notice).toBeNull();
    expect(r.incumbent).toBeNull();
    expect(r.prior_awards).toEqual([]);
    expect(r._meta.incumbent_finding).toBe('notice_not_found');
    expect(r._meta.absence_note).toMatch(/get_award_detail/);
    expect(JSON.stringify(r)).not.toMatch(/DANIELS|36C77624C0154/);
    // No USASpending prior-award search ran for a notice that is not the identifier.
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('usaspending'))).toBe(false);
  });

  it('the exact solicitation number still resolves (formatting differences ignored)', async () => {
    samPublic([AWARD_NOTICE_HIT]);
    const { notice } = await resolveSamNotice('36C248-24-R-0177');
    expect(notice?.solicitation_number).toBe('36C24824R0177');
  });
});

describe('noticeIdentity', () => {
  const n = { notice_id: 'a0931c2de70f4f32a4d183c3a1ce84c2', solicitation_number: '36C24824R0177', notice_ids: ['a0931c2de70f4f32a4d183c3a1ce84c2'] };
  it('identity by solicitation number or notice id, never by mention', () => {
    expect(noticeIdentity('36c24824r0177', n)).toBe('identity');
    expect(noticeIdentity('a0931c2d-e70f-4f32-a4d1-83c3a1ce84c2', n)).toBe('identity');
    expect(noticeIdentity('36C24825C0020', { ...n, matched_by: 'description_identifier' })).toBe('mentioned_only');
    expect(noticeIdentity('', n)).toBe('mentioned_only');
  });
  it('normalizeIdentifier keeps letters and digits only', () => {
    expect(normalizeIdentifier(' 36c248-25-c-0020 ')).toBe('36C24825C0020');
  });
  it('the mentioned-only note forbids presenting another award as the contract', () => {
    expect(MENTIONED_ONLY_NOTE).toMatch(/Never present another award as this contract/);
  });
});
