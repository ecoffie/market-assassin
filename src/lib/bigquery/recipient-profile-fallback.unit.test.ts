/**
 * `recipients` is a DERIVED table (build-derived.sql) rebuilt on its own cadence; `awards` is
 * refreshed by the WEEKLY ingest. When the rebuild lags, a firm whose first award landed after the
 * last rebuild sits in `awards` with NO profile row — and getRecipientByUei returned null, which
 * every caller reads as "no such contractor". Measured live 2026-08-12:
 *
 *   recipients MAX(last_action_date) = 2026-04-23
 *   awards     MAX(action_date)      = 2026-07-31
 *   → 1,962 real firms orphaned (ACS RITZ JV $42.8M, FOLEY HOAG LLP $20.6M, all active <180d)
 *
 * Each one 404'd the Opportunity Map's company drawer ("Couldn't load this company") even though
 * its pin, name and dollar figures rendered fine from `awards`. getRecipientByUei now falls back
 * to `awards` — while keeping the honest miss for a UEI that genuinely has no federal awards.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Q = { cacheKey: string; query: string; cacheOnly?: boolean; params?: Record<string, unknown> };

const calls: Q[] = [];
let profileRows: unknown[] = [];
let awardRows: unknown[] = [];

vi.mock('./cache', () => ({
  queryCached: vi.fn(async (opts: Q) => {
    calls.push(opts);
    return opts.cacheKey.includes('awards-fallback') ? awardRows : profileRows;
  }),
}));
vi.mock('@/lib/sam/recipient-certs', () => ({ getCachedCerts: vi.fn(async () => new Map()), certBuckets: () => [] }));

const { getRecipientByUei } = await import('./recipients');

const PROFILE_ROW = {
  recipient_uei: 'AAAA11112222', recipient_name: 'ESTABLISHED FIRM LLC',
  city: 'FORT WORTH', state: 'TX', cage_code: '81755', parent_uei: 'PPPP11112222',
  total_obligated: 500_000, award_count: 9, first_action_date: '2019-01-01', last_action_date: '2026-01-01',
};

const AWARD_ROW = {
  recipient_uei: 'ZB86MQ3HHZF1', recipient_name: 'FOLEY HOAG LLP', state: 'MA',
  total_obligated: 10_282_290, award_count: 2, transaction_count: 3,
  first_action_date: '2026-05-02', last_action_date: '2026-06-18',
  distinct_agency_count: 1, distinct_naics_count: 1,
};

beforeEach(() => { calls.length = 0; profileRows = []; awardRows = []; });

describe('getRecipientByUei — stale-derived-table fallback', () => {
  it('a firm IN the profile table resolves from it, and never touches awards', async () => {
    profileRows = [PROFILE_ROW];
    const r = await getRecipientByUei('AAAA11112222', true);
    expect(r?.recipient_name).toBe('ESTABLISHED FIRM LLC');
    expect(r?.city, 'profile-only fields must survive').toBe('FORT WORTH');
    expect(r?.cage_code).toBe('81755');
    expect(calls.filter((c) => c.cacheKey.includes('awards-fallback')), 'no awards scan on a hit').toHaveLength(0);
  });

  it('an ORPHAN (in awards, no profile row) resolves from awards instead of 404ing', async () => {
    // THE REGRESSION: this returned null, so the map drawer said "Couldn't load this company"
    // for a firm with $10.3M of real, current federal work.
    awardRows = [AWARD_ROW];
    const r = await getRecipientByUei('ZB86MQ3HHZF1', true);
    expect(r, 'an orphan firm must resolve, not read as nonexistent').not.toBeNull();
    expect(r?.recipient_name).toBe('FOLEY HOAG LLP');
    expect(r?.total_obligated).toBe(10_282_290);
    expect(r?.award_count).toBe(2);
    expect(r?.state).toBe('MA');
    expect(r?.last_action_date).toBe('2026-06-18');
  });

  it('the synthesized profile GUESSES nothing awards cannot ground', async () => {
    awardRows = [AWARD_ROW];
    const r = await getRecipientByUei('ZB86MQ3HHZF1', true);
    // These live only on the profile row. Inventing them would put fabricated address/parent
    // data on a drawer that reads as authoritative.
    expect(r?.city, 'city is not in awards — must stay null, never guessed').toBeNull();
    expect(r?.cage_code).toBeNull();
    expect(r?.address).toBeNull();
    expect(r?.zip).toBeNull();
    expect(r?.parent_uei).toBeNull();
    expect(r?.parent_name).toBeNull();
  });

  it('a UEI with no awards anywhere is STILL null — the honest miss survives', async () => {
    profileRows = []; awardRows = [];
    expect(await getRecipientByUei('ZZZZ00000000', true)).toBeNull();
  });

  it('an awards row with no resolvable name is null, not a nameless shell', async () => {
    awardRows = [{ ...AWARD_ROW, recipient_name: null }];
    expect(await getRecipientByUei('ZB86MQ3HHZF1', true)).toBeNull();
  });

  it('the fallback is LIVE-ONLY — a cacheOnly caller never triggers an awards scan', async () => {
    // queryCached defaults to cacheOnly for public/unauthed traffic precisely to avoid cold BQ
    // scans. The fallback must not become a back door around that.
    profileRows = []; awardRows = [AWARD_ROW];
    expect(await getRecipientByUei('ZB86MQ3HHZF1', false)).toBeNull();
    expect(calls.filter((c) => c.cacheKey.includes('awards-fallback'))).toHaveLength(0);
  });

  it('identity comes from the MOST RECENT award, not an arbitrary row', async () => {
    // A renamed or relocated firm should show its current name/state, so the query must order by
    // action_date DESC rather than ANY_VALUE.
    awardRows = [AWARD_ROW];
    await getRecipientByUei('ZB86MQ3HHZF1', true);
    const q = calls.find((c) => c.cacheKey.includes('awards-fallback'))!.query;
    expect(q).toContain('ORDER BY action_date DESC');
    expect(q).not.toContain('ANY_VALUE(recipient_name)');
    expect(q, 'single-UEI equality lookup — never a table scan').toContain('WHERE recipient_uei = @uei');
  });
});
