import { describe, expect, it, vi } from 'vitest';
import {
  decideDodSbirExecuteOutcome,
  probeDodSbirWithRetries,
} from './dod-sbir-outcome';

describe('decideDodSbirExecuteOutcome — false green cannot claim success', () => {
  it('api-down with empty corpus is not success (the 2026-11-18 defect)', () => {
    const o = decideDodSbirExecuteOutcome({ stopped: 'api-down', upserted: 0, heldRows: 0 });
    expect(o.success).toBe(false);
    expect(o.httpStatus).toBe(503);
    expect(o.cronOutcome).toBe('error');
    expect(o.disclosure).toMatch(/empty/);
  });

  it('api-down with an unmeasured held count is not an empty corpus', () => {
    const o = decideDodSbirExecuteOutcome({ stopped: 'api-down', upserted: 0, heldRows: null });
    expect(o.success).toBe(false);
    expect(o.httpStatus).toBe(503);
    expect(o.disclosure).toMatch(/unmeasured/);
    expect(o.disclosure).toMatch(/not an empty corpus/);
  });

  it('api-down with historical rows is still not success', () => {
    const o = decideDodSbirExecuteOutcome({ stopped: 'api-down', upserted: 0, heldRows: 42 });
    expect(o.success).toBe(false);
    expect(o.cronOutcome).toBe('error');
    expect(o.disclosure).toMatch(/unchanged/);
  });

  it('empty drain after last-page is not success', () => {
    const o = decideDodSbirExecuteOutcome({ stopped: 'last-page', upserted: 0, heldRows: 0 });
    expect(o.success).toBe(false);
    expect(o.httpStatus).toBe(503);
  });

  it('a real drain with rows held is success', () => {
    const o = decideDodSbirExecuteOutcome({ stopped: 'last-page', upserted: 100, heldRows: 100 });
    expect(o).toEqual({
      success: true,
      httpStatus: 200,
      cronOutcome: 'success',
      disclosure: '',
    });
  });

  it('budget stop with prior held rows (resume) is success', () => {
    const o = decideDodSbirExecuteOutcome({ stopped: 'budget', upserted: 50, heldRows: 150 });
    expect(o.success).toBe(true);
    expect(o.httpStatus).toBe(200);
  });

  it('rate-limit is partial, never green success', () => {
    const o = decideDodSbirExecuteOutcome({ stopped: 'rate-limit', upserted: 10, heldRows: 10 });
    expect(o.success).toBe(false);
    expect(o.cronOutcome).toBe('partial');
  });
});

describe('probeDodSbirWithRetries — temporary unavailability ≠ permanent disable', () => {
  it('recovers when a later probe succeeds', async () => {
    const sleep = vi.fn(async () => {});
    let n = 0;
    const { page, attemptsUsed } = await probeDodSbirWithRetries(
      async () => {
        n += 1;
        return n < 3
          ? { rateLimited: true, degraded: false }
          : { rateLimited: false, degraded: false };
      },
      { attempts: 3, delayMs: 1, sleep },
    );
    expect(page.rateLimited).toBe(false);
    expect(attemptsUsed).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('exhausts retries and leaves the down page for the 503 path', async () => {
    const sleep = vi.fn(async () => {});
    const { page, attemptsUsed } = await probeDodSbirWithRetries(
      async () => ({ rateLimited: false, degraded: true }),
      { attempts: 3, delayMs: 1, sleep },
    );
    expect(page.degraded).toBe(true);
    expect(attemptsUsed).toBe(3);
  });
});
