import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * last-good is the graceful-degradation core: on a DB outage a read route serves
 * its last SUCCESSFUL payload from KV instead of erroring. These tests lock the
 * contract that matters during an incident — save→read round-trips, the
 * memory/KV fallback order, KV failures degrading to null (never throwing), and
 * the fresh/degraded envelope shape the client banner reads.
 *
 * @vercel/kv is mocked so tests never touch a real store.
 */

const kvStore = new Map<string, unknown>();
const kvSet = vi.fn(async (k: string, v: unknown) => { kvStore.set(k, v); });
const kvGet = vi.fn(async (k: string) => (kvStore.has(k) ? kvStore.get(k) : null));

vi.mock('@vercel/kv', () => ({
  kv: {
    set: (k: string, v: unknown) => kvSet(k, v),
    get: (k: string) => kvGet(k),
  },
}));

import {
  saveSnapshot,
  readSnapshot,
  freshMeta,
  degradedMeta,
  isUpstreamOutage,
  withLastGood,
} from './last-good';

beforeEach(() => {
  kvStore.clear();
  kvSet.mockClear();
  kvGet.mockClear();
  kvSet.mockImplementation(async (k: string, v: unknown) => { kvStore.set(k, v); });
  kvGet.mockImplementation(async (k: string) => (kvStore.has(k) ? kvStore.get(k) : null));
});

describe('saveSnapshot / readSnapshot round-trip', () => {
  it('reads back exactly what was saved, with a savedAt timestamp', async () => {
    await saveSnapshot('recompete:x', { success: true, vehicles: [1, 2, 3] });
    const snap = await readSnapshot<{ success: boolean; vehicles: number[] }>('recompete:x');
    expect(snap).not.toBeNull();
    expect(snap!.data).toEqual({ success: true, vehicles: [1, 2, 3] });
    expect(typeof snap!.savedAt).toBe('string');
    expect(Number.isNaN(Date.parse(snap!.savedAt))).toBe(false);
  });

  it('keys are isolated — one filter never serves another filter\'s data', async () => {
    await saveSnapshot('recompete:naics=541512', { rows: 'A' });
    await saveSnapshot('recompete:naics=236220', { rows: 'B' });
    expect((await readSnapshot<{ rows: string }>('recompete:naics=541512'))!.data.rows).toBe('A');
    expect((await readSnapshot<{ rows: string }>('recompete:naics=236220'))!.data.rows).toBe('B');
  });

  it('returns null when no snapshot has ever been saved for the key', async () => {
    expect(await readSnapshot('never-seen')).toBeNull();
  });
});

describe('memory vs KV fallback order', () => {
  it('serves from the in-memory copy without hitting KV (warm-lambda fast path)', async () => {
    await saveSnapshot('warm', { v: 1 });
    kvGet.mockClear();
    const snap = await readSnapshot<{ v: number }>('warm');
    expect(snap!.data.v).toBe(1);
    // memory hit → no KV read
    expect(kvGet).not.toHaveBeenCalled();
  });

  it('falls back to KV when memory is cold (simulated cross-lambda outage read)', async () => {
    // Seed KV directly, bypassing saveSnapshot so nothing is in this "lambda's" memory.
    kvStore.set('lastgood:cold', { data: { v: 9 }, savedAt: new Date('2026-07-03T19:00:00Z').toISOString() });
    const snap = await readSnapshot<{ v: number }>('cold');
    expect(snap!.data.v).toBe(9);
    expect(kvGet).toHaveBeenCalledTimes(1);
  });
});

describe('KV resilience — a KV failure must never break the route', () => {
  it('saveSnapshot swallows a KV write error (still resolves)', async () => {
    kvSet.mockRejectedValueOnce(new Error('ERR max requests limit exceeded'));
    await expect(saveSnapshot('kv-down', { v: 1 })).resolves.toBeUndefined();
    // memory copy still works even though KV write failed
    expect((await readSnapshot<{ v: number }>('kv-down'))!.data.v).toBe(1);
  });

  it('readSnapshot returns null (not throw) when KV read fails and memory is cold', async () => {
    kvGet.mockRejectedValueOnce(new Error('ERR max requests limit exceeded'));
    await expect(readSnapshot('kv-read-down')).resolves.toBeNull();
  });
});

describe('degradation envelope', () => {
  it('freshMeta marks a live response, not degraded', () => {
    const m = freshMeta();
    expect(m._fresh).toBe(true);
    expect(m._degraded).toBe(false);
    expect(typeof m._servedAt).toBe('string');
  });

  it('degradedMeta carries the ORIGINAL capture time so the banner is honest', () => {
    const saved = '2026-07-03T14:14:00.000Z';
    const m = degradedMeta(saved);
    expect(m._fresh).toBe(false);
    expect(m._degraded).toBe(true);
    expect(m._servedAt).toBe(saved); // exact snapshot time, not "now"
  });
});

describe('isUpstreamOutage — only mask INFRA failures, never app bugs', () => {
  it.each([
    'fetch failed',
    'Connection terminated unexpectedly',
    'ETIMEDOUT',
    'ECONNREFUSED',
    'statement timeout',
    'too many clients already',
    'Database unreachable',
    'upstream connect error',
    'supabase request failed',
  ])('treats "%s" as an outage (serve stale)', (msg) => {
    expect(isUpstreamOutage(new Error(msg))).toBe(true);
  });

  it.each([
    'Cannot read properties of undefined',
    'column foo does not exist',
    'invalid input syntax for type integer',
    'TypeError: x is not a function',
  ])('treats "%s" as a real bug (do NOT mask)', (msg) => {
    expect(isUpstreamOutage(new Error(msg))).toBe(false);
  });

  it('handles non-Error throwables without crashing', () => {
    expect(isUpstreamOutage('connection reset')).toBe(true);
    expect(isUpstreamOutage(null)).toBe(false);
  });
});

describe('withLastGood — the one-call wrapper', () => {
  it('success → saves a snapshot and returns fresh, not degraded', async () => {
    const { data, meta, degraded } = await withLastGood('wlg:ok', async () => ({ n: 42 }));
    expect(data).toEqual({ n: 42 });
    expect(meta._fresh).toBe(true);
    expect(degraded).toBe(false);
    // snapshot persisted for a future outage
    expect((await readSnapshot<{ n: number }>('wlg:ok'))!.data.n).toBe(42);
  });

  it('outage WITH a prior snapshot → serves stale at degraded, no throw', async () => {
    await withLastGood('wlg:deg', async () => ({ n: 1 }));      // seed a good snapshot
    const { data, meta, degraded } = await withLastGood('wlg:deg', async () => {
      throw new Error('Connection terminated unexpectedly');     // now the DB is "down"
    });
    expect(data).toEqual({ n: 1 });      // last-good served
    expect(degraded).toBe(true);
    expect(meta._degraded).toBe(true);
  });

  it('outage with NO snapshot → rethrows (caller returns its own error)', async () => {
    await expect(
      withLastGood('wlg:cold', async () => { throw new Error('fetch failed'); }),
    ).rejects.toThrow('fetch failed');
  });

  it('a REAL app bug is rethrown even if a snapshot exists (never masked)', async () => {
    await withLastGood('wlg:bug', async () => ({ n: 1 }));       // seed a snapshot
    await expect(
      withLastGood('wlg:bug', async () => { throw new Error('column x does not exist'); }),
    ).rejects.toThrow('column x does not exist');               // bug surfaces, not hidden
  });
});
