/**
 * REGRESSION — PAR-26-120: a LIVE grant missing from a COMPLETE listing must never be hidden.
 *
 * Measured 2026-09-26 (tasks/evidence/grants-cache-reconcile/classify-all-103-2026-09-26.json):
 * - grants_cache held PAR-26-120 (Grants.gov id 361275) as `forecasted`;
 * - the complete run (925/925 posted, 611/611 forecasted) did not list PAR-26-120;
 * - the official fetchOpportunity said id 361275 is a LIVE synopsis (archiveDate Jan 04, 2030);
 * - the same id 361275 WAS listed that day as PAR-28-056 (posted). All 17 "live but absent" rows of the
 *   103 were this identity case: renumbered, not removed.
 *
 * Driven through the REAL ingestGrants → reconcile → confirmAbsentGrants → getGrantsViewportPins. Only I/O
 * is faked (Grants.gov search pages, fetchOpportunity, Supabase in memory).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeFakeDb, type FakeDb } from './grants-cache-fake';

type G = { oppNumber: string; id: string; closeDate?: string | null };
const LISTING: Record<string, G[]> = { posted: [], forecasted: [] };
vi.mock('./search', () => ({
  searchGrants: vi.fn(async ({ status, offset, limit }: { status: string; offset: number; limit: number }) => {
    const all = LISTING[status] || [];
    const page = all.slice(offset, offset + limit);
    return {
      grants: page.map((g) => ({
        oppNumber: g.oppNumber, title: `T ${g.oppNumber}`, agency: 'NIH', agencyCode: 'HHS-NIH11', description: '',
        awardCeiling: null, postedDate: '09/01/2026', closeDate: g.closeDate ?? '12/31/2026', status, cfdaList: [],
        url: `https://www.grants.gov/search-results-detail/${g.id}`,
      })),
      total: all.length, agencyFiltered: false, degraded: false,
    };
  }),
}));

let DB: FakeDb;
vi.mock('@/lib/supabase/server-clients', () => ({ getReadClient: () => DB }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => DB }));

import { ingestGrants } from './ingest';
import { getGrantsViewportPins } from '@/lib/opportunities/map-data';

const NOW = '2026-09-26T09:00:00.000Z';
const US = { west: -180, south: -90, east: 180, north: 90 };
const cached = (opp: string, id: string, status: 'posted' | 'forecasted', extra: Record<string, unknown> = {}) => ({
  opp_number: opp, title: opp, agency: 'NIH', agency_code: 'HHS-NIH11', status, award_ceiling: null,
  close_date: status === 'posted' ? '2026-12-31' : null, posted_date: '2026-08-01',
  url: `https://www.grants.gov/search-results-detail/${id}`, map_lat: 39.0, map_lng: -77.1, map_loc_source: 'agency_hq',
  absent_since: null, source_status: null, source_checked_at: null, superseded_by: null, ...extra,
});
/** Measured fetchOpportunity shapes (2026-09-26). */
const LIVE_SYNOPSIS = { errorcode: 0, data: { id: 361275, docType: 'synopsis', synopsis: { archiveDate: 'Jan 04, 2030 12:00:00 AM EST', responseDate: '' } } };
const ARCHIVED_SYNOPSIS = { errorcode: 0, data: { id: 361275, docType: 'synopsis', synopsis: { archiveDate: 'Sep 23, 2026 12:00:00 AM EDT' } } };
const NOT_FOUND = { errorcode: 0, data: {} };
const respond = (status: number, body: unknown) => (async () => ({ status, json: async () => body })) as unknown as typeof fetch;

function world(opts: { relistedAs?: string | null }) {
  // A complete listing of other grants, plus (optionally) the SAME id 361275 under its new number.
  // Enough other listed grants that one absence stays under the reconcile breaker (20%).
  const others = Array.from({ length: 12 }, (_, i) => ({ oppNumber: `PAR-27-${String(i + 1).padStart(3, '0')}`, id: String(400001 + i) }));
  LISTING.posted = [...others];
  if (opts.relistedAs) LISTING.posted.push({ oppNumber: opts.relistedAs, id: '361275' });
  LISTING.forecasted = [{ oppNumber: 'FOR-X-1', id: '400999', closeDate: null }];
  DB = makeFakeDb([
    cached('PAR-26-120', '361275', 'forecasted'),
    ...others.map((g) => cached(g.oppNumber, g.id, 'posted')), cached('FOR-X-1', '400999', 'forecasted'),
  ]);
}
const ingest = (fetchImpl?: typeof fetch, confirmLimit = 0) =>
  ingestGrants(DB as never, { nowIso: NOW, pageSize: 100, confirmLimit, fetchImpl });
const rowOf = (opp: string) => DB.tables.grants_cache.find((r) => r.opp_number === opp)!;
const visible = async () => (await getGrantsViewportPins(US)).map((p) => ({ sol: p.sol, verification: p.verification }));

beforeEach(() => { LISTING.posted = []; LISTING.forecasted = []; });

describe('PAR-26-120 — the measured case: same grant re-listed under a new number', () => {
  it('is recorded as SUPERSEDED by PAR-28-056 (record kept); the grant is visible exactly once, via its current row', async () => {
    world({ relistedAs: 'PAR-28-056' });
    await ingest();
    expect(rowOf('PAR-26-120')).toMatchObject({ superseded_by: 'PAR-28-056' });
    expect(rowOf('PAR-26-120').absent_since).toBeTruthy();
    const v = await visible();
    expect(v.filter((p) => p.sol === 'PAR-28-056')).toEqual([{ sol: 'PAR-28-056', verification: 'listed' }]);
    expect(v.some((p) => p.sol === 'PAR-26-120')).toBe(false); // not a second copy of the same grant
    expect(DB.tables.grants_cache.some((r) => r.opp_number === 'PAR-26-120')).toBe(true); // preserved
  });
});

describe('PAR-26-120 — the rule when the live grant is genuinely missing from a complete listing', () => {
  it('absent from a complete listing → marked absent/unverified and STILL VISIBLE (never treated as closed)', async () => {
    world({ relistedAs: null });
    await ingest();
    expect(rowOf('PAR-26-120')).toMatchObject({ source_status: null, superseded_by: null });
    expect(rowOf('PAR-26-120').absent_since).toBeTruthy();
    expect(await visible()).toContainEqual({ sol: 'PAR-26-120', verification: 'absent_unverified' });
  });

  it('official lookup confirms live (measured shape: synopsis, archive 2030) → visible, confirmed live', async () => {
    world({ relistedAs: null });
    await ingest(respond(200, LIVE_SYNOPSIS), 40);
    expect(rowOf('PAR-26-120').source_status).toBe('posted');
    expect(await visible()).toContainEqual({ sol: 'PAR-26-120', verification: 'absent_confirmed_live' });
  });

  it('lookup times out → uncertainty retained: unconfirmed and visible', async () => {
    world({ relistedAs: null });
    const timeout = (async () => { throw Object.assign(new Error('aborted'), { name: 'TimeoutError' }); }) as unknown as typeof fetch;
    await ingest(timeout, 40);
    expect(rowOf('PAR-26-120').source_status).toBeNull();
    expect(await visible()).toContainEqual({ sol: 'PAR-26-120', verification: 'absent_unverified' });
  });

  it('lookup fails (HTTP 500) → uncertainty retained: unconfirmed and visible', async () => {
    world({ relistedAs: null });
    await ingest(respond(500, { error: 'boom' }), 40);
    expect(rowOf('PAR-26-120').source_status).toBeNull();
    expect(await visible()).toContainEqual({ sol: 'PAR-26-120', verification: 'absent_unverified' });
  });

  it('lookup returns not_found → AMBIGUOUS: visible and labelled, never inferred closed', async () => {
    world({ relistedAs: null });
    await ingest(respond(200, NOT_FOUND), 40);
    expect(rowOf('PAR-26-120').source_status).toBe('not_found');
    expect(await visible()).toContainEqual({ sol: 'PAR-26-120', verification: 'absent_not_found_ambiguous' });
  });

  it('only an official archived/closed answer removes it from actionable results — and the record is kept', async () => {
    world({ relistedAs: null });
    await ingest(respond(200, ARCHIVED_SYNOPSIS), 40);
    expect(rowOf('PAR-26-120').source_status).toBe('archived');
    expect((await visible()).some((p) => p.sol === 'PAR-26-120')).toBe(false);
    expect(DB.tables.grants_cache.some((r) => r.opp_number === 'PAR-26-120')).toBe(true);
  });
});
