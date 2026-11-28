import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The shared KV store is DOWN for every test in this file.
const kvState = vi.hoisted(() => ({ down: true, count: 0 }));
vi.mock('@vercel/kv', () => ({
  kv: {
    incr: async () => { if (kvState.down) throw new Error('kv unreachable'); return ++kvState.count; },
    expire: async () => 1,
    ttl: async () => 3600,
  },
}));

import { checkVaultLimit, __resetVaultLocalLimits, VAULT_LIMITS } from './rate-limits';
import { checkRateLimit } from '@/lib/rate-limit';

/**
 * Uploads fail closed when rate limiting is unavailable (VAULT_UPLOAD_LIMIT_FAIL_CLOSED='true').
 * With the flag off, behaviour is unchanged (shared limiter, then the per-instance window).
 */
beforeEach(() => { vi.unstubAllEnvs(); __resetVaultLocalLimits(); kvState.down = true; kvState.count = 0; });
afterEach(() => vi.unstubAllEnvs());

describe('shared limiter reports when it is only guessing', () => {
  it('marks the allow-by-default fallback as unavailable', async () => {
    const r = await checkRateLimit('t:1', 5, 60);
    expect(r).toMatchObject({ allowed: true, unavailable: true });
  });
  it('a real KV answer is not marked unavailable', async () => {
    kvState.down = false;
    const r = await checkRateLimit('t:2', 5, 60);
    expect(r.allowed).toBe(true);
    expect(r.unavailable).toBeUndefined();
  });
});

describe('Vault upload limit when KV is down', () => {
  it('flag ON: an upload is refused, with nothing saved and a retry time', async () => {
    vi.stubEnv('VAULT_UPLOAD_LIMIT_FAIL_CLOSED', 'true');
    const r = await checkVaultLimit('upload', 'a@x.com');
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.retryAfterSeconds).toBeGreaterThan(0);
      expect(r.message).toMatch(/Nothing was saved/);
    }
  });

  it('flag ON: document parse keeps the existing fallback (only writes fail closed)', async () => {
    vi.stubEnv('VAULT_UPLOAD_LIMIT_FAIL_CLOSED', 'true');
    expect((await checkVaultLimit('parse', 'a@x.com')).allowed).toBe(true);
  });

  it('flag OFF (default): unchanged — allowed until the per-instance window is exceeded', async () => {
    for (let i = 0; i < VAULT_LIMITS.upload.limit; i++) expect((await checkVaultLimit('upload', 'b@x.com')).allowed).toBe(true);
    expect((await checkVaultLimit('upload', 'b@x.com')).allowed).toBe(false);
  });

  it('only the exact value "true" turns it on', async () => {
    vi.stubEnv('VAULT_UPLOAD_LIMIT_FAIL_CLOSED', 'yes');
    expect((await checkVaultLimit('upload', 'c@x.com')).allowed).toBe(true);
  });

  it('flag ON but KV healthy: normal limiting applies', async () => {
    vi.stubEnv('VAULT_UPLOAD_LIMIT_FAIL_CLOSED', 'true');
    kvState.down = false;
    expect((await checkVaultLimit('upload', 'd@x.com')).allowed).toBe(true);
  });
});
