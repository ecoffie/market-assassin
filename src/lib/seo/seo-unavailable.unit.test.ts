import { beforeEach, describe, expect, it, vi } from 'vitest';

const kvMock = vi.hoisted(() => ({ incr: vi.fn(), expire: vi.fn() }));
vi.mock('@vercel/kv', () => ({ kv: kvMock }));

import {
  seoColdDailyLimit,
  takeSeoColdBudget,
  isSeoTemporarilyUnavailable,
  SeoTemporarilyUnavailableError,
} from './seo-unavailable';

describe('cold-render budget', () => {
  beforeEach(() => {
    kvMock.incr.mockReset();
    kvMock.expire.mockReset();
    delete process.env.SEO_CONTRACTOR_COLD_LOOKUPS_PER_DAY;
  });

  it('defaults to 200/day, honors overrides, and 0 turns cold renders off', () => {
    expect(seoColdDailyLimit('contractor', {})).toBe(200);
    expect(seoColdDailyLimit('contracts', { SEO_CONTRACTS_COLD_LOOKUPS_PER_DAY: '50' })).toBe(50);
    expect(seoColdDailyLimit('contractor', { SEO_CONTRACTOR_COLD_LOOKUPS_PER_DAY: '0' })).toBe(0);
    expect(seoColdDailyLimit('contractor', { SEO_CONTRACTOR_COLD_LOOKUPS_PER_DAY: 'junk' })).toBe(200);
  });

  it('allows up to the limit, then refuses', async () => {
    process.env.SEO_CONTRACTOR_COLD_LOOKUPS_PER_DAY = '2';
    kvMock.incr.mockResolvedValueOnce(1).mockResolvedValueOnce(2).mockResolvedValueOnce(3);
    expect(await takeSeoColdBudget('contractor')).toBe(true);
    expect(await takeSeoColdBudget('contractor')).toBe(true);
    expect(await takeSeoColdBudget('contractor')).toBe(false);
    expect(kvMock.expire).toHaveBeenCalledTimes(1); // TTL set on the first unit only
  });

  it('FAILS CLOSED when KV is down — the moment every page reads cold at once', async () => {
    kvMock.incr.mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await takeSeoColdBudget('contractor')).toBe(false);
  });

  it('a 0 limit never touches KV', async () => {
    process.env.SEO_CONTRACTOR_COLD_LOOKUPS_PER_DAY = '0';
    expect(await takeSeoColdBudget('contractor')).toBe(false);
    expect(kvMock.incr).not.toHaveBeenCalled();
  });

  it('keys the budget by UTC day and page family', async () => {
    kvMock.incr.mockResolvedValue(5);
    await takeSeoColdBudget('contracts', new Date('2026-11-12T23:59:00Z'));
    expect(kvMock.incr).toHaveBeenCalledWith('rl:seo-cold:contracts:2026-11-12');
  });
});

describe('temporary-unavailable error', () => {
  it('is recognizable across a serialization boundary by its message prefix', () => {
    const e = new SeoTemporarilyUnavailableError('profile x: cold-budget-exhausted');
    expect(isSeoTemporarilyUnavailable(e)).toBe(true);
    expect(isSeoTemporarilyUnavailable(new Error(e.message))).toBe(true);
    expect(isSeoTemporarilyUnavailable(new Error('boom'))).toBe(false);
  });
});
