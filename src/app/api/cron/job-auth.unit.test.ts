/**
 * Scheduled job routes require server-side authorization (2026-11-07).
 *
 * Behavioral sweep: every route under src/app/api/cron (plus the admin job routes the dispatcher
 * calls) is invoked with ONLY caller-set headers. None may touch the database, the network or the
 * email sender, and none may answer 2xx with a run result. Then the same request with the
 * CRON_SECRET bearer must get past the gate.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const sideEffects = vi.hoisted(() => ({ calls: [] as string[] }));

vi.mock('@supabase/supabase-js', () => {
  const client = new Proxy({}, { get: (_t, p) => { if (p === 'then') return undefined; sideEffects.calls.push(`supabase.${String(p)}`); return () => client; } });
  return { createClient: () => client };
});
vi.mock('@/lib/supabase/server-clients', () => {
  const client: unknown = new Proxy({}, { get: (_t, p) => (p === 'then' ? undefined : () => client) });
  const touch = (n: string) => () => { sideEffects.calls.push(n); return client; };
  return { getWriteClient: touch('getWriteClient'), getReadClient: touch('getReadClient'), getCountClient: touch('getCountClient') };
});
vi.mock('@/lib/send-email', () => ({
  sendEmail: vi.fn(async () => { sideEffects.calls.push('sendEmail'); return true; }),
}));
vi.mock('next/cache', () => ({ revalidatePath: () => sideEffects.calls.push('revalidatePath'), revalidateTag: () => {}, unstable_cache: (f: unknown) => f }));

const SECRET = 'job-auth-test-secret';
process.env.CRON_SECRET = SECRET;
process.env.ADMIN_PASSWORD = 'job-auth-admin';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';

const cronRoutes = import.meta.glob('./**/route.ts');
const adminRoutes = import.meta.glob([
  '../admin/backfill-pop-state/route.ts',
  '../admin/backfill-target-counts/route.ts',
  '../admin/backfill-target-opp-counts/route.ts',
  '../admin/send-profile-reminders/route.ts',
  '../admin/sync-alert-profiles/route.ts',
  '../admin/sync-naics-to-alerts/route.ts',
  '../admin/trigger-catchup-briefings/route.ts',
  '../admin/alert-status/route.ts',
]);
const routes = { ...cronRoutes, ...adminRoutes };

const SPOOF_HEADERS = [
  { 'x-cron-dispatch': '1' },
  { 'x-vercel-cron': '1' },
  { 'x-cron-dispatch': '1', 'x-vercel-cron': '1', authorization: 'Bearer wrong' },
];

type Handler = (req: NextRequest) => Promise<Response> | Response;

beforeEach(() => {
  sideEffects.calls.length = 0;
  // Production semantics: some older routes skip auth outside production.
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubGlobal('fetch', vi.fn(async (u: unknown) => { sideEffects.calls.push(`fetch ${String(u)}`); throw new Error('network'); }));
});

describe('scheduled job routes reject caller-set headers', () => {
  it('finds the routes it guards', () => {
    expect(Object.keys(cronRoutes).length).toBeGreaterThan(80);
    expect(Object.keys(adminRoutes).length).toBe(8);
  });

  for (const [path, load] of Object.entries(routes)) {
    it(`${path}: no side effect without the CRON_SECRET bearer`, async () => {
      const mod = (await load()) as Record<string, Handler>;
      for (const method of ['GET', 'POST'] as const) {
        const handler = mod[method];
        if (typeof handler !== 'function') continue;
        for (const headers of SPOOF_HEADERS) {
          sideEffects.calls.length = 0;
          const url = `https://getmindy.ai/api/x?mode=execute&limit=5`;
          let status = 0;
          try {
            const res = await handler(new NextRequest(url, { method, headers }));
            status = res.status;
          } catch {
            status = -1; // a throw is not an authorization pass, but it must still have no side effect
          }
          expect(sideEffects.calls, `${method} ${JSON.stringify(headers)} → status ${status}`).toEqual([]);
          if (status >= 200 && status < 300) {
            // A 2xx is allowed only for routes whose unauthenticated GET returns documentation.
            expect(DOC_ONLY_GET.has(path) && method === 'GET', `${path} ${method} answered ${status} to a spoofed request`).toBe(true);
          }
        }
      }
    });
  }
});

/** Unauthenticated GET answers with usage text and runs nothing (asserted above by the side-effect check). */
const DOC_ONLY_GET = new Set<string>([
  './daily-alerts/route.ts',
  './weekly-alerts/route.ts',
  './send-notifications/route.ts',
  './check-briefing-health/route.ts',
  './check-fms-health/route.ts',
  './manage-briefing-rollout/route.ts',
]);

describe('the CRON_SECRET bearer gets past the gate', () => {
  it.each([
    './saved-search-alerts/route.ts',
    './setup-invite-batch/route.ts',
    './sync-stripe-cache/route.ts',
    './upgrade-drip/route.ts',
  ])('%s attempts work with the bearer', async (path) => {
    const mod = (await routes[path]()) as Record<string, Handler>;
    sideEffects.calls.length = 0;
    try {
      await mod.GET(new NextRequest('https://getmindy.ai/api/x?limit=1', { headers: { authorization: `Bearer ${SECRET}` } }));
    } catch { /* downstream mocks throw; reaching them is the point */ }
    expect(sideEffects.calls.length).toBeGreaterThan(0);
  });
});
