/** "What's your ranking?" — rank by lifetime dollars to a UEI; honest states, never a fake rank. */
import { describe, expect, it, vi } from 'vitest';

vi.mock('./client', () => ({ BQ_TABLES: { recipients: '`p.d.recipients`' } }));
vi.mock('./cache', () => ({ queryCached: vi.fn(), bqUnavailable: vi.fn() }));

const { toResult, normalizeUei, topPercent, getUeiRanking } = await import('./uei-ranking');
const cache = await import('./cache');

const row = (over: Record<string, unknown> = {}) => ({
  recipient_name: 'ACME LLC', state: 'FL', total_obligated: 12_400_000,
  rank_all: 4210, count_all: 317_402, rank_state: 38, count_state: 9210,
  since: '2007-10-01', as_of: '2026-04-23', ...over,
});

describe('UEI ranking', () => {
  it('maps a row to an overall + in-state rank', () => {
    expect(toResult([row()], 'ABC123DEF456')).toEqual({
      status: 'ok',
      ranking: {
        uei: 'ABC123DEF456', name: 'ACME LLC', state: 'FL', totalObligated: 12_400_000,
        rankAll: 4210, countAll: 317_402, rankState: 38, countState: 9210, since: '2007-10-01', asOf: '2026-04-23',
      },
    });
  });

  it('a UEI not in the table is not_found (the aggregate row comes back all-null), never rank #1', () => {
    expect(toResult([row({ recipient_name: null, state: null, total_obligated: null, rank_all: 1, count_all: 317_402 })], 'X').status).toBe('not_found');
    expect(toResult([], 'X').status).toBe('not_found');
  });

  it('a lifetime total of zero or less is not ranked', () => {
    expect(toResult([row({ total_obligated: -500 })], 'X')).toEqual({ status: 'not_ranked', totalObligated: -500 });
  });

  it('no state → no in-state rank (a NULL state would otherwise read as #1)', () => {
    const r = toResult([row({ state: null, rank_state: 1, count_state: 0 })], 'X');
    expect(r.status === 'ok' && r.ranking.rankState).toBeNull();
  });

  it('normalizes and validates the UEI', () => {
    expect(normalizeUei(' abc123def456 ')).toBe('ABC123DEF456');
    expect(normalizeUei('short')).toBeNull();
    expect(normalizeUei(null)).toBeNull();
  });

  it('top percent never claims a better tier than the rank earns', () => {
    expect(topPercent(4210, 317_402)).toBe('top 2%');
    expect(topPercent(300, 317_402)).toBe('top 0.1%');
    expect(topPercent(2000, 317_402)).toBe('top 0.7%');
    expect(topPercent(1, 0)).toBe('');
  });

  it('a cold or failed query is unavailable, not a rank', async () => {
    vi.mocked(cache.queryCached).mockResolvedValueOnce([]);
    vi.mocked(cache.bqUnavailable).mockReturnValueOnce(true);
    expect(await getUeiRanking('ABC123DEF456')).toEqual({ status: 'unavailable' });
  });

  it('an invalid UEI never queries', async () => {
    vi.mocked(cache.queryCached).mockClear();
    expect(await getUeiRanking('nope')).toEqual({ status: 'not_found' });
    expect(cache.queryCached).not.toHaveBeenCalled();
  });
});
