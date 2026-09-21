/**
 * GET /api/app/return-brief — hermetic contract tests.
 *
 * These guard the three ways this route could ship a number Mindy cannot defend:
 *   1. a failed read rendered as "nothing changed"
 *   2. a null count (the documented missing-relation shape) coalesced to 0
 *   3. a visitor with no recoverable market told "0 new" instead of nothing
 * plus the link-class invariant: the closed-listing CTA must name ONE record and
 * carry nothing that could exclude it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type TableState = {
  rows: Record<string, unknown>[];
  error: { message: string } | null;
  /** For the head/count query: what `count` comes back as. */
  count: number | null;
};

const tables: Record<string, TableState> = {};
const reset = () => {
  for (const k of Object.keys(tables)) delete tables[k];
  tables.user_engagement = { rows: [], error: null, count: null };
  tables.saved_searches = { rows: [], error: null, count: null };
  tables.sam_opportunities = { rows: [], error: null, count: 0 };
  tables.anonymous_shortlist = { rows: [], error: null, count: null };
};

function builder(table: string) {
  const st = () => tables[table] ?? { rows: [], error: null, count: null };
  let isHead = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api: any = {};
  const self = () => api;
  api.select = (_c?: string, o?: { head?: boolean }) => { if (o?.head) isHead = true; return self(); };
  for (const m of ['eq', 'gte', 'lte', 'gt', 'lt', 'in', 'or', 'not', 'is', 'order', 'limit', 'ilike', 'contains', 'overlaps']) api[m] = () => self();
  // Awaiting the builder resolves it — the shape @supabase/supabase-js uses.
  api.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
    const s = st();
    const out = isHead
      ? { data: null, error: s.error, count: s.count }
      : { data: s.error ? null : s.rows, error: s.error, count: s.count };
    return Promise.resolve(out).then(res, rej);
  };
  return api;
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (t: string) => builder(t) }),
}));
vi.mock('@/lib/two-factor-session', () => ({
  requireMIAuthSession: () => ({ ok: true, session: { email: 'real@example.com' } }),
}));

const { GET } = await import('./route');

const ANON = 'anon:11111111-2222-4333-8444-555555555555';
const NOW = Date.now();
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const DAY = 86_400_000;

const req = (qs: string) => new NextRequest(`https://getmindy.ai/api/app/return-brief?${qs}`);

/** Two visits: one 3 days ago, one just now. */
function seedReturningVisitor(filters: Record<string, unknown> | null) {
  tables.user_engagement.rows = [
    { created_at: iso(3 * DAY), metadata: filters ? { action: 'map_search', filters } : { action: 'map_view' } },
    { created_at: iso(3 * DAY - 60_000), metadata: { action: 'cards_shown' } },
    { created_at: iso(30_000), metadata: { action: 'map_view' } },
  ];
}

beforeEach(reset);

describe('identity', () => {
  it('a junk anon id gets no brief and no numbers', async () => {
    const r = await (await GET(req('anonId=not-an-anon-id'))).json();
    expect(r.isReturn).toBe(false);
    expect(r._meta.reason).toBe('no_identity');
    expect(r.newInMarket.state).toBe('no_basis');
  });

  it('serves an ANONYMOUS visitor — 219 of 414 returners have no account', async () => {
    seedReturningVisitor({ naics: '541512' });
    tables.sam_opportunities.count = 7;
    const r = await (await GET(req(`anonId=${ANON}`))).json();
    expect(r.isReturn).toBe(true);
    expect(r._meta.identityKind).toBe('anon');
    expect(r.newInMarket.count).toBe(7);
  });
});

describe('unknown is not zero', () => {
  it('a FAILED history read is 503 + no_basis — never "welcome, first-time visitor"', async () => {
    tables.user_engagement.error = { message: 'connection reset' };
    const res = await GET(req(`anonId=${ANON}`));
    expect(res.status).toBe(503);
    const r = await res.json();
    expect(r._meta.reason).toBe('history_unavailable');
    expect(r.newInMarket.state).toBe('no_basis');
    expect(r.newInMarket.count).toBeUndefined();
  });

  it('a NULL count with no error is UNKNOWN, not 0', async () => {
    // The documented missing-relation shape: count=null, error=null, HTTP 204.
    // `count ?? 0` here would report a calm, confident, wrong zero.
    seedReturningVisitor({ naics: '541512' });
    tables.sam_opportunities.count = null;
    const r = await (await GET(req(`anonId=${ANON}`))).json();
    expect(r.newInMarket.state).toBe('unknown');
    expect(r.newInMarket.count).toBeUndefined();
    expect(r._meta.grounded).toBe(false);
  });

  it('a failed count query is UNKNOWN, not 0', async () => {
    seedReturningVisitor({ naics: '541512' });
    tables.sam_opportunities.error = { message: 'statement timeout' };
    const r = await (await GET(req(`anonId=${ANON}`))).json();
    expect(r.newInMarket.state).toBe('unknown');
    expect(r.newInMarket.why).toContain('statement timeout');
  });

  it('NO recoverable market -> no_basis, not "0 new opportunities"', async () => {
    // 244 of 414 returners (59%) are in exactly this position today.
    seedReturningVisitor(null);
    const r = await (await GET(req(`anonId=${ANON}`))).json();
    expect(r.newInMarket.state).toBe('no_basis');
    expect(r.newInMarket.why).toContain('no_market_scope');
    expect(JSON.stringify(r.newInMarket)).not.toMatch(/"count"/);
  });

  it('listings that no longer resolve are EXCLUDED, never counted as unchanged', async () => {
    // Measured: 2,558 of 3,973 opened ids no longer resolve in the SAM cache.
    tables.user_engagement.rows = [
      { created_at: iso(3 * DAY), metadata: { action: 'listing_open', notice_id: 'GONE-FROM-CACHE' } },
      { created_at: iso(30_000), metadata: { action: 'map_view' } },
    ];
    tables.sam_opportunities.rows = [];
    const r = await (await GET(req(`anonId=${ANON}`))).json();
    expect(r.listingClosed.state).toBe('no_basis');
    expect(r.listingClosed.why).toContain('unresolvable_listings');
  });
});

describe('the window', () => {
  it('a FIRST-time visitor gets no brief', async () => {
    tables.user_engagement.rows = [{ created_at: iso(60_000), metadata: { action: 'map_view' } }];
    const r = await (await GET(req(`anonId=${ANON}`))).json();
    expect(r.isReturn).toBe(false);
    expect(r._meta.reason).toBe('first_visit');
  });

  it('a 2-hour coffee break is not a return', async () => {
    tables.user_engagement.rows = [
      { created_at: iso(2 * 3_600_000), metadata: { action: 'map_view' } },
      { created_at: iso(30_000), metadata: { action: 'map_view' } },
    ];
    const r = await (await GET(req(`anonId=${ANON}`))).json();
    expect(r.isReturn).toBe(false);
    expect(r._meta.reason).toBe('gap_too_short');
  });
});

describe('listing_closed', () => {
  it('counts only deadlines that passed INSIDE the window', async () => {
    tables.user_engagement.rows = [
      { created_at: iso(5 * DAY), metadata: { action: 'listing_open', notice_id: 'A' } },
      { created_at: iso(5 * DAY), metadata: { action: 'listing_open', notice_id: 'B' } },
      { created_at: iso(5 * DAY), metadata: { action: 'listing_open', notice_id: 'C' } },
      { created_at: iso(30_000), metadata: { action: 'map_view' } },
    ];
    tables.sam_opportunities.rows = [
      { notice_id: 'A', title: 'Closed while away', response_deadline: iso(2 * DAY) },  // inside
      { notice_id: 'B', title: 'Closed BEFORE they left', response_deadline: iso(9 * DAY) }, // before window
      { notice_id: 'C', title: 'Still open', response_deadline: new Date(NOW + 9 * DAY).toISOString() }, // future
    ];
    const r = await (await GET(req(`anonId=${ANON}`))).json();
    expect(r.listingClosed.state).toBe('measured');
    expect(r.listingClosed.count).toBe(1);
    expect(r.listingClosed.detail.listings[0].noticeId).toBe('A');
    expect(r.listingClosed.detail.resolved).toBe(3);
  });

  it('never counts a listing opened AFTER the last visit — that is this session, not news', async () => {
    tables.user_engagement.rows = [
      { created_at: iso(5 * DAY), metadata: { action: 'map_view' } },
      { created_at: iso(20_000), metadata: { action: 'listing_open', notice_id: 'JUSTNOW' } },
    ];
    tables.sam_opportunities.rows = [{ notice_id: 'JUSTNOW', title: 'x', response_deadline: iso(DAY) }];
    const r = await (await GET(req(`anonId=${ANON}`))).json();
    expect(r.listingClosed.state).toBe('no_basis');
  });
});

describe('the withheld registry always ships with the brief', () => {
  it('names the four classes we refuse to count, with evidence', async () => {
    seedReturningVisitor({ naics: '541512' });
    const r = await (await GET(req(`anonId=${ANON}`))).json();
    expect(r.withheld.map((w: { key: string }) => w.key).sort())
      .toEqual(['amendment', 'deadline_moved', 'forecast_change', 'recompete_moved']);
    for (const w of r.withheld) expect(typeof w.evidence).toBe('string');
  });

  it('a withheld class never carries a count anywhere in the payload', async () => {
    seedReturningVisitor({ naics: '541512' });
    tables.sam_opportunities.count = 7;
    const r = await (await GET(req(`anonId=${ANON}`))).json();
    for (const w of r.withheld) expect(w).not.toHaveProperty('count');
  });
});

describe('provenance', () => {
  it('every rendered number carries a provenance line', async () => {
    seedReturningVisitor({ naics: '541512' });
    tables.sam_opportunities.count = 7;
    tables.sam_opportunities.rows = [];
    const r = await (await GET(req(`anonId=${ANON}`))).json();
    expect(r._meta.provenance.length).toBeGreaterThan(0);
    expect(r._meta.provenance[0]).toContain('created_at');
    expect(r._meta.provenance[0]).toContain('applyMapFilters');
  });

  it('the market link carries the SAME scope the count was computed from', async () => {
    seedReturningVisitor({ naics: '541512', state: 'FL', bbox: { n: 1 }, device: 'mobile' });
    tables.sam_opportunities.count = 7;
    const r = await (await GET(req(`anonId=${ANON}`))).json();
    expect(r.newInMarket.detail.link).toBe('/opportunity-map?naics=541512&state=FL');
    // telemetry noise never reaches a shareable URL
    expect(r.newInMarket.detail.link).not.toMatch(/bbox|device/);
  });

  it('a saved WATCH outranks an observed filter', async () => {
    seedReturningVisitor({ naics: '541512' });
    tables.saved_searches.rows = [{ name: 'My Navy IT market', filters: { naics: '541330', agency: 'Navy' }, created_at: iso(DAY) }];
    tables.sam_opportunities.count = 3;
    const r = await (await GET(req(`anonId=${ANON}`))).json();
    expect(r.newInMarket.detail.scope.basis).toBe('saved_watch');
    expect(r.newInMarket.detail.scope.label).toBe('My Navy IT market');
  });
});
