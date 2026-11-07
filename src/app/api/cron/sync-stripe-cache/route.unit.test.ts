/**
 * The dispatcher judges a job by its status code alone, so a failure in either half must be
 * non-2xx. Budget exhaustion with progress is a backlog, not a failure.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const sync = vi.hoisted(() => vi.fn());
vi.mock('@/lib/stripe/charge-sync', () => ({ syncChargesIncremental: sync }));

import { GET } from './route';

const subsOk = { ok: true, status: 200, json: async () => ({ success: true, stats: { subscriptions: { fetched: 5 } }, totalErrors: 0 }) };
const chargesOk = { ok: true, complete: true, upserted: 3, listed: 3, remaining: 0 };
const call = () => GET(new NextRequest('https://x.test/api/cron/sync-stripe-cache', { headers: { 'x-cron-dispatch': '1' } }));

beforeEach(() => {
  sync.mockReset();
  vi.stubGlobal('fetch', vi.fn(async () => subsOk));
  vi.stubEnv('STRIPE_CHARGE_SYNC_ENABLED', 'true');
});

describe('sync-stripe-cache charge switch', () => {
  it.each([[undefined], [''], ['false'], ['1'], ['TRUE']])('%s: charges do not run, subscriptions still sync', async (value) => {
    vi.stubEnv('STRIPE_CHARGE_SYNC_ENABLED', value as string);
    const res = await call();
    const j = await res.json();
    expect(sync).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(j.synced.charges).toEqual({ skipped: 'charge_sync_disabled' });
    expect(j.synced.subscriptions.fetched).toBe(5);
  });
});

describe('sync-stripe-cache fast path', () => {
  it('both halves clean: 200 and both reported', async () => {
    sync.mockResolvedValue(chargesOk);
    const res = await call();
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.success).toBe(true);
    expect(j.synced.charges.upserted).toBe(3);
    expect(j.synced.subscriptions.fetched).toBe(5);
  });

  it('a charge failure is non-2xx, and subscriptions still synced', async () => {
    sync.mockResolvedValue({ ok: false, complete: false, reason: 'failed', error: 'boom', upserted: 0 });
    const res = await call();
    const j = await res.json();
    expect(res.status).toBe(500);
    expect(j.failures).toEqual(['charges: boom']);
    expect(j.synced.subscriptions.fetched).toBe(5);
  });

  it('a subscription failure is non-2xx, and charges still run', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('net'); }));
    sync.mockResolvedValue(chargesOk);
    const res = await call();
    expect(res.status).toBe(500);
    expect((await res.json()).failures).toEqual(['subscriptions: net']);
    expect(sync).toHaveBeenCalledOnce();
  });

  it('row errors reported by the subscription sync are non-2xx, not a 200 with a note', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: false, stats: {}, errors: ['x'], totalErrors: 1 }) })));
    sync.mockResolvedValue(chargesOk);
    expect((await call()).status).toBe(500);
  });

  it('out of budget with progress is a backlog: 200, reported', async () => {
    sync.mockResolvedValue({ ok: true, complete: false, reason: 'time_budget', upserted: 200, remaining: 300 });
    const res = await call();
    expect(res.status).toBe(200);
    expect((await res.json()).synced.charges.remaining).toBe(300);
  });

  it('out of budget with no progress is a failure, or it would stall silently', async () => {
    sync.mockResolvedValue({ ok: true, complete: false, reason: 'time_budget', upserted: 0, remaining: 300 });
    expect((await call()).status).toBe(500);
  });

  it('gives charges a deadline inside the dispatcher budget', async () => {
    sync.mockResolvedValue(chargesOk);
    const before = Date.now();
    await call();
    const { deadlineMs } = sync.mock.calls[0][0];
    expect(deadlineMs - before).toBeLessThanOrEqual(250_000);
    expect(deadlineMs).toBeGreaterThan(before);
  });
});
