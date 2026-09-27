import { describe, it, expect, vi, beforeAll } from 'vitest';

/**
 * FILTER BEFORE LIMIT. fetchSamOpportunitiesFromCache used to read the first
 * `limit` (200) rows of the NAICS/PSC market ordered by deadline and only THEN
 * prefer keyword matches — so a match at row 201+ was discarded before it was
 * checked. Measured on a real profile: 57 of 78 keyword matches lost this way.
 *
 * The fake below ignores filters (every row IS the market) and honours only
 * order + limit/range, which is exactly the part under test.
 */

type Row = Record<string, unknown>;
let MARKET: Row[] = [];
const calls = { range: 0, limit: 0 };

function fakeQuery() {
  let from = 0;
  let to = Number.POSITIVE_INFINITY;
  const q: Record<string, unknown> = {};
  const chain = () => q;
  for (const m of ['select', 'eq', 'or', 'gte', 'lte', 'order', 'in', 'like', 'ilike', 'is']) q[m] = chain;
  q.limit = (n: number) => { calls.limit++; to = n - 1; return q; };
  q.range = (a: number, b: number) => { calls.range++; from = a; to = b; return q; };
  q.then = (resolve: (v: unknown) => void) => resolve({ data: MARKET.slice(from, to + 1), error: null });
  return q;
}

vi.mock('@/lib/supabase/server-clients', () => ({
  getReadClient: () => ({ from: () => fakeQuery() }),
}));

let fetchSamOpportunitiesFromCache: typeof import('./sam-gov').fetchSamOpportunitiesFromCache;
let MAX_PREFER_SCAN_ROWS: number;

beforeAll(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://fake.local';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake';
  ({ fetchSamOpportunitiesFromCache, MAX_PREFER_SCAN_ROWS } = await import('./sam-gov'));
});

const future = (d: number) => new Date(Date.now() + d * 864e5).toISOString();
function market(n: number, aiAt: number[]): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    notice_id: `n${String(i).padStart(5, '0')}`,
    title: aiAt.includes(i) ? 'Enterprise Artificial Intelligence Support Services' : `Routine IT support ${i}`,
    description: '',
    naics_code: '541511',
    notice_type: 'Solicitation',
    response_deadline: future(1 + i / 10), // ascending — row order == deadline order
    posted_date: future(-5),
    active: true,
  }));
}

describe('fetchSamOpportunitiesFromCache — keyword preference sees the whole market', () => {
  it('finds a keyword match beyond the old 200-row cutoff', async () => {
    MARKET = market(450, [420]);
    const r = await fetchSamOpportunitiesFromCache({
      naicsCodes: ['541511'], savedNaics: ['541511'], keywords: ['artificial intelligence'], limit: 200,
    });
    expect(r.openKeywordOutcome).toBe('distinctive_hits');
    expect(r.opportunities.map((o) => o.noticeId)).toEqual(['n00420']);
    expect(r.marketRowsScanned).toBe(450);
    expect(r.scanTruncated).toBe(false);
  });

  it('with no match anywhere, returns the market and says there were no keyword hits', async () => {
    MARKET = market(450, []);
    const r = await fetchSamOpportunitiesFromCache({
      naicsCodes: ['541511'], savedNaics: ['541511'], keywords: ['artificial intelligence'], limit: 200,
    });
    expect(r.openKeywordOutcome).toBe('open_market_no_keyword_hits');
    expect(r.distinctiveMatchCount).toBe(0);
    expect(r.opportunities).toHaveLength(200);
  });

  it('reports — does not hide — a market larger than the scan bound', async () => {
    MARKET = market(MAX_PREFER_SCAN_ROWS + 500, [MAX_PREFER_SCAN_ROWS + 10]);
    const r = await fetchSamOpportunitiesFromCache({
      naicsCodes: ['541511'], savedNaics: ['541511'], keywords: ['artificial intelligence'], limit: 200,
    });
    expect(r.scanTruncated).toBe(true);
    expect(r.marketRowsScanned).toBe(MAX_PREFER_SCAN_ROWS);
  });

  it('without keywords, keeps the single capped query (nothing to prefer)', async () => {
    MARKET = market(450, [420]);
    calls.range = 0; calls.limit = 0;
    const r = await fetchSamOpportunitiesFromCache({ naicsCodes: ['541511'], savedNaics: ['541511'], limit: 200 });
    expect(calls.range).toBe(0);
    expect(calls.limit).toBe(1);
    expect(r.opportunities).toHaveLength(200);
    expect(r.marketRowsScanned).toBeUndefined();
  });
});

describe('truncated scan → the alert DISCLOSES incomplete coverage (fetch → outcome → email note)', () => {
  it('the only keyword match lies beyond the scan bound: the note says coverage was incomplete, never "no keyword match"', async () => {
    const { openMarketNote, OPEN_MARKET_NO_KEYWORD_HITS_COPY } = await import('@/lib/alerts/open-contract-d');
    MARKET = market(MAX_PREFER_SCAN_ROWS + 500, [MAX_PREFER_SCAN_ROWS + 10]);
    const r = await fetchSamOpportunitiesFromCache({
      naicsCodes: ['541511'], savedNaics: ['541511'], keywords: ['artificial intelligence'], limit: 200,
    });
    // The fetch really did miss it — that is the premise.
    expect(r.opportunities.some((o) => o.noticeId === `n${String(MAX_PREFER_SCAN_ROWS + 10).padStart(5, '0')}`)).toBe(false);
    expect(r.openKeywordOutcome).toBe('open_market_no_keyword_hits');
    expect(r.scanTruncated).toBe(true);

    // Exactly what daily-alerts passes to the email (route: openMarketNote(outcome, keywordScan)).
    const note = openMarketNote(r.openKeywordOutcome!, { scanTruncated: r.scanTruncated, marketRowsScanned: r.marketRowsScanned });
    expect(note).not.toBe(OPEN_MARKET_NO_KEYWORD_HITS_COPY);
    expect(note).toMatch(/looked at the first 4,000 open notices/);
    expect(note).toMatch(/not a finding that none exist/);
  });

  it('matches found inside the bound still say later notices were not checked', async () => {
    const { openMarketNote } = await import('@/lib/alerts/open-contract-d');
    MARKET = market(MAX_PREFER_SCAN_ROWS + 500, [10, MAX_PREFER_SCAN_ROWS + 10]);
    const r = await fetchSamOpportunitiesFromCache({
      naicsCodes: ['541511'], savedNaics: ['541511'], keywords: ['artificial intelligence'], limit: 200,
    });
    expect(r.openKeywordOutcome).toBe('distinctive_hits');
    const note = openMarketNote(r.openKeywordOutcome!, { scanTruncated: r.scanTruncated, marketRowsScanned: r.marketRowsScanned });
    expect(note).toMatch(/later matches were not checked today/);
  });

  it('a complete scan keeps the ordinary copy', async () => {
    const { openMarketNote, OPEN_MARKET_NO_KEYWORD_HITS_COPY } = await import('@/lib/alerts/open-contract-d');
    MARKET = market(450, []);
    const r = await fetchSamOpportunitiesFromCache({
      naicsCodes: ['541511'], savedNaics: ['541511'], keywords: ['artificial intelligence'], limit: 200,
    });
    expect(openMarketNote(r.openKeywordOutcome!, { scanTruncated: r.scanTruncated, marketRowsScanned: r.marketRowsScanned }))
      .toBe(OPEN_MARKET_NO_KEYWORD_HITS_COPY);
  });

  it('daily-alerts carries the scan coverage from the fetch into the email note', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/app/api/cron/daily-alerts/route.ts', 'utf8');
    expect(src).toMatch(/keywordScan = \{ scanTruncated: cacheResult\.scanTruncated, marketRowsScanned: cacheResult\.marketRowsScanned \}/);
    expect(src).toMatch(/openMarketNote\(openKeywordOutcome \?\? 'no_keywords_configured', keywordScan\)/);
  });
});
