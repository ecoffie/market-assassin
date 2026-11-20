/**
 * GET /api/sbir?agency=NSF used to default source=nih, ask NIH RePORTER for
 * agencies:["NSF"], and return that HTTP 200 total-0 as count 0 / _degraded false.
 */
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { saveSnapshot, fetchMock } = vi.hoisted(() => ({
  saveSnapshot: vi.fn(async () => undefined),
  fetchMock: vi.fn(),
}));

vi.mock('@/lib/resilience/last-good', () => ({
  saveSnapshot: (...args: unknown[]) => saveSnapshot(...args),
  readSnapshot: async () => null,
  freshMeta: () => ({ _fresh: true, _degraded: false, _servedAt: '2026-11-20T00:00:00.000Z' }),
  degradedMeta: (savedAt: string) => ({ _fresh: false, _degraded: true, _servedAt: savedAt }),
  isUpstreamOutage: () => false,
}));

import { GET } from './route';

function call(qs: string) {
  return GET(new NextRequest(`https://getmindy.ai/api/sbir${qs}`));
}

describe('GET /api/sbir agency routing', () => {
  beforeEach(() => {
    saveSnapshot.mockClear();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('agency=NSF is unavailable and is not sent to NIH', async () => {
    const res = await call('?agency=NSF');
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(saveSnapshot).not.toHaveBeenCalled();
    expect(body).toMatchObject({
      count: null,
      opportunities: [],
      result_state: 'unavailable',
      source: 'nsf',
      _degraded: true,
    });
    expect(body.unavailable_reason).toMatch(/403/);
    expect(body.searchCriteria.source).toBe('nsf');
  });

  it('an NIH institute with zero RePORTER rows is an empty result', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ meta: { total: 0, offset: 0, limit: 25 }, results: [] }),
    });
    const res = await call('?agency=NCI');
    const body = await res.json();
    expect(fetchMock).toHaveBeenCalledOnce();
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body)).criteria.agencies).toEqual(['NCI']);
    expect(body).toMatchObject({
      count: 0,
      opportunities: [],
      result_state: 'empty',
      source: 'nih',
      _degraded: false,
    });
    expect(body.empty_reason).toMatch(/empty result/);
  });

  it.each(['NIDA', 'NEI', 'NHGRI'])('agency=%s is sent to RePORTER and returned rows are kept', async (code) => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        meta: { total: 1, offset: 0, limit: 25 },
        results: [{
          project_num: `${code}-1`,
          project_title: `${code} awarded project`,
          activity_code: 'R43',
          agency_ic_admin: { abbreviation: code, name: code },
        }],
      }),
    });
    const res = await call(`?agency=${code}`);
    const body = await res.json();
    expect(fetchMock).toHaveBeenCalledOnce();
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body)).criteria.agencies).toEqual([code]);
    expect(body).toMatchObject({
      count: 1,
      result_state: 'matched',
      source: 'nih',
      _degraded: false,
    });
    expect(body.opportunities[0]).toMatchObject({ id: `${code}-1`, agency: code });
  });

  it('an NIH HTTP failure is unavailable, not a fresh zero', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    const res = await call('?agency=NCI&keyword=malaria');
    const body = await res.json();
    expect(saveSnapshot).not.toHaveBeenCalled();
    expect(body).toMatchObject({
      count: null,
      result_state: 'unavailable',
      source: 'nih',
      _degraded: true,
    });
    expect(body.unavailable_reason).toMatch(/503/);
  });
});
