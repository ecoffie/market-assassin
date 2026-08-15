import { describe, it, expect, vi, beforeEach } from 'vitest';

const insert = vi.fn();
vi.mock('@/lib/supabase/server-clients', () => ({
  getWriteClient: () => ({ from: () => ({ insert }) }),
}));

import { recordSearch, recordSearchAxes } from './search-history';

beforeEach(() => { insert.mockReset(); insert.mockResolvedValue({ error: null }); });

describe('recordSearch', () => {
  it('writes the row with a normalized email', async () => {
    await recordSearch({ userEmail: '  Eric@GovconGiants.com ', tool: 'market_report', searchType: 'keyword', searchValue: ' hypersonic ' });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      user_email: 'eric@govcongiants.com',
      tool: 'market_report',
      search_type: 'keyword',
      search_value: 'hypersonic',
    }));
  });

  it('skips anonymous or empty searches rather than writing junk rows', async () => {
    await recordSearch({ userEmail: null, tool: 'mcp', searchType: 'keyword', searchValue: 'x' });
    await recordSearch({ userEmail: 'a@b.com', tool: 'mcp', searchType: 'keyword', searchValue: '   ' });
    expect(insert).not.toHaveBeenCalled();
  });

  /**
   * The property that matters most: this is instrumentation on a working path. A
   * logging failure must never turn a successful report or tool call into an error.
   */
  it('never throws when the insert errors', async () => {
    insert.mockResolvedValue({ error: { message: 'relation does not exist' } });
    await expect(recordSearch({ userEmail: 'a@b.com', tool: 'mcp', searchType: 'naics', searchValue: '541511' })).resolves.toBeUndefined();
  });

  it('never throws when the client itself blows up', async () => {
    insert.mockRejectedValue(new Error('connection refused'));
    await expect(recordSearch({ userEmail: 'a@b.com', tool: 'mcp', searchType: 'naics', searchValue: '541511' })).resolves.toBeUndefined();
  });
});

describe('recordSearchAxes', () => {
  it('logs each axis as its own row — a multi-axis search is several facts', async () => {
    recordSearchAxes('a@b.com', 'market_report', { keyword: 'hypersonic', naics: '541715', agency: 'DOD' });
    await new Promise((r) => setTimeout(r, 0));
    expect(insert).toHaveBeenCalledTimes(3);
    const types = insert.mock.calls.map((c) => c[0].search_type).sort();
    expect(types).toEqual(['agency', 'keyword', 'naics']);
  });

  it('ignores empty axes', async () => {
    recordSearchAxes('a@b.com', 'mcp', { keyword: 'drones', naics: undefined, psc: '' });
    await new Promise((r) => setTimeout(r, 0));
    expect(insert).toHaveBeenCalledTimes(1);
  });
});
