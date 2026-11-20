import { describe, expect, it } from 'vitest';
import { fetchWithRetry } from './http-retry';

function res(status: number): Response {
  return new Response('x', { status });
}

describe('fetchWithRetry', () => {
  it('retries a 503 and returns the later 200', async () => {
    const seen: string[] = [];
    const fetchImpl = (async (url: string) => {
      seen.push(url);
      return seen.length < 3 ? res(503) : res(200);
    }) as typeof fetch;
    const out = await fetchWithRetry('https://apfs-era.dhs.gov/api/apfs-public/forecasts/all', { cache: 'no-store' }, {
      attempts: 3,
      retryBaseMs: 0,
      fetchImpl,
    });
    expect(out.attempts).toBe(3);
    expect(out.response.status).toBe(200);
    expect(seen).toHaveLength(3);
  });

  it('does not retry a 403', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return res(403);
    }) as typeof fetch;
    const out = await fetchWithRetry('https://www.dhs.gov/file.csv', {}, { attempts: 3, retryBaseMs: 0, fetchImpl });
    expect(out.attempts).toBe(1);
    expect(out.response.status).toBe(403);
    expect(calls).toBe(1);
  });

  it('retries a thrown network error', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      if (calls === 1) throw new Error('timeout');
      return res(200);
    }) as typeof fetch;
    const out = await fetchWithRetry('https://example.test', {}, { attempts: 2, retryBaseMs: 0, fetchImpl });
    expect(out.response.status).toBe(200);
    expect(calls).toBe(2);
  });
});
