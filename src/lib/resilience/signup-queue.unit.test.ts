import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * signup-queue is the "never lose a free-alert signup to a DB outage" buffer.
 * These tests lock the contract that matters during an incident: enqueue→drain
 * round-trip (FIFO), KV failures degrade (return false / [] / 0, never throw),
 * and unparseable entries are dropped rather than blocking the whole drain.
 *
 * @vercel/kv is mocked as an in-memory list.
 */

let list: string[] = [];
const lpush = vi.fn(async (_k: string, v: string) => { list.unshift(v); return list.length; });
const rpop = vi.fn(async () => (list.length ? list.pop()! : null));
const llen = vi.fn(async () => list.length);

vi.mock('@vercel/kv', () => ({
  kv: {
    lpush: (k: string, v: string) => lpush(k, v),
    rpop: () => rpop(),
    llen: () => llen(),
  },
}));

import {
  enqueuePendingSignup,
  drainPendingSignups,
  pendingSignupCount,
  requeuePendingSignup,
} from './signup-queue';

beforeEach(() => {
  list = [];
  lpush.mockClear(); rpop.mockClear(); llen.mockClear();
  lpush.mockImplementation(async (_k: string, v: string) => { list.unshift(v); return list.length; });
  rpop.mockImplementation(async () => (list.length ? list.pop()! : null));
  llen.mockImplementation(async () => list.length);
});

describe('enqueue / drain round-trip', () => {
  it('captures an email and drains it back with the same fields + a queuedAt', async () => {
    expect(await enqueuePendingSignup({ email: 'a@x.com', source: 'signup' })).toBe(true);
    const drained = await drainPendingSignups();
    expect(drained).toHaveLength(1);
    expect(drained[0].email).toBe('a@x.com');
    expect(drained[0].source).toBe('signup');
    expect(typeof drained[0].queuedAt).toBe('string');
  });

  it('drains FIFO — the first person to sign up is completed first', async () => {
    await enqueuePendingSignup({ email: 'first@x.com' });
    await enqueuePendingSignup({ email: 'second@x.com' });
    const drained = await drainPendingSignups();
    expect(drained.map((d) => d.email)).toEqual(['first@x.com', 'second@x.com']);
  });

  it('respects the max drain cap and leaves the rest queued', async () => {
    for (let i = 0; i < 5; i++) await enqueuePendingSignup({ email: `u${i}@x.com` });
    const drained = await drainPendingSignups(2);
    expect(drained).toHaveLength(2);
    expect(await pendingSignupCount()).toBe(3);
  });

  it('drain on an empty queue returns [] (no crash)', async () => {
    expect(await drainPendingSignups()).toEqual([]);
  });

  it('requeue puts a failed entry back for the next drain', async () => {
    await requeuePendingSignup({ email: 'retry@x.com', queuedAt: new Date('2026-07-03T19:00:00Z').toISOString() });
    expect(await pendingSignupCount()).toBe(1);
    expect((await drainPendingSignups())[0].email).toBe('retry@x.com');
  });
});

describe('KV resilience — an outage of the QUEUE must never throw', () => {
  it('enqueue returns false (not throw) when KV is down', async () => {
    lpush.mockRejectedValueOnce(new Error('ERR max requests limit exceeded'));
    await expect(enqueuePendingSignup({ email: 'a@x.com' })).resolves.toBe(false);
  });

  it('drain returns [] when KV is down', async () => {
    rpop.mockRejectedValueOnce(new Error('kv down'));
    await expect(drainPendingSignups()).resolves.toEqual([]);
  });

  it('pendingSignupCount returns 0 when KV is down', async () => {
    llen.mockRejectedValueOnce(new Error('kv down'));
    await expect(pendingSignupCount()).resolves.toBe(0);
  });
});

describe('bad data handling', () => {
  it('drops an unparseable queue entry instead of failing the whole drain', async () => {
    list = ['{"email":"good@x.com","queuedAt":"2026-07-03T19:00:00Z"}', 'not-json{'];
    // rpop pulls from the end first ('not-json{') → dropped; then the good one.
    const drained = await drainPendingSignups();
    expect(drained.map((d) => d.email)).toEqual(['good@x.com']);
  });
});
