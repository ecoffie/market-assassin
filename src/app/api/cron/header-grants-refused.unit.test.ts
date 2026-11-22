/**
 * Scheduled-job and dispatcher-run admin routes authorize ONLY with the CRON_SECRET bearer (or, where a route
 * already allowed it, the admin password). Caller-set headers never authorize, and an unset CRON_SECRET never
 * lets a request through. For every route here, in production:
 *   no credentials / caller-set cron headers only / a wrong bearer / CRON_SECRET unset ("Bearer undefined")
 * -> 401, and the job never starts: no database client, no fetch, no email.
 * Isolated: every client is a recording fake; no route is called over the network.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const calls = vi.hoisted(() => ({ db: 0, email: 0, fetch: 0 }));
vi.hoisted(() => {
  (globalThis as Record<string, unknown>).__headerGrantFakeDb = () => {
    calls.db++;
    const p: unknown = new Proxy(function () {}, {
      get: (_t, prop) => (prop === 'then' ? (res: (v: unknown) => unknown) => res({ data: [], error: null, count: 0 }) : p),
      apply: () => p,
    });
    return p;
  };
});
const fakeDb = () => (globalThis as unknown as { __headerGrantFakeDb: () => unknown }).__headerGrantFakeDb();
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => fakeDb()) }));
vi.mock('@/lib/supabase/server-clients', () => ({
  getWriteClient: vi.fn(() => fakeDb()), getReadClient: vi.fn(() => fakeDb()), getServiceClient: vi.fn(() => fakeDb()),
}));
vi.mock('@/lib/send-email', () => ({ sendEmail: vi.fn(async () => { calls.email++; return true; }) }));
vi.mock('@/lib/admin-identity', () => ({ verifyAdminAuth: vi.fn(async () => ({ ok: false })) }));

const ROUTES = [
  'admin/alert-status',
  'admin/backfill-pop-state',
  'admin/backfill-target-counts',
  'admin/backfill-target-opp-counts',
  'admin/enroll-leads-to-alerts',
  'admin/enroll-ma-alerts',
  'admin/seed-alerts',
  'admin/send-catch-up-alerts',
  'admin/send-profile-reminders',
  'admin/sync-alert-profiles',
  'admin/sync-alert-to-notification',
  'admin/sync-naics-to-alerts',
  'admin/trigger-catchup-briefings',
  'cron/aggregate-profiles',
  'cron/awards-build-worker',
  'cron/awards-prune',
  'cron/awards-refresh',
  'cron/backfill-event-offices',
  'cron/backfill-recipient-certs',
  'cron/backfill-sam-attachments',
  'cron/backfill-sam-descriptions',
  'cron/backup-vault-files',
  'cron/bootcamp-lifetime-offer',
  'cron/bootcamp-rollout',
  'cron/check-alert-throughput',
  'cron/check-briefing-health',
  'cron/check-data-freshness',
  'cron/check-fms-health',
  'cron/check-provider-health',
  'cron/daily-alerts',
  'cron/data-invariants-watch',
  'cron/db-health-watch',
  'cron/dispatch',
  'cron/dispatcher-watchdog',
  'cron/doj-forecast-sync',
  'cron/email-map-digest',
  'cron/embed-user-capabilities',
  'cron/epa-source-watch',
  'cron/extract-sam-events',
  'cron/fco-roster-watch',
  'cron/founders-seats-refresh',
  'cron/grant-mcp-pro-credits',
  'cron/hhs-forecast-sync',
  'cron/indexnow-submit',
  'cron/institute-gao-sync',
  'cron/institute-legislation-sync',
  'cron/manage-briefing-rollout',
  'cron/mcp-autorecharge',
  'cron/nasa-forecast-sync',
  'cron/navy-source-watch',
  'cron/nrc-source-watch',
  'cron/onboarding-thin-rate',
  'cron/precompute-today-intel',
  'cron/rebuild-capability-profiles',
  'cron/refresh-bq-rollups',
  'cron/refresh-contracts',
  'cron/refresh-dodaac-directory',
  'cron/run-proposal-jobs',
  'cron/sam-sync-watchdog',
  'cron/send-notifications',
  'cron/seo-materialize',
  'cron/seo-report',
  'cron/snapshot-awards',
  'cron/snapshot-opportunities',
  'cron/snapshot-recompetes',
  'cron/ssa-forecast-sync',
  'cron/ssa-source-watch',
  'cron/sync-dod-sbir',
  'cron/sync-gov-buyer-data',
  'cron/sync-recompete-contracts',
  'cron/sync-sam-opportunities',
  'cron/sync-stripe-cache',
  'cron/sync-usaspending-awards',
  'cron/throughput-digest',
  'cron/upgrade-drip',
  'cron/warm-contractor-pages',
  'cron/watch-key-accounts',
  'cron/web-intelligence',
  'cron/weekly-alerts',
] as const;

type Handler = (r: NextRequest) => Promise<Response> | Response;
const handlers = new Map<string, Array<[string, Handler]>>();

beforeEach(async () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('CRON_SECRET', 'test-cron-secret');
  vi.stubEnv('ADMIN_PASSWORD', 'test-admin-password');
  vi.stubGlobal('fetch', vi.fn(async () => { calls.fetch++; return new Response('{}'); }));
  for (const r of ROUTES) {
    if (handlers.has(r)) continue;
    const mod = (await import(`../${r}/route`)) as Record<string, unknown>;
    handlers.set(r, (['GET', 'POST'] as const).filter((m) => typeof mod[m] === 'function').map((m) => [m, mod[m] as Handler]));
  }
  calls.db = 0; calls.email = 0; calls.fetch = 0;
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const req = (route: string, method: string, headers: Record<string, string> = {}) =>
  new NextRequest(`https://getmindy.ai/api/${route}`, { method, headers, ...(method === 'POST' ? { body: '{}' } : {}) });

describe.each(ROUTES)('/api/%s', (route) => {
  const cases: Array<[string, Record<string, string>, boolean]> = [
    ['no credentials', {}, false],
    ['caller-set cron headers only', { 'x-vercel-cron': '1', 'x-cron-dispatch': '1' }, false],
    ['a wrong bearer', { authorization: 'Bearer not-the-secret' }, false],
    ['CRON_SECRET unset, "Bearer undefined"', { authorization: 'Bearer undefined' }, true],
    ['CRON_SECRET unset, no header', {}, true],
  ];
  it.each(cases)('%s -> 401, the job never starts', async (_label, headers, unsetSecret) => {
    if (unsetSecret) vi.stubEnv('CRON_SECRET', '');
    const hs = handlers.get(route)!;
    expect(hs.length).toBeGreaterThan(0);
    for (const [method, h] of hs) {
      const res = await h(req(route, method, headers));
      if (res.status !== 401) {
        // A few routes answer an unauthenticated GET with their usage document instead of 401. That is a
        // refusal too, as long as nothing ran (asserted below) and the body is only the usage text.
        expect(res.status, `${method} ${route}`).toBe(200);
        const body = (await res.json()) as Record<string, unknown>;
        expect(body, `${method} ${route} body`).toHaveProperty('usage');
      }
    }
    expect(calls).toEqual({ db: 0, email: 0, fetch: 0 });
  });
});

describe('a test send to an arbitrary address is not authorization', () => {
  it.each(['cron/daily-alerts', 'cron/send-notifications'])('/api/%s?email=…&test=true without the secret → 401, nothing sent', async (route) => {
    const mod = (await import(`../${route}/route`)) as { GET: Handler };
    const res = await mod.GET(new NextRequest(`https://getmindy.ai/api/${route}?email=someone@example.com&test=true`));
    expect(res.status).toBe(401);
    expect(calls).toEqual({ db: 0, email: 0, fetch: 0 });
  });
});

describe('the real scheduler credential still works (Vercel native crons and the dispatcher)', () => {
  // vercel.json crons: Vercel sends `Authorization: Bearer $CRON_SECRET` when CRON_SECRET is set.
  it.each(['cron/dispatch', 'cron/dispatcher-watchdog', 'cron/founders-seats-refresh', 'cron/warm-contractor-pages', 'cron/lazy-blueprint-sms'])('/api/%s accepts the CRON_SECRET bearer', async (route) => {
    const mod = (await import(`../${route}/route`)) as { GET: Handler };
    const res = await mod.GET(new NextRequest(`https://getmindy.ai/api/${route}?dry_run=true`, { headers: { authorization: 'Bearer test-cron-secret' } }));
    expect(res.status).not.toBe(401);
  });
});
