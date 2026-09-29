import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Controllable fakes for the two dependencies the probe reads.
const db = { result: { error: null as unknown }, delayMs: 0, throws: false };
const cache = { delayMs: 0, reject: false };
const kvGet = vi.fn();
const kvWrite = vi.fn();

vi.mock('@/lib/supabase/server-clients', () => ({
  getReadClient: () => {
    if (db.throws) throw new Error('missing env');
    return {
      from: () => ({
        select: () => ({
          limit: () => new Promise((resolve) => setTimeout(() => resolve(db.result), db.delayMs)),
        }),
      }),
    };
  },
}));

vi.mock('@vercel/kv', () => ({
  kv: {
    get: (...args: unknown[]) => {
      kvGet(...args);
      return new Promise((resolve, reject) =>
        setTimeout(() => (cache.reject ? reject(new Error('kv down: secret-host:6379')) : resolve(null)), cache.delayMs),
      );
    },
    set: kvWrite,
    del: kvWrite,
    incr: kvWrite,
  },
}));

async function callHealth() {
  const { GET } = await import('./route');
  const res = await GET();
  return { res, body: await res.json() };
}

beforeEach(() => {
  db.result = { error: null };
  db.delayMs = 0;
  db.throws = false;
  cache.delayMs = 0;
  cache.reject = false;
  kvGet.mockClear();
  kvWrite.mockClear();
  process.env.KV_REST_API_URL = 'https://kv.test';
  process.env.KV_REST_API_TOKEN = 'kv-token';
});

afterEach(() => {
  vi.useRealTimers();
});

describe('GET /api/health', () => {
  it('returns 200 ok with no-store when the database and KV both answer', async () => {
    const { res, body } = await callHealth();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store, max-age=0');
    expect(body.ok).toBe(true);
    expect(body.status).toBe('ok');
    expect(body.checks.database.ok).toBe(true);
    expect(body.checks.cache.ok).toBe(true);
  });

  it('returns 503 degraded when the database returns an error', async () => {
    db.result = { error: { message: 'relation does not exist' } };
    const { res, body } = await callHealth();
    expect(res.status).toBe(503);
    expect(body.ok).toBe(false);
    expect(body.checks.database).toMatchObject({ ok: false, error: 'error' });
    expect(body.checks.cache.ok).toBe(true);
  });

  it('returns 503 with error=timeout when a dependency hangs past the 2s budget', async () => {
    vi.useFakeTimers();
    db.delayMs = 10_000;
    const pending = callHealth();
    await vi.advanceTimersByTimeAsync(2_001);
    const { res, body } = await pending;
    expect(res.status).toBe(503);
    expect(body.checks.database).toMatchObject({ ok: false, error: 'timeout' });
  });

  it('reports unconfigured instead of throwing when env is missing', async () => {
    db.throws = true;
    delete process.env.KV_REST_API_URL;
    const { res, body } = await callHealth();
    expect(res.status).toBe(503);
    expect(body.checks.database.error).toBe('unconfigured');
    expect(body.checks.cache.error).toBe('unconfigured');
  });

  it('never leaks the underlying error message on a public route', async () => {
    cache.reject = true;
    const { body } = await callHealth();
    expect(body.checks.cache).toMatchObject({ ok: false, error: 'error' });
    expect(JSON.stringify(body)).not.toContain('secret-host');
  });

  it('only reads: one KV GET, no KV writes', async () => {
    await callHealth();
    expect(kvGet).toHaveBeenCalledTimes(1);
    expect(kvWrite).not.toHaveBeenCalled();
  });

  it('has no path to BigQuery, page regeneration or writes in its source', () => {
    const src = readFileSync(fileURLToPath(new URL('./route.ts', import.meta.url)), 'utf8');
    for (const forbidden of ['@/lib/bigquery', "from 'next/cache'", 'revalidatePath', 'revalidateTag', 'getWriteClient', '.insert(', '.update(', '.upsert(', '.delete(', 'kv.set', 'kv.del']) {
      expect(src).not.toContain(forbidden);
    }
  });
});
