import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The read/write client factory is the ONLY thing that decides replica-vs-primary
 * routing (Resilience Phase 1). These tests lock the safety contract: writes are
 * ALWAYS primary, reads fall back to primary when no replica is configured (so
 * the file is a no-op until a replica exists), and reads use the replica host
 * only when SUPABASE_REPLICA_URL is set.
 *
 * We mock @supabase/supabase-js and record which URL each createClient got.
 */

const created: { url: string }[] = [];
vi.mock('@supabase/supabase-js', () => ({
  createClient: (url: string) => {
    created.push({ url });
    return { __url: url } as unknown;
  },
}));

const PRIMARY = 'https://primary.supabase.co';
const REPLICA = 'https://replica.supabase.co';
const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  created.length = 0;
  process.env.NEXT_PUBLIC_SUPABASE_URL = PRIMARY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-key';
  delete process.env.SUPABASE_REPLICA_URL;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

async function load() {
  return await import('./server-clients');
}

describe('getWriteClient — always the primary', () => {
  it('uses the primary URL for writes', async () => {
    const { getWriteClient } = await load();
    getWriteClient();
    expect(created.map((c) => c.url)).toEqual([PRIMARY]);
  });

  it('even when a replica IS configured, writes still go to the primary', async () => {
    process.env.SUPABASE_REPLICA_URL = REPLICA;
    const { getWriteClient } = await load();
    getWriteClient();
    expect(created.map((c) => c.url)).toEqual([PRIMARY]); // never the replica
  });
});

describe('getReadClient — safe-by-default', () => {
  it('falls back to the PRIMARY when no replica is configured (no-op)', async () => {
    const { getReadClient, isReplicaConfigured } = await load();
    getReadClient();
    expect(isReplicaConfigured()).toBe(false);
    expect(created.map((c) => c.url)).toEqual([PRIMARY]);
  });

  it('uses the REPLICA host when SUPABASE_REPLICA_URL is set', async () => {
    process.env.SUPABASE_REPLICA_URL = REPLICA;
    const { getReadClient, isReplicaConfigured } = await load();
    getReadClient();
    expect(isReplicaConfigured()).toBe(true);
    expect(created.map((c) => c.url)).toEqual([REPLICA]);
  });
});

describe('client reuse (one pool per lambda)', () => {
  it('returns the same write client on repeated calls', async () => {
    const { getWriteClient } = await load();
    const a = getWriteClient();
    const b = getWriteClient();
    expect(a).toBe(b);
    expect(created).toHaveLength(1); // not re-created
  });

  it('read and write are DISTINCT clients when a replica is set', async () => {
    process.env.SUPABASE_REPLICA_URL = REPLICA;
    const { getReadClient, getWriteClient } = await load();
    const r = getReadClient();
    const w = getWriteClient();
    expect(r).not.toBe(w);
    expect(created.map((c) => c.url).sort()).toEqual([PRIMARY, REPLICA].sort());
  });

  it('read and write are the SAME client when no replica (both primary)', async () => {
    const { getReadClient, getWriteClient } = await load();
    const r = getReadClient();
    const w = getWriteClient();
    expect(r).toBe(w); // reads reuse the primary client
    expect(created).toHaveLength(1);
  });
});
