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
/** Optional hook: runs before each range read (used to simulate a sync moving rows between pages). */
let onRange: ((from: number) => void) | null = null;
/** When set, any read starting at or after this row offset answers a PostgREST error (statement timeout). */
let FAIL_FROM: number | null = null;

function fakeQuery() {
  let from = 0;
  let to = Number.POSITIVE_INFINITY;
  const q: Record<string, unknown> = {};
  const chain = () => q;
  for (const m of ['select', 'eq', 'or', 'gte', 'lte', 'order', 'in', 'like', 'ilike', 'is']) q[m] = chain;
  q.limit = (n: number) => { calls.limit++; to = n - 1; return q; };
  q.range = (a: number, b: number) => { calls.range++; onRange?.(a); from = a; to = b; return q; };
  q.then = (resolve: (v: unknown) => void) => resolve(
    FAIL_FROM !== null && from >= FAIL_FROM
      ? { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }
      : { data: MARKET.slice(from, to + 1), error: null },
  );
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
      naicsCodes: ['541511'], savedNaics: ['541511'], keywords: ['artificial intelligence'], limit: 200, fullMarketKeywordScan: true,
    });
    expect(r.openKeywordOutcome).toBe('distinctive_hits');
    expect(r.opportunities.map((o) => o.noticeId)).toEqual(['n00420']);
    expect(r.marketRowsScanned).toBe(450);
    expect(r.scanTruncated).toBe(false);
  });

  it('with no match anywhere, returns the market and says there were no keyword hits', async () => {
    MARKET = market(450, []);
    const r = await fetchSamOpportunitiesFromCache({
      naicsCodes: ['541511'], savedNaics: ['541511'], keywords: ['artificial intelligence'], limit: 200, fullMarketKeywordScan: true,
    });
    expect(r.openKeywordOutcome).toBe('open_market_no_keyword_hits');
    expect(r.distinctiveMatchCount).toBe(0);
    expect(r.opportunities).toHaveLength(450); // opt-in: the whole market; daily-alerts ranks, then cuts
  });

  it('reports — does not hide — a market larger than the scan bound', async () => {
    MARKET = market(MAX_PREFER_SCAN_ROWS + 500, [MAX_PREFER_SCAN_ROWS + 10]);
    const r = await fetchSamOpportunitiesFromCache({
      naicsCodes: ['541511'], savedNaics: ['541511'], keywords: ['artificial intelligence'], limit: 200, fullMarketKeywordScan: true,
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
      naicsCodes: ['541511'], savedNaics: ['541511'], keywords: ['artificial intelligence'], limit: 200, fullMarketKeywordScan: true,
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
      naicsCodes: ['541511'], savedNaics: ['541511'], keywords: ['artificial intelligence'], limit: 200, fullMarketKeywordScan: true,
    });
    expect(r.openKeywordOutcome).toBe('distinctive_hits');
    const note = openMarketNote(r.openKeywordOutcome!, { scanTruncated: r.scanTruncated, marketRowsScanned: r.marketRowsScanned });
    expect(note).toMatch(/later matches were not checked today/);
  });

  it('a complete scan keeps the ordinary copy', async () => {
    const { openMarketNote, OPEN_MARKET_NO_KEYWORD_HITS_COPY } = await import('@/lib/alerts/open-contract-d');
    MARKET = market(450, []);
    const r = await fetchSamOpportunitiesFromCache({
      naicsCodes: ['541511'], savedNaics: ['541511'], keywords: ['artificial intelligence'], limit: 200, fullMarketKeywordScan: true,
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

describe('scan-bound edges (exactly vs more than MAX_PREFER_SCAN_ROWS)', () => {
  it('exactly 4,000 rows is a COMPLETE scan — not reported as truncated', async () => {
    MARKET = market(MAX_PREFER_SCAN_ROWS, [3990]);
    const r = await fetchSamOpportunitiesFromCache({
      naicsCodes: ['541511'], savedNaics: ['541511'], keywords: ['artificial intelligence'], limit: 200, fullMarketKeywordScan: true,
    });
    expect(r.marketRowsScanned).toBe(MAX_PREFER_SCAN_ROWS);
    expect(r.scanTruncated).toBe(false);
    expect(r.opportunities.map((o) => o.noticeId)).toEqual(['n03990']);
  });

  it('4,001 rows IS truncated (one row past the bound exists)', async () => {
    MARKET = market(MAX_PREFER_SCAN_ROWS + 1, []);
    const r = await fetchSamOpportunitiesFromCache({
      naicsCodes: ['541511'], savedNaics: ['541511'], keywords: ['artificial intelligence'], limit: 200, fullMarketKeywordScan: true,
    });
    expect(r.marketRowsScanned).toBe(MAX_PREFER_SCAN_ROWS);
    expect(r.scanTruncated).toBe(true);
  });
});

describe('fullMarketKeywordScan — opt-in; the final cut happens after the caller ranks', () => {
  // 260 keyword matches; the ONLY title match is the 250th by deadline (past the old 200 cut).
  function bigHitMarket(): Row[] {
    return Array.from({ length: 600 }, (_, i) => ({
      notice_id: `m${String(i).padStart(5, '0')}`,
      title: i === 499 ? 'Artificial Intelligence Governance Support' : `IT support ${i}`,
      description: i < 520 && i % 2 === 1 ? 'tasks include artificial intelligence pilots' : '',
      naics_code: '541511', notice_type: 'Solicitation',
      response_deadline: future(1 + i / 10), posted_date: future(-5), active: true,
    }));
  }

  it('WITHOUT the opt-in (every non-daily caller): main\'s behaviour — one capped query, the title match is never seen', async () => {
    MARKET = bigHitMarket();
    calls.range = 0; calls.limit = 0;
    const r = await fetchSamOpportunitiesFromCache({
      naicsCodes: ['541511'], savedNaics: ['541511'], keywords: ['artificial intelligence'], limit: 200,
    });
    expect(calls).toEqual({ range: 0, limit: 1 });       // single capped read, exactly as on main
    expect(r.marketRowsScanned).toBeUndefined();
    expect(r.scanTruncated).toBeUndefined();
    expect(r.distinctiveMatchCount).toBe(100);           // only the hits inside the first 200 rows
    expect(r.opportunities.some((o) => o.noticeId === 'm00499')).toBe(false);
  });

  it('WITH the opt-in (daily alerts): every preferred row is returned so ranking can find the title match', async () => {
    MARKET = bigHitMarket();
    const r = await fetchSamOpportunitiesFromCache({
      naicsCodes: ['541511'], savedNaics: ['541511'], keywords: ['artificial intelligence'], limit: 200, fullMarketKeywordScan: true,
    });
    expect(r.opportunities).toHaveLength(260);
    expect(r.opportunities.some((o) => o.noticeId === 'm00499')).toBe(true);
  });
});

describe('paging over a live table: de-duplication fixes REPEATS only', () => {
  it('a row that moves into the next page between reads is returned once, not twice', async () => {
    MARKET = market(1500, [1200]);
    const moved = { ...MARKET[999] };
    onRange = (from) => { if (from === 1000) MARKET.splice(1000, 0, moved); }; // sync re-sorts it into page 2
    try {
      const r = await fetchSamOpportunitiesFromCache({
        naicsCodes: ['541511'], savedNaics: ['541511'], keywords: ['artificial intelligence'], limit: 200, fullMarketKeywordScan: true,
      });
      expect(r.marketRowsScanned).toBe(1500); // 1,501 rows read, the repeat removed
    } finally { onRange = null; }
  });

  it('LIMITATION (documented, not solved): a row that moves backward across a page boundary is skipped', async () => {
    MARKET = market(1500, [1000]);
    // Before page 2 is read, the AI row (index 1000) moves to index 10 — into page 1, already read.
    onRange = (from) => { if (from === 1000) { const [row] = MARKET.splice(1000, 1); MARKET.splice(10, 0, row); } };
    try {
      const r = await fetchSamOpportunitiesFromCache({
        naicsCodes: ['541511'], savedNaics: ['541511'], keywords: ['artificial intelligence'], limit: 200, fullMarketKeywordScan: true,
      });
      // Not seen in either read. De-duplication cannot recover it; this test pins that the
      // limitation is REAL so no one reads the de-dup as a consistency guarantee.
      expect(r.opportunities.some((o) => o.noticeId === 'n01000')).toBe(false);
    } finally { onRange = null; }
  });
});

describe('fetchSamOpportunitiesFromCache — a failed page is a FAILED read, never a smaller market (#1853 contract)', () => {
  it('a timeout on page 2 of the full-market scan → queryStatus error, no partial rows returned as ok', async () => {
    MARKET = market(MAX_PREFER_SCAN_ROWS > 1500 ? 1500 : MAX_PREFER_SCAN_ROWS, [3]);
    FAIL_FROM = 1; // page 1 (from=0) succeeds; every later page fails
    try {
      const r = await fetchSamOpportunitiesFromCache({
        naicsCodes: ['541511'], savedNaics: ['541511'], keywords: ['artificial intelligence'], limit: 200, fullMarketKeywordScan: true,
      });
      expect(r.queryStatus).toBe('error');
      expect(r.queryError?.code).toBe('57014');
      expect(r.opportunities).toEqual([]);
    } finally { FAIL_FROM = null; }
  });

  it('a timeout on the single capped read (no keyword preference) → queryStatus error', async () => {
    MARKET = market(50, []);
    FAIL_FROM = 0;
    try {
      const r = await fetchSamOpportunitiesFromCache({ naicsCodes: ['541511'], savedNaics: ['541511'], limit: 200 });
      expect(r.queryStatus).toBe('error');
      expect(r.opportunities).toEqual([]);
    } finally { FAIL_FROM = null; }
  });

  it('control: a successful scan reports queryStatus ok', async () => {
    MARKET = market(50, [3]);
    const r = await fetchSamOpportunitiesFromCache({
      naicsCodes: ['541511'], savedNaics: ['541511'], keywords: ['artificial intelligence'], limit: 200, fullMarketKeywordScan: true,
    });
    expect(r.queryStatus).toBe('ok');
  });
});
