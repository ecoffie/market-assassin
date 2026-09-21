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

describe('getCountClient — always the primary (the replica 400s every HEAD)', () => {
  // Regression guard for the 2026-07-16 incident: the Supabase read-replica
  // endpoint rejects EVERY HTTP HEAD request with a 400, and supabase-js issues a
  // HEAD for `{ count: 'exact', head: true }`. Head-counts routed at the replica
  // therefore always failed — and callers doing `count ?? 0` / `count || 0` turned
  // that failure into a confident zero. cron/snapshot-metrics recorded
  // setup_emails_sent = 0 for nine days (190 emails erased) before anyone noticed.
  // If someone "optimizes" this to getReadClient(), that bug comes straight back.
  it('uses the PRIMARY even when a replica IS configured', async () => {
    process.env.SUPABASE_REPLICA_URL = REPLICA;
    const { getCountClient } = await load();
    getCountClient();
    expect(created.map((c) => c.url)).toEqual([PRIMARY]); // NEVER the replica
  });

  it('uses the primary when no replica is configured', async () => {
    const { getCountClient } = await load();
    getCountClient();
    expect(created.map((c) => c.url)).toEqual([PRIMARY]);
  });

  it('shares the write client (one pool, not a third connection)', async () => {
    process.env.SUPABASE_REPLICA_URL = REPLICA;
    const { getCountClient, getWriteClient } = await load();
    expect(getCountClient()).toBe(getWriteClient());
    expect(created).toHaveLength(1);
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
