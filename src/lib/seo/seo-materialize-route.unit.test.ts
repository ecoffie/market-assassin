/**
 * /api/cron/seo-materialize is the only live path to two 10-17 GB BigQuery scans. These tests pin
 * its guards: auth, one-at-a-time, scan frequency, and failure reporting.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const m = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  kvDown: false,
  latest: vi.fn(),
  largest: vi.fn(),
  build: vi.fn(),
  unavailable: vi.fn(),
}));
vi.mock('@vercel/kv', () => ({
  kv: {
    set: vi.fn(async (k: string, v: unknown, o?: { nx?: boolean }) => {
      if (m.kvDown) throw new Error('KV down');
      if (o?.nx && m.store.has(k)) return null;
      m.store.set(k, v);
      return 'OK';
    }),
    get: vi.fn(async (k: string) => (m.store.has(k) ? m.store.get(k) : null)),
    del: vi.fn(async (k: string) => m.store.delete(k)),
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }));
vi.mock('@/lib/seo/forecast-summary-builder', () => ({ buildForecastSummary: m.build, FORECAST_SUMMARY_TTL_SECONDS: 1 }));
vi.mock('@/lib/bigquery/awards', () => ({
  getLatestAwards: m.latest,
  getLargestAwards: m.largest,
  awardListKey: (k: string, n: number) => `awards:${k}:${n}`,
}));
vi.mock('@/lib/bigquery/cache', () => ({ bqUnavailable: m.unavailable }));

import { GET } from '@/app/api/cron/seo-materialize/route';

const req = (q = '', headers: Record<string, string> = { authorization: 'Bearer s3cret' }) =>
  new NextRequest(`https://getmindy.ai/api/cron/seo-materialize${q}`, { headers });
const liveCalls = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.filter((c) => c[1]?.liveBq).length;

beforeEach(() => {
  process.env.CRON_SECRET = 's3cret';
  process.env.ADMIN_PASSWORD = 'pw';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://sb';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
  m.store.clear();
  m.kvDown = false;
  m.build.mockReset().mockResolvedValue({ truncated: false, total: 36841, agencies: [1, 2] });
  m.latest.mockReset().mockImplementation(async (_n: number, o?: { liveBq?: boolean }) => (o?.liveBq ? [{ a: 1 }] : []));
  m.largest.mockReset().mockImplementation(async (_n: number, o?: { liveBq?: boolean }) => (o?.liveBq ? [{ a: 1 }] : []));
  m.unavailable.mockReset().mockReturnValue(false);
});

describe('auth', () => {
  it('rejects the spoofable x-vercel-cron header on its own, and no auth at all', async () => {
    expect((await GET(req('', { 'x-vercel-cron': '1' }))).status).toBe(401);
    expect((await GET(req('', {}))).status).toBe(401);
    expect(m.latest).not.toHaveBeenCalled();
  });
  it('accepts the dispatcher bearer and the admin password', async () => {
    expect((await GET(req())).status).toBe(200);
    m.store.clear();
    expect((await GET(req('?password=pw', {}))).status).toBe(200);
  });
});

describe('concurrency', () => {
  it('an overlapping run returns 409 without querying', async () => {
    m.store.set('cron:seo-materialize:lock', 'other-run');
    const r = await GET(req());
    expect(r.status).toBe(409);
    expect(m.latest).not.toHaveBeenCalled();
    expect(m.build).not.toHaveBeenCalled();
  });
  it('fails closed when the lock cannot be taken (KV down)', async () => {
    m.kvDown = true;
    expect((await GET(req())).status).toBe(503);
    expect(m.latest).not.toHaveBeenCalled();
  });
  it('releases its lock when done', async () => {
    await GET(req());
    expect(m.store.has('cron:seo-materialize:lock')).toBe(false);
  });
});

describe('BigQuery frequency', () => {
  it('first run builds all three', async () => {
    const r = await GET(req());
    const body = await r.json();
    expect(body.success).toBe(true);
    expect(liveCalls(m.latest)).toBe(1);
    expect(liveCalls(m.largest)).toBe(1);
  });
  it('a second run within 20h re-scans neither list', async () => {
    await GET(req());
    m.latest.mockImplementation(async (_n: number, o?: { liveBq?: boolean }) => [{ a: 1 }]); // now cached
    m.largest.mockImplementation(async () => [{ a: 1 }]);
    m.latest.mockClear(); m.largest.mockClear();
    const body = await (await GET(req())).json();
    expect(liveCalls(m.latest)).toBe(0);
    expect(liveCalls(m.largest)).toBe(0);
    expect(body.steps.awardsLatest.detail).toMatch(/not rebuilt/);
  });
  it('?force=1 refreshes "latest" but never re-scans a cached "largest"', async () => {
    await GET(req());
    m.latest.mockImplementation(async () => [{ a: 1 }]);
    m.largest.mockImplementation(async () => [{ a: 1 }]);
    m.latest.mockClear(); m.largest.mockClear();
    await GET(req('?force=1'));
    expect(liveCalls(m.latest)).toBe(1);
    expect(liveCalls(m.largest)).toBe(0);
  });
});

describe('failure behavior', () => {
  it('a BigQuery failure reports 500 and keeps the previous value', async () => {
    m.latest.mockImplementation(async () => []);
    m.unavailable.mockReturnValue(true);
    const r = await GET(req());
    expect(r.status).toBe(500);
    expect((await r.json()).steps.awardsLatest.ok).toBe(false);
  });
  it('a truncated forecast build is not written', async () => {
    m.build.mockResolvedValue({ truncated: true, total: 36841, agencies: [] });
    const r = await GET(req());
    expect(r.status).toBe(500);
    expect(m.store.has('seo:forecast-summary:v1')).toBe(false);
  });
});
