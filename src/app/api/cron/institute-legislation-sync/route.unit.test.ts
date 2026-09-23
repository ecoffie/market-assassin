/**
 * The legislation route's HEADLINE state is the current authorization's — driven through
 * the real GET handler (preview mode, so nothing is written). Congress, the database and
 * discovery are faked; the family collection, per-FY classification and response are real.
 *
 * Regression 2026-09-22: the headline aggregated every family, so FY2026's enactment
 * (S.1071 → PL 119-60) made the run report "enacted" while FY2027 was only House-passed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const fakeDb = {
  from: () => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { notes: null }, error: null }) }) }),
  }),
};
vi.mock('@supabase/supabase-js', () => ({ createClient: () => fakeDb }));
vi.mock('@/lib/cron-self-report', () => ({ reportCronOutcome: async () => undefined }));

type Ref = { congress: number; billType: string; number: string; title: string; updateDate: string | null; originChamber: string | null };
const vehicles: Ref[] = [
  { congress: 119, billType: 'S', number: '11', title: 'National Defense Authorization Act for Fiscal Year 2026', updateDate: null, originChamber: 'Senate' },
  { congress: 119, billType: 'S', number: '22', title: 'National Defense Authorization Act for Fiscal Year 2026', updateDate: null, originChamber: 'Senate' },
  { congress: 119, billType: 'HR', number: '33', title: 'National Defense Authorization Act for Fiscal Year 2027', updateDate: null, originChamber: 'House' },
  { congress: 119, billType: 'S', number: '44', title: 'National Defense Authorization Act for Fiscal Year 2027', updateDate: null, originChamber: 'Senate' },
];
const enacted = new Set(['S11']);

vi.mock('@/lib/institute/legislation-discovery', async (orig) => ({
  ...(await orig<typeof import('@/lib/institute/legislation-discovery')>()),
  discoverSince: async () => ({ pollOk: true, coverage: 'complete', scanned: 4, reportedTotal: 4, windowFrom: null, matched: vehicles }),
  knownMeasures: async () => ({ measures: [] }),
}));
vi.mock('@/lib/institute/legislation', async (orig) => {
  const real = await orig<typeof import('@/lib/institute/legislation')>();
  return {
    ...real,
    congressApiKey: () => 'test-key',
    collectBillDocuments: async (ref: Ref) => {
      const law = enacted.has(`${ref.billType}${ref.number}`);
      const status = { latestActionDate: null, latestActionText: null, becameLaw: law, lawNumber: law ? '119-60' : null };
      const versions = [{ type: ref.billType === 'HR' ? 'Engrossed in House' : 'Reported to Senate', date: '2026-06-15', formats: [] }];
      return { documents: real.billVersionsToDocuments(ref, versions, status, '2026-09-22T00:00:00Z'), status };
    },
  };
});

import { GET } from './route';

beforeEach(() => { process.env.ADMIN_PASSWORD = 'pw'; });

describe('institute-legislation-sync — headline discovery state', () => {
  it('reports the CURRENT fiscal year (FY2027, diverging) — never a prior year\'s enactment', async () => {
    const res = await GET(new NextRequest('http://local/api/cron/institute-legislation-sync?mode=preview&password=pw'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ mode: 'preview', discoveryState: 'diverging', currentFiscalYear: 2027 });
    expect(body.fiscalYearStates).toEqual({ 2026: 'enacted', 2027: 'diverging' });
    expect(body.note).toBe('preview — nothing written');
  });
});
