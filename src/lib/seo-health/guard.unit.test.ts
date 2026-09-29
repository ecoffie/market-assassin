/**
 * Proof that the SEO health job is OBSERVE-ONLY.
 *
 * 1. Static: walk the full import graph of the cron route and fail on any path to
 *    BigQuery, page regeneration, KV, IndexNow, the sitemap generator or cache warmers,
 *    and on any Supabase table other than the four seo_health_* tables.
 * 2. Runtime: import the route with those modules replaced by throwing stubs (an import
 *    of any of them fails the test), run a full job against fakes, and check every
 *    outbound request and every table touched.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

// Any of these being imported anywhere in the route's graph throws at import time.
vi.mock('@/lib/bigquery/client', () => { throw new Error('seo-health reached @/lib/bigquery/client'); });
vi.mock('@/lib/bigquery/cache', () => { throw new Error('seo-health reached @/lib/bigquery/cache'); });
vi.mock('@/lib/bigquery/recipients', () => { throw new Error('seo-health reached @/lib/bigquery/recipients'); });
vi.mock('@google-cloud/bigquery', () => { throw new Error('seo-health reached @google-cloud/bigquery'); });
vi.mock('@vercel/kv', () => { throw new Error('seo-health reached @vercel/kv'); });
vi.mock('next/cache', () => { throw new Error('seo-health reached next/cache (revalidate)'); });

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ROUTES = [join(SRC, 'app/api/cron/seo-health/route.ts'), join(SRC, 'app/api/cron/seo-health-watchdog/route.ts')];
const ALLOWED_TABLES = new Set(['seo_health_runs', 'seo_health_url_checks', 'seo_health_cursors', 'seo_health_stratum_daily']);

function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = join(SRC, spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(from), spec);
  else return null; // package import: checked by name below
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(cand) && !cand.endsWith('/')) {
      try {
        readFileSync(cand);
        return cand;
      } catch {
        /* directory */
      }
    }
  }
  return null;
}

function importGraph(entries: string[]) {
  const files = new Set<string>();
  const packages = new Set<string>();
  const stack = [...entries];
  while (stack.length) {
    const f = stack.pop()!;
    if (files.has(f)) continue;
    files.add(f);
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const spec = m[1] ?? m[2] ?? m[3];
      if (!spec || /^import\s+type\b/.test(m[0])) continue;
      const r = resolveImport(f, spec);
      if (r) stack.push(r);
      else if (!spec.startsWith('.') && !spec.startsWith('@/')) packages.add(spec);
    }
  }
  return { files: [...files], packages: [...packages] };
}

describe('seo-health import graph (static): the job AND its watchdog', () => {
  const graph = importGraph(ROUTES);
  const rel = graph.files.map((f) => relative(SRC, f));

  it('includes the job code it is meant to guard', () => {
    expect(rel).toEqual(expect.arrayContaining(['app/api/cron/seo-health/route.ts', 'app/api/cron/seo-health-watchdog/route.ts', 'lib/seo-health/run.ts', 'lib/seo-health/store.ts', 'lib/seo-health/observe.ts', 'lib/seo-health/watchdog.ts']));
  });

  it('never reaches BigQuery, KV, page regeneration, IndexNow, the sitemap generator or cache warmers', () => {
    for (const f of rel) {
      expect(f).not.toMatch(/^lib\/bigquery\//);
      expect(f).not.toMatch(/indexnow/i);
      expect(f).not.toMatch(/^app\/sitemap/);
      expect(f).not.toMatch(/warm/i);
    }
    for (const p of graph.packages) {
      expect(p).not.toMatch(/bigquery|@vercel\/kv|^next\/cache$|indexnow/i);
    }
  });

  it('contains no mutation calls against pages, caches, the sitemap or search engines', () => {
    // Code only: comments are stripped so documentation ("never calls IndexNow") is allowed.
    const forbidden = [/\brevalidatePath\b/, /\brevalidateTag\b/, /\bkv\.(set|del|incr|hset|expire)\b/, /\bbqQuery\b/, /\bqueryCached\b/, /\bgetRollupOrSingleBySlug\b/, /indexnow\.org|bing\.com\/indexnow|\/indexnow\b|submitIndexNow|indexNow\w*\(/i, /\bping\?sitemap/i];
    const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    for (const f of graph.files) {
      const src = code(readFileSync(f, 'utf8'));
      for (const re of forbidden) expect({ file: relative(SRC, f), hit: re.test(src) }).toEqual({ file: relative(SRC, f), hit: false });
    }
  });

  it('touches no Supabase table other than the four seo_health_* tables', () => {
    for (const f of graph.files) {
      for (const m of readFileSync(f, 'utf8').matchAll(/\.from\(\s*['"`]([a-z0-9_]+)['"`]/g)) {
        expect({ file: relative(SRC, f), table: m[1], allowed: ALLOWED_TABLES.has(m[1]) }).toEqual({ file: relative(SRC, f), table: m[1], allowed: true });
      }
    }
  });
});

describe('seo-health at runtime', () => {
  it('runs end to end with only GETs to the public site, read-only Google calls, and seo_health_* writes', async () => {
    // The route module graph imports cleanly with BigQuery/KV/next-cache stubbed to throw.
    await expect(import('@/app/api/cron/seo-health/route')).resolves.toHaveProperty('GET');
    await expect(import('@/app/api/cron/seo-health-watchdog/route')).resolves.toHaveProperty('GET');

    const { runSeoHealth } = await import('./run');
    const { createStore } = await import('./store');

    const requests: Array<{ method: string; url: string }> = [];
    const html = `<html><head><link rel="canonical" href="__URL__"></head><body><h1>Acme</h1><p>${'word '.repeat(300)}</p></body></html>`;
    const fetchSpy = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ method: (init?.method ?? 'GET').toUpperCase(), url });
      if (url.endsWith('/sitemap-index.xml')) return new Response('<sitemapindex><sitemap><loc>https://getmindy.ai/sitemap.xml</loc></sitemap></sitemapindex>', { status: 200 });
      if (url.endsWith('/sitemap.xml')) return new Response('<urlset>' + ['/a', '/b', '/contractors/c'].map((p) => `<url><loc>https://getmindy.ai${p}</loc></url>`).join('') + '</urlset>', { status: 200 });
      return new Response(html.replace('__URL__', url), { status: 200, headers: { 'content-type': 'text/html' } });
    }) as typeof fetch;

    const tableOps: Array<{ table: string; op: string }> = [];
    const fakeDb = {
      from(table: string) {
        const q: Record<string, unknown> = {};
        const chain = new Proxy(q, {
          get(_t, prop: string) {
            if (prop === 'then') return (res: (v: unknown) => void) => res({ data: prop === 'then' ? [] : null, error: null });
            if (['insert', 'update', 'upsert', 'delete'].includes(prop)) tableOps.push({ table, op: prop });
            if (prop === 'select') tableOps.push({ table, op: 'select' });
            if (prop === 'single' || prop === 'maybeSingle') return async () => ({ data: table === 'seo_health_runs' ? { id: 1 } : null, error: null });
            if (prop === 'range') return async () => ({ data: [], error: null });
            return () => chain;
          },
        });
        return chain;
      },
    };

    const result = await runSeoHealth({
      fetch: fetchSpy,
      gsc: {
        datePageRows: async () => ({ rows: [{ keys: ['2026-09-20', 'https://getmindy.ai/a'], clicks: 1, impressions: 10 }], pages: 1, rowCount: 1, complete: true }),
        inspect: async () => ({ ok: true as const, result: { verdict: 'PASS', coverageState: 'Submitted and indexed' } }),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      store: createStore(fakeDb as any),
      postSlack: async () => ({ ok: true }),
      now: Date.now,
      liveBqEnabled: () => false,
    });

    expect(result.status).not.toBe('failed');
    // Every outbound HTTP request from the job itself is a GET to the public site.
    expect(requests.length).toBeGreaterThan(0);
    for (const r of requests) {
      expect(r.method).toBe('GET');
      expect(new URL(r.url).host).toBe('getmindy.ai');
    }
    // Every table read or written is a seo_health_* table.
    expect(tableOps.length).toBeGreaterThan(0);
    for (const t of tableOps) expect(ALLOWED_TABLES.has(t.table)).toBe(true);
    // And nothing is ever deleted.
    expect(tableOps.some((t) => t.op === 'delete')).toBe(false);
  });

  it('refuses to crawl when live BigQuery is enabled, so crawling cannot trigger a scan', async () => {
    const { runSeoHealth } = await import('./run');
    const crawled: string[] = [];
    const store = memoryStore();
    const result = await runSeoHealth({
      fetch: (async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('sitemap')) return new Response(url.endsWith('index.xml') ? '<urlset><url><loc>https://getmindy.ai/a</loc></url></urlset>' : '', { status: 200 });
        crawled.push(url);
        return new Response('', { status: 200 });
      }) as typeof fetch,
      gsc: { datePageRows: async () => ({ rows: [], pages: 1, rowCount: 0, complete: true }), inspect: async () => ({ ok: true as const, result: {} }) },
      store,
      postSlack: async () => ({ ok: true }),
      now: Date.now,
      liveBqEnabled: () => true,
    });
    expect(crawled).toEqual([]);
    expect(result.summary.crawl).toEqual({ skipped: 'live_bq_enabled' });
  });
});

describe('seo-health routes: header-only auth', () => {
  it('reject ?password=ADMIN_PASSWORD, x-vercel-cron: 1 (caller-controlled), and a wrong bearer', async () => {
    process.env.ADMIN_PASSWORD = 'admin-pw';
    process.env.CRON_SECRET = 'cron-secret';
    const { NextRequest } = await import('next/server');
    for (const path of ['@/app/api/cron/seo-health/route', '@/app/api/cron/seo-health-watchdog/route']) {
      const { GET } = await import(path);
      const byQuery = await GET(new NextRequest('https://getmindy.ai/api/cron/x?password=admin-pw'));
      expect({ path, status: byQuery.status }).toEqual({ path, status: 401 });
      const wrong = await GET(new NextRequest('https://getmindy.ai/api/cron/x', { headers: { authorization: 'Bearer admin-pw' } }));
      expect({ path, status: wrong.status }).toEqual({ path, status: 401 });
      const spoofed = await GET(new NextRequest('https://getmindy.ai/api/cron/x', { headers: { 'x-vercel-cron': '1' } }));
      expect({ path, status: spoofed.status }).toEqual({ path, status: 401 });
    }
    delete process.env.ADMIN_PASSWORD;
    delete process.env.CRON_SECRET;
  });
});

// Minimal in-memory store for the runtime guard.
function memoryStore() {
  return {
    startRun: async () => 1,
    updateRun: async () => {},
    loadCursor: async (stream: 'crawl' | 'inspect', stratum: 'hub') => ({ stream, stratum, last_url: null, cycle: 0 }),
    saveCursor: async () => {},
    insertChecks: async (_id: number, checks: Array<{ url: string }>) => new Set(checks.map((c) => c.url)),
    upsertStratumDaily: async () => {},
    crawlHistory: async () => [],
    previousCompletedCanaries: async () => null,
    previousRunSummary: async () => null,
    inspections: async () => [],
    latestRuns: async () => [],
  };
}
