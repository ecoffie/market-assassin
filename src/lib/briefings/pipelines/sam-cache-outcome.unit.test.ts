import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

/**
 * fetchSamOpportunitiesFromCache / fetchSamOpportunityNoticeSummaryFromCache must say
 * WHETHER THE QUERY RAN, not just what it returned. An empty array from a failed query
 * and an empty array from an empty market are different facts (match-health audit
 * 2026-10-06: a 57014 statement timeout became "no opportunities" for keyword-only users).
 */

type Resp = { data: unknown; error: { code?: string; message: string } | null };
let NEXT: Resp[] = [];
const TIMEOUT = { code: '57014', message: 'canceling statement due to statement timeout' };

function builder() {
  const b: Record<string, unknown> = {};
  const self = () => b;
  for (const m of ['select', 'eq', 'or', 'gte', 'lte', 'in', 'like', 'ilike', 'order', 'limit', 'range', 'not', 'filter', 'textSearch']) b[m] = self;
  b.then = (res: (v: unknown) => unknown) => Promise.resolve(NEXT.shift() ?? { data: [], error: null }).then(res);
  return b;
}
vi.mock('@/lib/supabase/server-clients', () => ({ getReadClient: () => ({ from: () => builder() }) }));

let mod: typeof import('./sam-gov');
beforeAll(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://fake.local';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake';
  mod = await import('./sam-gov');
});
beforeEach(() => { NEXT = []; });

describe('fetchSamOpportunitiesFromCache — outcome contract', () => {
  it('a successful query with no rows is a MEASURED zero: queryStatus ok', async () => {
    NEXT = [{ data: [], error: null }];
    const r = await mod.fetchSamOpportunitiesFromCache({ keywords: ['janitorial services'], limit: 200 });
    expect(r.opportunities).toEqual([]);
    expect(r.queryStatus).toBe('ok');
    expect(r.queryError).toBeUndefined();
  });

  it('a PostgREST error is UNKNOWN: queryStatus error with the code, never a silent ok', async () => {
    NEXT = [{ data: null, error: TIMEOUT }];
    const r = await mod.fetchSamOpportunitiesFromCache({ keywords: ['janitorial services'], limit: 200 });
    expect(r.opportunities).toEqual([]);
    expect(r.queryStatus).toBe('error');
    expect(r.queryError).toMatchObject({ code: '57014' });
  });
});

describe('fetchSamOpportunityNoticeSummaryFromCache — a failed page is not a total', () => {
  it('complete scan: no complete=false flag', async () => {
    NEXT = [{ data: [{ notice_type: 'Solicitation' }], error: null }];
    const s = await mod.fetchSamOpportunityNoticeSummaryFromCache({ keywords: ['janitorial services'] });
    expect(s.totalMatched).toBe(1);
    expect(s.complete).not.toBe(false);
  });

  it('error on the first page: zero counts are flagged incomplete', async () => {
    NEXT = [{ data: null, error: TIMEOUT }];
    const s = await mod.fetchSamOpportunityNoticeSummaryFromCache({ keywords: ['janitorial services'] });
    expect(s.totalMatched).toBe(0);
    expect(s.complete).toBe(false);
  });

  it('error after a full page: the partial tally is flagged incomplete', async () => {
    const page = Array.from({ length: 1000 }, () => ({ notice_type: 'Solicitation' }));
    NEXT = [{ data: page, error: null }, { data: null, error: TIMEOUT }];
    const s = await mod.fetchSamOpportunityNoticeSummaryFromCache({ keywords: ['janitorial services'] });
    expect(s.totalMatched).toBe(1000);
    expect(s.complete).toBe(false);
  });
});
