/** /contracts page-1 warming: cache first, live only when cold, nothing for no-award contractors. */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/bigquery/recipients', () => ({ getPaginatedAwardsForRecipient: vi.fn() }));

import { warmContractsPage1, CONTRACTS_PAGE_SIZE } from './contracts-page-warm';

type State = 'ok' | 'unavailable' | 'failed';
const reader = (cacheOnly: State, live: State = 'ok') =>
  vi.fn(async (_u: string[], _r: string, _p: number, _s?: number, liveBq = false) => ({
    rows: [], total: 0, available: (liveBq ? live : cacheOnly) === 'ok', state: liveBq ? live : cacheOnly,
  }));
const R = { child_ueis: ['UEI1', 'UEI2'], rollup_uei: 'UEI1', award_count: 12 };

describe('warmContractsPage1', () => {
  it('cold page ⇒ one cache-only read, then ONE live read of page 1 at the page size', async () => {
    const read = reader('unavailable', 'ok');
    expect(await warmContractsPage1(R, read)).toBe('warmed');
    expect(read).toHaveBeenCalledTimes(2);
    expect(read).toHaveBeenNthCalledWith(1, ['UEI1', 'UEI2'], 'UEI1', 1, CONTRACTS_PAGE_SIZE, false);
    expect(read).toHaveBeenNthCalledWith(2, ['UEI1', 'UEI2'], 'UEI1', 1, CONTRACTS_PAGE_SIZE, true);
  });

  it('cache reuse: page already served (KV or durable table) ⇒ no live read, no BigQuery', async () => {
    const read = reader('ok');
    expect(await warmContractsPage1(R, read)).toBe('cached');
    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0][4]).toBe(false);
  });

  it('contractor with no awards ⇒ nothing read at all', async () => {
    for (const award_count of [0, null, undefined]) {
      const read = reader('unavailable');
      expect(await warmContractsPage1({ ...R, award_count }, read)).toBe('no-awards');
      expect(read).not.toHaveBeenCalled();
    }
  });

  it('cache source errored ⇒ failed, and no live retry into the same wall', async () => {
    const read = reader('failed');
    expect(await warmContractsPage1(R, read)).toBe('failed');
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('live read did not answer (BigQuery quota / budget exhausted) ⇒ failed, never "warmed"', async () => {
    for (const live of ['failed', 'unavailable'] as const) {
      expect(await warmContractsPage1(R, reader('unavailable', live))).toBe('failed');
    }
  });

  it('the /contracts page uses the same page size (it is part of the cache key)', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/app/contractors/[slug]/contracts/[[...page]]/page.tsx', 'utf8');
    expect(src).toMatch(/const PAGE_SIZE = CONTRACTS_PAGE_SIZE;/);
  });
});
