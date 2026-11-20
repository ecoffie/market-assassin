import { beforeEach, describe, expect, it, vi } from 'vitest';
import { searchSbir } from './search';

describe('searchSbir agency availability', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('NSF is unavailable and is not sent to NIH RePORTER', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await searchSbir({ agency: 'NSF' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      opportunities: [],
      total: null,
      degraded: true,
      result_state: 'unavailable',
    });
    expect(result.unavailable_reason).toMatch(/403/);
    expect(result.total).not.toBe(0);
  });

  it('NIDA is still queried on RePORTER', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        results: [{
          project_num: 'NIDA-1',
          project_title: 'A NIDA award',
          activity_code: 'R43',
          agency_ic_admin: { abbreviation: 'NIDA' },
        }],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await searchSbir({ agency: 'NIDA' });
    expect(fetchMock).toHaveBeenCalledOnce();
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body)).criteria.agencies).toEqual(['NIDA']);
    expect(result.total).toBe(1);
    expect(result.degraded).toBe(false);
    expect(result.result_state).toBe('matched');
  });
});
