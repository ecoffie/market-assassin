/**
 * Every scheduled-job route fixed here refuses an unauthenticated request in production with a bare 401,
 * and the job body never starts: no database client, no fetch, no email. Caller-set headers
 * (x-cron-dispatch, x-vercel-cron) do not authorize. The dispatcher's CRON_SECRET bearer still does.
 *
 * Isolated: every client is a recording fake; no route is ever called over the network.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const calls = vi.hoisted(() => ({ db: 0, email: 0, fetch: 0 }));

// Any attempt to reach the database records a call. The fake is chainable and resolves to an empty result.
vi.hoisted(() => {
  (globalThis as Record<string, unknown>).__cronAuthFakeDb = () => {
    calls.db++;
    const p: unknown = new Proxy(function () {}, {
      get: (_t, prop) => (prop === 'then' ? (res: (v: unknown) => unknown) => res({ data: [], error: null, count: 0 }) : p),
      apply: () => p,
    });
    return p;
  };
});
const fakeDb = () => (globalThis as unknown as { __cronAuthFakeDb: () => unknown }).__cronAuthFakeDb();
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => fakeDb()) }));
vi.mock('@/lib/supabase/server-clients', () => ({
  getWriteClient: vi.fn(() => fakeDb()),
  getReadClient: vi.fn(() => fakeDb()),
  getServiceClient: vi.fn(() => fakeDb()),
}));
vi.mock('@/lib/send-email', () => ({ sendEmail: vi.fn(async () => { calls.email++; return true; }) }));
vi.mock('@/lib/admin-identity', () => ({ verifyAdminAuth: vi.fn(async () => ({ ok: false })) }));

const ROUTES = [
  'backfill-descriptions', 'briefing-watchdog', 'build-recent-spending', 'build-weird-awards', 'embed-sow-corpus',
  'enrich-opportunity-seo', 'enrich-recompete-detail', 'geocode-open-opps', 'precompute-opp-intel', 'pursuit-changes',
  'saved-search-alerts', 'setup-invite-batch', 'snapshot-leaderboards', 'snapshot-metrics', 'snapshot-watchlist',
  'sow-catalog', 'tag-cta', 'zero-alert-nudge',
] as const;

const handlers = new Map<string, (r: NextRequest) => Promise<Response>>();

beforeEach(async () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('CRON_SECRET', 'test-cron-secret');
  vi.stubEnv('ADMIN_PASSWORD', 'test-admin-password');
  vi.stubGlobal('fetch', vi.fn(async () => { calls.fetch++; return new Response('{}'); }));
  for (const r of ROUTES) {
    if (!handlers.has(r)) handlers.set(r, (await import(`./${r}/route`)).GET as (r: NextRequest) => Promise<Response>);
  }
  // Count only what a REQUEST triggers, not module initialisation.
  calls.db = 0; calls.email = 0; calls.fetch = 0;
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const req = (route: string, headers: Record<string, string> = {}, qs = '') =>
  new NextRequest(`https://getmindy.ai/api/cron/${route}${qs}`, { headers });

describe.each(ROUTES)('/api/cron/%s', (route) => {
  it('no credentials → 401, and the job never starts', async () => {
    const res = await handlers.get(route)!(req(route));
    expect(res.status).toBe(401);
    expect(calls).toEqual({ db: 0, email: 0, fetch: 0 });
  });

  it('caller-set cron headers alone → 401, and the job never starts', async () => {
    const res = await handlers.get(route)!(req(route, { 'x-cron-dispatch': '1', 'x-vercel-cron': '1' }));
    expect(res.status).toBe(401);
    expect(calls).toEqual({ db: 0, email: 0, fetch: 0 });
  });

  it('a wrong bearer → 401', async () => {
    const res = await handlers.get(route)!(req(route, { authorization: 'Bearer not-the-secret' }));
    expect(res.status).toBe(401);
    expect(calls).toEqual({ db: 0, email: 0, fetch: 0 });
  });

  it('the admin password does not run a scheduled job', async () => {
    const res = await handlers.get(route)!(req(route, {}, '?password=test-admin-password'));
    expect(res.status).toBe(401);
    expect(calls.email).toBe(0);
  });
});

describe('saved-search-alerts preview', () => {
  it('a preview without verified admin auth is refused too', async () => {
    const res = await handlers.get('saved-search-alerts')!(req('saved-search-alerts', {}, '?mode=preview'));
    expect(res.status).toBe(401);
    expect(calls).toEqual({ db: 0, email: 0, fetch: 0 });
  });
});
