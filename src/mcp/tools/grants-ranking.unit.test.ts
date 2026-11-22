/**
 * search_grants ranks by what the keyword names and includes forecasted programs (Ask Mindy Backend Spec,
 * Tools: "rank by grant title and assistance listing; include forecasted programs").
 * Grants.gov's search endpoint sorts only by date, so a newest grant whose synopsis merely mentions the
 * word came first. Fetch is mocked with production-shaped Grants.gov hits; no network.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { rankGrantsByRelevance, type GrantResult } from '@/lib/grants/search';
import { grantsSearch } from './grants';

const hit = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
  id, number: `NUM-${id}`, title, agencyCode: 'USDA-RUS', agency: 'Rural Utilities Service', openDate: '11/01/2026',
  closeDate: '01/15/2027', oppStatus: 'posted', docType: 'synopsis', cfdaList: ['10.886'], synopsis: 'Program synopsis', ...extra,
});
const g = (title: string, extra: Partial<GrantResult> = {}): GrantResult => ({
  oppNumber: title, title, agency: 'A', agencyCode: 'A', description: '', awardCeiling: null, postedDate: null, closeDate: null,
  status: 'posted', cfdaList: [], url: 'u', ...extra,
});

describe('rankGrantsByRelevance', () => {
  it('all terms in the title → assistance listing → some terms in the title → synopsis only; recency kept within a tier', () => {
    const ranked = rankGrantsByRelevance([
      g('Community Facilities Program'), // synopsis-only (newest)
      g('Rural Health Clinic Support'), // partial title ("rural")
      g('Rural Broadband Deployment'), // all terms
      g('ReConnect Rural Broadband Loans'), // all terms, older
    ], 'rural broadband');
    expect(ranked.map((x) => [x.title, x.match])).toEqual([
      ['Rural Broadband Deployment', 'title'],
      ['ReConnect Rural Broadband Loans', 'title'],
      ['Rural Health Clinic Support', 'title_partial'],
      ['Community Facilities Program', 'description'],
    ]);
  });

  it('an Assistance Listing number keyword matches the listing, not the text', () => {
    const ranked = rankGrantsByRelevance([g('Other program', { cfdaList: ['93.123'] }), g('Target program', { cfdaList: ['10.886'] })], '10.886');
    expect(ranked[0]).toMatchObject({ title: 'Target program', match: 'assistance_listing' });
  });

  it('no keyword → unchanged order, no match label', () => {
    const input = [g('B'), g('A')];
    expect(rankGrantsByRelevance(input, '')).toEqual(input);
  });
});

describe('search_grants tool', () => {
  const bodies: Array<Record<string, unknown>> = [];
  beforeEach(() => {
    bodies.length = 0;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as Record<string, unknown>;
      bodies.push(body);
      const forecasted = body.oppStatuses === 'forecasted';
      const oppHits = forecasted
        ? [hit('f1', 'Rural Broadband Technical Assistance', { oppStatus: 'forecasted' })]
        : [hit('p1', 'Community Facilities Direct Loans', { synopsis: 'includes rural broadband' }), hit('p2', 'Rural Broadband Deployment')];
      return new Response(JSON.stringify({ oppHits, hitCount: oppHits.length }), { status: 200 });
    }));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('no status → searches posted AND forecasted, ranked together, forecasted counted', async () => {
    const r = await grantsSearch({ keyword: 'rural broadband' });
    expect(bodies.map((b) => b.oppStatuses).sort()).toEqual(['forecasted', 'posted']);
    expect(r._meta.statuses_searched).toEqual(['posted', 'forecasted']);
    expect(r.grants.map((x) => [x.title, x.match])).toEqual([
      ['Rural Broadband Deployment', 'title'],
      ['Rural Broadband Technical Assistance', 'title'],
      ['Community Facilities Direct Loans', 'description'],
    ]);
    expect(r._meta.forecasted_count).toBe(1);
    expect(r._meta.total).toBe(3);
  });

  it('a keyword search fetches a wider window than the page, so title matches can be ranked first', async () => {
    await grantsSearch({ keyword: 'rural broadband', status: 'posted', limit: 5 });
    expect(bodies).toHaveLength(1);
    expect(Number(bodies[0].rows)).toBeGreaterThanOrEqual(50);
    expect(bodies[0].sortBy).toBe('openDate|desc'); // still a date sort Grants.gov accepts
  });

  it('an explicit status is one call with exactly that status', async () => {
    const r = await grantsSearch({ keyword: 'rural broadband', status: 'forecasted' });
    expect(bodies.map((b) => b.oppStatuses)).toEqual(['forecasted']);
    expect(r._meta.statuses_searched).toEqual(['forecasted']);
  });
});
