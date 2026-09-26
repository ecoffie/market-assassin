/**
 * Grants cache reconcile — BEHAVIOURAL tests over the REAL ingestGrants / reconcile / confirmation code.
 * Only I/O is faked: Grants.gov search pages (scripted per status/page) and Supabase (in-memory, able to
 * simulate the migration not being applied).
 *
 * The rule under test (Eric, 2026-09-26): mark absence ONLY after a demonstrably complete run; a partial
 * run, failed page, count mismatch or outage must never hide a valid grant; records are preserved; absence
 * is not closure — only the source can confirm closed/archived/not_found.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeFakeDb, type FakeDb } from './grants-cache-fake';
import { classifySourceRecord, confirmAbsentGrants, statusCompleteness } from './reconcile';

type Page = { grants?: Array<{ oppNumber: string; closeDate?: string | null }>; total?: number; degraded?: boolean; throws?: string };
const SCRIPT: Record<string, Page[]> = {};
vi.mock('./search', () => ({
  searchGrants: vi.fn(async ({ status, offset, limit }: { status: string; offset: number; limit: number }) => {
    const page = (SCRIPT[status] || [])[Math.floor(offset / limit)];
    // Past the last page Grants.gov answers an empty page with the SAME hitCount (not 0).
    if (!page) return { grants: [], total: (SCRIPT[status]?.[0]?.total ?? 0), agencyFiltered: false, degraded: false };
    if (page.throws) throw new Error(page.throws);
    if (page.degraded) return { grants: [], total: 0, agencyFiltered: false, degraded: true };
    return {
      grants: (page.grants || []).map((g) => ({
        oppNumber: g.oppNumber, title: `T ${g.oppNumber}`, agency: 'NSF', agencyCode: 'NSF', description: '',
        awardCeiling: null, postedDate: '09/01/2026', closeDate: g.closeDate ?? '12/31/2026', status, cfdaList: [],
        url: `https://www.grants.gov/search-results-detail/${g.oppNumber.replace(/\D/g, '') || '1'}`,
      })),
      total: page.total ?? (page.grants || []).length, agencyFiltered: false, degraded: false,
    };
  }),
}));
import { ingestGrants } from './ingest';

const NOW = '2026-09-26T09:00:00.000Z';
const ids = (p: string, n: number) => Array.from({ length: n }, (_, i) => `${p}-${i + 1}`);
const row = (opp: string, status: 'posted' | 'forecasted', extra: Record<string, unknown> = {}) => ({
  opp_number: opp, status, close_date: status === 'posted' ? '2026-12-31' : null, map_lat: 38.9, map_lng: -77,
  url: `https://www.grants.gov/search-results-detail/${opp.replace(/\D/g, '') || '1'}`, absent_since: null, source_status: null, source_checked_at: null, ...extra,
});
/** 20 posted + 10 forecasted listed by Grants.gov; the cache additionally holds 2 posted + 1 forecasted it no longer lists. */
function scenario(schema = { columns: true, runsTable: true }): FakeDb {
  const posted = ids('P', 20); const fc = ids('F', 10);
  SCRIPT.posted = [{ grants: posted.map((o) => ({ oppNumber: o })), total: 20 }];
  SCRIPT.forecasted = [{ grants: fc.map((o) => ({ oppNumber: o, closeDate: null })), total: 10 }];
  const seed = [
    ...posted.map((o) => row(o, 'posted')), ...fc.map((o) => row(o, 'forecasted')),
    row('GONE-1', 'posted'), row('GONE-2', 'posted'), row('GONE-F', 'forecasted'),
  ];
  if (!schema.columns) for (const r of seed) { for (const k of ['absent_since', 'source_status', 'source_checked_at']) delete (r as Record<string, unknown>)[k]; }
  return makeFakeDb(seed, schema);
}
const run = (db: FakeDb, extra = {}) => ingestGrants(db as never, { nowIso: NOW, pageSize: 100, confirmLimit: 0, ...extra });
const absentIds = (db: FakeDb) => db.tables.grants_cache.filter((r) => r.absent_since).map((r) => r.opp_number).sort();

beforeEach(() => { for (const k of Object.keys(SCRIPT)) delete SCRIPT[k]; });

describe('complete run → unseen rows marked absent, records preserved', () => {
  it('marks exactly the unlisted rows absent; listed rows stay present with last_seen_at', async () => {
    const db = scenario();
    const r = await run(db);
    expect(r.complete).toBe(true);
    expect(r.reconcile).toMatchObject({ ran: true, markedAbsent: 3 });
    expect(absentIds(db)).toEqual(['GONE-1', 'GONE-2', 'GONE-F']);
    expect(db.tables.grants_cache).toHaveLength(33); // nothing deleted
    expect(db.tables.grants_cache.find((x) => x.opp_number === 'P-1')).toMatchObject({ absent_since: null, last_seen_at: NOW });
    expect(db.tables.grants_ingest_runs).toHaveLength(1);
    expect(db.tables.grants_ingest_runs[0]).toMatchObject({ complete: true });
    expect((db.tables.grants_ingest_runs[0].per_status as Record<string, { expected: number; fetchedUnique: number }>).posted).toMatchObject({ expected: 20, fetchedUnique: 20 });
  });

  it('a row seen again is restored (absent_since cleared) and counted', async () => {
    const db = scenario();
    const g = db.tables.grants_cache.find((x) => x.opp_number === 'P-3')!;
    g.absent_since = '2026-09-20T09:00:00.000Z'; g.source_status = 'archived';
    const r = await run(db);
    const after = db.tables.grants_cache.find((x) => x.opp_number === 'P-3')!;
    expect(after.absent_since).toBeNull();
    expect(after.last_seen_at).toBe(NOW);
    expect(r.reconcile.restored).toBe(1);
  });
});

describe('incomplete run → NOTHING marked absent (for any status)', () => {
  const cases: Array<[string, () => void, RegExp]> = [
    ['a degraded forecasted page', () => { SCRIPT.forecasted = [{ degraded: true }]; }, /forecasted: a page was degraded/],
    ['a thrown fetch on the posted listing', () => { SCRIPT.posted = [{ throws: 'ECONNRESET' }]; }, /posted: fetch error: ECONNRESET/],
    ['unique fetched ≠ hitCount', () => { SCRIPT.posted[0].total = 25; }, /posted: unique fetched 20 ≠ upstream hitCount 25/],
    ['hitCount 0 (silent-empty answer)', () => { SCRIPT.forecasted = [{ grants: [], total: 0 }]; }, /forecasted: upstream hitCount 0/],
    ['hitCount changing between pages', () => {
      const g = ids('P', 20).map((o) => ({ oppNumber: o }));
      SCRIPT.posted = [{ grants: g.slice(0, 10), total: 20 }, { grants: g.slice(10), total: 21 }];
    }, /posted: hitCount changed during the run \(20 → 21\)/],
  ];
  it.each(cases)('%s', async (_n, mutate, reason) => {
    const db = scenario();
    mutate();
    const r = await run(db, _n.includes('changing') ? { pageSize: 10 } : {});
    expect(r.complete).toBe(false);
    expect(r.reconcile.ran).toBe(false);
    expect(r.reconcile.reason).toMatch(reason);
    expect(absentIds(db)).toEqual([]); // GONE-* stay visible — an incomplete run proves nothing
    expect(db.tables.grants_ingest_runs[0]).toMatchObject({ complete: false });
  });

  it('a per-status cap reached before the listing was exhausted', async () => {
    const db = scenario();
    const r = await run(db, { pageSize: 10, maxPerStatus: 10 });
    expect(r.completeness.posted.reason).toMatch(/cap reached/);
    expect(absentIds(db)).toEqual([]);
  });

  it('the complete status does NOT reconcile on its own when another status is incomplete (status transitions)', async () => {
    const db = scenario();
    SCRIPT.forecasted = [{ degraded: true }];
    const r = await run(db);
    expect(r.completeness.posted.complete).toBe(true);
    expect(absentIds(db)).toEqual([]); // not even GONE-1/2 (posted)
  });
});

describe('breaker — a suspiciously large absence is refused', () => {
  it('refuses when newly-absent actionable rows exceed 20% of those present', async () => {
    const db = scenario();
    SCRIPT.posted = [{ grants: ids('P', 5).map((o) => ({ oppNumber: o })), total: 5 }]; // Grants.gov "lost" 15 of 20
    const r = await run(db);
    expect(r.complete).toBe(true);
    expect(r.reconcile).toMatchObject({ ran: false });
    expect(r.reconcile.reason).toMatch(/^breaker/);
    expect(absentIds(db)).toEqual([]);
  });
});

describe('migration NOT applied → safe no-op (old upsert-only behaviour)', () => {
  it('ingest succeeds, upsert payload has no reconcile columns, nothing hidden, reason recorded', async () => {
    const db = scenario({ columns: false, runsTable: false });
    const r = await run(db);
    expect(r.schema).toEqual({ columns: false, runsTable: false });
    expect(r.upserted).toBe(30);
    expect(r.reconcile).toMatchObject({ ran: false });
    expect(r.reconcile.reason).toMatch(/migration not applied/);
    expect(r.confirm).toBeNull();
    expect(db.tables.grants_cache.some((x) => 'absent_since' in x && x.absent_since)).toBe(false);
  });
});

describe('completeness rule (pure)', () => {
  it('exact tolerance: one missing grant is incomplete', () => {
    expect(statusCompleteness({ status: 'posted', hitCounts: [925], pages: 10, fetchedUnique: 924, degraded: false, error: null, capped: false }).complete).toBe(false);
    expect(statusCompleteness({ status: 'posted', hitCounts: [925, 925], pages: 10, fetchedUnique: 925, degraded: false, error: null, capped: false }).complete).toBe(true);
  });
});

describe('confirmation against the official source — absence is not closure', () => {
  const TODAY = '2026-09-26';
  const syn = (archive?: string, response?: string) => ({ errorcode: 0, data: { id: 1, docType: 'synopsis', synopsis: { archiveDate: archive, responseDate: response } } });
  it.each([
    ['archived synopsis (PD-24-110Z shape)', 200, syn('Sep 23, 2026 12:00:00 AM EDT', 'Sep 22, 2026 12:00:00 AM EDT'), 'archived'],
    ['archived forecast (RFA-DK-27-102 shape)', 200, { errorcode: 0, data: { id: 1, docType: 'forecast', forecast: { archiveDate: 'Sep 17, 2026 12:00:00 AM EDT' } } }, 'archived'],
    ['live synopsis (PAR-26-120 shape)', 200, syn('Jan 04, 2030 12:00:00 AM EST', 'Nov 05, 2029 12:00:00 AM EST'), 'posted'],
    ['closed: response date passed, not yet archived', 200, syn('Dec 10, 2026 12:00:00 AM EST', 'Sep 01, 2026 12:00:00 AM EDT'), 'closed'],
    ['live forecast', 200, { errorcode: 0, data: { id: 1, docType: 'forecast', forecast: { archiveDate: 'Jan 01, 2028 12:00:00 AM EST' } } }, 'forecast'],
    ['not found (NOAA-…-27967 shape: errorcode 0, no data.id)', 200, { errorcode: 0, data: { opportunityNumber: null } }, 'not_found'],
    ['HTTP 500', 500, { errorcode: 0, data: { id: 1 } }, null],
    ['errorcode ≠ 0', 200, { errorcode: 3, msg: 'down' }, null],
    ['malformed body', 200, 'nope', null],
    ['unknown docType', 200, { errorcode: 0, data: { id: 1, docType: 'mystery' } }, null],
  ])('%s → %s', (_n, http, body, expected) => {
    expect(classifySourceRecord(http as number, body, TODAY)).toBe(expected);
  });

  it('confirmAbsentGrants writes only definitive answers; an outage leaves the row unconfirmed', async () => {
    const db = makeFakeDb([
      row('A-11', 'posted', { absent_since: NOW }),
      row('B-22', 'posted', { absent_since: NOW }),
      row('C-33', 'posted', { absent_since: NOW }),
      row('D-44', 'posted'), // present → never checked
    ]);
    const fetchImpl = vi.fn(async (_u: string, init: RequestInit) => {
      const id = JSON.parse(String(init.body)).opportunityId;
      if (id === 11) return new Response(JSON.stringify(syn('Sep 23, 2026 12:00:00 AM EDT')), { status: 200 });
      if (id === 22) throw new Error('ETIMEDOUT');
      return new Response('Service Unavailable', { status: 503 });
    }) as unknown as typeof fetch;
    const r = await confirmAbsentGrants(db as never, { limit: 10, fetchImpl, nowIso: NOW });
    expect(r).toEqual({ attempted: 3, confirmed: { archived: 1 }, unconfirmed: 2 });
    const byId = Object.fromEntries(db.tables.grants_cache.map((x) => [x.opp_number, x]));
    expect(byId['A-11']).toMatchObject({ source_status: 'archived', source_checked_at: NOW });
    expect(byId['B-22']).toMatchObject({ source_status: null, source_checked_at: null });
    expect(byId['C-33']).toMatchObject({ source_status: null, source_checked_at: null });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});
